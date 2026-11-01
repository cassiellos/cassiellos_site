/**
 * Fase 1.2 — regressão dos riscos financeiros (P2-1, P2-2, P2-4, P2-5, P2-6, P3-1) contra PostgreSQL DESCARTÁVEL
 * (CRM_INTEGRATION_DATABASE_URL, migrações 0001–0016, banco ligado ao SANDBOX). Dados sintéticos; sem rede.
 * Concorrência: ordens problemáticas FORÇADAS com ganchos (afterDecide/afterExecute) — nada depende de sorte.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { Pool } from 'pg'
import { handleFinanceAdmin, type FinanceAdminRequest } from '../finance/admin-request'
import { FinanceRuleError, recordSettlement } from '../finance/store'
import { parseWebhookEvent } from './policy'
import {
  applyPaymentSnapshot, asaasCashSummary, bindAsaasEnvironment, ingestPayment, linkSubscription, processWebhookEvent, reconcilePayment, recordWebhookEvent,
} from './store'
import { normalizePayment, type AsaasReadGateway } from './types'

const url = process.env.CRM_INTEGRATION_DATABASE_URL
const skip = !url ? 'CRM_INTEGRATION_DATABASE_URL não definida' : false
type Body = Record<string, any>
const rid = (p: string) => p + '_' + randomUUID().replaceAll('-', '').slice(0, 16)
const A = 'sessao-teste'

/** Barreira manual: o processo pausado espera `release()`; `reached` resolve quando ele chega ao ponto. */
function gate() {
  let release!: () => void
  let reachedResolve!: () => void
  const released = new Promise<void>(r => { release = r })
  const reached = new Promise<void>(r => { reachedResolve = r })
  return { release, reached, wait: async () => { reachedResolve(); await released } }
}
const pending = async (p: Promise<unknown>, ms = 400) => Promise.race([p.then(() => false), new Promise(r => setTimeout(() => r(true), ms))])

