/**
 * Agendamento público sem convite — integração contra PostgreSQL DESCARTÁVEL
 * (CRM_INTEGRATION_DATABASE_URL, migrações 0001–0007). Nunca usar o Neon.
 * Google simulado: registramos o que SERIA enviado ao Google em cada chamada.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { Pool } from 'pg'
import { cancelMeeting, adminActorFromSession } from './admin-actions'
import { confirmBookingRequest, type BookingSession, type ConfirmDeps } from './booking-confirmation'
import type { BookingEventInput } from './booking-event'
import { getBookingForm } from './booking-forms'
import { listBookingSlots, type BookingSlot } from './booking-slots'
import { saveLeadSubmission } from './lead-intake'
import { TURNSTILE_BOOKING_ACTION } from './turnstile'

const url = process.env.CRM_INTEGRATION_DATABASE_URL
const skip = !url ? 'CRM_INTEGRATION_DATABASE_URL não definida' : false
const DAY = 86_400_000
const ORIGIN = 'https://crm.cassiellos.com.br'
const MEET = 'https://meet.google.com/abc-defg-hij'

function slots(count: number, offset = 2): BookingSlot[] {
  const result: BookingSlot[] = []
  for (let d = offset; d < 30 && result.length < count; d++) {
    const day = new Date(Date.now() + d * DAY).toISOString().slice(0, 10)
    result.push(...listBookingSlots(day, []).slice(0, count - result.length))
  }
  return result
}

describe('agendamento público sem convite (PostgreSQL descartável)', { skip }, () => {
  let pool: Pool
  before(() => { pool = new Pool({ connectionString: url, max: 6 }) })
  after(async () => { await pool?.end() })
  const q = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pool.query<T>(sql, params)).rows

  async function lead(tag: string) {
    const email = tag + '.' + randomUUID().slice(0, 8) + '@clinica-exemplo.com.br'
    const name = 'Maria Teste ' + randomUUID().slice(0, 4)
    const phone = '3199' + String(Math.floor(Math.random() * 1e7)).padStart(7, '0')
    const r = await saveLeadSubmission(pool, {
      idempotencyKey: randomUUID(), name, email, phone, formSlug: 'odontologia', formVersion: 'odontologia-v2',
      niche: 'Clínicas odontológicas', answers: { clinic: 'Clínica Sigilo', revenue: 'Até R$ 10 mil/mês', priority: 'Atrair mais pacientes' },
      attribution: {}, newLeadIsTest: true, bookingMode: 'test',
      protection: { turnstile: 'verified', action: TURNSTILE_BOOKING_ACTION, hostname: 'crm.cassiellos.com.br', challengeTs: null },
    })
    return { ...r, email, name, phone }
  }
  function google(opts: { meetingUrl?: string | null; fail?: boolean } = {}) {
    const inputs: BookingEventInput[] = []
    const calls = { readBusy: 0, createEvent: 0 }
    return {
      inputs, calls,
      readBusy: async () => { calls.readBusy++; return [] },
      createEvent: async (input: BookingEventInput) => {
        calls.createEvent++; inputs.push(input)
        if (opts.fail) throw new Error('CRM_GOOGLE_CALENDAR_UNAVAILABLE')
        return { id: input.googleEventId, meetingUrl: opts.meetingUrl === undefined ? MEET : opts.meetingUrl, htmlLink: 'https://www.google.com/calendar/event?eid=interno' }
      },
    }
  }
  function deps(g: ReturnType<typeof google>, allowedEmail: string, calendarId = 'cal-' + randomUUID()): ConfirmDeps {
    return { pool, verifySession: t => (t && typeof t === 'object' ? t as BookingSession : null), getForm: getBookingForm,
      readBusy: g.readBusy, createEvent: g.createEvent, calendarId, allowedEmail }
  }
  const session = (l: { leadId: string; submissionId: string }): BookingSession => ({ leadId: l.leadId, submissionId: l.submissionId, formSlug: 'odontologia' })

  it('cria o evento SEM convidado e sem dados pessoais; confirmação traz o Meet e nenhum convite', async () => {
    const l = await lead('sem.convite')
    const g = google()
    const [slot] = slots(1)
    const r = await confirmBookingRequest(deps(g, l.email), { bookingToken: session(l), startAt: slot.startAt, pageOrigin: ORIGIN })
    assert.equal(r.status, 201)
    assert.deepEqual(Object.keys(g.inputs[0]).sort(), ['endAt', 'googleEventId', 'reference', 'requestId', 'startAt', 'title'])
    const sent = JSON.stringify(g.inputs[0])
    for (const pii of [l.email, l.name, l.phone, '@']) assert.equal(sent.includes(pii), false, 'dado pessoal no evento: ' + pii)
    assert.equal(r.body.googleMeetUrl, MEET)
    assert.equal(r.body.invitationSent, false)
    assert.equal(r.body.meetPending, false)
    assert.equal('googleCalendarUrl' in r.body, false) // link interno da agenda da Cassiellos não vai ao visitante
    assert.equal(r.body.meetingTitle, getBookingForm('odontologia')!.meetingName)
    const [appt] = await q<{ meeting_url: string; status: string }>('SELECT meeting_url, status FROM crm.appointments WHERE id = $1', [r.body.appointmentId])
    assert.deepEqual(appt, { meeting_url: MEET, status: 'confirmed' })
  })

  it('duplicidade: repetir a confirmação devolve a MESMA reunião e o link, sem novo evento nem consulta ao Google', async () => {
    const l = await lead('repetido')
    const g = google()
    const d = deps(g, l.email)
    const [slot, other] = slots(2)
    const first = await confirmBookingRequest(d, { bookingToken: session(l), startAt: slot.startAt, pageOrigin: ORIGIN })
    assert.equal(first.status, 201)
    const again = await confirmBookingRequest(d, { bookingToken: session(l), startAt: other.startAt, pageOrigin: ORIGIN })
    assert.equal(again.status, 200)
    assert.equal(again.body.alreadyConfirmed, true)
    assert.equal(again.body.googleMeetUrl, MEET)
    assert.equal(again.body.startAt, slot.startAt) // horário real da reunião, não o novo pedido
    assert.deepEqual(g.calls, { readBusy: 2, createEvent: 1 })
    // Outra sessão (outra inscrição) do mesmo e-mail: bloqueada pela regra de reunião ativa, sem link.
    const second = await saveLeadSubmission(pool, {
      idempotencyKey: randomUUID(), name: 'Outra', email: l.email, phone: '31900000099', formSlug: 'odontologia', formVersion: 'odontologia-v2',
      niche: 'Clínicas odontológicas', answers: { clinic: 'X', revenue: 'Até R$ 10 mil/mês', priority: 'Atrair mais pacientes' },
      attribution: {}, newLeadIsTest: true, bookingMode: 'test',
      protection: { turnstile: 'verified', action: TURNSTILE_BOOKING_ACTION, hostname: 'crm.cassiellos.com.br', challengeTs: null },
    })
    const blocked = await confirmBookingRequest(d, { bookingToken: session(second), startAt: other.startAt, pageOrigin: ORIGIN })
    assert.deepEqual(blocked, { status: 409, body: { error: 'CONTACT_HAS_ACTIVE_MEETING' } })
    assert.equal(g.calls.createEvent, 1)
  })

  it('falha da API Google ao criar: 503 para revisão manual, sem nova tentativa e sem reunião no CRM', async () => {
    const l = await lead('falha.google')
    const g = google({ fail: true })
    const d = deps(g, l.email)
    const [slot] = slots(1, 4)
    const r = await confirmBookingRequest(d, { bookingToken: session(l), startAt: slot.startAt, pageOrigin: ORIGIN })
    assert.deepEqual(r, { status: 503, body: { error: 'BOOKING_REQUIRES_REVIEW' } })
    const rows = await q<{ status: string; appointment_id: string | null }>('SELECT status, appointment_id FROM crm.booking_requests WHERE submission_id = $1', [l.submissionId])
    assert.deepEqual(rows, [{ status: 'processing', appointment_id: null }])
    const retry = await confirmBookingRequest(d, { bookingToken: session(l), startAt: slot.startAt, pageOrigin: ORIGIN })
    assert.deepEqual(retry, { status: 409, body: { error: 'BOOKING_ALREADY_PROCESSING' } })
    assert.equal(g.calls.createEvent, 1)
  })

  it('Meet pendente ou link inesperado: nada inválido é gravado ou exibido', async () => {
    for (const meetingUrl of [null, 'javascript:alert(1)']) {
      const l = await lead('meet.pendente')
      const g = google({ meetingUrl })
      const [slot] = slots(1, 6)
      const r = await confirmBookingRequest(deps(g, l.email), { bookingToken: session(l), startAt: slot.startAt, pageOrigin: ORIGIN })
      assert.equal(r.status, 201)
      assert.equal(r.body.googleMeetUrl, null)
      assert.equal(r.body.meetPending, true)
      const [appt] = await q<{ meeting_url: string | null }>('SELECT meeting_url FROM crm.appointments WHERE id = $1', [r.body.appointmentId])
      assert.equal(appt.meeting_url, null)
    }
  })

  it('allowlist preservada: e-mail fora da lista é recusado antes do Google', async () => {
    const l = await lead('fora.lista')
    const g = google()
    const [slot] = slots(1, 8)
    const r = await confirmBookingRequest(deps(g, 'autorizado@exemplo.com'), { bookingToken: session(l), startAt: slot.startAt, pageOrigin: ORIGIN })
    assert.deepEqual(r, { status: 403, body: { error: 'TEST_EMAIL_NOT_ALLOWED' } })
    assert.deepEqual(g.calls, { readBusy: 0, createEvent: 0 })
  })

  it('cancelamento pelo CRM: evento removido no Google, reunião e reserva canceladas; link não é mais devolvido', async () => {
    const l = await lead('cancelamento')
    const g = google()
    const d = deps(g, l.email)
    const [slot] = slots(1, 10)
    const r = await confirmBookingRequest(d, { bookingToken: session(l), startAt: slot.startAt, pageOrigin: ORIGIN })
    assert.equal(r.status, 201)
    const cancelled: { calendarId: string; eventId: string }[] = []
    const result = await cancelMeeting({ pool, cancelGoogleEvent: async (calendarId, eventId) => { cancelled.push({ calendarId, eventId }); return 'cancelled' } },
      { leadId: l.leadId, appointmentId: String(r.body.appointmentId), actor: adminActorFromSession('sessao-teste'), reason: 'Teste sem convite' })
    assert.equal(result.outcome, 'cancelled')
    assert.deepEqual(cancelled, [{ calendarId: d.calendarId, eventId: g.inputs[0].googleEventId }])
    const [booking] = await q<{ status: string }>('SELECT status FROM crm.booking_requests WHERE submission_id = $1', [l.submissionId])
    assert.equal(booking.status, 'cancelled')
    const after = await confirmBookingRequest(d, { bookingToken: session(l), startAt: slot.startAt, pageOrigin: ORIGIN })
    assert.equal('googleMeetUrl' in after.body, false)
    assert.equal(g.calls.createEvent, 1)
  })
})
