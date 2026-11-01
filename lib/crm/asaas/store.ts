import type { PoolClient } from 'pg'
import { todayInBrazil } from '../finance/model'
import { FinanceRuleError, recordSettlementInTx, reverseSettlementInTx, type FinancePool } from '../finance/store'
import { canCreateExternalCharge, type ParsedWebhookEvent } from './policy'
import {
  compareSubscription, decideReconciliation, matchPayment, receiptIdempotencyKey, resolveCompetence, STATE_RANK,
  type ReconcileAction, type SourceForLink,
} from './reconcile'
import {
  AsaasDataError, CUSTOMER_ID, normalizePayment, normalizeSubscription,
  type AsaasEnvironment, type AsaasReadGateway, type NormalizedPayment,
} from './types'

/**
 * Persistência da integração Asaas (migração 0016). Usada apenas por testes em banco descartável — não há rota,
 * tela nem chamada externa ligada a ela.
 *
 * Invariantes:
 *  - SERIALIZAÇÃO POR COBRANÇA: toda operação sobre uma cobrança roda em UMA transação, sob trava transacional
 *    própria daquela cobrança (pg_advisory_xact_lock), e lê → decide → executa dentro dela. Nenhuma decisão é
 *    executada sobre estado desatualizado; uma falha no meio desfaz tudo (nada fica pela metade).
 *  - Baixas/estornos usam as MESMAS regras do Financeiro (recordSettlementInTx / reverseSettlementInTx), com chave de
 *    idempotência determinística por cobrança.
 *  - ISOLAMENTO: o banco é ligado a um único ambiente (finance_asaas_binding); qualquer gravação de outro ambiente é
 *    recusada aqui e pelas chaves estrangeiras.
 *  - Ordem de trava (sem ciclos): trava da cobrança → linha da cobrança → linha do lançamento.
 */

export class AsaasLinkError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = 'AsaasLinkError' }
}

export type ReconcileHooks = {
  /** Chamado com a decisão tomada, ainda dentro da transação e sob a trava (testes determinísticos de concorrência). */
  afterDecide?: (action: ReconcileAction) => Promise<void>
  /** Chamado depois da execução e antes do COMMIT; lançar erro aqui simula queda no meio da operação. */
  afterExecute?: (action: ReconcileAction) => Promise<void>
}
export type ReconcileOptions = { today?: string; hooks?: ReconcileHooks }

async function tx<T>(pool: FinancePool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  let ok = false
  try {
    await c.query('BEGIN')
    await c.query("SET LOCAL statement_timeout = '15s'")
    await c.query("SET LOCAL lock_timeout = '10s'")
    const r = await fn(c)
    await c.query('COMMIT')
    ok = true
    return r
  } finally {
    if (!ok) await c.query('ROLLBACK').catch(() => undefined)
    c.release(ok ? undefined : true)
  }
}

const isUnique = (e: unknown) => (e as { code?: string })?.code === '23505'
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v))
const dateText = (v: unknown) => v === null || v === undefined ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10)

/** Trava transacional de UMA cobrança (liberada no COMMIT/ROLLBACK). Colisão de hash só serializa a mais. */
async function lockPayment(c: PoolClient, env: AsaasEnvironment, paymentId: string) {
  await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', ['asaas:' + env + ':' + paymentId])
}

