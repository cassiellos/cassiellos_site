/**
 * F3 contra PostgreSQL DESCARTÁVEL (CRM_INTEGRATION_DATABASE_URL; nunca o Neon): o que `saveLeadSubmission` devolve em cada situação
 * e como isso vira `leadOutcome` / `generate_lead`. Sem a variável, ignorado.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { Pool } from 'pg'
import { saveLeadSubmission, type LeadSubmissionInput } from './lead-intake'
import { isNewLeadResponse, leadOutcomeOf } from '../tracking/lead-outcome'

const url = process.env.CRM_INTEGRATION_DATABASE_URL
const skip = !url ? 'CRM_INTEGRATION_DATABASE_URL não definida' : false

function input(overrides: Partial<LeadSubmissionInput> = {}): LeadSubmissionInput {
  return {
    idempotencyKey: randomUUID(), name: 'Lead Teste F3', email: `f3.${randomUUID()}@exemplo.com`, phone: '31900000031',
    formSlug: 'hamburguerias', formVersion: 'flow-v3', niche: 'Hamburguerias',
    answers: { clinic: 'Hamburgueria Fictícia' }, attribution: {}, newLeadIsTest: true, bookingMode: 'test',
    protection: { turnstile: 'verified', action: 'booking_lead', hostname: 'localhost', challengeTs: null },
    ...overrides,
  }
}
/** O que o navegador recebe do corpo da rota (mesma composição de app/api/public/forms/[slug]/route.ts). */
const body = (saved: Awaited<ReturnType<typeof saveLeadSubmission>>) => ({ ok: true, reused: saved.reused, leadOutcome: leadOutcomeOf(saved) })

describe('F3 — leadOutcome com o banco real', { skip }, () => {
  let pool: Pool
  before(() => { pool = new Pool({ connectionString: url, max: 5 }) })
  after(async () => { await pool?.end() })
  const count = async (email: string) => Number((await pool.query('SELECT count(*)::int AS n FROM crm.leads WHERE lower(email)=lower($1)', [email])).rows[0].n)

  it('lead novo (de teste) → "new": uma linha em crm.leads, generate_lead conta', async () => {
    const data = input()
    const saved = await saveLeadSubmission(pool, data)
    assert.equal(await count(data.email), 1)
    assert.equal(saved.isTest, true)
    assert.equal(leadOutcomeOf(saved), 'new')
    assert.equal(isNewLeadResponse(body(saved)), true)
  })

  it('lead novo real → "new" com isTest=false', async () => {
    const saved = await saveLeadSubmission(pool, input({ newLeadIsTest: false }))
    assert.equal(saved.isTest, false)
    assert.equal(leadOutcomeOf(saved), 'new')
  })

  it('mesmo e-mail em outra visita (nova chave) → "resubmitted": nenhum lead novo, generate_lead NÃO conta', async () => {
    const first = input()
    await saveLeadSubmission(pool, first)
    const again = await saveLeadSubmission(pool, { ...first, idempotencyKey: randomUUID(), name: 'Lead Teste F3 Revisitou' })
    assert.equal(await count(first.email), 1, 'continua um único lead no banco')
    assert.equal(again.reused, false)
    assert.equal(again.resubmitted, true)
    assert.equal(leadOutcomeOf(again), 'resubmitted')
    assert.equal(isNewLeadResponse(body(again)), false)
    assert.equal(again.leadEventId ?? null, null, 'nenhum evento interno Lead novo (Meta intacta)')
  })

  it('mesma chave de idempotência → "reused": repetição do mesmo envio, nada novo', async () => {
    const data = input()
    const first = await saveLeadSubmission(pool, data)
    const repeat = await saveLeadSubmission(pool, data)
    assert.equal(repeat.reused, true)
    assert.equal(leadOutcomeOf(repeat), 'reused')
    assert.equal(isNewLeadResponse(body(repeat)), false)
    assert.equal(repeat.leadId, first.leadId)
    assert.equal(await count(data.email), 1)
  })

  it('e-mail em caixa diferente conta como o mesmo lead (recadastro, não lead novo)', async () => {
    const data = input({ email: `F3.Caixa.${randomUUID()}@Exemplo.com` })
    await saveLeadSubmission(pool, data)
    const again = await saveLeadSubmission(pool, { ...data, idempotencyKey: randomUUID(), email: data.email.toLowerCase() })
    assert.equal(leadOutcomeOf(again), 'resubmitted')
    assert.equal(await count(data.email), 1)
  })
})
