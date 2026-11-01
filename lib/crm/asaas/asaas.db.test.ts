/**
 * Integração Asaas — FASE 1, contra PostgreSQL DESCARTÁVEL com as migrações 0001–0016 (CRM_INTEGRATION_DATABASE_URL).
 * Nenhuma chamada ao Asaas: cobranças, assinaturas e webhooks são SINTÉTICOS; o "gateway" é um objeto de teste
 * somente leitura. Nenhum dado real (ids fictícios, clientes fictícios).
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { Pool } from 'pg'
import { handleFinanceAdmin, type FinanceAdminRequest } from '../finance/admin-request'
import { recordSettlement } from '../finance/store'
import { parseWebhookEvent } from './policy'
import { receiptIdempotencyKey } from './reconcile'
import {
  acceptAdditionalPayment, acceptAmountDivergence, AsaasLinkError, bindAsaasEnvironment, confirmManualOverlap, externalChargeGuard, ingestPayment,
  linkCustomer, linkSubscription, processWebhookEvent, reconcilePayment, recordWebhookEvent, syncSubscriptionPayments,
} from './store'
import { normalizePayment, type AsaasReadGateway } from './types'

const url = process.env.CRM_INTEGRATION_DATABASE_URL
const skip = !url ? 'CRM_INTEGRATION_DATABASE_URL não definida' : false
type Body = Record<string, any>
const rid = (p: string) => p + '_' + randomUUID().replaceAll('-', '').slice(0, 16)
const ACTOR = 'sessao-teste'

describe('Asaas — fundação (PostgreSQL descartável, dados sintéticos)', { skip }, () => {
  let pool: Pool
  // Este banco descartável representa um banco ligado ao SANDBOX (isolamento físico: o CRM real seria 'production').
  before(async () => { pool = new Pool({ connectionString: url, max: 8 }); await bindAsaasEnvironment(pool, 'sandbox', ACTOR) })
  after(async () => { await pool?.end() })
  const base: FinanceAdminRequest = { method: 'GET', vercelEnv: 'preview', sessionValid: true, originAllowed: true, contentType: 'application/json', actorRef: ACTOR }
  const deps = () => ({ pool, now: () => new Date('2026-10-31T15:00:00Z'), log: () => undefined })
  async function fin(action: string, payload: Body): Promise<Body> {
    const r = await handleFinanceAdmin(deps(), { ...base, method: 'POST', rawBody: JSON.stringify({ action, ...payload }) })
    assert.equal(r.status, 200, action + ' ' + JSON.stringify(r.body))
    return r.body
  }
  const view = (month: string) => handleFinanceAdmin(deps(), { ...base, searchParams: new URLSearchParams({ month }) })
  const one = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows[0]
  /** Contrato mensal de hospedagem fictício (R$ 69,90, vence dia 30), com previsões out–dez/2026. */
  async function contract(amount = '69,90') {
    const clientId = (await fin('client_create', { name: 'Cliente Fictício ' + randomUUID().slice(0, 6) })).id
    const sourceId = (await fin('source_create', { direction: 'in', clientId, category: 'hosting', description: 'Hospedagem fictícia', amount,
      periodicity: 'monthly', startDate: '2026-10-01', dueDay: 30 })).id
    const entries = (await pool.query("SELECT id, to_char(competence_month, 'YYYY-MM') AS m FROM crm.finance_entries WHERE source_id = $1 ORDER BY 2", [sourceId])).rows
    return { clientId, sourceId, entry: (m: string) => entries.find(e => e.m === m)!.id as string }
  }
  const subscription = (id: string, o: Body = {}) => ({ id, value: 69.9, cycle: 'MONTHLY', nextDueDate: '2026-11-30', status: 'ACTIVE', ...o })
  const payment = (o: Body) => ({ value: 69.9, netValue: 64.91, status: 'PENDING', billingType: 'PIX', dueDate: '2026-11-30', ...o })
  async function linked(amount = '69,90') {
    const k = await contract(amount)
    const subId = rid('sub')
    const sub = await linkSubscription(pool, { environment: 'sandbox', sourceId: k.sourceId, subscription: subscription(subId, { value: Number(amount.replace(/\./g, '').replace(',', '.')) }) }, ACTOR)
    return { ...k, subId, subLinkId: sub.id }
  }
  const settlements = async (entryId: string) => (await pool.query(
    'SELECT id, amount_cents::int AS a, settled_on::text AS d, reversed_at IS NOT NULL AS reversed FROM crm.finance_settlements WHERE entry_id = $1 ORDER BY created_at', [entryId])).rows
  const ingest = async (raw: Body, eventAt: string | null = null) => ingestPayment(pool, 'sandbox', normalizePayment(raw), eventAt, ACTOR)

  // ───────────── clientes e assinaturas ─────────────
  it('clientes: vínculo válido; duplicado e conflito recusados; outro ambiente recusado neste banco', async () => {
    const a = await contract()
    const b = await contract()
    const cus = rid('cus')
    assert.ok(await linkCustomer(pool, { environment: 'sandbox', clientId: a.clientId, asaasCustomerId: cus }, ACTOR))
    await assert.rejects(linkCustomer(pool, { environment: 'sandbox', clientId: a.clientId, asaasCustomerId: cus }, ACTOR), (e: AsaasLinkError) => e.code === 'CUSTOMER_ALREADY_LINKED')
    await assert.rejects(linkCustomer(pool, { environment: 'sandbox', clientId: b.clientId, asaasCustomerId: cus }, ACTOR), (e: AsaasLinkError) => e.code === 'CUSTOMER_ALREADY_LINKED')
    await assert.rejects(linkCustomer(pool, { environment: 'sandbox', clientId: a.clientId, asaasCustomerId: rid('cus') }, ACTOR), (e: AsaasLinkError) => e.code === 'CLIENT_ALREADY_LINKED')
    // Isolamento físico (P2-3): um banco ligado ao sandbox nunca aceita dado de produção.
    await assert.rejects(linkCustomer(pool, { environment: 'production', clientId: a.clientId, asaasCustomerId: cus }, ACTOR), (e: AsaasLinkError) => e.code === 'ENVIRONMENT_MISMATCH')
    await assert.rejects(linkCustomer(pool, { environment: 'sandbox', clientId: b.clientId, asaasCustomerId: 'cliente-123' }, ACTOR), (e: AsaasLinkError) => e.code === 'INVALID_CUSTOMER_ID')
    // vínculos simultâneos do mesmo id: exatamente um vence (índice único)
    const c = await contract()
    const d = await contract()
    const race = rid('cus')
    const rs = await Promise.allSettled([c, d].map(k => linkCustomer(pool, { environment: 'sandbox', clientId: k.clientId, asaasCustomerId: race }, ACTOR)))
    assert.equal(rs.filter(r => r.status === 'fulfilled').length, 1)
  })

  it('assinaturas: vínculo sem recriar nada; duplicidade, ciclo incompatível e despesa recusados; divergência sinalizada', async () => {
    const k = await contract()
    const subId = rid('sub')
    const r = await linkSubscription(pool, { environment: 'sandbox', sourceId: k.sourceId, subscription: subscription(subId) }, ACTOR)
    assert.deepEqual(r.divergences, [])
    assert.equal((await one('SELECT billing_provider FROM crm.finance_sources WHERE id = $1', [k.sourceId])).billing_provider, 'asaas_subscription')
    const other = await contract()
    await assert.rejects(linkSubscription(pool, { environment: 'sandbox', sourceId: other.sourceId, subscription: subscription(subId) }, ACTOR),
      (e: AsaasLinkError) => e.code === 'SUBSCRIPTION_OR_SOURCE_ALREADY_LINKED', 'a mesma assinatura não liga a dois contratos')
    await assert.rejects(linkSubscription(pool, { environment: 'sandbox', sourceId: k.sourceId, subscription: subscription(rid('sub')) }, ACTOR),
      (e: AsaasLinkError) => e.code === 'SUBSCRIPTION_OR_SOURCE_ALREADY_LINKED', 'um contrato, uma assinatura')
    const yearly = await contract()
    await assert.rejects(linkSubscription(pool, { environment: 'sandbox', sourceId: yearly.sourceId, subscription: subscription(rid('sub'), { cycle: 'YEARLY' }) }, ACTOR),
      (e: AsaasLinkError) => e.code === 'CYCLE_MISMATCH')
    assert.equal((await one('SELECT billing_provider FROM crm.finance_sources WHERE id = $1', [yearly.sourceId])).billing_provider, 'manual', 'recusa não altera o contrato')
    const exp = (await fin('source_create', { direction: 'out', category: 'software', description: 'Despesa fictícia', amount: '10', periodicity: 'monthly',
      startDate: '2026-10-01', dueDay: 10, costKind: 'fixed' })).id
    await assert.rejects(linkSubscription(pool, { environment: 'sandbox', sourceId: exp, subscription: subscription(rid('sub')) }, ACTOR), (e: AsaasLinkError) => e.code === 'SOURCE_NOT_REVENUE')
    const div = await contract()
    const d = await linkSubscription(pool, { environment: 'sandbox', sourceId: div.sourceId, subscription: subscription(rid('sub'), { value: 79.9, nextDueDate: '2026-11-10' }) }, ACTOR)
    assert.deepEqual(d.divergences, ['VALUE_MISMATCH', 'DUE_DAY_MISMATCH'])
    assert.deepEqual(await one('SELECT divergent, divergence_codes FROM crm.finance_asaas_subscriptions WHERE id = $1', [d.id]),
      { divergent: true, divergence_codes: ['VALUE_MISMATCH', 'DUE_DAY_MISMATCH'] })
  })

  // ───────────── cobranças e competência ─────────────
  it('uma competência, uma cobrança; repetição idempotente; segunda cobrança → revisão; adicional só com justificativa', async () => {
    const k = await linked()
    const p1 = rid('pay')
    const a = await ingest(payment({ id: p1, subscription: k.subId }))
    assert.equal(a.linkStatus, 'linked')
    const again = await ingest(payment({ id: p1, subscription: k.subId }))
    assert.equal(again.id, a.id)
    assert.equal((await one('SELECT count(*)::int n FROM crm.finance_asaas_payments WHERE asaas_payment_id = $1', [p1])).n, 1)
    assert.equal((await one('SELECT entry_id FROM crm.finance_asaas_payments WHERE id = $1', [a.id])).entry_id, k.entry('2026-11'))
    const p2 = await ingest(payment({ id: rid('pay'), subscription: k.subId }))
    assert.equal(p2.linkStatus, 'review')
    assert.deepEqual(await one('SELECT entry_id, review_reason FROM crm.finance_asaas_payments WHERE id = $1', [p2.id]), { entry_id: null, review_reason: 'DUPLICATE_COMPETENCE' })
    await assert.rejects(acceptAdditionalPayment(pool, p2.id, k.entry('2026-11'), 'ok', ACTOR), (e: AsaasLinkError) => e.code === 'JUSTIFICATION_REQUIRED')
    await acceptAdditionalPayment(pool, p2.id, k.entry('2026-11'), 'Cobrança complementar combinada com o cliente', ACTOR)
    assert.deepEqual(await one('SELECT link_status, is_additional FROM crm.finance_asaas_payments WHERE id = $1', [p2.id]), { link_status: 'linked', is_additional: true })
    // simultâneas na mesma competência (dez): só UMA principal
    const dec = await Promise.all([rid('pay'), rid('pay')].map(id => ingest(payment({ id, subscription: k.subId, dueDate: '2026-12-30' }))))
    assert.deepEqual(dec.map(d => d.linkStatus).sort(), ['linked', 'review'])
  })

  it('competência ainda não gerada: aguarda; depois de gerada, vincula. Sem assinatura vinculada: nunca vincula', async () => {
    const k = await linked()
    const id = rid('pay')
    assert.equal((await ingest(payment({ id, subscription: k.subId, dueDate: '2027-04-30' }))).linkStatus, 'unmatched')
    await view('2027-04') // o Financeiro materializa a previsão até o mês consultado
    assert.equal((await ingest(payment({ id, subscription: k.subId, dueDate: '2027-04-30' }))).linkStatus, 'linked')
    assert.equal((await ingest(payment({ id: rid('pay'), subscription: rid('sub') }))).linkStatus, 'unmatched')
  })

  it('valor divergente: vinculado, mas sem baixa automática até aceite com justificativa', async () => {
    const k = await linked()
    const id = rid('pay')
    const a = await ingest(payment({ id, subscription: k.subId, value: 79.9, netValue: 74, status: 'RECEIVED', paymentDate: '2026-10-30', creditDate: '2026-10-30' }))
    assert.deepEqual((await one('SELECT divergence_codes FROM crm.finance_asaas_payments WHERE id = $1', [a.id])).divergence_codes, ['AMOUNT_MISMATCH'])
    assert.deepEqual(await reconcilePayment(pool, a.id, ACTOR), { type: 'review', code: 'AMOUNT_MISMATCH' })
    assert.equal((await settlements(k.entry('2026-11'))).length, 0)
    // aceitar não permite passar do saldo do lançamento (R$ 79,90 > R$ 69,90)
    assert.deepEqual(await acceptAmountDivergence(pool, a.id, 'Reajuste acordado, conferido no contrato', ACTOR), { type: 'review', code: 'AMOUNT_EXCEEDS_BALANCE' })
    assert.equal((await settlements(k.entry('2026-11'))).length, 0)
  })

  // ───────────── recebimentos ─────────────
  it('pagamento integral: baixa BRUTA na data de caixa; tarifa e líquido guardados; repetições não duplicam', async () => {
    const k = await linked()
    const id = rid('pay')
    const a = await ingest(payment({ id, subscription: k.subId, status: 'CONFIRMED', billingType: 'CREDIT_CARD', confirmedDate: '2026-10-30' }))
    assert.deepEqual(await reconcilePayment(pool, a.id, ACTOR), { type: 'none', reason: 'AWAITING_CREDIT' })
    assert.equal((await settlements(k.entry('2026-11'))).length, 0, 'confirmado ≠ caixa')
    await ingest(payment({ id, subscription: k.subId, status: 'RECEIVED', billingType: 'CREDIT_CARD', confirmedDate: '2026-10-30', paymentDate: '2026-10-30', creditDate: '2026-10-31' }))
    const r = await reconcilePayment(pool, a.id, ACTOR)
    assert.equal(r.type, 'record_receipt')
    for (let i = 0; i < 3; i++) assert.deepEqual(await reconcilePayment(pool, a.id, ACTOR), { type: 'none', reason: 'ALREADY_SETTLED' })
    assert.deepEqual(await settlements(k.entry('2026-11')), [{ id: (await settlements(k.entry('2026-11')))[0].id, a: 6990, d: '2026-10-31', reversed: false }])
    assert.deepEqual(await one('SELECT value_cents::int v, net_value_cents::int n, fee_cents::int f FROM crm.finance_asaas_payments WHERE id = $1', [a.id]), { v: 6990, n: 6491, f: 499 })
    // competência novembro x caixa outubro, no Financeiro
    const nov = (await view('2026-11')).body
    const oct = (await view('2026-10')).body
    const novEntry = (nov.entries as Body[]).find(e => e.id === k.entry('2026-11'))!
    assert.deepEqual([novEntry.state, novEntry.settledCents], ['settled', 6990])
    assert.ok((oct.entries as Body[]).some(e => e.id === k.entry('2026-11')), 'aparece no caixa de outubro')
    // nenhuma despesa automática de tarifa
    assert.equal((await one("SELECT count(*)::int n FROM crm.finance_entries WHERE direction = 'out' AND description ILIKE '%asaas%'")).n, 0)
  })

  it('pagamento parcial e múltiplos movimentos válidos: duas cobranças justificadas quitam um lançamento; estorno de uma preserva a outra', async () => {
    const k = await linked('2.000,00')
    const a = await ingest(payment({ id: rid('pay'), subscription: k.subId, value: 1000, netValue: 990, status: 'RECEIVED', paymentDate: '2026-10-20', creditDate: '2026-10-21' }))
    assert.deepEqual(await reconcilePayment(pool, a.id, ACTOR), { type: 'review', code: 'AMOUNT_MISMATCH' })
    assert.equal((await acceptAmountDivergence(pool, a.id, 'Valor dividido em duas cobranças', ACTOR)).type, 'record_receipt')
    const bId = rid('pay')
    const b = await ingest(payment({ id: bId, subscription: k.subId, value: 1000, netValue: 990, status: 'RECEIVED', paymentDate: '2026-10-25', creditDate: '2026-10-26' }))
    assert.equal(b.linkStatus, 'review')
    await acceptAdditionalPayment(pool, b.id, k.entry('2026-11'), 'Segunda parte do valor dividido', ACTOR)
    assert.equal((await reconcilePayment(pool, b.id, ACTOR)).type, 'record_receipt')
    let s = await settlements(k.entry('2026-11'))
    assert.deepEqual(s.map(x => [x.a, x.reversed]), [[100000, false], [100000, false]])
    // estorno total da segunda cobrança
    await ingest(payment({ id: bId, subscription: k.subId, value: 1000, netValue: 990, status: 'REFUNDED', paymentDate: '2026-10-25', creditDate: '2026-10-26' }))
    assert.equal((await reconcilePayment(pool, b.id, ACTOR)).type, 'reverse')
    assert.deepEqual(await reconcilePayment(pool, b.id, ACTOR), { type: 'none', reason: 'NOTHING_TO_REVERSE' }, 'estorno não se repete')
    s = await settlements(k.entry('2026-11'))
    assert.deepEqual(s.map(x => [x.a, x.reversed]), [[100000, false], [100000, true]], 'histórico preservado')
    const e = ((await view('2026-11')).body.entries as Body[]).find(x => x.id === k.entry('2026-11'))!
    assert.deepEqual([e.state, e.remainingCents], ['partial', 100000])
  })

  it('estorno parcial, chargeback e remoção após recebimento: revisão, recibo mantido', async () => {
    for (const [extra, code] of [[{ refunds: [{ value: 20, status: 'DONE' }] }, 'PARTIAL_REFUND'], [{ status: 'CHARGEBACK_REQUESTED' }, 'CHARGEBACK'],
      [{ deleted: true }, 'DELETED_AFTER_RECEIPT']] as const) {
      const k = await linked()
      const id = rid('pay')
      const recv = payment({ id, subscription: k.subId, status: 'RECEIVED', paymentDate: '2026-10-30', creditDate: '2026-10-30' })
      const a = await ingest(recv)
      await reconcilePayment(pool, a.id, ACTOR)
      await ingest({ ...recv, ...extra })
      assert.deepEqual(await reconcilePayment(pool, a.id, ACTOR), { type: 'review', code })
      assert.deepEqual((await settlements(k.entry('2026-11'))).map(s => s.reversed), [false], code)
    }
  })

  it('baixa manual já lançada: revisão (sem segunda baixa); confirmada pelo administrador, apenas vincula', async () => {
    const k = await linked()
    await fin('settle', { entryId: k.entry('2026-11'), amount: '69,90', settledOn: '2026-10-30', idempotencyKey: randomUUID(), method: 'PIX' })
    const a = await ingest(payment({ id: rid('pay'), subscription: k.subId, status: 'RECEIVED', paymentDate: '2026-10-30', creditDate: '2026-10-30' }))
    assert.deepEqual(await reconcilePayment(pool, a.id, ACTOR), { type: 'review', code: 'MANUAL_SETTLEMENT_EXISTS' })
    assert.equal((await settlements(k.entry('2026-11'))).length, 1)
    assert.equal((await confirmManualOverlap(pool, a.id, ACTOR)).type, 'link_manual')
    assert.equal((await settlements(k.entry('2026-11'))).length, 1, 'nenhuma baixa nova')
    assert.equal((await one("SELECT kind FROM crm.finance_asaas_payment_settlements WHERE payment_link_id = $1", [a.id])).kind, 'manual_confirmed')
    assert.deepEqual(await reconcilePayment(pool, a.id, ACTOR), { type: 'none', reason: 'ALREADY_SETTLED' })
  })

  // ───────────── webhooks simulados ─────────────
  const event = (id: string, type: string, pay: Body, at: string) => parseWebhookEvent('sandbox', { id, event: type, dateCreated: at, payment: pay })

  it('evento uma vez e repetido: processado UMA vez, uma baixa', async () => {
    const k = await linked()
    const ev = event(rid('evt'), 'PAYMENT_RECEIVED', payment({ id: rid('pay'), subscription: k.subId, status: 'RECEIVED', paymentDate: '2026-10-30', creditDate: '2026-10-30' }), '2026-10-30 10:00:00')
    const r1 = await recordWebhookEvent(pool, ev)
    assert.equal(r1.duplicate, false)
    assert.equal((await processWebhookEvent(pool, r1.id, ACTOR)).status, 'processed')
    const r2 = await recordWebhookEvent(pool, ev)
    assert.deepEqual(r2, { id: r1.id, duplicate: true })
    assert.equal((await processWebhookEvent(pool, r2.id, ACTOR)).status, 'already_processed')
    assert.equal((await settlements(k.entry('2026-11'))).length, 1)
    const stored = await one('SELECT payload_min FROM crm.finance_asaas_events WHERE id = $1', [r1.id])
    assert.deepEqual(Object.keys(stored.payload_min).sort(), ['billingType', 'creditDate', 'dueDate', 'id', 'netValue', 'paymentDate', 'status', 'subscription', 'value'])
  })

  it('fora de ordem: evento antigo (pendente) depois do recebido é ignorado; nada é desfeito', async () => {
    const k = await linked()
    const pay = rid('pay')
    const recv = await recordWebhookEvent(pool, event(rid('evt'), 'PAYMENT_RECEIVED', payment({ id: pay, subscription: k.subId, status: 'RECEIVED', paymentDate: '2026-10-30', creditDate: '2026-10-30' }), '2026-10-30 12:00:00'))
    const created = await recordWebhookEvent(pool, event(rid('evt'), 'PAYMENT_CREATED', payment({ id: pay, subscription: k.subId, status: 'PENDING' }), '2026-10-01 08:00:00'))
    await processWebhookEvent(pool, recv.id, ACTOR)
    assert.equal((await processWebhookEvent(pool, created.id, ACTOR)).status, 'processed')
    assert.equal((await one('SELECT normalized_state FROM crm.finance_asaas_payments WHERE asaas_payment_id = $1', [pay])).normalized_state, 'received')
    assert.deepEqual((await settlements(k.entry('2026-11'))).map(s => s.reversed), [false])
  })

  it('falha durante o processamento: evento fica "failed" com código; reprocessamento seguro conclui com UMA baixa', async () => {
    const k = await linked()
    const pay = rid('pay')
    const r = await recordWebhookEvent(pool, event(rid('evt'), 'PAYMENT_RECEIVED', payment({ id: pay, subscription: k.subId, status: 'RECEIVED' }), '2026-10-30 10:00:00'))
    let calls = 0
    const gateway: AsaasReadGateway = {
      environment: 'sandbox',
      getPayment: async () => { calls++; if (calls === 1) throw Object.assign(new Error('timeout'), { code: 'ASAAS_TIMEOUT' }); return payment({ id: pay, subscription: k.subId, status: 'RECEIVED', paymentDate: '2026-10-30', creditDate: '2026-10-31' }) },
      getSubscription: async () => ({}), listSubscriptionPayments: async () => [],
    }
    assert.deepEqual(await processWebhookEvent(pool, r.id, ACTOR, gateway), { status: 'failed', error: 'ASAAS_TIMEOUT' })
    assert.deepEqual(await one('SELECT status, attempts, last_error FROM crm.finance_asaas_events WHERE id = $1', [r.id]), { status: 'failed', attempts: 1, last_error: 'ASAAS_TIMEOUT' })
    assert.equal((await processWebhookEvent(pool, r.id, ACTOR, gateway)).status, 'processed')
    assert.equal((await processWebhookEvent(pool, r.id, ACTOR, gateway)).status, 'already_processed')
    assert.deepEqual((await settlements(k.entry('2026-11'))).map(s => [s.a, s.d]), [[6990, '2026-10-31']], 'data do Asaas relido (fonte da verdade)')
    // gateway de outro ambiente é recusado
    const r2 = await recordWebhookEvent(pool, event(rid('evt'), 'PAYMENT_UPDATED', payment({ id: pay, subscription: k.subId, status: 'RECEIVED' }), '2026-10-31 10:00:00'))
    assert.deepEqual(await processWebhookEvent(pool, r2.id, ACTOR, { ...gateway, environment: 'production' }), { status: 'failed', error: 'ENVIRONMENT_MISMATCH' })
  })

  it('queda entre gravar o recibo e o vínculo: reprocessar auto-repara, sem segunda baixa e sem "baixa manual" falsa', async () => {
    const k = await linked()
    const pay = rid('pay')
    const a = await ingest(payment({ id: pay, subscription: k.subId, status: 'RECEIVED', paymentDate: '2026-10-30', creditDate: '2026-10-30' }))
    // simula a queda: o recibo (mesma chave determinística) foi gravado, mas o vínculo não
    await recordSettlement(pool, { entryId: k.entry('2026-11'), amountCents: 6990, settledOn: '2026-10-30', method: 'Asaas PIX', notes: 'x',
      idempotencyKey: receiptIdempotencyKey('sandbox', pay) }, ACTOR)
    assert.deepEqual(await reconcilePayment(pool, a.id, ACTOR), { type: 'none', reason: 'ALREADY_SETTLED' })
    assert.equal((await settlements(k.entry('2026-11'))).length, 1)
  })

  it('concorrência: o mesmo evento e eventos diferentes da mesma cobrança, em paralelo → uma baixa', async () => {
    const k = await linked()
    const pay = rid('pay')
    const recv = payment({ id: pay, subscription: k.subId, status: 'RECEIVED', paymentDate: '2026-10-30', creditDate: '2026-10-30' })
    const evs = await Promise.all([rid('evt'), rid('evt'), rid('evt')].map((id, i) => recordWebhookEvent(pool, event(id, 'PAYMENT_RECEIVED', recv, '2026-10-30 10:0' + i + ':00'))))
    const results = await Promise.all([...evs, evs[0]].map(e => processWebhookEvent(pool, e.id, ACTOR)))
    assert.ok(results.every(r => r.status !== 'failed'), JSON.stringify(results))
    assert.equal((await settlements(k.entry('2026-11'))).filter(s => !s.reversed).length, 1)
    assert.equal((await one('SELECT count(*)::int n FROM crm.finance_asaas_payment_settlements l JOIN crm.finance_asaas_payments p ON p.id = l.payment_link_id WHERE p.asaas_payment_id = $1', [pay])).n, 1)
  })

  // ───────────── travas e sincronização ─────────────
  it('trava de cobrança externa: contrato com assinatura vinculada nunca recebe cobrança do CRM', async () => {
    const k = await linked()
    assert.deepEqual(await externalChargeGuard(pool, 'sandbox', k.sourceId, '2026-12-01'), { allowed: false, reason: 'MANAGED_BY_EXTERNAL_SUBSCRIPTION' })
    const m = await contract()
    assert.deepEqual(await externalChargeGuard(pool, 'sandbox', m.sourceId, '2026-12-01'), { allowed: false, reason: 'CONTRACT_NOT_BILLED_BY_ASAAS' })
  })

  it('sincronização com gateway SOMENTE LEITURA: concilia todas as cobranças da assinatura; repetir não duplica', async () => {
    const k = await linked()
    const pays = [payment({ id: rid('pay'), subscription: k.subId, dueDate: '2026-10-30', status: 'RECEIVED', paymentDate: '2026-10-28', creditDate: '2026-10-28' }),
      payment({ id: rid('pay'), subscription: k.subId, dueDate: '2026-11-30', status: 'PENDING' })]
    const gateway: AsaasReadGateway = { environment: 'sandbox', getPayment: async () => ({}), getSubscription: async () => ({}), listSubscriptionPayments: async () => pays }
    assert.deepEqual(Object.keys(gateway).sort(), ['environment', 'getPayment', 'getSubscription', 'listSubscriptionPayments'], 'contrato sem métodos de escrita')
    for (let i = 0; i < 2; i++) {
      const res = await syncSubscriptionPayments(pool, gateway, k.subLinkId, ACTOR)
      assert.deepEqual(res.map(r => r.linkStatus), ['linked', 'linked'])
    }
    assert.deepEqual((await settlements(k.entry('2026-10'))).map(s => s.a), [6990])
    assert.equal((await settlements(k.entry('2026-11'))).length, 0)
    await assert.rejects(syncSubscriptionPayments(pool, { ...gateway, environment: 'production' }, k.subLinkId, ACTOR), (e: AsaasLinkError) => e.code === 'ENVIRONMENT_MISMATCH')
    // trilha da integração
    assert.ok((await one("SELECT count(*)::int n FROM crm.finance_integration_log WHERE entity = 'subscription' AND entity_ref = $1", [k.subId])).n >= 1)
  })

  it('preservação: nenhum lançamento apagado ou alterado; auditoria do Financeiro registra as baixas da integração', async () => {
    const k = await linked()
    const before = await pool.query('SELECT id, amount_cents, competence_month, due_date, status FROM crm.finance_entries WHERE source_id = $1 ORDER BY id', [k.sourceId])
    const a = await ingest(payment({ id: rid('pay'), subscription: k.subId, status: 'RECEIVED', paymentDate: '2026-10-30', creditDate: '2026-10-30' }))
    await reconcilePayment(pool, a.id, ACTOR)
    const afterRows = await pool.query('SELECT id, amount_cents, competence_month, due_date, status FROM crm.finance_entries WHERE source_id = $1 ORDER BY id', [k.sourceId])
    assert.deepEqual(afterRows.rows, before.rows)
    const s = (await settlements(k.entry('2026-11')))[0]
    assert.equal((await one("SELECT count(*)::int n FROM crm.finance_audit_log WHERE entity = 'settlement' AND entity_id = $1 AND action = 'recorded'", [s.id])).n, 1)
  })
})