describe('Asaas — Fase 1.2: correções dos riscos financeiros', { skip }, () => {
  let pool: Pool
  before(async () => { pool = new Pool({ connectionString: url, max: 12 }); await bindAsaasEnvironment(pool, 'sandbox', A) })
  after(async () => { await pool?.end() })
  const base: FinanceAdminRequest = { method: 'POST', vercelEnv: 'preview', sessionValid: true, originAllowed: true, contentType: 'application/json', actorRef: A }
  const fin = async (action: string, b: Body) => {
    const r = await handleFinanceAdmin({ pool, now: () => new Date('2026-10-31T15:00:00Z'), log: () => undefined }, { ...base, rawBody: JSON.stringify({ action, ...b }) })
    assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body as Body
  }
  const one = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows[0]
  async function linked(amount = '69,90') {
    const clientId = (await fin('client_create', { name: 'Cliente Fictício ' + randomUUID().slice(0, 6) })).id
    const sourceId = (await fin('source_create', { direction: 'in', clientId, category: 'hosting', description: 'Hosp fictícia', amount, periodicity: 'monthly', startDate: '2026-10-01', dueDay: 30 })).id
    const subId = rid('sub')
    await linkSubscription(pool, { environment: 'sandbox', sourceId, subscription: { id: subId, value: Number(amount.replace(/\./g, '').replace(',', '.')), cycle: 'MONTHLY', nextDueDate: '2026-11-30' } }, A)
    const entries = (await pool.query("SELECT id, to_char(competence_month, 'YYYY-MM') m FROM crm.finance_entries WHERE source_id = $1", [sourceId])).rows
    return { sourceId, subId, entry: (m: string) => entries.find(e => e.m === m)!.id as string }
  }
  const pay = (o: Body) => ({ value: 69.9, netValue: 68.91, billingType: 'PIX', dueDate: '2026-11-30', status: 'PENDING', ...o })
  const received = (id: string, sub: string, o: Body = {}) => pay({ id, subscription: sub, status: 'RECEIVED', paymentDate: '2026-10-30', creditDate: '2026-10-30', ...o })
  const active = async (entryId: string) => (await pool.query('SELECT id, amount_cents::int a, settled_on::text d FROM crm.finance_settlements WHERE entry_id = $1 AND reversed_at IS NULL', [entryId])).rows
  const all = async (entryId: string) => (await pool.query('SELECT reversed_at IS NOT NULL AS r FROM crm.finance_settlements WHERE entry_id = $1 ORDER BY created_at', [entryId])).rows.map(r => r.r)
  const state = async (id: string) => (await one('SELECT normalized_state FROM crm.finance_asaas_payments WHERE asaas_payment_id = $1', [id])).normalized_state

  // ─────────────── P2-3 (lado sandbox): banco ligado ao sandbox recusa vínculo de produção ───────────────
  it('P2-3 contrato em banco Sandbox não recebe vínculo Production; contrato intacto', async () => {
    const clientId = (await fin('client_create', { name: 'Cliente Fictício Sbx ' + randomUUID().slice(0, 5) })).id
    const sourceId = (await fin('source_create', { direction: 'in', clientId, category: 'hosting', description: 'Hosp', amount: '69,90', periodicity: 'monthly', startDate: '2026-10-01', dueDay: 30 })).id
    await assert.rejects(linkSubscription(pool, { environment: 'production', sourceId, subscription: { id: rid('sub'), value: 69.9, cycle: 'MONTHLY', nextDueDate: '2026-11-30' } }, A),
      (e: { code?: string }) => e.code === 'ENVIRONMENT_MISMATCH')
    assert.equal((await one('SELECT billing_provider FROM crm.finance_sources WHERE id = $1', [sourceId])).billing_provider, 'manual')
  })

  // ─────────────── P2-1: concorrência ───────────────
  it('P2-1 recebimento iniciado ANTES do estorno: o estorno espera a trava e estorna o recibo — nunca "estornada com recibo ativo"', async () => {
    const k = await linked(); const p = rid('pay')
    const ing = await ingestPayment(pool, 'sandbox', normalizePayment(received(p, k.subId)), '2026-10-30T13:00:00Z', A)
    const g = gate()
    const worker1 = reconcilePayment(pool, ing.id, A, { hooks: { afterDecide: async a => { assert.equal(a.type, 'record_receipt'); await g.wait() } } })
    await g.reached // worker 1 decidiu baixar e está parado DENTRO da transação, com a trava
    const worker2 = applyPaymentSnapshot(pool, 'sandbox', normalizePayment(received(p, k.subId, { status: 'REFUNDED' })), '2026-10-30T14:00:00Z', A)
    assert.equal(await pending(worker2), true, 'o estorno fica bloqueado enquanto a baixa está em curso')
    g.release()
    assert.equal((await worker1).type, 'record_receipt')
    assert.deepEqual((await worker2).action, { type: 'reverse', settlementIds: [(await pool.query('SELECT id FROM crm.finance_settlements WHERE entry_id = $1', [k.entry('2026-11')])).rows[0].id], reason: 'ASAAS_REFUNDED' })
    assert.deepEqual([await state(p), await active(k.entry('2026-11')), await all(k.entry('2026-11'))], ['refunded', [], [true]])
  })

  it('P2-1 estorno concluído ANTES da tentativa de baixa: nenhuma baixa é criada depois', async () => {
    const k = await linked(); const p = rid('pay')
    await applyPaymentSnapshot(pool, 'sandbox', normalizePayment(received(p, k.subId, { status: 'REFUNDED' })), '2026-10-30T14:00:00Z', A)
    // evento de recebimento atrasado (mais antigo) e conciliação posterior
    const late = await applyPaymentSnapshot(pool, 'sandbox', normalizePayment(received(p, k.subId)), '2026-10-30T13:00:00Z', A)
    assert.equal(late.applied, false)
    assert.deepEqual(late.action, { type: 'none', reason: 'NOTHING_TO_REVERSE' })
    assert.deepEqual(await active(k.entry('2026-11')), [])
  })

  it('P2-1 dois processos conciliando a MESMA cobrança: o segundo espera e não duplica', async () => {
    const k = await linked(); const p = rid('pay')
    const ing = await ingestPayment(pool, 'sandbox', normalizePayment(received(p, k.subId)), '2026-10-30T13:00:00Z', A)
    const g = gate()
    const w1 = reconcilePayment(pool, ing.id, A, { hooks: { afterDecide: async () => g.wait() } })
    await g.reached
    const w2 = reconcilePayment(pool, ing.id, A)
    assert.equal(await pending(w2), true)
    g.release()
    assert.deepEqual([(await w1).type, await w2], ['record_receipt', { type: 'none', reason: 'ALREADY_SETTLED' }])
    assert.equal((await active(k.entry('2026-11'))).length, 1)
    // e sem pausa, muitos em paralelo
    const k2 = await linked(); const p2 = rid('pay')
    const ing2 = await ingestPayment(pool, 'sandbox', normalizePayment(received(p2, k2.subId)), '2026-10-30T13:00:00Z', A)
    await Promise.all(Array.from({ length: 8 }, () => reconcilePayment(pool, ing2.id, A)))
    assert.equal((await active(k2.entry('2026-11'))).length, 1)
  })

  it('P2-1 reenvio de evento após o estorno: duplicado não reprocessa; recebimento antigo não ressuscita a baixa', async () => {
    const k = await linked(); const p = rid('pay')
    const ev = (id: string, type: string, o: Body, at: string) => parseWebhookEvent('sandbox', { id, event: type, dateCreated: at, payment: received(p, k.subId, o) })
    const recvId = rid('evt')
    const e1 = await recordWebhookEvent(pool, ev(recvId, 'PAYMENT_RECEIVED', {}, '2026-10-30 10:00:00'))
    await processWebhookEvent(pool, e1.id, A)
    const e2 = await recordWebhookEvent(pool, ev(rid('evt'), 'PAYMENT_REFUNDED', { status: 'REFUNDED' }, '2026-10-30 11:00:00'))
    await processWebhookEvent(pool, e2.id, A)
    const again = await recordWebhookEvent(pool, ev(recvId, 'PAYMENT_RECEIVED', {}, '2026-10-30 10:00:00'))
    assert.deepEqual([again.duplicate, (await processWebhookEvent(pool, again.id, A)).status], [true, 'already_processed'])
    const replay = await recordWebhookEvent(pool, ev(rid('evt'), 'PAYMENT_UPDATED', {}, '2026-10-30 10:30:00')) // outro id, estado antigo
    assert.equal((await processWebhookEvent(pool, replay.id, A)).status, 'processed')
    assert.deepEqual([await state(p), await active(k.entry('2026-11')), await all(k.entry('2026-11'))], ['refunded', [], [true]])
  })

  it('P2-1 falha entre operações: tudo é desfeito (sem recibo nem vínculo pela metade); retomada cria UMA baixa', async () => {
    const k = await linked(); const p = rid('pay')
    const ing = await ingestPayment(pool, 'sandbox', normalizePayment(received(p, k.subId)), '2026-10-30T13:00:00Z', A)
    await assert.rejects(reconcilePayment(pool, ing.id, A, { hooks: { afterExecute: async () => { throw new Error('queda simulada') } } }), /queda simulada/)
    assert.deepEqual(await active(k.entry('2026-11')), [])
    assert.equal((await one('SELECT count(*)::int n FROM crm.finance_asaas_payment_settlements WHERE payment_link_id = $1', [ing.id])).n, 0)
    assert.equal((await reconcilePayment(pool, ing.id, A)).type, 'record_receipt')
    assert.equal((await reconcilePayment(pool, ing.id, A)).type, 'none')
    assert.equal((await active(k.entry('2026-11'))).length, 1)
  })

  // ─────────────── P2-2: competência ───────────────
  it('P2-2 cobrança de novembro adiada para dezembro fica em NOVEMBRO; a de dezembro continua livre', async () => {
    const k = await linked()
    const nov = await ingestPayment(pool, 'sandbox', normalizePayment(pay({ id: rid('pay'), subscription: k.subId, dueDate: '2026-12-05', originalDueDate: '2026-11-30' })), null, A)
    assert.deepEqual(await one("SELECT link_status, entry_id, competence_basis FROM crm.finance_asaas_payments WHERE id = $1", [nov.id]),
      { link_status: 'linked', entry_id: k.entry('2026-11'), competence_basis: 'original_due_date' })
    const dec = await ingestPayment(pool, 'sandbox', normalizePayment(pay({ id: rid('pay'), subscription: k.subId, dueDate: '2026-12-30' })), null, A)
    assert.equal(dec.linkStatus, 'linked')
  })

  it('P2-2 sem vencimento original e vencimento movido → revisão; competência registrada nunca muda; contradição → revisão', async () => {
    const k = await linked()
    const moved = await ingestPayment(pool, 'sandbox', normalizePayment(pay({ id: rid('pay'), subscription: k.subId, dueDate: '2026-12-05' })), null, A)
    assert.deepEqual(await one('SELECT link_status, entry_id, review_reason FROM crm.finance_asaas_payments WHERE id = $1', [moved.id]),
      { link_status: 'review', entry_id: null, review_reason: 'COMPETENCE_UNCERTAIN' })
    const id = rid('pay')
    const ok = await ingestPayment(pool, 'sandbox', normalizePayment(pay({ id, subscription: k.subId, dueDate: '2026-10-30', originalDueDate: '2026-10-30' })), null, A)
    assert.equal(ok.linkStatus, 'linked')
    await ingestPayment(pool, 'sandbox', normalizePayment(pay({ id, subscription: k.subId, dueDate: '2026-11-15' })), null, A) // vencimento mudou depois
    assert.deepEqual(await one("SELECT to_char(competence_month,'YYYY-MM') c, entry_id, original_due_date::text o FROM crm.finance_asaas_payments WHERE id = $1", [ok.id]),
      { c: '2026-10', entry_id: k.entry('2026-10'), o: '2026-10-30' })
    await ingestPayment(pool, 'sandbox', normalizePayment(pay({ id, subscription: k.subId, dueDate: '2026-11-15', originalDueDate: '2026-11-15' })), null, A)
    assert.deepEqual(await one("SELECT to_char(competence_month,'YYYY-MM') c, review_reason, original_due_date::text o FROM crm.finance_asaas_payments WHERE id = $1", [ok.id]),
      { c: '2026-10', review_reason: 'COMPETENCE_CONFLICT', o: '2026-10-30' }, 'competência e original preservados; contradição em revisão')
  })

  // ─────────────── P2-4: datas inválidas e ordem ───────────────
  it('P2-4 evento com data inválida/ausente/formato inesperado depois do recebido: NÃO altera nada (aguarda releitura)', async () => {
    const k = await linked(); const p = rid('pay')
    const r = await recordWebhookEvent(pool, parseWebhookEvent('sandbox', { id: rid('evt'), event: 'PAYMENT_RECEIVED', dateCreated: '2026-10-30 10:00:00', payment: received(p, k.subId) }))
    await processWebhookEvent(pool, r.id, A)
    for (const dateCreated of ['30/10/2026 08:00', undefined, '2026-10-30T08:00:00', '2026-02-30 08:00:00']) {
      const e = await recordWebhookEvent(pool, parseWebhookEvent('sandbox', { id: rid('evt'), event: 'PAYMENT_CREATED', dateCreated, payment: pay({ id: p, subscription: k.subId }) }))
      assert.equal((await processWebhookEvent(pool, e.id, A)).status, 'needs_resync', String(dateCreated))
      assert.deepEqual(await one('SELECT status, last_error FROM crm.finance_asaas_events WHERE id = $1', [e.id]), { status: 'needs_resync', last_error: 'UNTRUSTED_EVENT_DATE' })
    }
    assert.deepEqual([await state(p), (await active(k.entry('2026-11'))).length,
      (await one('SELECT review_reason FROM crm.finance_asaas_payments WHERE asaas_payment_id = $1', [p])).review_reason], ['received', 1, null])
    // releitura futura (gateway) conclui o evento pendente com o estado real
    const e = await recordWebhookEvent(pool, parseWebhookEvent('sandbox', { id: rid('evt'), event: 'PAYMENT_UPDATED', payment: pay({ id: p, subscription: k.subId }) }))
    await processWebhookEvent(pool, e.id, A)
    const gw: AsaasReadGateway = { environment: 'sandbox', getPayment: async () => received(p, k.subId), getSubscription: async () => ({}), listSubscriptionPayments: async () => [] }
    assert.equal((await processWebhookEvent(pool, e.id, A, gw)).status, 'processed')
    assert.equal((await active(k.entry('2026-11'))).length, 1)
  })

  it('P2-4 mesmo segundo: CONFIRMED depois de RECEIVED não regride; RECEIVED depois de CONFIRMED avança; evento posterior legítimo aplica', async () => {
    const k = await linked(); const p = rid('pay')
    await applyPaymentSnapshot(pool, 'sandbox', normalizePayment(received(p, k.subId)), '2026-10-30T13:00:00Z', A)
    const tie = await applyPaymentSnapshot(pool, 'sandbox', normalizePayment(pay({ id: p, subscription: k.subId, status: 'CONFIRMED' })), '2026-10-30T13:00:00Z', A)
    assert.deepEqual([tie.applied, await state(p)], [false, 'received'])
    const q = rid('pay')
    await applyPaymentSnapshot(pool, 'sandbox', normalizePayment(pay({ id: q, subscription: k.subId, dueDate: '2026-12-30', status: 'CONFIRMED' })), '2026-10-30T13:00:00Z', A)
    const adv = await applyPaymentSnapshot(pool, 'sandbox', normalizePayment(received(q, k.subId, { dueDate: '2026-12-30' })), '2026-10-30T13:00:00Z', A)
    assert.deepEqual([adv.applied, await state(q)], [true, 'received'])
    const later = await applyPaymentSnapshot(pool, 'sandbox', normalizePayment(received(p, k.subId, { status: 'REFUNDED' })), '2026-10-30T15:00:00Z', A)
    assert.deepEqual([later.applied, later.action.type, await state(p)], [true, 'reverse', 'refunded'])
  })

  // ─────────────── P2-5: datas futuras ───────────────
  it('P2-5 crédito futuro não vira caixa; quando a data chega, a baixa sai NA data do crédito', async () => {
    const k = await linked(); const p = rid('pay')
    const snap = normalizePayment(received(p, k.subId, { creditDate: '2026-12-02' }))
    const r1 = await applyPaymentSnapshot(pool, 'sandbox', snap, null, A, { today: '2026-11-30' })
    assert.deepEqual(r1.action, { type: 'none', reason: 'AWAITING_CREDIT_DATE' })
    assert.deepEqual(await active(k.entry('2026-11')), [])
    assert.equal((await one('SELECT credit_date::text d FROM crm.finance_asaas_payments WHERE asaas_payment_id = $1', [p])).d, '2026-12-02', 'data prevista preservada')
    // ainda não chegou → nada; chegou → baixa em 02/12 (nunca a "data de hoje")
    assert.equal((await reconcilePayment(pool, r1.id, A, { today: '2026-12-01' })).type, 'none')
    assert.equal((await reconcilePayment(pool, r1.id, A, { today: '2026-12-05' })).type, 'record_receipt')
    assert.deepEqual((await active(k.entry('2026-11'))).map(s => s.d), ['2026-12-02'])
  })

  it('P2-5 serviço financeiro compartilhado recusa baixa direta com data futura', async () => {
    const k = await linked()
    await assert.rejects(recordSettlement(pool, { entryId: k.entry('2026-11'), amountCents: 6990, settledOn: '2099-01-01', method: 'PIX', notes: '', idempotencyKey: randomUUID() }, A),
      (e: FinanceRuleError) => e.code === 'SETTLED_ON_IN_FUTURE')
    await assert.rejects(recordSettlement(pool, { entryId: k.entry('2026-11'), amountCents: 6990, settledOn: '2026-12-01', method: 'PIX', notes: '', idempotencyKey: randomUUID() }, A, { today: '2026-11-30' }),
      (e: FinanceRuleError) => e.code === 'SETTLED_ON_IN_FUTURE')
    assert.equal((await recordSettlement(pool, { entryId: k.entry('2026-11'), amountCents: 6990, settledOn: '2026-11-30', method: 'PIX', notes: '', idempotencyKey: randomUUID() }, A, { today: '2026-11-30' })).duplicate, false)
  })

  // ─────────────── P2-6: bruto × tarifa × líquido ───────────────
  it('P2-6 resumo: bruto quita a obrigação; tarifa uma vez por cobrança; líquido sem dupla dedução; estorno não devolve tarifa', async () => {
    const k = await linked()
    const p1 = rid('pay'); const p2 = rid('pay'); const p3 = rid('pay')
    const s1 = await applyPaymentSnapshot(pool, 'sandbox', normalizePayment(received(p1, k.subId, { dueDate: '2026-10-30', creditDate: '2026-10-30' })), null, A)
    await applyPaymentSnapshot(pool, 'sandbox', normalizePayment(received(p2, k.subId)), null, A)
    await applyPaymentSnapshot(pool, 'sandbox', normalizePayment(received(p2, k.subId, { status: 'REFUNDED' })), null, A)
    await applyPaymentSnapshot(pool, 'sandbox', normalizePayment(received(p3, k.subId, { dueDate: '2026-12-30', netValue: undefined })), null, A)
    assert.equal(s1.action.type, 'record_receipt')
    const sumAll = await asaasCashSummary(pool, 'sandbox', '2026-10-01', '2026-10-31')
    const mine = await pool.query(`SELECT p.asaas_payment_id, p.value_cents::int v, p.fee_cents::int f FROM crm.finance_asaas_payments p WHERE p.asaas_payment_id = ANY($1)`, [[p1, p2, p3]])
    assert.deepEqual(mine.rows.find(r => r.asaas_payment_id === p1), { asaas_payment_id: p1, v: 6990, f: 99 })
    assert.ok(sumAll.grossCents >= 6990 * 2 && sumAll.netCents === sumAll.grossCents - sumAll.feeCents)
    assert.ok(sumAll.retainedFeeOnRefundsCents >= 99 && sumAll.paymentsWithUnknownFee >= 1)
    const entryNov = (await active(k.entry('2026-11')))
    assert.deepEqual(entryNov, [], 'p2 estornado; nov sem baixa ativa')
    assert.deepEqual((await active(k.entry('2026-10'))).map(s => s.a), [6990], 'baixa pelo BRUTO (R$ 69,90), não pelo líquido')
    assert.equal((await one("SELECT count(*)::int n FROM crm.finance_entries WHERE direction = 'out' AND description ILIKE '%tarifa%'")).n, 0, 'nenhuma despesa automática')
  })

  // ─────────────── P3-1: consistência no banco ───────────────
  it('P3-1 o banco recusa ligar a uma cobrança um movimento de OUTRO lançamento', async () => {
    const k = await linked(); const p = rid('pay')
    const r = await applyPaymentSnapshot(pool, 'sandbox', normalizePayment(received(p, k.subId)), null, A)
    const other = await recordSettlement(pool, { entryId: k.entry('2026-12'), amountCents: 100, settledOn: '2026-10-30', method: 'PIX', notes: '', idempotencyKey: randomUUID() }, A)
    await assert.rejects(pool.query(`INSERT INTO crm.finance_asaas_payment_settlements (payment_link_id, settlement_id, kind) VALUES ($1, $2, 'receipt')`, [r.id, other.id]),
      (e: { code?: string }) => e.code === '23514')
  })
})
