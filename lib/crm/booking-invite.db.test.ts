/**
 * Convite automático do Google Agenda no agendamento público — integração contra PostgreSQL DESCARTÁVEL
 * (CRM_INTEGRATION_DATABASE_URL). A camada HTTP do Google é SIMULADA: registramos exatamente as requisições que
 * seriam enviadas (caminho + corpo). Nenhum convite real, nenhum evento real. Endereços fictícios.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { Pool } from 'pg'
import { adminActorFromSession, cancelMeeting } from './admin-actions'
import { bookingAccessConfig } from './booking-access'
import { confirmBookingRequest, type BookingSession, type ConfirmDeps } from './booking-confirmation'
import { getBookingForm } from './booking-forms'
import { DEFAULT_AVAILABILITY_RULES, listAvailableSlots, type AvailabilityRules } from './availability/engine'
import { cancelGoogleEvent, insertBookingEvent } from './google-event-ops'
import { saveLeadSubmission } from './lead-intake'
import { TURNSTILE_BOOKING_ACTION } from './turnstile'

const url = process.env.CRM_INTEGRATION_DATABASE_URL
const skip = !url ? 'CRM_INTEGRATION_DATABASE_URL não definida' : false
const DAY = 86_400_000
const ORIGIN = 'https://crm.cassiellos.com.br'
const MEET = 'https://meet.google.com/inv-abcd-efg'
const RULES: AvailabilityRules = { ...DEFAULT_AVAILABILITY_RULES, settings: { ...DEFAULT_AVAILABILITY_RULES.settings, windowDays: 30 } }
/** Horários livres DISTINTOS (um por dia útil, alternando o horário), para que cada cenário use o seu. */
const SLOTS = (() => {
  const out: { startAt: string; endAt: string }[] = []
  for (let d = 3; d < 30; d++) {
    const day = listAvailableSlots(new Date(Date.now() + d * DAY).toISOString().slice(0, 10), [], RULES)
    for (const i of [1, 3, 5]) if (day[i]) out.push(day[i])
  }
  return out
})()
const slot = (n: number) => { if (!SLOTS[n]) throw new Error('sem horário'); return SLOTS[n] }

