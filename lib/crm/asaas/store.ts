import type { PoolClient } from 'pg'
import { FinanceRuleError, recordSettlement, reverseSettlement, type FinancePool } from '../finance/store'
import { canCreateExternalCharge } from './policy'
import {
  BLOCKING_LINK_CODES, compareSubscription, decideReconciliation, matchPayment, receiptIdempotencyKey,
  type ReconcileAction, type SourceForLink,
} from './reconcile'
import {
  AsaasDataError, CUSTOMER_ID, normalizePayment, normalizeSubscription,
  type AsaasEnvironment, type AsaasReadGateway, type NormalizedPayment,
} from './types'
import type { ParsedWebhookEvent } from './policy'

/**
 * Persistência da integração Asaas (migração 0016). FASE 1: usada apenas por testes em banco descartável — não há
 * rota, tela nem chamada externa ligada a ela. Toda baixa/estorno passa pelas funções JÁ EXISTENTES do Financeiro
 * (recordSettlement / reverseSettlement), com chave de idempotência determinística por cobrança.
 */

export class AsaasLinkError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = 'AsaasLinkError' }
}

async function tx<T>(pool: FinancePool, fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  let ok = false
  try {
    await c.query('BEGIN')
    await c.query("SET LOCAL statement_timeout = '15s'")
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

async function log(c: PoolClient, env: AsaasEnvironment, entity: string, ref: string, action: string, actor: string, details: Record<string, unknown> = {}) {
  await c.query(`INSERT INTO crm.finance_integration_log (environment, entity, entity_ref, action, actor, details) VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [env, entity, ref, action, actor, JSON.stringify(details)])
}

// ───────────────────────── vínculos ─────────────────────────

export async function linkCustomer(pool: FinancePool, input: { environment: AsaasEnvironment; clientId: string; asaasCustomerId: string }, actor: string): Promise<string> {
  if (!CUSTOMER_ID.test(input.asaasCustomerId)) throw new AsaasLinkError('INVALID_CUSTOMER_ID', 400)
  return tx(pool, async c => {
    const cl = await c.query('SELECT archived_at FROM crm.finance_clients WHERE id = $1', [input.clientId])
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
 * O contrato passa a billing_provider = 'asaas_subscription' (o CRM nunca criará cobrança externa para ele).
 */
export async function linkSubscription(pool: FinancePool, input: {
  environment: AsaasEnvironment; sourceId: string; subscription: unknown; customerLinkId?: string | null
}, actor: string): Promise<{ id: string; divergences: string[] }> {
  const sub = normalizeSubscription(input.subscription)
  return tx(pool, async c => {
    const s = await c.query(`SELECT direction, status, periodicity, amount_cents, due_day, installment_plan, billing_provider, client_id
      FROM crm.finance_sources WHERE id = $1 FOR UPDATE`, [input.sourceId])
    if (!s.rowCount) throw new AsaasLinkError('SOURCE_NOT_FOUND', 404)
    const r = s.rows[0]
    const source: SourceForLink = { direction: r.direction, status: r.status, periodicity: r.periodicity, amountCents: num(r.amount_cents),
      dueDay: r.due_day, installmentPlan: r.installment_plan, billingProvider: r.billing_provider }
    const { blocking, divergences } = compareSubscription(source, sub)
    if (blocking.length) throw new AsaasLinkError(blocking[0], 422)
    if (input.customerLinkId) {
      const cu = await c.query(`SELECT client_id, asaas_customer_id FROM crm.finance_asaas_customers WHERE id = $1 AND environment = $2 AND status = 'active'`,
        [input.customerLinkId, input.environment])
      if (!cu.rowCount || cu.rows[0].client_id !== r.client_id) throw new AsaasLinkError('CUSTOMER_LINK_MISMATCH', 422)
      if (sub.customerId && cu.rows[0].asaas_customer_id !== sub.customerId) throw new AsaasLinkError('SUBSCRIPTION_CUSTOMER_MISMATCH', 422)
    }
    let id: string
    try {
      const ins = await c.query(`INSERT INTO crm.finance_asaas_subscriptions (environment, source_id, customer_link_id, asaas_subscription_id, value_cents,
          cycle, next_due_date, external_status, divergent, divergence_codes, created_by, last_synced_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now()) RETURNING id`,
        [input.environment, input.sourceId, input.customerLinkId ?? null, sub.id, sub.valueCents, sub.cycle, sub.nextDueDate, sub.externalStatus,
          divergences.length > 0, divergences, actor])
      id = ins.rows[0].id
    } catch (e) {
      if (!isUnique(e)) throw e
      throw new AsaasLinkError('SUBSCRIPTION_OR_SOURCE_ALREADY_LINKED')
    }
    await c.query(`UPDATE crm.finance_sources SET billing_provider = 'asaas_subscription', updated_at = now() WHERE id = $1`, [input.sourceId])
    await log(c, input.environment, 'subscription', sub.id, 'linked', actor, { sourceId: input.sourceId, divergences })
    return { id, divergences }
  }).catch(e => { if (isUnique(e)) throw new AsaasLinkError('SUBSCRIPTION_OR_SOURCE_ALREADY_LINKED'); throw e })
}
export { BLOCKING_LINK_CODES }

// ───────────────────────── cobranças ─────────────────────────

/**
 * Registra/atualiza a fotografia de uma cobrança e tenta ligá-la ao lançamento da competência. Proteção contra
 * eventos fora de ordem: uma fotografia com data de evento ANTERIOR à última aplicada é ignorada. Fotografias lidas
 * diretamente do Asaas (eventAt = null) são a fonte da verdade e sempre aplicadas.
 */
export async function ingestPayment(pool: FinancePool, environment: AsaasEnvironment, p: NormalizedPayment, eventAt: string | null, actor: string):
  Promise<{ id: string; applied: boolean; linkStatus: string }> {
  return tx(pool, async c => {
    const cur = await c.query(`SELECT id, last_event_at, link_status FROM crm.finance_asaas_payments WHERE environment = $1 AND asaas_payment_id = $2 FOR UPDATE`,
      [environment, p.id])
    const stale = cur.rowCount && eventAt && cur.rows[0].last_event_at && new Date(cur.rows[0].last_event_at).getTime() > new Date(eventAt).getTime()
    if (stale) return { id: cur.rows[0].id, applied: false, linkStatus: cur.rows[0].link_status }
    const values = [environment, p.id, p.subscriptionId, p.externalStatus, p.state, p.deleted, p.billingType, p.valueCents, p.netValueCents,
      p.refundedCents, p.dueDate, p.paymentDate, p.clientPaymentDate, p.confirmedDate, p.creditDate, eventAt]
    const { rows } = await c.query(`INSERT INTO crm.finance_asaas_payments (environment, asaas_payment_id, asaas_subscription_id, external_status,
        normalized_state, deleted, billing_type, value_cents, net_value_cents, refunded_cents, due_date, payment_date, client_payment_date,
        confirmed_date, credit_date, last_event_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::timestamptz)
      ON CONFLICT (environment, asaas_payment_id) DO UPDATE SET external_status = EXCLUDED.external_status, normalized_state = EXCLUDED.normalized_state,
        deleted = EXCLUDED.deleted, billing_type = EXCLUDED.billing_type, value_cents = EXCLUDED.value_cents, net_value_cents = EXCLUDED.net_value_cents,
        refunded_cents = EXCLUDED.refunded_cents, due_date = EXCLUDED.due_date, payment_date = EXCLUDED.payment_date,
        client_payment_date = EXCLUDED.client_payment_date, confirmed_date = EXCLUDED.confirmed_date, credit_date = EXCLUDED.credit_date,
        asaas_subscription_id = COALESCE(crm.finance_asaas_payments.asaas_subscription_id, EXCLUDED.asaas_subscription_id),
        last_event_at = GREATEST(crm.finance_asaas_payments.last_event_at, COALESCE(EXCLUDED.last_event_at, now())),
        last_synced_at = now(), updated_at = now()
      RETURNING id, link_status`, values)
    const id = rows[0].id as string
    let linkStatus = rows[0].link_status as string
    if (linkStatus === 'unmatched') linkStatus = await tryMatch(c, environment, id, p, actor)
    return { id, applied: true, linkStatus }
  })
}

async function tryMatch(c: PoolClient, environment: AsaasEnvironment, paymentLinkId: string, p: NormalizedPayment, actor: string): Promise<string> {
  const sub = p.subscriptionId ? await c.query(`SELECT id, source_id FROM crm.finance_asaas_subscriptions
    WHERE environment = $1 AND asaas_subscription_id = $2 AND status = 'active'`, [environment, p.subscriptionId]) : { rows: [] as Record<string, unknown>[] }
  const link = sub.rows[0] as { id: string; source_id: string } | undefined
  const entries = link ? (await c.query(`SELECT id, to_char(competence_month, 'YYYY-MM-DD') AS m, due_date::text AS d, amount_cents, status
    FROM crm.finance_entries WHERE source_id = $1`, [link.source_id])).rows : []
  const linked = link ? (await c.query(`SELECT entry_id, asaas_payment_id FROM crm.finance_asaas_payments
    WHERE link_status = 'linked' AND NOT is_additional AND entry_id = ANY($1::uuid[])`, [entries.map(e => e.id)])).rows : []
  const result = matchPayment({
    payment: p, hasSubscriptionLink: Boolean(link),
    entries: entries.map(e => ({ id: e.id, competenceMonth: e.m, dueDate: e.d, amountCents: num(e.amount_cents), status: e.status })),
    primaryLinkedPaymentByEntry: new Map(linked.map(r => [r.entry_id as string, r.asaas_payment_id as string])),
  })
  if (result.status === 'linked') {
    try {
      await c.query('SAVEPOINT match')
      await c.query(`UPDATE crm.finance_asaas_payments SET link_status = 'linked', entry_id = $2, competence_month = $3, subscription_link_id = $4,
        divergence_codes = $5, updated_at = now() WHERE id = $1`, [paymentLinkId, result.entryId, result.competenceMonth, link!.id, result.divergences])
      await c.query('RELEASE SAVEPOINT match')
      await log(c, environment, 'payment', p.id, 'matched', actor, { entryId: result.entryId, competence: result.competenceMonth, divergences: result.divergences })
      return 'linked'
    } catch (e) {
      if (!isUnique(e)) throw e
      await c.query('ROLLBACK TO SAVEPOINT match') // outra cobrança ganhou a competência ao mesmo tempo
      await markReview(c, environment, paymentLinkId, p.id, 'DUPLICATE_COMPETENCE', result.entryId, result.competenceMonth, link!.id, actor)
      return 'review'
    }
  }
  if (result.status === 'review') {
    await markReview(c, environment, paymentLinkId, p.id, result.reason, result.entryId, result.competenceMonth, link!.id, actor)
    return 'review'
  }
  await c.query(`UPDATE crm.finance_asaas_payments SET competence_month = $2, subscription_link_id = $3, review_reason = $4, updated_at = now() WHERE id = $1`,
    [paymentLinkId, result.competenceMonth, link?.id ?? null, result.reason])
  return 'unmatched'
}

async function markReview(c: PoolClient, env: AsaasEnvironment, id: string, paymentId: string, reason: string, entryId: string, month: string,
  subLinkId: string, actor: string) {
  // Em revisão a cobrança NÃO ocupa a competência (entry_id fica nulo; a sugestão vai no log).
  await c.query(`UPDATE crm.finance_asaas_payments SET link_status = 'review', review_reason = $2, competence_month = $3, subscription_link_id = $4,
    updated_at = now() WHERE id = $1`, [id, reason, month, subLinkId])
  await log(c, env, 'payment', paymentId, 'review', actor, { reason, suggestedEntryId: entryId, competence: month })
}

// ───────────────────────── conciliação ─────────────────────────

async function loadReconcileInput(c: PoolClient, paymentLinkId: string) {
  const pr = await c.query(`SELECT * FROM crm.finance_asaas_payments WHERE id = $1`, [paymentLinkId])
  if (!pr.rowCount) throw new AsaasLinkError('PAYMENT_LINK_NOT_FOUND', 404)
  const row = pr.rows[0]
  const payment: NormalizedPayment = {
    id: row.asaas_payment_id, customerId: null, subscriptionId: row.asaas_subscription_id, externalStatus: row.external_status, state: row.normalized_state,
    deleted: row.deleted, billingType: row.billing_type, valueCents: num(row.value_cents), netValueCents: row.net_value_cents === null ? null : num(row.net_value_cents),
    feeCents: row.fee_cents === null ? null : num(row.fee_cents), refundedCents: num(row.refunded_cents),
    dueDate: String(row.due_date instanceof Date ? row.due_date.toISOString() : row.due_date).slice(0, 10),
    paymentDate: dateText(row.payment_date), clientPaymentDate: dateText(row.client_payment_date), confirmedDate: dateText(row.confirmed_date),
    creditDate: dateText(row.credit_date), externalReference: null,
  }
  const entry = row.entry_id ? (await c.query(`SELECT e.id, e.status, e.amount_cents,
      COALESCE((SELECT sum(s.amount_cents) FROM crm.finance_settlements s WHERE s.entry_id = e.id AND s.reversed_at IS NULL), 0) AS settled
    FROM crm.finance_entries e WHERE e.id = $1`, [row.entry_id])).rows[0] : null
  const linked = (await c.query(`SELECT s.id, s.amount_cents, s.reversed_at IS NOT NULL AS reversed FROM crm.finance_asaas_payment_settlements l
    JOIN crm.finance_settlements s ON s.id = l.settlement_id WHERE l.payment_link_id = $1`, [paymentLinkId])).rows
  const manual = row.entry_id ? (await c.query(`SELECT s.id, s.amount_cents, false AS reversed FROM crm.finance_settlements s
    WHERE s.entry_id = $1 AND s.reversed_at IS NULL AND NOT EXISTS (SELECT 1 FROM crm.finance_asaas_payment_settlements l WHERE l.settlement_id = s.id)`,
  [row.entry_id])).rows : []
  return {
    row, payment,
    input: {
      environment: row.environment as AsaasEnvironment, payment,
      link: { status: row.link_status, isAdditional: row.is_additional, manualOverlapConfirmed: row.manual_overlap_confirmed,
        divergenceAccepted: row.divergence_accepted },
      entry: entry ? { id: entry.id, status: entry.status, amountCents: num(entry.amount_cents), settledCents: num(entry.settled) } : null,
      linkedMovements: linked.map(m => ({ id: m.id, amountCents: num(m.amount_cents), reversed: m.reversed })),
      manualMovements: manual.map(m => ({ id: m.id, amountCents: num(m.amount_cents), reversed: false })),
    },
  }
}
const dateText = (v: unknown) => v === null || v === undefined ? null : (v instanceof Date ? v.toISOString() : String(v)).slice(0, 10)

/**
 * Aplica a decisão de conciliação de UMA cobrança. Seguro para repetir: recibos usam chave determinística e o
 * vínculo recibo↔cobrança é "auto-reparado" (se o processo caiu entre gravar o recibo e gravar o vínculo).
 */
export async function reconcilePayment(pool: FinancePool, paymentLinkId: string, actor: string): Promise<ReconcileAction> {
  // 1) auto-reparo: recibo desta cobrança já gravado (mesma chave), mas ainda sem vínculo
  await tx(pool, async c => {
    const r = await c.query(`SELECT environment, asaas_payment_id FROM crm.finance_asaas_payments WHERE id = $1`, [paymentLinkId])
    if (!r.rowCount) throw new AsaasLinkError('PAYMENT_LINK_NOT_FOUND', 404)
    const key = receiptIdempotencyKey(r.rows[0].environment, r.rows[0].asaas_payment_id)
    await c.query(`INSERT INTO crm.finance_asaas_payment_settlements (payment_link_id, settlement_id, kind)
      SELECT $1, s.id, 'receipt' FROM crm.finance_settlements s WHERE s.idempotency_key = $2::uuid
      ON CONFLICT DO NOTHING`, [paymentLinkId, key])
  })
  // 2) decisão pura sobre o estado atual
  const action = await tx(pool, async c => decideReconciliation((await loadReconcileInput(c, paymentLinkId)).input))
  const ctx = await tx(pool, async c => (await loadReconcileInput(c, paymentLinkId)).row)
  const env = ctx.environment as AsaasEnvironment
  // 3) execução
  if (action.type === 'record_receipt') {
    try {
      const r = await recordSettlement(pool, {
        entryId: ctx.entry_id, amountCents: action.amountCents, settledOn: action.settledOn, idempotencyKey: action.idempotencyKey,
        method: ('Asaas ' + (ctx.billing_type ?? '')).trim().slice(0, 60), notes: 'Cobrança Asaas ' + ctx.asaas_payment_id,
      }, actor)
      await tx(pool, async c => {
        await c.query(`INSERT INTO crm.finance_asaas_payment_settlements (payment_link_id, settlement_id, kind) VALUES ($1, $2, 'receipt') ON CONFLICT DO NOTHING`,
          [paymentLinkId, r.id])
        await c.query(`UPDATE crm.finance_asaas_payments SET review_reason = NULL, updated_at = now() WHERE id = $1`, [paymentLinkId])
        await log(c, env, 'payment', ctx.asaas_payment_id, r.duplicate ? 'receipt_already_recorded' : 'receipt_recorded', actor,
          { settlementId: r.id, amountCents: action.amountCents, settledOn: action.settledOn, feeCents: ctx.fee_cents === null ? null : num(ctx.fee_cents) })
      })
    } catch (e) {
      if (!(e instanceof FinanceRuleError)) throw e
      await setReview(pool, env, paymentLinkId, ctx.asaas_payment_id, 'FINANCE_' + e.code, actor)
      return { type: 'review', code: 'FINANCE_' + e.code }
    }
  } else if (action.type === 'link_manual') {
    await tx(pool, async c => {
      await c.query(`INSERT INTO crm.finance_asaas_payment_settlements (payment_link_id, settlement_id, kind) VALUES ($1, $2, 'manual_confirmed') ON CONFLICT DO NOTHING`,
        [paymentLinkId, action.settlementId])
      await c.query(`UPDATE crm.finance_asaas_payments SET review_reason = NULL, updated_at = now() WHERE id = $1`, [paymentLinkId])
      await log(c, env, 'payment', ctx.asaas_payment_id, 'manual_settlement_linked', actor, { settlementId: action.settlementId })
    })
  } else if (action.type === 'reverse') {
    for (const id of action.settlementIds) await reverseSettlement(pool, id, 'Estorno informado pelo Asaas (' + ctx.asaas_payment_id + ')', actor)
    await tx(pool, async c => log(c, env, 'payment', ctx.asaas_payment_id, 'receipts_reversed', actor, { settlementIds: action.settlementIds, reason: action.reason }))
  } else if (action.type === 'review') {
    await setReview(pool, env, paymentLinkId, ctx.asaas_payment_id, action.code, actor)
  } else if (ctx.link_status === 'linked' && ctx.review_reason) {
    await tx(pool, c => c.query(`UPDATE crm.finance_asaas_payments SET review_reason = NULL, updated_at = now() WHERE id = $1`, [paymentLinkId]))
  }
  return action
}

async function setReview(pool: FinancePool, env: AsaasEnvironment, id: string, paymentId: string, code: string, actor: string) {
  await tx(pool, async c => {
    // Mantém link_status = 'linked' (a competência continua ocupada por esta cobrança); só sinaliza para revisão.
    await c.query(`UPDATE crm.finance_asaas_payments SET review_reason = $2, updated_at = now() WHERE id = $1`, [id, code])
    await log(c, env, 'payment', paymentId, 'review', actor, { reason: code })
  })
}

// ───────────────────────── decisões administrativas (uso futuro na interface) ─────────────────────────

/** O administrador confirma que a baixa manual existente É o pagamento desta cobrança (não cria outra baixa). */
export async function confirmManualOverlap(pool: FinancePool, paymentLinkId: string, actor: string): Promise<ReconcileAction> {
  await tx(pool, async c => {
    const r = await c.query(`UPDATE crm.finance_asaas_payments SET manual_overlap_confirmed = true, updated_at = now()
      WHERE id = $1 AND link_status = 'linked' RETURNING environment, asaas_payment_id`, [paymentLinkId])
    if (!r.rowCount) throw new AsaasLinkError('PAYMENT_NOT_LINKED')
    await log(c, r.rows[0].environment, 'payment', r.rows[0].asaas_payment_id, 'manual_overlap_confirmed', actor)
  })
  return reconcilePayment(pool, paymentLinkId, actor)
}

/**
 * O administrador aceita, com JUSTIFICATIVA, que esta cobrança tenha valor diferente do contratado (ex.: valor
 * dividido em duas cobranças). Nunca altera o valor do lançamento; o recibo continua limitado ao saldo em aberto.
 */
export async function acceptAmountDivergence(pool: FinancePool, paymentLinkId: string, justification: string, actor: string): Promise<ReconcileAction> {
  const reason = justification.trim()
  if (reason.length < 5 || reason.length > 300) throw new AsaasLinkError('JUSTIFICATION_REQUIRED', 400)
  await tx(pool, async c => {
    const r = await c.query(`UPDATE crm.finance_asaas_payments SET divergence_accepted = true, divergence_justification = $2, updated_at = now()
      WHERE id = $1 AND link_status = 'linked' RETURNING environment, asaas_payment_id`, [paymentLinkId, reason])
    if (!r.rowCount) throw new AsaasLinkError('PAYMENT_NOT_LINKED')
    await log(c, r.rows[0].environment, 'payment', r.rows[0].asaas_payment_id, 'amount_divergence_accepted', actor, { justification: reason })
  })
  return reconcilePayment(pool, paymentLinkId, actor)
}

/** Segunda cobrança na mesma competência, aceita com JUSTIFICATIVA (ex.: valor dividido em duas cobranças). */
export async function acceptAdditionalPayment(pool: FinancePool, paymentLinkId: string, entryId: string, justification: string, actor: string): Promise<void> {
  const reason = justification.trim()
  if (reason.length < 5 || reason.length > 300) throw new AsaasLinkError('JUSTIFICATION_REQUIRED', 400)
  await tx(pool, async c => {
    const r = await c.query(`SELECT p.environment, p.asaas_payment_id, p.link_status, p.review_reason, p.competence_month, s.source_id
      FROM crm.finance_asaas_payments p JOIN crm.finance_asaas_subscriptions s ON s.id = p.subscription_link_id WHERE p.id = $1 FOR UPDATE OF p`, [paymentLinkId])
    if (!r.rowCount || r.rows[0].link_status !== 'review' || r.rows[0].review_reason !== 'DUPLICATE_COMPETENCE') throw new AsaasLinkError('NOT_A_DUPLICATE_COMPETENCE')
    const e = await c.query(`SELECT 1 FROM crm.finance_entries WHERE id = $1 AND source_id = $2 AND competence_month = $3`,
      [entryId, r.rows[0].source_id, r.rows[0].competence_month])
    if (!e.rowCount) throw new AsaasLinkError('ENTRY_MISMATCH', 422)
    await c.query(`UPDATE crm.finance_asaas_payments SET link_status = 'linked', entry_id = $2, is_additional = true, additional_justification = $3,
      review_reason = NULL, updated_at = now() WHERE id = $1`, [paymentLinkId, entryId, reason])
    await log(c, r.rows[0].environment, 'payment', r.rows[0].asaas_payment_id, 'additional_accepted', actor, { entryId, justification: reason })
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
    const ins = await c.query(`INSERT INTO crm.finance_asaas_events (environment, event_id, event_type, asaas_payment_id, event_created_at, payload_min)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb) ON CONFLICT (environment, event_id) DO NOTHING RETURNING id`,
    [ev.environment, ev.eventId, ev.eventType, ev.payment?.id ?? null, ev.eventCreatedAt, JSON.stringify(ev.paymentMin ?? {})])
    if (ins.rowCount) return { id: Number(ins.rows[0].id), duplicate: false }
    const ex = await c.query('SELECT id FROM crm.finance_asaas_events WHERE environment = $1 AND event_id = $2', [ev.environment, ev.eventId])
    return { id: Number(ex.rows[0].id), duplicate: true }
  })
}

/**
 * Processa um evento gravado. Com gateway (Fase 2+), relê a cobrança no Asaas (fonte da verdade, imune à ordem dos
 * eventos); sem gateway, usa o payload mínimo com a proteção de ordem. Falha = status 'failed' com código curto (sem
 * dados), pronto para reprocessar com segurança.
 */
export async function processWebhookEvent(pool: FinancePool, eventRowId: number, actor: string, gateway?: AsaasReadGateway):
  Promise<{ status: 'processed' | 'ignored' | 'already_processed' | 'failed'; action?: ReconcileAction; error?: string }> {
  const ev = await tx(pool, async c => {
    const r = await c.query(`UPDATE crm.finance_asaas_events SET attempts = attempts + 1 WHERE id = $1 AND status IN ('pending', 'failed')
      RETURNING environment, event_type, asaas_payment_id, event_created_at, payload_min`, [eventRowId])
    return r.rows[0] ?? null
  })
  if (!ev) return { status: 'already_processed' }
  const finish = (status: 'processed' | 'ignored' | 'failed', error: string | null) => tx(pool, c => c.query(
    `UPDATE crm.finance_asaas_events SET status = $2, last_error = $3, processed_at = CASE WHEN $2 = 'failed' THEN NULL ELSE now() END WHERE id = $1`,
    [eventRowId, status, error]))
  if (!ev.asaas_payment_id || !/^PAYMENT_/.test(ev.event_type)) { await finish('ignored', null); return { status: 'ignored' } }
  try {
    if (gateway && gateway.environment !== ev.environment) throw new AsaasDataError('ENVIRONMENT_MISMATCH')
    const payment = gateway ? normalizePayment(await gateway.getPayment(ev.asaas_payment_id), ev.event_type) : normalizePayment(ev.payload_min, ev.event_type)
    if (payment.id !== ev.asaas_payment_id) throw new AsaasDataError('PAYMENT_ID_MISMATCH')
    const eventAt = gateway ? null : ev.event_created_at ? new Date(ev.event_created_at).toISOString() : null
    const ing = await ingestPayment(pool, ev.environment, payment, eventAt, actor)
    const action = await reconcilePayment(pool, ing.id, actor)
    await finish('processed', null)
    return { status: 'processed', action }
  } catch (e) {
    const code = (e as { code?: string }).code
    const safe = typeof code === 'string' && /^[A-Z0-9_]{2,60}$/.test(code) ? code : 'UNEXPECTED_ERROR'
    await finish('failed', safe)
    return { status: 'failed', error: safe }
  }
}

/** Sincronização (Fase 3): lê as cobranças de uma assinatura vinculada e concilia cada uma. Somente leitura no Asaas. */
export async function syncSubscriptionPayments(pool: FinancePool, gateway: AsaasReadGateway, subscriptionLinkId: string, actor: string) {
  const sub = await tx(pool, async c => (await c.query(`SELECT environment, asaas_subscription_id FROM crm.finance_asaas_subscriptions
    WHERE id = $1 AND status = 'active'`, [subscriptionLinkId])).rows[0])
  if (!sub) throw new AsaasLinkError('SUBSCRIPTION_LINK_NOT_FOUND', 404)
  if (sub.environment !== gateway.environment) throw new AsaasLinkError('ENVIRONMENT_MISMATCH', 422)
  const results: { paymentId: string; linkStatus: string; action: ReconcileAction }[] = []
  for (const raw of await gateway.listSubscriptionPayments(sub.asaas_subscription_id)) {
    const p = normalizePayment(raw)
    if (p.subscriptionId !== sub.asaas_subscription_id) throw new AsaasDataError('SUBSCRIPTION_ID_MISMATCH')
    const ing = await ingestPayment(pool, sub.environment, p, null, actor)
    results.push({ paymentId: p.id, linkStatus: ing.linkStatus, action: await reconcilePayment(pool, ing.id, actor) })
  }
  await tx(pool, c => c.query('UPDATE crm.finance_asaas_subscriptions SET last_synced_at = now() WHERE id = $1', [subscriptionLinkId]))
  return results
}