async function log(c: PoolClient, env: AsaasEnvironment, entity: string, ref: string, action: string, actor: string, details: Record<string, unknown> = {}) {
  await c.query(`INSERT INTO crm.finance_integration_log (environment, entity, entity_ref, action, actor, details) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [env, entity, ref, action, actor, JSON.stringify(details)])
}

// ───────────────────────── isolamento de ambiente ─────────────────────────

/** Recusa qualquer gravação se o banco não estiver ligado a ESTE ambiente. */
async function requireBinding(c: PoolClient, env: AsaasEnvironment) {
  const r = await c.query('SELECT environment FROM crm.finance_asaas_binding')
  if (!r.rowCount) throw new AsaasLinkError('ASAAS_ENVIRONMENT_NOT_BOUND')
  if (r.rows[0].environment !== env) throw new AsaasLinkError('ENVIRONMENT_MISMATCH', 422)
}

/**
 * Liga este banco a um ambiente Asaas (passo administrativo único, Fase 2/3). O CRM real (Neon Preview) deve ser
 * ligado a 'production'; testes de Sandbox exigem um banco separado ligado a 'sandbox'. Não muda depois de ligado.
 */
export async function bindAsaasEnvironment(pool: FinancePool, environment: AsaasEnvironment, actor: string): Promise<void> {
  await tx(pool, async c => {
    await c.query('LOCK TABLE crm.finance_asaas_binding IN EXCLUSIVE MODE')
    const r = await c.query('SELECT environment FROM crm.finance_asaas_binding')
    if (r.rowCount) {
      if (r.rows[0].environment !== environment) throw new AsaasLinkError('ENVIRONMENT_ALREADY_BOUND')
      return
    }
    await c.query('INSERT INTO crm.finance_asaas_binding (environment, bound_by) VALUES ($1, $2)', [environment, actor])
    await log(c, environment, 'event', 'binding', 'environment_bound', actor)
  })
}

// ───────────────────────── vínculos ─────────────────────────

export async function linkCustomer(pool: FinancePool, input: { environment: AsaasEnvironment; clientId: string; asaasCustomerId: string }, actor: string): Promise<string> {
  if (!CUSTOMER_ID.test(input.asaasCustomerId)) throw new AsaasLinkError('INVALID_CUSTOMER_ID', 400)
  return tx(pool, async c => {
    await requireBinding(c, input.environment)
    const cl = await c.query('SELECT 1 FROM crm.finance_clients WHERE id = $1', [input.clientId])
    if (!cl.rowCount) throw new AsaasLinkError('CLIENT_NOT_FOUND', 404)
    const taken = await c.query(`SELECT client_id, asaas_customer_id FROM crm.finance_asaas_customers WHERE environment = $1 AND status = 'active'
      AND (client_id = $2 OR asaas_customer_id = $3)`, [input.environment, input.clientId, input.asaasCustomerId])
    if (taken.rows.some(r => r.asaas_customer_id === input.asaasCustomerId)) throw new AsaasLinkError('CUSTOMER_ALREADY_LINKED')
    if (taken.rowCount) throw new AsaasLinkError('CLIENT_ALREADY_LINKED')
    // O índice único continua sendo a garantia final (vínculos simultâneos): violação vira CUSTOMER_LINK_CONFLICT.
    const { rows } = await c.query(`INSERT INTO crm.finance_asaas_customers (environment, client_id, asaas_customer_id, created_by)
      VALUES ($1, $2, $3, $4) RETURNING id`, [input.environment, input.clientId, input.asaasCustomerId, actor])
    await log(c, input.environment, 'customer', input.asaasCustomerId, 'linked', actor, { clientId: input.clientId })
    return rows[0].id as string
  }).catch(e => { if (isUnique(e)) throw new AsaasLinkError('CUSTOMER_LINK_CONFLICT'); throw e })
}

/**
 * Vincula um contrato do CRM a uma assinatura EXISTENTE do Asaas (nunca cria/edita/cancela nada no Asaas). Compara
 * antes: ciclo incompatível ou contrato inelegível impede; valor/dia divergentes vinculam com sinalização.
 * Um contrato tem no máximo UMA assinatura ativa em qualquer ambiente. Recusa = contrato intacto.
 */
export async function linkSubscription(pool: FinancePool, input: {
  environment: AsaasEnvironment; sourceId: string; subscription: unknown; customerLinkId?: string | null
}, actor: string): Promise<{ id: string; divergences: string[] }> {
  const sub = normalizeSubscription(input.subscription)
  return tx(pool, async c => {
    await requireBinding(c, input.environment)
    const s = await c.query(`SELECT direction, status, periodicity, amount_cents, due_day, installment_plan, billing_provider, client_id
      FROM crm.finance_sources WHERE id = $1 FOR UPDATE`, [input.sourceId])
    if (!s.rowCount) throw new AsaasLinkError('SOURCE_NOT_FOUND', 404)
    const r = s.rows[0]
    const source: SourceForLink = { direction: r.direction, status: r.status, periodicity: r.periodicity, amountCents: num(r.amount_cents),
      dueDay: r.due_day, installmentPlan: r.installment_plan, billingProvider: r.billing_provider }
    const { blocking, divergences } = compareSubscription(source, sub)
    if (blocking.length) throw new AsaasLinkError(blocking[0], 422)
    const existing = await c.query(`SELECT 1 FROM crm.finance_asaas_subscriptions WHERE status = 'active' AND (source_id = $1
      OR (environment = $2 AND asaas_subscription_id = $3))`, [input.sourceId, input.environment, sub.id])
    if (existing.rowCount) throw new AsaasLinkError('SUBSCRIPTION_OR_SOURCE_ALREADY_LINKED')
    if (input.customerLinkId) {
      const cu = await c.query(`SELECT client_id, asaas_customer_id FROM crm.finance_asaas_customers WHERE id = $1 AND environment = $2 AND status = 'active'`,
        [input.customerLinkId, input.environment])
      if (!cu.rowCount || cu.rows[0].client_id !== r.client_id) throw new AsaasLinkError('CUSTOMER_LINK_MISMATCH', 422)
      if (sub.customerId && cu.rows[0].asaas_customer_id !== sub.customerId) throw new AsaasLinkError('SUBSCRIPTION_CUSTOMER_MISMATCH', 422)
    }
    const ins = await c.query(`INSERT INTO crm.finance_asaas_subscriptions (environment, source_id, customer_link_id, asaas_subscription_id, value_cents,
        cycle, next_due_date, external_status, divergent, divergence_codes, created_by, last_synced_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now()) RETURNING id`,
      [input.environment, input.sourceId, input.customerLinkId ?? null, sub.id, sub.valueCents, sub.cycle, sub.nextDueDate, sub.externalStatus,
        divergences.length > 0, divergences, actor])
    await c.query(`UPDATE crm.finance_sources SET billing_provider = 'asaas_subscription', updated_at = now() WHERE id = $1`, [input.sourceId])
    await log(c, input.environment, 'subscription', sub.id, 'linked', actor, { sourceId: input.sourceId, divergences })
    return { id: ins.rows[0].id as string, divergences }
  }).catch(e => { if (isUnique(e)) throw new AsaasLinkError('SUBSCRIPTION_OR_SOURCE_ALREADY_LINKED'); throw e })
}

// ───────────────────────── cobranças: fotografia e vínculo com a competência ─────────────────────────

type IngestResult = { id: string; applied: boolean; linkStatus: string }

/**
 * Registra/atualiza a fotografia de uma cobrança (sob a trava da cobrança). Ordem dos eventos:
 *  - data de evento ANTERIOR à última aplicada → ignorada;
 *  - MESMA data → só aplica se não regredir a situação (STATE_RANK);
 *  - eventAt null = leitura direta no Asaas (fonte da verdade) → sempre aplicada.
 * O vencimento ORIGINAL registrado nunca é sobrescrito; a competência de uma cobrança já vinculada nunca muda.
 */
async function ingestInTx(c: PoolClient, env: AsaasEnvironment, p: NormalizedPayment, eventAt: string | null, actor: string): Promise<IngestResult> {
  const cur = await c.query(`SELECT id, last_event_at, link_status, normalized_state, to_char(competence_month, 'YYYY-MM-DD') AS competence,
      original_due_date::text AS original, competence_basis FROM crm.finance_asaas_payments WHERE environment = $1 AND asaas_payment_id = $2 FOR UPDATE`,
  [env, p.id])
  const old = cur.rows[0]
  if (old && eventAt && old.last_event_at) {
    const diff = new Date(eventAt).getTime() - new Date(old.last_event_at).getTime()
    if (diff < 0 || (diff === 0 && (STATE_RANK[p.state] ?? 0) < (STATE_RANK[old.normalized_state] ?? 0))) {
      return { id: old.id, applied: false, linkStatus: old.link_status }
    }
  }
  const { rows } = await c.query(`INSERT INTO crm.finance_asaas_payments (environment, asaas_payment_id, asaas_subscription_id, external_status,
      normalized_state, deleted, billing_type, value_cents, net_value_cents, refunded_cents, due_date, original_due_date, payment_date,
      client_payment_date, confirmed_date, credit_date, estimated_credit_date, last_event_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::timestamptz)
    ON CONFLICT (environment, asaas_payment_id) DO UPDATE SET external_status = EXCLUDED.external_status, normalized_state = EXCLUDED.normalized_state,
      deleted = EXCLUDED.deleted, billing_type = EXCLUDED.billing_type, value_cents = EXCLUDED.value_cents, net_value_cents = EXCLUDED.net_value_cents,
      refunded_cents = EXCLUDED.refunded_cents, due_date = EXCLUDED.due_date,
      original_due_date = COALESCE(crm.finance_asaas_payments.original_due_date, EXCLUDED.original_due_date),
      payment_date = EXCLUDED.payment_date, client_payment_date = EXCLUDED.client_payment_date, confirmed_date = EXCLUDED.confirmed_date,
      credit_date = EXCLUDED.credit_date, estimated_credit_date = EXCLUDED.estimated_credit_date,
      asaas_subscription_id = COALESCE(crm.finance_asaas_payments.asaas_subscription_id, EXCLUDED.asaas_subscription_id),
      last_event_at = GREATEST(crm.finance_asaas_payments.last_event_at, COALESCE(EXCLUDED.last_event_at, now())),
      last_synced_at = now(), updated_at = now()
    RETURNING id, link_status`,
  [env, p.id, p.subscriptionId, p.externalStatus, p.state, p.deleted, p.billingType, p.valueCents, p.netValueCents, p.refundedCents, p.dueDate,
    p.originalDueDate, p.paymentDate, p.clientPaymentDate, p.confirmedDate, p.creditDate, p.estimatedCreditDate, eventAt])
  const id = rows[0].id as string
  let linkStatus = rows[0].link_status as string
  const stored = { originalDueDate: old?.original ?? null, competenceMonth: old && old.link_status === 'linked' ? old.competence : null,
    basis: old && old.link_status === 'linked' ? old.competence_basis : null }
  if (linkStatus === 'unmatched') {
    linkStatus = await tryMatch(c, env, id, p, { ...stored, competenceMonth: null, basis: null }, actor)
  } else if (linkStatus === 'linked' && resolveCompetence(p, stored).status === 'conflict') {
    // Vencimento original contraditório numa cobrança já vinculada: a competência NÃO muda; vai para revisão.
    await c.query(`UPDATE crm.finance_asaas_payments SET review_reason = 'COMPETENCE_CONFLICT', updated_at = now() WHERE id = $1`, [id])
    await log(c, env, 'payment', p.id, 'review', actor, { reason: 'COMPETENCE_CONFLICT' })
  }
  return { id, applied: true, linkStatus }
}

async function tryMatch(c: PoolClient, env: AsaasEnvironment, paymentLinkId: string, p: NormalizedPayment,
  stored: { competenceMonth: string | null; originalDueDate: string | null; basis: 'original_due_date' | 'due_date' | null }, actor: string): Promise<string> {
  const sub = p.subscriptionId ? await c.query(`SELECT id, source_id FROM crm.finance_asaas_subscriptions
    WHERE environment = $1 AND asaas_subscription_id = $2 AND status = 'active'`, [env, p.subscriptionId]) : { rows: [] as Record<string, unknown>[] }
  const link = sub.rows[0] as { id: string; source_id: string } | undefined
  const entries = link ? (await c.query(`SELECT id, to_char(competence_month, 'YYYY-MM-DD') AS m, due_date::text AS d, amount_cents, status
    FROM crm.finance_entries WHERE source_id = $1`, [link.source_id])).rows : []
  const linked = link ? (await c.query(`SELECT entry_id, asaas_payment_id FROM crm.finance_asaas_payments
    WHERE link_status = 'linked' AND NOT is_additional AND entry_id = ANY($1::uuid[])`, [entries.map(e => e.id)])).rows : []
  const result = matchPayment({
    payment: p, hasSubscriptionLink: Boolean(link), stored,
    entries: entries.map(e => ({ id: e.id, competenceMonth: e.m, dueDate: e.d, amountCents: num(e.amount_cents), status: e.status })),
    primaryLinkedPaymentByEntry: new Map(linked.map(r => [r.entry_id as string, r.asaas_payment_id as string])),
  })
  if (result.status === 'linked') {
    try {
      await c.query('SAVEPOINT match')
      await c.query(`UPDATE crm.finance_asaas_payments SET link_status = 'linked', entry_id = $2, competence_month = $3, competence_basis = $4,
        subscription_link_id = $5, divergence_codes = $6, review_reason = NULL, updated_at = now() WHERE id = $1`,
      [paymentLinkId, result.entryId, result.competenceMonth, result.basis, link!.id, result.divergences])
      await c.query('RELEASE SAVEPOINT match')
      await log(c, env, 'payment', p.id, 'matched', actor, { entryId: result.entryId, competence: result.competenceMonth, basis: result.basis, divergences: result.divergences })
      return 'linked'
    } catch (e) {
      if (!isUnique(e)) throw e
      await c.query('ROLLBACK TO SAVEPOINT match') // outra cobrança ganhou a competência ao mesmo tempo
      await markReview(c, env, paymentLinkId, p.id, 'DUPLICATE_COMPETENCE', result.entryId, result.competenceMonth, result.basis, link!.id, actor)
      return 'review'
    }
  }
  if (result.status === 'review') {
    const basis = p.originalDueDate || stored.originalDueDate ? 'original_due_date' : 'due_date'
    await markReview(c, env, paymentLinkId, p.id, result.reason, result.entryId, result.competenceMonth, basis, link?.id ?? null, actor)
    return 'review'
  }
  await c.query(`UPDATE crm.finance_asaas_payments SET competence_month = $2, subscription_link_id = $3, review_reason = $4, updated_at = now() WHERE id = $1`,
    [paymentLinkId, result.competenceMonth, link?.id ?? null, result.reason])
  return 'unmatched'
}

async function markReview(c: PoolClient, env: AsaasEnvironment, id: string, paymentId: string, reason: string, entryId: string | null,
  month: string | null, basis: string, subLinkId: string | null, actor: string) {
  // Em revisão a cobrança NÃO ocupa a competência (entry_id fica nulo; a sugestão vai na trilha).
  await c.query(`UPDATE crm.finance_asaas_payments SET link_status = 'review', review_reason = $2, competence_month = $3, competence_basis = $4,
    subscription_link_id = $5, updated_at = now() WHERE id = $1`, [id, reason, month, basis, subLinkId])
  await log(c, env, 'payment', paymentId, 'review', actor, { reason, suggestedEntryId: entryId, competence: month })
}

// ───────────────────────── conciliação (sob a trava da cobrança) ─────────────────────────

async function reconcileInTx(c: PoolClient, paymentLinkId: string, actor: string, opts: ReconcileOptions): Promise<ReconcileAction> {
  const today = opts.today ?? todayInBrazil()
  const pr = await c.query('SELECT * FROM crm.finance_asaas_payments WHERE id = $1 FOR UPDATE', [paymentLinkId])
  if (!pr.rowCount) throw new AsaasLinkError('PAYMENT_LINK_NOT_FOUND', 404)
  const row = pr.rows[0]
  const env = row.environment as AsaasEnvironment
  // Auto-reparo (dados legados/externos): recibo desta cobrança (mesma chave) já gravado, mas sem vínculo.
  if (row.link_status === 'linked' && row.entry_id) {
    await c.query(`INSERT INTO crm.finance_asaas_payment_settlements (payment_link_id, settlement_id, kind)
      SELECT $1, s.id, 'receipt' FROM crm.finance_settlements s WHERE s.idempotency_key = $2::uuid AND s.entry_id = $3
      ON CONFLICT DO NOTHING`, [paymentLinkId, receiptIdempotencyKey(env, row.asaas_payment_id), row.entry_id])
  }
  const entry = row.entry_id ? (await c.query(`SELECT e.id, e.status, e.amount_cents FROM crm.finance_entries e WHERE e.id = $1 FOR UPDATE`, [row.entry_id])).rows[0] : null
  const settled = entry ? num((await c.query(`SELECT COALESCE(sum(amount_cents), 0) AS t FROM crm.finance_settlements WHERE entry_id = $1 AND reversed_at IS NULL`,
    [entry.id])).rows[0].t) : 0
  const linked = (await c.query(`SELECT s.id, s.amount_cents, s.reversed_at IS NOT NULL AS reversed FROM crm.finance_asaas_payment_settlements l
    JOIN crm.finance_settlements s ON s.id = l.settlement_id WHERE l.payment_link_id = $1`, [paymentLinkId])).rows
  const manual = entry ? (await c.query(`SELECT s.id, s.amount_cents FROM crm.finance_settlements s
    WHERE s.entry_id = $1 AND s.reversed_at IS NULL AND NOT EXISTS (SELECT 1 FROM crm.finance_asaas_payment_settlements l WHERE l.settlement_id = s.id)`,
  [entry.id])).rows : []
  const payment: NormalizedPayment = {
    id: row.asaas_payment_id, customerId: null, subscriptionId: row.asaas_subscription_id, externalStatus: row.external_status, state: row.normalized_state,
    deleted: row.deleted, billingType: row.billing_type, valueCents: num(row.value_cents),
    netValueCents: row.net_value_cents === null ? null : num(row.net_value_cents), feeCents: row.fee_cents === null ? null : num(row.fee_cents),
    refundedCents: num(row.refunded_cents), dueDate: dateText(row.due_date)!, originalDueDate: dateText(row.original_due_date),
    paymentDate: dateText(row.payment_date), clientPaymentDate: dateText(row.client_payment_date), confirmedDate: dateText(row.confirmed_date),
    creditDate: dateText(row.credit_date), estimatedCreditDate: dateText(row.estimated_credit_date), externalReference: null,
  }
  let action = decideReconciliation({
    environment: env, payment, today,
    link: { status: row.link_status, isAdditional: row.is_additional, manualOverlapConfirmed: row.manual_overlap_confirmed, divergenceAccepted: row.divergence_accepted },
    entry: entry ? { id: entry.id, status: entry.status, amountCents: num(entry.amount_cents), settledCents: settled } : null,
    linkedMovements: linked.map(m => ({ id: m.id, amountCents: num(m.amount_cents), reversed: m.reversed })),
    manualMovements: manual.map(m => ({ id: m.id, amountCents: num(m.amount_cents), reversed: false })),
  })
  await opts.hooks?.afterDecide?.(action)

  if (action.type === 'record_receipt') {
    await c.query('SAVEPOINT exec')
    try {
      const r = await recordSettlementInTx(c, {
        entryId: row.entry_id, amountCents: action.amountCents, settledOn: action.settledOn, idempotencyKey: action.idempotencyKey,
        method: ('Asaas ' + (row.billing_type ?? '')).trim().slice(0, 60), notes: 'Cobrança Asaas ' + row.asaas_payment_id,
      }, actor, { today })
      await c.query(`INSERT INTO crm.finance_asaas_payment_settlements (payment_link_id, settlement_id, kind) VALUES ($1, $2, 'receipt') ON CONFLICT DO NOTHING`,
        [paymentLinkId, r.id])
      await c.query('RELEASE SAVEPOINT exec')
      await c.query(`UPDATE crm.finance_asaas_payments SET review_reason = NULL, updated_at = now() WHERE id = $1`, [paymentLinkId])
      await log(c, env, 'payment', row.asaas_payment_id, r.duplicate ? 'receipt_already_recorded' : 'receipt_recorded', actor,
        { settlementId: r.id, grossCents: action.amountCents, feeCents: row.fee_cents === null ? null : num(row.fee_cents), settledOn: action.settledOn })
    } catch (e) {
      if (!(e instanceof FinanceRuleError)) throw e
      await c.query('ROLLBACK TO SAVEPOINT exec')
      action = { type: 'review', code: 'FINANCE_' + e.code }
      await setReviewInTx(c, env, paymentLinkId, row.asaas_payment_id, action.code, actor)
    }
  } else if (action.type === 'link_manual') {
    await c.query(`INSERT INTO crm.finance_asaas_payment_settlements (payment_link_id, settlement_id, kind) VALUES ($1, $2, 'manual_confirmed') ON CONFLICT DO NOTHING`,
      [paymentLinkId, action.settlementId])
    await c.query(`UPDATE crm.finance_asaas_payments SET review_reason = NULL, updated_at = now() WHERE id = $1`, [paymentLinkId])
    await log(c, env, 'payment', row.asaas_payment_id, 'manual_settlement_linked', actor, { settlementId: action.settlementId })
  } else if (action.type === 'reverse') {
    for (const id of action.settlementIds) await reverseSettlementInTx(c, id, 'Estorno informado pelo Asaas (' + row.asaas_payment_id + ')', actor)
    await log(c, env, 'payment', row.asaas_payment_id, 'receipts_reversed', actor, { settlementIds: action.settlementIds, reason: action.reason })
  } else if (action.type === 'review') {
    await setReviewInTx(c, env, paymentLinkId, row.asaas_payment_id, action.code, actor)
  } else if (row.link_status === 'linked' && row.review_reason && row.review_reason !== 'COMPETENCE_CONFLICT') {
    await c.query(`UPDATE crm.finance_asaas_payments SET review_reason = NULL, updated_at = now() WHERE id = $1`, [paymentLinkId])
  }
  await opts.hooks?.afterExecute?.(action)
  return action
}

async function setReviewInTx(c: PoolClient, env: AsaasEnvironment, id: string, paymentId: string, code: string, actor: string) {
  // Mantém link_status = 'linked' (a competência continua ocupada por esta cobrança); só sinaliza para revisão.
  await c.query(`UPDATE crm.finance_asaas_payments SET review_reason = $2, updated_at = now() WHERE id = $1`, [id, code])
  await log(c, env, 'payment', paymentId, 'review', actor, { reason: code })
}

/** Fotografia isolada (sem conciliar), sob a trava da cobrança. */
export async function ingestPayment(pool: FinancePool, environment: AsaasEnvironment, p: NormalizedPayment, eventAt: string | null, actor: string): Promise<IngestResult> {
  return tx(pool, async c => {
    await requireBinding(c, environment)
    await lockPayment(c, environment, p.id)
    return ingestInTx(c, environment, p, eventAt, actor)
  })
}

/** Concilia UMA cobrança: lê, decide e executa na mesma transação, sob a trava da cobrança. */
export async function reconcilePayment(pool: FinancePool, paymentLinkId: string, actor: string, opts: ReconcileOptions = {}): Promise<ReconcileAction> {
  return tx(pool, async c => {
    const r = await c.query('SELECT environment, asaas_payment_id FROM crm.finance_asaas_payments WHERE id = $1', [paymentLinkId])
    if (!r.rowCount) throw new AsaasLinkError('PAYMENT_LINK_NOT_FOUND', 404)
    await requireBinding(c, r.rows[0].environment)
    await lockPayment(c, r.rows[0].environment, r.rows[0].asaas_payment_id)
    return reconcileInTx(c, paymentLinkId, actor, opts)
  })
}

/** Fotografia + conciliação numa ÚNICA transação sob a trava (caminho usado por webhook e sincronização). */
export async function applyPaymentSnapshot(pool: FinancePool, environment: AsaasEnvironment, p: NormalizedPayment, eventAt: string | null, actor: string,
  opts: ReconcileOptions = {}): Promise<IngestResult & { action: ReconcileAction }> {
  return tx(pool, async c => {
    await requireBinding(c, environment)
    await lockPayment(c, environment, p.id)
    const ing = await ingestInTx(c, environment, p, eventAt, actor)
    return { ...ing, action: await reconcileInTx(c, ing.id, actor, opts) }
  })
}

// ───────────────────────── decisões administrativas (uso futuro na interface) ─────────────────────────

async function withPaymentLock<T>(pool: FinancePool, paymentLinkId: string, fn: (c: PoolClient, env: AsaasEnvironment, paymentId: string) => Promise<T>) {
  return tx(pool, async c => {
    const r = await c.query('SELECT environment, asaas_payment_id FROM crm.finance_asaas_payments WHERE id = $1', [paymentLinkId])
    if (!r.rowCount) throw new AsaasLinkError('PAYMENT_LINK_NOT_FOUND', 404)
    await requireBinding(c, r.rows[0].environment)
    await lockPayment(c, r.rows[0].environment, r.rows[0].asaas_payment_id)
    return fn(c, r.rows[0].environment, r.rows[0].asaas_payment_id)
  })
}

/** O administrador confirma que a baixa manual existente É o pagamento desta cobrança (não cria outra baixa). */
export async function confirmManualOverlap(pool: FinancePool, paymentLinkId: string, actor: string, opts: ReconcileOptions = {}): Promise<ReconcileAction> {
  return withPaymentLock(pool, paymentLinkId, async (c, env, pid) => {
    const r = await c.query(`UPDATE crm.finance_asaas_payments SET manual_overlap_confirmed = true, updated_at = now() WHERE id = $1 AND link_status = 'linked'`, [paymentLinkId])
    if (!r.rowCount) throw new AsaasLinkError('PAYMENT_NOT_LINKED')
    await log(c, env, 'payment', pid, 'manual_overlap_confirmed', actor)
    return reconcileInTx(c, paymentLinkId, actor, opts)
  })
}

/**
 * Aceita, com JUSTIFICATIVA, que esta cobrança tenha valor diferente do contratado (ex.: valor dividido em duas
 * cobranças). Nunca altera o valor do lançamento; o recibo continua limitado ao saldo em aberto.
 */
export async function acceptAmountDivergence(pool: FinancePool, paymentLinkId: string, justification: string, actor: string, opts: ReconcileOptions = {}): Promise<ReconcileAction> {
  const reason = justification.trim()
  if (reason.length < 5 || reason.length > 300) throw new AsaasLinkError('JUSTIFICATION_REQUIRED', 400)
  return withPaymentLock(pool, paymentLinkId, async (c, env, pid) => {
    const r = await c.query(`UPDATE crm.finance_asaas_payments SET divergence_accepted = true, divergence_justification = $2, updated_at = now()
      WHERE id = $1 AND link_status = 'linked'`, [paymentLinkId, reason])
    if (!r.rowCount) throw new AsaasLinkError('PAYMENT_NOT_LINKED')
    await log(c, env, 'payment', pid, 'amount_divergence_accepted', actor, { justification: reason })
    return reconcileInTx(c, paymentLinkId, actor, opts)
  })
}

/** Segunda cobrança na mesma competência, aceita com JUSTIFICATIVA (ex.: valor dividido em duas cobranças). */
export async function acceptAdditionalPayment(pool: FinancePool, paymentLinkId: string, entryId: string, justification: string, actor: string): Promise<void> {
  const reason = justification.trim()
  if (reason.length < 5 || reason.length > 300) throw new AsaasLinkError('JUSTIFICATION_REQUIRED', 400)
  await withPaymentLock(pool, paymentLinkId, async (c, env, pid) => {
    const r = await c.query(`SELECT p.link_status, p.review_reason, p.competence_month, s.source_id
      FROM crm.finance_asaas_payments p JOIN crm.finance_asaas_subscriptions s ON s.id = p.subscription_link_id WHERE p.id = $1 FOR UPDATE OF p`, [paymentLinkId])
    if (!r.rowCount || r.rows[0].link_status !== 'review' || r.rows[0].review_reason !== 'DUPLICATE_COMPETENCE') throw new AsaasLinkError('NOT_A_DUPLICATE_COMPETENCE')
    const e = await c.query(`SELECT 1 FROM crm.finance_entries WHERE id = $1 AND source_id = $2 AND competence_month = $3`,
      [entryId, r.rows[0].source_id, r.rows[0].competence_month])
    if (!e.rowCount) throw new AsaasLinkError('ENTRY_MISMATCH', 422)
    await c.query(`UPDATE crm.finance_asaas_payments SET link_status = 'linked', entry_id = $2, is_additional = true, additional_justification = $3,
      review_reason = NULL, updated_at = now() WHERE id = $1`, [paymentLinkId, entryId, reason])
    await log(c, env, 'payment', pid, 'additional_accepted', actor, { entryId, justification: reason })
  })
}

/** Trava (consulta) para qualquer futura criação de cobrança externa — nesta fase nenhuma criação existe. */
export async function externalChargeGuard(pool: FinancePool, environment: AsaasEnvironment, sourceId: string, competenceMonth: string) {
  const c = await pool.connect()
  try {
    const s = await c.query('SELECT billing_provider FROM crm.finance_sources WHERE id = $1', [sourceId])
    if (!s.rowCount) throw new AsaasLinkError('SOURCE_NOT_FOUND', 404)
    const p = await c.query(`SELECT count(*)::int AS n FROM crm.finance_asaas_payments p
      JOIN crm.finance_entries e ON e.id = p.entry_id OR (p.entry_id IS NULL AND p.competence_month = e.competence_month)
      WHERE p.environment = $1 AND NOT p.deleted AND e.source_id = $2 AND e.competence_month = $3`, [environment, sourceId, competenceMonth])
    return canCreateExternalCharge({ billingProvider: s.rows[0].billing_provider, existingPaymentsForCompetence: p.rows[0].n })
  } finally { c.release() }
}

// ───────────────────────── eventos (webhook simulado) e sincronização ─────────────────────────

/** Grava o evento (deduplicado por ambiente + id). Retorna duplicate=true para repetição — nada a reprocessar. */
export async function recordWebhookEvent(pool: FinancePool, ev: ParsedWebhookEvent): Promise<{ id: number; duplicate: boolean }> {
  return tx(pool, async c => {
    await requireBinding(c, ev.environment)
    const ins = await c.query(`INSERT INTO crm.finance_asaas_events (environment, event_id, event_type, asaas_payment_id, event_created_at, date_trusted, payload_min)
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) ON CONFLICT (environment, event_id) DO NOTHING RETURNING id`,
    [ev.environment, ev.eventId, ev.eventType, ev.payment?.id ?? null, ev.eventCreatedAt, ev.dateTrusted, JSON.stringify(ev.paymentMin ?? {})])
    if (ins.rowCount) return { id: Number(ins.rows[0].id), duplicate: false }
    const ex = await c.query('SELECT id FROM crm.finance_asaas_events WHERE environment = $1 AND event_id = $2', [ev.environment, ev.eventId])
    return { id: Number(ex.rows[0].id), duplicate: true }
  })
}

export type ProcessResult = { status: 'processed' | 'ignored' | 'already_processed' | 'failed' | 'needs_resync'; action?: ReconcileAction; error?: string }

/**
 * Processa um evento gravado.
 *  - Com gateway (Fase 2+): relê a cobrança no Asaas (fonte da verdade, imune à ordem dos eventos).
 *  - Sem gateway: usa o payload mínimo SOMENTE se a data do evento for confiável; senão o evento fica
 *    'needs_resync' (nenhum estado é alterado) até a releitura.
 * Falha = 'failed' com código curto (sem dados), seguro para reprocessar.
 */
export async function processWebhookEvent(pool: FinancePool, eventRowId: number, actor: string, gateway?: AsaasReadGateway, opts: ReconcileOptions = {}): Promise<ProcessResult> {
  const ev = await tx(pool, async c => {
    const r = await c.query(`UPDATE crm.finance_asaas_events SET attempts = attempts + 1 WHERE id = $1 AND status IN ('pending', 'failed', 'needs_resync')
      RETURNING environment, event_type, asaas_payment_id, event_created_at, date_trusted, payload_min, status`, [eventRowId])
    return r.rows[0] ?? null
  })
  if (!ev) return { status: 'already_processed' }
  const finish = (status: 'processed' | 'ignored' | 'failed' | 'needs_resync', error: string | null) => tx(pool, c => c.query(
    `UPDATE crm.finance_asaas_events SET status = $2, last_error = $3, processed_at = CASE WHEN $2 IN ('processed', 'ignored') THEN now() ELSE NULL END WHERE id = $1`,
    [eventRowId, status, error]))
  if (!ev.asaas_payment_id || !/^PAYMENT_/.test(ev.event_type)) { await finish('ignored', null); return { status: 'ignored' } }
  try {
    if (gateway && gateway.environment !== ev.environment) throw new AsaasDataError('ENVIRONMENT_MISMATCH')
    if (!gateway && !ev.date_trusted) { await finish('needs_resync', 'UNTRUSTED_EVENT_DATE'); return { status: 'needs_resync' } }
    const payment = gateway ? normalizePayment(await gateway.getPayment(ev.asaas_payment_id), ev.event_type) : normalizePayment(ev.payload_min, ev.event_type)
    if (payment.id !== ev.asaas_payment_id) throw new AsaasDataError('PAYMENT_ID_MISMATCH')
    const eventAt = gateway ? null : new Date(ev.event_created_at).toISOString()
    const r = await applyPaymentSnapshot(pool, ev.environment, payment, eventAt, actor, opts)
    await finish('processed', null)
    return { status: 'processed', action: r.action }
  } catch (e) {
    const code = (e as { code?: string }).code
    const safe = typeof code === 'string' && /^[A-Z0-9_]{2,60}$/.test(code) ? code : 'UNEXPECTED_ERROR'
    await finish('failed', safe)
    return { status: 'failed', error: safe }
  }
}

/** Sincronização (Fase 3): lê as cobranças de uma assinatura vinculada e concilia cada uma. Somente leitura no Asaas. */
export async function syncSubscriptionPayments(pool: FinancePool, gateway: AsaasReadGateway, subscriptionLinkId: string, actor: string, opts: ReconcileOptions = {}) {
  const sub = await tx(pool, async c => (await c.query(`SELECT environment, asaas_subscription_id FROM crm.finance_asaas_subscriptions
    WHERE id = $1 AND status = 'active'`, [subscriptionLinkId])).rows[0])
  if (!sub) throw new AsaasLinkError('SUBSCRIPTION_LINK_NOT_FOUND', 404)
  if (sub.environment !== gateway.environment) throw new AsaasLinkError('ENVIRONMENT_MISMATCH', 422)
  const results: { paymentId: string; linkStatus: string; action: ReconcileAction }[] = []
  for (const raw of await gateway.listSubscriptionPayments(sub.asaas_subscription_id)) {
    const p = normalizePayment(raw)
    if (p.subscriptionId !== sub.asaas_subscription_id) throw new AsaasDataError('SUBSCRIPTION_ID_MISMATCH')
    const r = await applyPaymentSnapshot(pool, sub.environment, p, null, actor, opts)
    results.push({ paymentId: p.id, linkStatus: r.linkStatus, action: r.action })
  }
  await tx(pool, c => c.query('UPDATE crm.finance_asaas_subscriptions SET last_synced_at = now() WHERE id = $1', [subscriptionLinkId]))
  return results
}

// ───────────────────────── relatórios: bruto × tarifa × líquido (preparação, sem tela) ─────────────────────────

export type AsaasCashSummary = {
  /** Valor BRUTO baixado no Financeiro (quita a obrigação do cliente), por data de caixa. */
  grossCents: number
  /** Tarifas do Asaas das cobranças com recibo ativo (contadas UMA vez por cobrança). */
  feeCents: number
  /** Entrada líquida = bruto − tarifas (nunca deduz duas vezes). */
  netCents: number
  /** Bruto de recibos estornados no período (fora do bruto acima). */
  reversedGrossCents: number
  /** Tarifas de cobranças estornadas: o Asaas NÃO as devolve no estorno (documentação oficial). */
  retainedFeeOnRefundsCents: number
  /** Cobranças sem líquido informado: tarifa desconhecida — nunca presumida zero. */
  paymentsWithUnknownFee: number
}

export async function asaasCashSummary(pool: FinancePool, environment: AsaasEnvironment, fromDate: string, toDate: string): Promise<AsaasCashSummary> {
  const c = await pool.connect()
  try {
    const { rows } = await c.query(`SELECT p.id, p.fee_cents, s.amount_cents, s.reversed_at IS NOT NULL AS reversed
      FROM crm.finance_asaas_payment_settlements l JOIN crm.finance_asaas_payments p ON p.id = l.payment_link_id
      JOIN crm.finance_settlements s ON s.id = l.settlement_id
      WHERE p.environment = $1 AND s.settled_on BETWEEN $2::date AND $3::date`, [environment, fromDate, toDate])
    const out: AsaasCashSummary = { grossCents: 0, feeCents: 0, netCents: 0, reversedGrossCents: 0, retainedFeeOnRefundsCents: 0, paymentsWithUnknownFee: 0 }
    const byPayment = new Map<string, { fee: number | null; active: number; reversed: number }>()
    for (const r of rows) {
      const p = byPayment.get(r.id) ?? { fee: r.fee_cents === null ? null : num(r.fee_cents), active: 0, reversed: 0 }
      if (r.reversed) p.reversed += num(r.amount_cents); else p.active += num(r.amount_cents)
      byPayment.set(r.id, p)
    }
    for (const p of byPayment.values()) {
      out.grossCents += p.active
      out.reversedGrossCents += p.reversed
      if (p.fee === null) { out.paymentsWithUnknownFee++; continue }
      if (p.active > 0) out.feeCents += p.fee
      else if (p.reversed > 0) out.retainedFeeOnRefundsCents += p.fee
    }
    out.netCents = out.grossCents - out.feeCents
    return out
  } finally { c.release() }
}