describe('convite do Google Agenda ao lead (PostgreSQL descartável, Google simulado)', { skip }, () => {
  let pool: Pool
  before(() => { pool = new Pool({ connectionString: url, max: 6 }) })
  after(async () => { await pool?.end() })

  async function lead(email: string) {
    const r = await saveLeadSubmission(pool, {
      idempotencyKey: randomUUID(), name: 'Visitante Fictícia <script>', email, phone: '3199' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0'),
      formSlug: 'odontologia', formVersion: 'odontologia-v2', niche: 'Clínicas odontológicas',
      answers: { clinic: 'Clínica http://spam.example', revenue: 'Até R$ 10 mil/mês', priority: 'Atrair mais pacientes' }, attribution: {},
      newLeadIsTest: true, bookingMode: 'test',
      protection: { turnstile: 'verified', action: TURNSTILE_BOOKING_ACTION, hostname: 'crm.cassiellos.com.br', challengeTs: null },
    })
    return { ...r, email }
  }
  /** "Google" simulado no nível HTTP: guarda as requisições de criação e de cancelamento. */
  function google(insertStatuses: number[] = []) {
    const inserts: { path: string; body: Record<string, any> }[] = []
    const deletes: string[] = []
    const createEvent: ConfirmDeps['createEvent'] = input => insertBookingEvent(async (path, body) => {
      inserts.push({ path, body: body as Record<string, any> })
      const status = insertStatuses.shift() ?? 200
      return { status, json: status === 200 ? { id: (body as any).id, hangoutLink: MEET, attendees: (body as any).attendees } : null }
    }, 'agenda-cassiellos', input)
    const cancel = (calendarId: string, eventId: string) => cancelGoogleEvent(async (method, path) => {
      deletes.push(method + ' ' + path); return { status: 204, json: async () => ({}) }
    }, calendarId, eventId)
    return { inserts, deletes, createEvent, cancel }
  }
  const access = bookingAccessConfig({ VERCEL_ENV: 'preview', CRM_GOOGLE_BOOKINGS_ENABLED: 'true' })
  const deps = (g: ReturnType<typeof google>, extra: Partial<ConfirmDeps> = {}): ConfirmDeps => ({
    pool, verifySession: t => (t && typeof t === 'object' ? t as BookingSession : null), getForm: getBookingForm,
    readBusy: async () => [], createEvent: g.createEvent, calendarId: 'agenda-cassiellos', loadRules: async () => RULES,
    allowedEmail: access.allowedEmail, restrictToAllowedEmail: access.restrictedToAllowedEmail, sendInvites: access.sendInvites, ...extra,
  })
  const session = (l: { leadId: string; submissionId: string }): BookingSession => ({ leadId: l.leadId, submissionId: l.submissionId, formSlug: 'odontologia' })

  it('padrão da rota pública: convite LIGADO; CRM_BOOKING_SEND_INVITES=false desliga', () => {
    assert.equal(access.sendInvites, true)
    assert.equal(bookingAccessConfig({ VERCEL_ENV: 'preview', CRM_GOOGLE_BOOKINGS_ENABLED: 'true', CRM_BOOKING_SEND_INVITES: 'false' }).sendInvites, false)
  })

  it('confirmação: UM evento com o lead como participante, sendUpdates=all, Meet e conteúdo do convite; resposta não afirma entrega', async () => {
    const email = 'Maria.' + randomUUID().slice(0, 6) + '+agenda@Gmail.com'
    const l = await lead(email)
    const g = google()
    const s = slot(0)
    const r = await confirmBookingRequest(deps(g), { bookingToken: session(l), startAt: s.startAt, pageOrigin: ORIGIN })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.equal(g.inserts.length, 1)
    const { path, body } = g.inserts[0]
    assert.equal(path, 'calendars/agenda-cassiellos/events?sendUpdates=all&conferenceDataVersion=1')
    assert.deepEqual(body.attendees, [{ email: email.toLowerCase() }])
    assert.equal(body.summary, 'Diagnóstico estratégico • Odontologia | Cassiellos')
    assert.equal(body.conferenceData.createRequest.conferenceSolutionKey.type, 'hangoutsMeet')
    assert.match(body.description, /\(horário de Brasília\)/)
    assert.match(body.description, /Duração: 30 minutos/)
    assert.equal((Date.parse(body.end.dateTime) - Date.parse(body.start.dateTime)) / 60_000, 30)
    // nada digitado pelo visitante (nome, clínica) entra no convite
    assert.doesNotMatch(JSON.stringify(body), /Visitante|<script>|spam\.example|Clínica http/)
    assert.equal(r.body.invitationRequested, true)
    assert.equal(r.body.invitationSent, false, 'entrega/aceite não são afirmados')
    assert.equal(r.body.googleMeetUrl, MEET)
    // mesmo compromisso no CRM: o evento gravado é o criado no Google
    const [appt] = (await pool.query('SELECT calendar_event_id, meeting_url, status FROM crm.appointments WHERE id = $1', [r.body.appointmentId])).rows
    assert.deepEqual(appt, { calendar_event_id: body.id, meeting_url: MEET, status: 'confirmed' })

    // repetir a confirmação não cria outro evento nem outro convite
    const again = await confirmBookingRequest(deps(g), { bookingToken: session(l), startAt: slot(1).startAt, pageOrigin: ORIGIN })
    assert.equal(again.status, 200)
    assert.equal(again.body.alreadyConfirmed, true)
    assert.equal(g.inserts.length, 1)

    // cancelamento no CRM: o MESMO evento é cancelado com sendUpdates=all (o Google avisa o participante)
    const actor = adminActorFromSession('sessao-teste-' + randomUUID())
    const c = await cancelMeeting({ pool, cancelGoogleEvent: g.cancel }, { leadId: l.leadId, appointmentId: r.body.appointmentId as string, actor, reason: 'teste' })
    assert.equal(c.outcome, 'cancelled')
    assert.deepEqual(g.deletes, ['DELETE calendars/agenda-cassiellos/events/' + body.id + '?sendUpdates=all'])
  })

  it('Google recusa o convidado (403): reunião confirmada sem convite, sem segundo evento; tela não promete convite', async () => {
    const l = await lead('recusa.' + randomUUID().slice(0, 6) + '@outlook.com')
    const g = google([403, 200])
    const r = await confirmBookingRequest(deps(g), { bookingToken: session(l), startAt: slot(2).startAt, pageOrigin: ORIGIN })
    assert.equal(r.status, 201)
    assert.equal(g.inserts.length, 2)
    assert.equal(g.inserts[0].body.id, g.inserts[1].body.id)
    assert.equal('attendees' in g.inserts[1].body, false)
    assert.deepEqual([r.body.invitationRequested, r.body.invitationSent, r.body.googleMeetUrl], [false, false, MEET])
  })

  it('convite desligado: evento sem participante (comportamento anterior) e invitationRequested=false', async () => {
    const l = await lead('semconvite.' + randomUUID().slice(0, 6) + '@icloud.com')
    const g = google()
    const r = await confirmBookingRequest(deps(g, { sendInvites: false }), { bookingToken: session(l), startAt: slot(3).startAt, pageOrigin: ORIGIN })
    assert.equal(r.status, 201)
    assert.match(g.inserts[0].path, /sendUpdates=none/)
    assert.equal('attendees' in g.inserts[0].body, false)
    assert.equal(r.body.invitationRequested, false)
  })

  it('falha do Google (500) ou id já existente (409): nenhuma nova tentativa, reserva para revisão (sem convite duplicado)', async () => {
    for (const status of [500, 409]) {
      const l = await lead('falha' + status + '.' + randomUUID().slice(0, 6) + '@yahoo.com.br')
      const g = google([status])
      const r = await confirmBookingRequest(deps(g), { bookingToken: session(l), startAt: slot(status === 409 ? 6 : 5).startAt, pageOrigin: ORIGIN })
      assert.deepEqual(r, { status: 503, body: { error: 'BOOKING_REQUIRES_REVIEW' } })
      assert.equal(g.inserts.length, 1)
    }
  })
})
