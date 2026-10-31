/**
 * Formulário público /agendar: qualquer e-mail VÁLIDO conclui cadastro e agendamento (correção da allowlist de
 * homologação que vazava para o fluxo público). Parte unitária sempre roda; a parte de banco usa PostgreSQL
 * DESCARTÁVEL (CRM_INTEGRATION_DATABASE_URL) com o Google simulado — nenhum e-mail, convite ou evento real.
 * Endereços fictícios (caixas inventadas) em provedores e domínios variados.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { Pool } from 'pg'
import { bookingAccessConfig } from './booking-access'
import { confirmBookingRequest, type BookingSession, type ConfirmDeps } from './booking-confirmation'
import type { BookingEventInput } from './booking-event'
import { getBookingForm } from './booking-forms'
import { validatedEmail } from './booking-intake-request'
import { DEFAULT_AVAILABILITY_RULES, listAvailableSlots, type AvailabilityRules } from './availability/engine'
import { saveLeadSubmission } from './lead-intake'
import { TURNSTILE_BOOKING_ACTION } from './turnstile'

const VALID = [
  'maria.silva@gmail.com', 'joao_99@outlook.com', 'ana.souza@hotmail.com', 'clinica@yahoo.com.br', 'pedro@icloud.com',
  'contato@clinicasorriso.com.br', 'dra.ana@odonto.saude.com.br', 'maria+agenda@gmail.com', 'recepcao@clinica-exemplar.dental',
]
const HOMOLOGATION = 'homologacao.cassiellos@gmail.com'

describe('acesso público ao agendamento (configuração)', () => {
  const preview = { VERCEL_ENV: 'preview', CRM_GOOGLE_BOOKINGS_ENABLED: 'true' }
  it('allowlist de homologação presente NÃO restringe o público (padrão)', () => {
    assert.deepEqual(bookingAccessConfig({ ...preview, CRM_BOOKING_ALLOWED_EMAIL: HOMOLOGATION }),
      { enabled: true, restrictedToAllowedEmail: false, allowedEmail: HOMOLOGATION })
  })
  it('não exige mais o e-mail de homologação para habilitar a confirmação', () => {
    assert.equal(bookingAccessConfig(preview).enabled, true)
  })
  it('restrição só com CRM_BOOKING_RESTRICT_TO_ALLOWED_EMAIL=true; sem e-mail configurado = desligado (falha fechada)', () => {
    assert.deepEqual(bookingAccessConfig({ ...preview, CRM_BOOKING_ALLOWED_EMAIL: HOMOLOGATION, CRM_BOOKING_RESTRICT_TO_ALLOWED_EMAIL: 'true' }),
      { enabled: true, restrictedToAllowedEmail: true, allowedEmail: HOMOLOGATION })
    assert.equal(bookingAccessConfig({ ...preview, CRM_BOOKING_RESTRICT_TO_ALLOWED_EMAIL: 'true' }).enabled, false)
  })
  it('continua desligado fora do Preview ou sem o interruptor', () => {
    assert.equal(bookingAccessConfig({ VERCEL_ENV: 'production', CRM_GOOGLE_BOOKINGS_ENABLED: 'true' }).enabled, false)
    assert.equal(bookingAccessConfig({ VERCEL_ENV: 'preview' }).enabled, false)
    assert.equal(bookingAccessConfig({ VERCEL_ENV: 'preview', CRM_GOOGLE_BOOKINGS_ENABLED: 'TRUE' }).enabled, false)
  })
  it('cadastro: e-mails válidos de qualquer provedor/domínio aceitos; inválidos recusados', () => {
    for (const e of VALID) assert.equal(validatedEmail(e), e, e)
    assert.equal(validatedEmail('  Maria.Silva@GMAIL.com '), 'maria.silva@gmail.com')
    for (const e of ['maria@', 'maria.gmail.com', 'maria @gmail.com', 'maria@gmail', 'maria@@gmail.com', '', 'a@b.c']) assert.equal(validatedEmail(e), null, e)
  })
})

const url = process.env.CRM_INTEGRATION_DATABASE_URL
const skip = !url ? 'CRM_INTEGRATION_DATABASE_URL não definida' : false
const DAY = 86_400_000
const ORIGIN = 'https://crm.cassiellos.com.br'
const TEST_RULES: AvailabilityRules = { ...DEFAULT_AVAILABILITY_RULES, settings: { ...DEFAULT_AVAILABILITY_RULES.settings, windowDays: 30 } }
function slot(offset: number) {
  for (let d = 2 + offset; d < 30; d++) {
    const s = listAvailableSlots(new Date(Date.now() + d * DAY).toISOString().slice(0, 10), [], TEST_RULES)[0]
    if (s) return s
  }
  throw new Error('sem horário')
}

describe('fluxo público completo com e-mails de provedores distintos (PostgreSQL descartável)', { skip }, () => {
  let pool: Pool
  before(() => { pool = new Pool({ connectionString: url, max: 6 }) })
  after(async () => { await pool?.end() })
  const unique = (email: string) => email.replace('@', '.' + randomUUID().slice(0, 6) + '@')
  async function lead(email: string, turnstile: 'verified' | 'unverified' = 'verified') {
    const r = await saveLeadSubmission(pool, {
      idempotencyKey: randomUUID(), name: 'Visitante Fictício', email, phone: '3199' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0'),
      formSlug: 'odontologia', formVersion: 'odontologia-v2', niche: 'Clínicas odontológicas',
      answers: { clinic: 'Clínica Fictícia', revenue: 'Até R$ 10 mil/mês', priority: 'Atrair mais pacientes' }, attribution: {},
      newLeadIsTest: true, bookingMode: 'test',
      protection: { turnstile, action: TURNSTILE_BOOKING_ACTION, hostname: 'crm.cassiellos.com.br', challengeTs: null } as never,
    })
    return { ...r, email }
  }
  const google = () => {
    const created: BookingEventInput[] = []
    return { created, readBusy: async () => [], createEvent: async (i: BookingEventInput) => { created.push(i); return { id: i.googleEventId, meetingUrl: 'https://meet.google.com/tst-abcd-efg', htmlLink: 'https://www.google.com/calendar/event?eid=x' } } }
  }
  // Exatamente o que a rota pública monta (app/api/booking/confirm/route.ts) com a allowlist de homologação PRESENTE.
  const access = bookingAccessConfig({ VERCEL_ENV: 'preview', CRM_GOOGLE_BOOKINGS_ENABLED: 'true', CRM_BOOKING_ALLOWED_EMAIL: HOMOLOGATION })
  const deps = (g: ReturnType<typeof google>, extra: Partial<ConfirmDeps> = {}): ConfirmDeps => ({
    pool, verifySession: t => (t && typeof t === 'object' ? t as BookingSession : null), getForm: getBookingForm,
    readBusy: g.readBusy, createEvent: g.createEvent, calendarId: 'cal-' + randomUUID(), loadRules: async () => TEST_RULES,
    allowedEmail: access.allowedEmail, restrictToAllowedEmail: access.restrictedToAllowedEmail, ...extra,
  })
  const session = (l: { leadId: string; submissionId: string }): BookingSession => ({ leadId: l.leadId, submissionId: l.submissionId, formSlug: 'odontologia' })

  it('visitantes fora de qualquer allowlist concluem cadastro + agendamento e viram lead no CRM', async () => {
    let i = 0
    for (const base of VALID) {
      const email = unique(base)
      const l = await lead(email)
      const g = google()
      const r = await confirmBookingRequest(deps(g), { bookingToken: session(l), startAt: slot(i++ % 20).startAt, pageOrigin: ORIGIN })
      assert.equal(r.status, 201, email + ' ' + JSON.stringify(r.body))
      assert.equal(g.created.length, 1)
      const [row] = (await pool.query(`SELECT l.email, a.status FROM crm.leads l JOIN crm.appointments a ON a.lead_id = l.id WHERE l.id = $1`, [l.leadId])).rows
      assert.deepEqual(row, { email, status: 'confirmed' }, email)
    }
  })

  it('proteções preservadas: envio não verificado, reunião ativa (mesma caixa) e modo de homologação explícito', async () => {
    const g = google()
    const unverified = await lead(unique('naoverificado@gmail.com'), 'unverified')
    assert.deepEqual(await confirmBookingRequest(deps(g), { bookingToken: session(unverified), startAt: slot(3).startAt, pageOrigin: ORIGIN }),
      { status: 401, body: { error: 'BOOKING_SESSION_EXPIRED' } })
    const mail = unique('repetida@gmail.com')
    const first = await lead(mail)
    assert.equal((await confirmBookingRequest(deps(g), { bookingToken: session(first), startAt: slot(4).startAt, pageOrigin: ORIGIN })).status, 201)
    const second = await lead(mail)
    assert.deepEqual(await confirmBookingRequest(deps(g), { bookingToken: session(second), startAt: slot(5).startAt, pageOrigin: ORIGIN }),
      { status: 409, body: { error: 'CONTACT_HAS_ACTIVE_MEETING' } })
    // Homologação isolada (CRM_BOOKING_RESTRICT_TO_ALLOWED_EMAIL=true): só o e-mail autorizado agenda.
    const restricted = bookingAccessConfig({ VERCEL_ENV: 'preview', CRM_GOOGLE_BOOKINGS_ENABLED: 'true', CRM_BOOKING_ALLOWED_EMAIL: HOMOLOGATION, CRM_BOOKING_RESTRICT_TO_ALLOWED_EMAIL: 'true' })
    const other = await lead(unique('outra.pessoa@outlook.com'))
    const before = g.created.length
    assert.deepEqual(await confirmBookingRequest(deps(g, { restrictToAllowedEmail: restricted.restrictedToAllowedEmail }),
      { bookingToken: session(other), startAt: slot(6).startAt, pageOrigin: ORIGIN }), { status: 403, body: { error: 'TEST_EMAIL_NOT_ALLOWED' } })
    assert.equal(g.created.length, before, 'bloqueado antes de chamar o Google')
  })
})
