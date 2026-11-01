/**
 * Fase 1.2 — P2-3: isolamento entre Sandbox e Production. Requer um PostgreSQL DESCARTÁVEL NOVO (migrações
 * 0001–0016, SEM ligação de ambiente) em CRM_ASAAS_ISOLATION_DATABASE_URL — fica fora da suíte padrão porque liga
 * o banco a 'production' (simula o CRM real). Dados sintéticos; sem rede.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { Pool } from 'pg'
import { handleFinanceAdmin, type FinanceAdminRequest } from '../finance/admin-request'
import { parseWebhookEvent } from './policy'
import { AsaasLinkError, bindAsaasEnvironment, ingestPayment, linkCustomer, linkSubscription, recordWebhookEvent } from './store'
import { normalizePayment } from './types'

const url = process.env.CRM_ASAAS_ISOLATION_DATABASE_URL
const skip = !url ? 'CRM_ASAAS_ISOLATION_DATABASE_URL não definida (banco descartável novo, sem ligação de ambiente)' : false
const A = 'sessao-teste'
const rid = (p: string) => p + '_' + randomUUID().replaceAll('-', '').slice(0, 16)
const code = (c: string) => (e: AsaasLinkError) => e.code === c

describe('P2-3 — isolamento físico de ambientes (banco do CRM real = production)', { skip }, () => {
  let pool: Pool
  before(() => { pool = new Pool({ connectionString: url, max: 8 }) })
  after(async () => { await pool?.end() })
  const base: FinanceAdminRequest = { method: 'POST', vercelEnv: 'preview', sessionValid: true, originAllowed: true, contentType: 'application/json', actorRef: A }
  const fin = async (action: string, b: Record<string, unknown>) => (await handleFinanceAdmin({ pool, now: () => new Date('2026-10-31T15:00:00Z'), log: () => undefined },
    { ...base, rawBody: JSON.stringify({ action, ...b }) })).body as Record<string, string>
  async function realContract() {
    const clientId = (await fin('client_create', { name: 'Cliente Real Fictício ' + randomUUID().slice(0, 5) })).id
    const sourceId = (await fin('source_create', { direction: 'in', clientId, category: 'hosting', description: 'Hospedagem', amount: '69,90', periodicity: 'monthly', startDate: '2026-10-01', dueDay: 30 })).id
    return { clientId, sourceId }
  }
  const sub = (id: string) => ({ id, value: 69.9, cycle: 'MONTHLY', nextDueDate: '2026-11-30' })
  const provider = async (id: string) => (await pool.query('SELECT billing_provider FROM crm.finance_sources WHERE id = $1', [id])).rows[0].billing_provider

  it('banco sem ligação de ambiente: NENHUMA gravação da integração é aceita (negação por padrão)', async () => {
    const k = await realContract()
    assert.equal((await pool.query('SELECT count(*)::int n FROM crm.finance_asaas_binding')).rows[0].n, 0, 'teste exige banco novo, sem ligação')
    await assert.rejects(linkSubscription(pool, { environment: 'production', sourceId: k.sourceId, subscription: sub(rid('sub')) }, A), code('ASAAS_ENVIRONMENT_NOT_BOUND'))
    await assert.rejects(linkCustomer(pool, { environment: 'sandbox', clientId: k.clientId, asaasCustomerId: rid('cus') }, A), code('ASAAS_ENVIRONMENT_NOT_BOUND'))
    assert.equal(await provider(k.sourceId), 'manual')
  })

  it('ligado a production: contrato real NUNCA recebe vínculo Sandbox (código e banco recusam); contrato intacto', async () => {
    await bindAsaasEnvironment(pool, 'production', A)
    await bindAsaasEnvironment(pool, 'production', A) // idempotente
    await assert.rejects(bindAsaasEnvironment(pool, 'sandbox', A), code('ENVIRONMENT_ALREADY_BOUND'))
    const k = await realContract()
    await assert.rejects(linkSubscription(pool, { environment: 'sandbox', sourceId: k.sourceId, subscription: sub(rid('sub')) }, A), code('ENVIRONMENT_MISMATCH'))
    await assert.rejects(linkCustomer(pool, { environment: 'sandbox', clientId: k.clientId, asaasCustomerId: rid('cus') }, A), code('ENVIRONMENT_MISMATCH'))
    await assert.rejects(ingestPayment(pool, 'sandbox', normalizePayment({ id: rid('pay'), value: 69.9, status: 'PENDING', dueDate: '2026-11-30' }), null, A), code('ENVIRONMENT_MISMATCH'))
    await assert.rejects(recordWebhookEvent(pool, parseWebhookEvent('sandbox', { id: rid('evt'), event: 'PAYMENT_CREATED', dateCreated: '2026-10-30 10:00:00' })), code('ENVIRONMENT_MISMATCH'))
    // mesmo contornando o código, o banco recusa (chave estrangeira para o ambiente ligado)
    await assert.rejects(pool.query(`INSERT INTO crm.finance_asaas_subscriptions (environment, source_id, asaas_subscription_id, value_cents, cycle, created_by)
      VALUES ('sandbox', $1, $2, 6990, 'MONTHLY', 'x')`, [k.sourceId, rid('sub')]), (e: { code?: string }) => e.code === '23503')
    assert.equal(await provider(k.sourceId), 'manual', 'tentativas inválidas não alteram o contrato real')
    assert.equal((await pool.query('SELECT count(*)::int n FROM crm.finance_asaas_subscriptions WHERE source_id = $1', [k.sourceId])).rows[0].n, 0)
  })

  it('identificadores semelhantes em ambientes diferentes não se misturam; um contrato = uma assinatura ativa', async () => {
    const k = await realContract()
    const same = rid('sub')
    await assert.rejects(linkSubscription(pool, { environment: 'sandbox', sourceId: k.sourceId, subscription: sub(same) }, A), code('ENVIRONMENT_MISMATCH'))
    await linkSubscription(pool, { environment: 'production', sourceId: k.sourceId, subscription: sub(same) }, A)
    assert.equal(await provider(k.sourceId), 'asaas_subscription')
    await assert.rejects(linkSubscription(pool, { environment: 'production', sourceId: k.sourceId, subscription: sub(rid('sub')) }, A), code('SUBSCRIPTION_OR_SOURCE_ALREADY_LINKED'))
    const other = await realContract()
    await assert.rejects(linkSubscription(pool, { environment: 'production', sourceId: other.sourceId, subscription: sub(same) }, A), code('SUBSCRIPTION_OR_SOURCE_ALREADY_LINKED'))
    assert.equal(await provider(other.sourceId), 'manual')
  })

  it('tentativas simultâneas de vínculo: exatamente uma vence (contrato e assinatura)', async () => {
    const k = await realContract()
    const r1 = await Promise.allSettled([rid('sub'), rid('sub'), rid('sub')].map(s => linkSubscription(pool, { environment: 'production', sourceId: k.sourceId, subscription: sub(s) }, A)))
    assert.equal(r1.filter(r => r.status === 'fulfilled').length, 1)
    const s = rid('sub')
    const contracts = await Promise.all([realContract(), realContract(), realContract()])
    const r2 = await Promise.allSettled(contracts.map(c => linkSubscription(pool, { environment: 'production', sourceId: c.sourceId, subscription: sub(s) }, A)))
    assert.equal(r2.filter(r => r.status === 'fulfilled').length, 1)
    const providers = await Promise.all(contracts.map(c => provider(c.sourceId)))
    assert.deepEqual(providers.sort(), ['asaas_subscription', 'manual', 'manual'], 'perdedores intactos')
  })
})
