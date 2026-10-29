/**
 * Teste de integração do envio do formulário contra um PostgreSQL DESCARTÁVEL.
 * Só roda quando CRM_INTEGRATION_DATABASE_URL aponta para um banco com as migrações
 * 0001–0007 aplicadas (ex.: instância local criada só para o teste). Nunca usar o Neon.
 * Sem a variável, os testes são ignorados (npm test continua independente de banco).
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { Pool } from 'pg'
import { saveLeadSubmission, type LeadSubmissionInput } from './lead-intake'

const url = process.env.CRM_INTEGRATION_DATABASE_URL
const skip = !url ? 'CRM_INTEGRATION_DATABASE_URL não definida' : false

// Apenas endereços fictícios/de domínio reservado ou da própria agência.
function input(overrides: Partial<LeadSubmissionInput> = {}): LeadSubmissionInput {
  return {
    idempotencyKey: randomUUID(),
    name: 'Lead Inicial',
    email: 'lead.integracao@exemplo.com',
    phone: '31900000010',
    formSlug: 'odontologia',
    formVersion: 'odontologia-v2',
    niche: 'Clínicas odontológicas',
    answers: { clinic: 'Clínica Inicial', revenue: 'De R$ 30 mil a R$ 50 mil/mês', priority: 'Quero entender as possibilidades' },
    attribution: { utm_source: 'teste', utm_campaign: 'integracao' },
    newLeadIsTest: true,
    bookingMode: 'test',
    ...overrides,
  }
}

describe('saveLeadSubmission (PostgreSQL descartável)', { skip }, () => {
  let pool: Pool
  before(() => { pool = new Pool({ connectionString: url, max: 10 }) })
  after(async () => { await pool?.end() })

  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) =>
    (await pool.query<T>(sql, params)).rows

  it('cria lead novo com histórico, consentimento e atividade form_completed', async () => {
    const r = await saveLeadSubmission(pool, input({ email: 'novo.lead@exemplo.com', newLeadIsTest: false, bookingMode: 'live' }))
    assert.equal(r.reused, false)
    assert.equal(r.resubmitted, false)
    const [lead] = await q('SELECT full_name, email, whatsapp, company, segment, stage, is_test FROM crm.leads WHERE id=$1', [r.leadId])
    assert.deepEqual(lead, { full_name: 'Lead Inicial', email: 'novo.lead@exemplo.com', whatsapp: '31900000010',
      company: 'Clínica Inicial', segment: 'Clínicas odontológicas', stage: 'new', is_test: false })
    const [sub] = await q<{ form_version: string; answers: Record<string, any> }>(
      'SELECT form_version, answers FROM crm.form_submissions WHERE id=$1', [r.submissionId])
    assert.equal(sub.form_version, 'odontologia-v2')
    assert.deepEqual(sub.answers.contact, { name: 'Lead Inicial', email: 'novo.lead@exemplo.com', whatsapp: '31900000010' })
    assert.equal(sub.answers.questions.revenue, 'De R$ 30 mil a R$ 50 mil/mês')
    assert.equal(sub.answers.attribution.utm_campaign, 'integracao')
    assert.equal(sub.answers.formSlug, 'odontologia')
    const acts = await q<{ activity_kind: string }>('SELECT activity_kind FROM crm.lead_activities WHERE lead_id=$1', [r.leadId])
    assert.deepEqual(acts.map(a => a.activity_kind), ['form_completed'])
    const consents = await q('SELECT 1 FROM crm.consents WHERE lead_id=$1', [r.leadId])
    assert.equal(consents.length, 1)
  })

  it('reenvio preserva cadastro, classificação, etapa, reuniões, contratos e consentimentos', async () => {
    const email = 'preservar.lead@exemplo.com'
    const first = await saveLeadSubmission(pool, input({ email, newLeadIsTest: false }))
    // Simula histórico comercial já existente.
    await pool.query("UPDATE crm.leads SET stage='qualified', notes='nota comercial' WHERE id=$1", [first.leadId])
    const [appt] = await q<{ id: string }>(`INSERT INTO crm.appointments
      (lead_id, calendar_id, starts_at, ends_at, status, confirmed_at, completed_at, is_test)
      VALUES ($1,'primary','2026-11-02T12:00:00Z','2026-11-02T12:30:00Z','completed',now(),now(),false) RETURNING id`, [first.leadId])
    await pool.query(`INSERT INTO crm.deals (lead_id, appointment_id, status, amount, closed_at, is_test)
      VALUES ($1,$2,'won',1000,now(),false)`, [first.leadId, appt.id])
    const snapshot = await q('SELECT full_name, whatsapp, company, segment, stage, notes, is_test FROM crm.leads WHERE id=$1', [first.leadId])

    const again = await saveLeadSubmission(pool, input({
      email: '  PRESERVAR.Lead@Exemplo.com ', name: 'Nome Diferente', phone: '31900009999',
      answers: { clinic: 'Clínica Diferente', revenue: 'Acima de R$ 300 mil/mês', priority: 'Atrair mais pacientes' },
      newLeadIsTest: true, // must be ignored for an existing lead
    }))
    assert.equal(again.leadId, first.leadId)
    assert.equal(again.resubmitted, true)
    assert.deepEqual(await q('SELECT full_name, whatsapp, company, segment, stage, notes, is_test FROM crm.leads WHERE id=$1', [first.leadId]), snapshot)
    assert.equal((await q('SELECT 1 FROM crm.leads WHERE lower(email)=$1', [email])).length, 1)
    assert.equal((await q("SELECT 1 FROM crm.appointments WHERE lead_id=$1 AND status='completed'", [first.leadId])).length, 1)
    assert.equal((await q("SELECT 1 FROM crm.deals WHERE lead_id=$1 AND status='won'", [first.leadId])).length, 1)
    assert.equal((await q('SELECT 1 FROM crm.consents WHERE lead_id=$1', [first.leadId])).length, 2)
    const subs = await q<{ answers: Record<string, any> }>(
      'SELECT answers FROM crm.form_submissions WHERE lead_id=$1 ORDER BY submitted_at, id', [first.leadId])
    assert.equal(subs.length, 2)
    assert.deepEqual(subs.map(s => s.answers.contact.name).sort(), ['Lead Inicial', 'Nome Diferente'])
    const [act] = await q<{ details: Record<string, any> }>(
      "SELECT details FROM crm.lead_activities WHERE lead_id=$1 AND activity_kind='form_resubmitted'", [first.leadId])
    assert.deepEqual(act.details.differingFields, ['full_name', 'whatsapp', 'company'])
    assert.deepEqual(act.details.filledFields, [])
    assert.equal(act.details.isTest, false)
    assert.ok(!JSON.stringify(act.details).includes('Nome Diferente'), 'atividade não guarda valores pessoais')
  })

  it('preenche apenas campos vazios', async () => {
    const email = 'preencher.vazios@exemplo.com'
    const first = await saveLeadSubmission(pool, input({ email }))
    await pool.query('UPDATE crm.leads SET whatsapp=NULL, company=NULL WHERE id=$1', [first.leadId])
    const again = await saveLeadSubmission(pool, input({ email, name: 'Outro Nome', phone: '31900002222',
      answers: { clinic: 'Clínica Preenchida', revenue: 'Ainda não faturo', priority: 'Atrair mais pacientes' } }))
    const [lead] = await q('SELECT full_name, whatsapp, company FROM crm.leads WHERE id=$1', [again.leadId])
    assert.deepEqual(lead, { full_name: 'Lead Inicial', whatsapp: '31900002222', company: 'Clínica Preenchida' })
    const [act] = await q<{ details: Record<string, any> }>(
      "SELECT details FROM crm.lead_activities WHERE lead_id=$1 AND activity_kind='form_resubmitted'", [again.leadId])
    assert.deepEqual(act.details.filledFields, ['whatsapp', 'company'])
    assert.deepEqual(act.details.differingFields, ['full_name'])
  })

  it('mesma chave de envio é idempotente (sem novo histórico)', async () => {
    const payload = input({ email: 'idempotente@exemplo.com' })
    const a = await saveLeadSubmission(pool, payload)
    const b = await saveLeadSubmission(pool, payload)
    assert.equal(b.reused, true)
    assert.equal(b.submissionId, a.submissionId)
    assert.equal((await q('SELECT 1 FROM crm.form_submissions WHERE lead_id=$1', [a.leadId])).length, 1)
  })

  it('envios simultâneos do mesmo e-mail geram 1 lead e histórico completo', async () => {
    const email = 'simultaneo@exemplo.com'
    const results = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      saveLeadSubmission(pool, input({ email: i % 2 ? email.toUpperCase() : email, name: 'Pessoa ' + i }))))
    assert.equal(new Set(results.map(r => r.leadId)).size, 1)
    const leadId = results[0].leadId
    assert.equal((await q('SELECT 1 FROM crm.leads WHERE lower(email)=$1', [email])).length, 1)
    assert.equal((await q('SELECT 1 FROM crm.form_submissions WHERE lead_id=$1', [leadId])).length, 6)
    const kinds = await q<{ activity_kind: string; n: string }>(
      'SELECT activity_kind, count(*)::text AS n FROM crm.lead_activities WHERE lead_id=$1 GROUP BY 1 ORDER BY 1', [leadId])
    assert.deepEqual(kinds, [{ activity_kind: 'form_completed', n: '1' }, { activity_kind: 'form_resubmitted', n: '5' }])
  })

  it('compatível com registros antigos (odontologia-v1 sem snapshot de contato)', async () => {
    const [legacy] = await q<{ id: string }>(`INSERT INTO crm.leads (full_name, email, whatsapp, company, segment, stage, is_test)
      VALUES ('Lead Antigo','lead.antigo@exemplo.com','31900003333','Clínica Antiga','Clínicas odontológicas','contacted',true) RETURNING id`)
    await pool.query(`INSERT INTO crm.form_submissions (lead_id, form_version, answers, idempotency_key, status)
      VALUES ($1,'odontologia-v1',$2::jsonb,$3,'validated')`,
    [legacy.id, JSON.stringify({ niche: 'Clínicas odontológicas', formSlug: 'odontologia',
      questions: { clinic: 'Clínica Antiga', revenue: '45k', priority: 'Atrair mais pacientes' }, attribution: {} }), randomUUID()])
    const r = await saveLeadSubmission(pool, input({ email: 'lead.antigo@exemplo.com', name: 'Lead Antigo' }))
    assert.equal(r.leadId, legacy.id)
    const revenues = await q<{ v: string; rev: string }>(
      "SELECT form_version AS v, answers #>> '{questions,revenue}' AS rev FROM crm.form_submissions WHERE lead_id=$1 ORDER BY submitted_at, id", [legacy.id])
    assert.deepEqual(revenues, [{ v: 'odontologia-v1', rev: '45k' }, { v: 'odontologia-v2', rev: 'De R$ 30 mil a R$ 50 mil/mês' }])
    const [lead] = await q('SELECT stage, is_test FROM crm.leads WHERE id=$1', [legacy.id])
    assert.deepEqual(lead, { stage: 'contacted', is_test: true })
  })
})
