/**
 * Fase 2.2A — banco LOCAL descartável ligado ao SANDBOX (CRM_ASAAS_SANDBOX_DATABASE_URL, criado por
 * `scripts/crm-local-sandbox-db.sh create crm_local_asaas_sandbox sandbox`). Exercita, de ponta a ponta e SEM REDE,
 * receptor de webhook + cliente HTTP (transporte simulado) + conciliação. Recusa-se a rodar em banco não local ou
 * sem o marcador do script. Dados exclusivamente sintéticos.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { Pool } from 'pg'
import { handleFinanceAdmin, type FinanceAdminRequest } from '../finance/admin-request'
import { FAKE_PII, FAKE_SANDBOX_KEY, FAKE_WEBHOOK_TOKEN, paymentFixture, subscriptionFixture, webhookEvent } from './fixtures'
import { AsaasHttpError, createAsaasSandboxGateway, type AsaasTransport } from './http'
import { parseWebhookEvent } from './policy'
import { AsaasLinkError, bindAsaasEnvironment, ingestPayment, linkCustomer, linkSubscription, recordWebhookEvent } from './store'
import { assertDisposableDatabase } from './test-support'
import { normalizePayment } from './types'
import { handleAsaasWebhook, reprocessPendingEvents, type WebhookLogEntry } from './webhook'

const url = process.env.CRM_ASAAS_SANDBOX_DATABASE_URL
const skip = !url ? 'CRM_ASAAS_SANDBOX_DATABASE_URL não definida (scripts/crm-local-sandbox-db.sh env)' : false
const A = 'sessao-teste-sandbox'
const rid = (p: string) => p + '_' + randomUUID().replaceAll('-', '').slice(0, 16)
const code = (c: string) => (e: { code?: string }) => e.code === c
const TODAY = { today: '2026-12-31' }

describe('Fase 2.2A — ambiente Sandbox local (banco descartável)', { skip }, () => {
  let pool: Pool
  const logs: WebhookLogEntry[] = []
  before(async () => {
    pool = new Pool({ connectionString: url, max: 10 })
    await assertDisposableDatabase(pool, url!, 'sandbox')
  })
  after(async () => { await pool?.end() })

  const base: FinanceAdminRequest = { method: 'POST', vercelEnv: 'preview', sessionValid: true, originAllowed: true, contentType: 'application/json', actorRef: A }
  const fin = async (action: string, b: Record<string, unknown>) => {
    const r = await handleFinanceAdmin({ pool, now: () => new Date('2026-10-31T15:00:00Z'), log: () => undefined }, { ...base, rawBody: JSON.stringify({ action, ...b }) })
    assert.equal(r.status, 200, action + ' ' + JSON.stringify(r.body))
    return r.body as Record<string, string>
  }
  async function linkedContract() {
    const clientId = (await fin('client_create', { name: 'Cliente Fictício ' + randomUUID().slice(0, 6) })).id
    const sourceId = (await fin('source_create', { direction: 'in', clientId, category: 'hosting', description: 'Hospedagem fictícia', amount: '69,90',
      periodicity: 'monthly', startDate: '2026-10-01', dueDay: 30 })).id
    const subId = rid('sub')
    await linkSubscription(pool, { environment: 'sandbox', sourceId, subscription: subscriptionFixture(subId) }, A)
    const entries = (await pool.query("SELECT id, to_char(competence_month, 'YYYY-MM') m FROM crm.finance_entries WHERE source_id = $1", [sourceId])).rows
    return { clientId, sourceId, subId, entry: (m: string) => entries.find(e => e.m === m)!.id as string }
  }
  const cfg = { environment: 'sandbox' as const, enabled: true, expectedToken: FAKE_WEBHOOK_TOKEN }
  const send = (ev: unknown, deps: Partial<Parameters<typeof handleAsaasWebhook>[1]> = {}, config = cfg) =>
    handleAsaasWebhook(config, { pool, actor: A, log: e => logs.push(e), reconcile: TODAY, ...deps },
      { method: 'POST', token: FAKE_WEBHOOK_TOKEN, contentType: 'application/json', rawBody: JSON.stringify(ev) })
  const settlements = async (entryId: string) => (await pool.query(
    'SELECT amount_cents::int a, settled_on::text d, reversed_at IS NOT NULL r FROM crm.finance_settlements WHERE entry_id = $1 ORDER BY created_at', [entryId])).rows
  const paymentRow = async (id: string) => (await pool.query('SELECT * FROM crm.finance_asaas_payments WHERE environment = $1 AND asaas_payment_id = $2', ['sandbox', id])).rows[0]
  const eventRow = async (id: string) => (await pool.query('SELECT * FROM crm.finance_asaas_events WHERE event_id = $1', [id])).rows[0]
  /** Asaas simulado: devolve a fotografia ATUAL de cada cobrança; pode falhar sob comando. */
  function fakeAsaas() {
    const state = new Map<string, Record<string, unknown>>()
    let failing = false
    const transport: AsaasTransport = async u => {
      if (failing) return { status: 503, text: async () => '{"errors":[{"code":"service_unavailable"}]}' }
      const id = new URL(u).pathname.split('/').pop()!
      const p = state.get(id)
      return p ? { status: 200, text: async () => JSON.stringify(p) } : { status: 404, text: async () => '{}' }
    }
    const gateway = createAsaasSandboxGateway({ environment: 'sandbox', enabled: true, apiKey: FAKE_SANDBOX_KEY, transport })
    return { gateway, state, setFailing: (v: boolean) => { failing = v } }
  }

  // ───────────── isolamento Sandbox × Production ─────────────

  it('banco local marcado e ligado a sandbox; ligação imutável', async () => {
    assert.deepEqual((await pool.query('SELECT environment FROM crm.finance_asaas_binding')).rows, [{ environment: 'sandbox' }])
    await bindAsaasEnvironment(pool, 'sandbox', A) // idempotente
    await assert.rejects(bindAsaasEnvironment(pool, 'production', A), code('ENVIRONMENT_ALREADY_BOUND'))
    await assert.rejects(pool.query(`INSERT INTO crm.finance_asaas_binding (singleton, environment, bound_by) VALUES (false, 'production', 'x')`), code('23514'))
    await assert.rejects(pool.query(`INSERT INTO crm.finance_asaas_binding (environment, bound_by) VALUES ('production', 'x')`), code('23505'))
    assert.equal((await pool.query('SELECT count(*)::int n FROM crm.finance_asaas_binding')).rows[0].n, 1)
  })

  it('vinculação indevida a Production: recusada pelo código, pelo banco e pelos adaptadores; contrato intacto', async () => {
    const clientId = (await fin('client_create', { name: 'Cliente Fictício Prod' })).id
    const sourceId = (await fin('source_create', { direction: 'in', clientId, category: 'hosting', description: 'Hospedagem', amount: '69,90',
      periodicity: 'monthly', startDate: '2026-10-01', dueDay: 30 })).id
    await assert.rejects(linkSubscription(pool, { environment: 'production', sourceId, subscription: subscriptionFixture(rid('sub')) }, A), code('ENVIRONMENT_MISMATCH'))
    await assert.rejects(linkCustomer(pool, { environment: 'production', clientId, asaasCustomerId: rid('cus') }, A), code('ENVIRONMENT_MISMATCH'))
    await assert.rejects(ingestPayment(pool, 'production', normalizePayment(paymentFixture(rid('pay'), null)), null, A), code('ENVIRONMENT_MISMATCH'))
    await assert.rejects(recordWebhookEvent(pool, parseWebhookEvent('production', webhookEvent(rid('evt'), 'PAYMENT_CREATED', null))), code('ENVIRONMENT_MISMATCH'))
    for (const sql of [
      `INSERT INTO crm.finance_asaas_customers (environment, client_id, asaas_customer_id, created_by) VALUES ('production', '${clientId}', 'cus_x1', 'x')`,
      `INSERT INTO crm.finance_asaas_events (environment, event_id, event_type) VALUES ('production', 'evt_x1', 'PAYMENT_CREATED')`,
      `INSERT INTO crm.finance_integration_log (environment, entity, entity_ref, action, actor) VALUES ('production', 'event', 'x', 'x', 'x')`,
    ]) await assert.rejects(pool.query(sql), code('23503'))
    // receptor configurado como production sobre banco Sandbox: 503, nada gravado
    const evId = rid('evt')
    const r = await send(webhookEvent(evId, 'PAYMENT_CREATED', paymentFixture(rid('pay'), null)), {}, { ...cfg, environment: 'production' as never })
    assert.deepEqual(r, { status: 503, body: { error: 'RECEIVER_ENVIRONMENT_UNAVAILABLE' } })
    assert.equal(await eventRow(evId), undefined)
    // adaptadores: production não existe nesta fase; reprocessamento com leitor de outro ambiente é recusado
    assert.throws(() => createAsaasSandboxGateway({ environment: 'production' }), (e: AsaasHttpError) => e.code === 'PRODUCTION_NOT_ALLOWED_IN_THIS_PHASE')
    await assert.rejects(reprocessPendingEvents(pool, 'production', A, { gateway: fakeAsaas().gateway }), code('ENVIRONMENT_MISMATCH'))
    assert.equal((await pool.query('SELECT billing_provider FROM crm.finance_sources WHERE id = $1', [sourceId])).rows[0].billing_provider, 'manual')
    assert.equal((await pool.query(`SELECT count(*)::int n FROM crm.finance_asaas_payments WHERE environment <> 'sandbox'`)).rows[0].n, 0)
  })

  // ───────────── receptor de webhook (ponta a ponta, sem rede) ─────────────

  it('criação → repetição → recebimento → evento antigo fora de ordem → estorno total', async () => {
    const k = await linkedContract()
    const pay = rid('pay')
    const created = webhookEvent(rid('evt'), 'PAYMENT_CREATED', paymentFixture(pay, k.subId), '2026-11-01 09:00:00')
    assert.deepEqual(await send(created), { status: 200, body: { received: true, status: 'processed' } })
    assert.equal((await paymentRow(pay)).link_status, 'linked')
    assert.equal((await paymentRow(pay)).entry_id, k.entry('2026-11'))
    // repetição do MESMO evento: 200, não reprocessa
    assert.deepEqual(await send(created), { status: 200, body: { received: true, duplicate: true } })
    assert.equal((await pool.query('SELECT count(*)::int n FROM crm.finance_asaas_events WHERE event_id = $1', [created.id])).rows[0].n, 1)

    const received = paymentFixture(pay, k.subId, { status: 'RECEIVED', paymentDate: '2026-11-30', creditDate: '2026-11-30' })
    assert.equal((await send(webhookEvent(rid('evt'), 'PAYMENT_RECEIVED', received, '2026-11-30 10:00:00'))).body.status, 'processed')
    assert.deepEqual(await settlements(k.entry('2026-11')), [{ a: 6990, d: '2026-11-30', r: false }])
    // evento ANTIGO chega depois (fora de ordem): gravado e processado, mas não regride a cobrança nem a baixa
    assert.equal((await send(webhookEvent(rid('evt'), 'PAYMENT_UPDATED', paymentFixture(pay, k.subId), '2026-11-01 09:30:00'))).body.status, 'processed')
    assert.equal((await paymentRow(pay)).normalized_state, 'received')
    assert.equal((await settlements(k.entry('2026-11'))).length, 1)

    const refunded = { ...received, status: 'REFUNDED', refunds: [{ value: 69.9, status: 'DONE' }] }
    assert.equal((await send(webhookEvent(rid('evt'), 'PAYMENT_REFUNDED', refunded, '2026-12-05 10:00:00'))).body.status, 'processed')
    assert.deepEqual(await settlements(k.entry('2026-11')), [{ a: 6990, d: '2026-11-30', r: true }])
    assert.equal((await paymentRow(pay)).refunded_cents, '6990')
  })

  it('estorno parcial e chargeback: nunca mexem sozinhos na baixa — vão para revisão', async () => {
    const k = await linkedContract()
    const p1 = rid('pay')
    const r1 = paymentFixture(p1, k.subId, { status: 'RECEIVED', paymentDate: '2026-11-30', creditDate: '2026-11-30' })
    await send(webhookEvent(rid('evt'), 'PAYMENT_RECEIVED', r1, '2026-11-30 10:00:00'))
    await send(webhookEvent(rid('evt'), 'PAYMENT_PARTIALLY_REFUNDED', { ...r1, refunds: [{ value: 20, status: 'DONE' }] }, '2026-12-02 10:00:00'))
    assert.equal((await paymentRow(p1)).review_reason, 'PARTIAL_REFUND')
    assert.deepEqual(await settlements(k.entry('2026-11')), [{ a: 6990, d: '2026-11-30', r: false }])

    const p2 = rid('pay')
    const r2 = paymentFixture(p2, k.subId, { dueDate: '2026-12-30', originalDueDate: '2026-12-30', status: 'RECEIVED', billingType: 'CREDIT_CARD',
      paymentDate: '2026-12-30', creditDate: '2026-12-30' })
    await send(webhookEvent(rid('evt'), 'PAYMENT_RECEIVED', r2, '2026-12-30 10:00:00'))
    await send(webhookEvent(rid('evt'), 'PAYMENT_CHARGEBACK_REQUESTED', { ...r2, status: 'CHARGEBACK_REQUESTED' }, '2026-12-30 18:00:00'))
    assert.equal((await paymentRow(p2)).review_reason, 'CHARGEBACK')
    assert.deepEqual(await settlements(k.entry('2026-12')), [{ a: 6990, d: '2026-12-30', r: false }])
  })

  it('falha na releitura do Asaas → evento "failed" (200 ao Asaas); reprocessamento conclui sem duplicar', async () => {
    const k = await linkedContract()
    const fake = fakeAsaas()
    const pay = rid('pay')
    fake.state.set(pay, paymentFixture(pay, k.subId, { dueDate: '2026-10-30', originalDueDate: '2026-10-30', status: 'RECEIVED', paymentDate: '2026-10-30', creditDate: '2026-10-30' }))
    fake.setFailing(true)
    // o corpo traz uma fotografia antiga (PENDING); com leitor, a fonte da verdade é a releitura no Asaas
    const ev = webhookEvent(rid('evt'), 'PAYMENT_RECEIVED', paymentFixture(pay, k.subId, { dueDate: '2026-10-30', originalDueDate: '2026-10-30' }), '2026-10-30 10:00:00')
    assert.deepEqual(await send(ev, { gateway: fake.gateway }), { status: 200, body: { received: true, status: 'failed' } })
    const failed = await eventRow(ev.id)
    assert.deepEqual([failed.status, failed.last_error, failed.attempts], ['failed', 'ASAAS_UPSTREAM_ERROR', 1])
    assert.equal((await settlements(k.entry('2026-10'))).length, 0)
    fake.setFailing(false)
    const s1 = await reprocessPendingEvents(pool, 'sandbox', A, { gateway: fake.gateway, reconcile: TODAY })
    assert.ok((s1.byStatus.processed ?? 0) >= 1)
    assert.equal((await eventRow(ev.id)).status, 'processed')
    assert.deepEqual(await settlements(k.entry('2026-10')), [{ a: 6990, d: '2026-10-30', r: false }])
    // reprocessar de novo: o evento concluído não volta; a baixa não duplica
    await reprocessPendingEvents(pool, 'sandbox', A, { gateway: fake.gateway, reconcile: TODAY })
    assert.equal((await eventRow(ev.id)).attempts, 2)
    assert.equal((await settlements(k.entry('2026-10'))).length, 1)
  })

  it('data do evento não confiável → "needs_resync" sem alterar nada; releitura no Asaas resolve', async () => {
    const k = await linkedContract()
    const fake = fakeAsaas()
    const pay = rid('pay')
    const raw = paymentFixture(pay, k.subId, { status: 'RECEIVED', paymentDate: '2026-11-30', creditDate: '2026-11-30' })
    fake.state.set(pay, raw)
    const ev = webhookEvent(rid('evt'), 'PAYMENT_RECEIVED', raw, '30/11/2026 10:00')
    assert.equal((await send(ev)).body.status, 'needs_resync')
    assert.equal(await paymentRow(pay), undefined)
    await reprocessPendingEvents(pool, 'sandbox', A, { gateway: fake.gateway, reconcile: TODAY })
    assert.equal((await eventRow(ev.id)).status, 'processed')
    assert.equal((await settlements(k.entry('2026-11'))).length, 1)
  })

  it('o mesmo evento entregue 6 vezes ao mesmo tempo: gravado uma vez, uma única baixa', async () => {
    const k = await linkedContract()
    const pay = rid('pay')
    const ev = webhookEvent(rid('evt'), 'PAYMENT_RECEIVED', paymentFixture(pay, k.subId, { status: 'RECEIVED', paymentDate: '2026-11-30', creditDate: '2026-11-30' }))
    const rs = await Promise.all(Array.from({ length: 6 }, () => send(ev)))
    assert.ok(rs.every(r => r.status === 200))
    assert.equal(rs.filter(r => r.body.duplicate !== true).length, 1)
    assert.equal((await settlements(k.entry('2026-11'))).length, 1)
  })

  it('nenhum dado pessoal é guardado (eventos, cobranças, trilha) nem registrado', async () => {
    const dump = JSON.stringify([
      (await pool.query('SELECT payload_min, last_error FROM crm.finance_asaas_events')).rows,
      (await pool.query('SELECT * FROM crm.finance_asaas_payments')).rows,
      (await pool.query('SELECT details FROM crm.finance_integration_log')).rows,
      logs,
    ])
    for (const v of Object.values(FAKE_PII)) assert.ok(!dump.includes(v), 'dado pessoal guardado: ' + v)
    assert.ok(!dump.includes('invoiceUrl') && !dump.includes('aact_'))
    assert.ok(logs.length > 5 && logs.every(l => Object.keys(l).every(k => ['event', 'outcome', 'eventType', 'eventId', 'status', 'code'].includes(k))))
  })
})
