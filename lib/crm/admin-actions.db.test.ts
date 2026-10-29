/**
 * Fase 3.4 — controles administrativos contra PostgreSQL DESCARTÁVEL
 * (CRM_INTEGRATION_DATABASE_URL, migrações 0001–0007). Nunca usar o Neon.
 * O Google é simulado (contamos chamadas e forçamos falhas); nenhuma reunião real.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { Pool } from 'pg'
import {
  cancelMeeting, inspectStuckReservation, listStuckReservations, markNoShow, resolveStuckReservation, setLeadClassification,
  type AdminActor,
} from './admin-actions'
import { finalizeBookingReservation, reserveBookingSlot, type ReserveInput } from './booking-reservation'
import { bookingEventId, type GoogleCancelResult, type GoogleEventState } from './google-event-ops'
import { saveLeadSubmission } from './lead-intake'

const url = process.env.CRM_INTEGRATION_DATABASE_URL
const skip = !url ? 'CRM_INTEGRATION_DATABASE_URL não definida' : false
const DAY = 86_400_000
const MIN = 60_000
const ACTOR: AdminActor = { kind: 'crm_admin', sessionRef: 'abcdef0123456789' }

type Lead = { leadId: string; submissionId: string; email: string }
const slotAt = (ms: number) => ({ startAt: new Date(ms).toISOString(), endAt: new Date(ms + 30 * MIN).toISOString() })
const email = (tag: string) => tag + '.' + randomUUID().slice(0, 8) + '@exemplo.com'

describe('Fase 3.4 — controles administrativos (PostgreSQL descartável)', { skip }, () => {
  let pool: Pool
  before(() => { pool = new Pool({ connectionString: url, max: 10 }) })
  after(async () => { await pool?.end() })
  const q = async <T extends Record<string, unknown>>(sql: string, p: unknown[] = []) => (await pool.query<T>(sql, p)).rows
  const calendar = () => 'cal-' + randomUUID()

  async function submit(address: string, isTest = true): Promise<Lead> {
    const r = await saveLeadSubmission(pool, {
      idempotencyKey: randomUUID(), name: 'Lead Admin', email: address, phone: '31900000060',
      formSlug: 'odontologia', formVersion: 'odontologia-v2', niche: 'Clínicas odontológicas',
      answers: { clinic: 'Clínica Admin', revenue: 'Até R$ 10 mil/mês', priority: 'Atrair mais pacientes' },
      attribution: {}, newLeadIsTest: isTest, bookingMode: 'test',
      protection: { turnstile: 'verified', action: 'booking_lead', hostname: 'crm.cassiellos.com.br', challengeTs: null },
    })
    return { leadId: r.leadId, submissionId: r.submissionId, email: address }
  }
  const input = (lead: Lead, slot: { startAt: string; endAt: string }, cal: string): ReserveInput => ({
    leadId: lead.leadId, submissionId: lead.submissionId, formSlug: 'odontologia',
    startAt: slot.startAt, endAt: slot.endAt, calendarId: cal, allowedEmail: lead.email,
  })
  async function book(lead: Lead, slot: { startAt: string; endAt: string }, cal: string) {
    const r = await reserveBookingSlot(pool, input(lead, slot, cal))
    assert.equal(r.status, 'reserved')
    const bookingId = (r as { id: string }).id
    const { appointmentId } = await finalizeBookingReservation(pool, {
      bookingId, leadId: lead.leadId, submissionId: lead.submissionId, eventId: bookingEventId(bookingId),
      meetingUrl: 'https://meet.google.com/aaa-bbbb-ccc', startAt: slot.startAt, endAt: slot.endAt,
      calendarId: cal, formSlug: 'odontologia', pageOrigin: 'https://crm.cassiellos.com.br',
    })
    return { bookingId, appointmentId }
  }
  function google(results: (GoogleCancelResult | Error)[] = ['cancelled']) {
    const calls: { calendarId: string; eventId: string }[] = []
    return {
      calls,
      cancelGoogleEvent: async (calendarId: string, eventId: string) => {
        calls.push({ calendarId, eventId })
        const next = results.length > 1 ? results.shift()! : results[0]
        if (next instanceof Error) throw next
        return next
      },
    }
  }
  const activities = (leadId: string, kind: string) =>
    q<{ details: Record<string, unknown>; performed_by: string; created_at: Date }>(
      'SELECT details, performed_by, created_at FROM crm.lead_activities WHERE lead_id = $1 AND activity_kind = $2', [leadId, kind])

  describe('cancelar reunião', () => {
    it('cancela no Google primeiro, depois no CRM; libera o horário e preserva o histórico', async () => {
      const lead = await submit(email('cancela'))
      const cal = calendar()
      const slot = slotAt(Date.now() + 3 * DAY)
      const { bookingId, appointmentId } = await book(lead, slot, cal)
      const g = google()
      const r = await cancelMeeting({ pool, cancelGoogleEvent: g.cancelGoogleEvent },
        { leadId: lead.leadId, appointmentId, actor: ACTOR, reason: 'Cliente pediu outro dia' })
      assert.deepEqual(r, { status: 200, outcome: 'cancelled', details: { google: 'cancelled' } })
      assert.deepEqual(g.calls, [{ calendarId: cal, eventId: bookingEventId(bookingId) }])
      const [appt] = await q<{ status: string; cancelled_at: Date | null }>('SELECT status, cancelled_at FROM crm.appointments WHERE id = $1', [appointmentId])
      assert.equal(appt.status, 'cancelled')
      assert.ok(appt.cancelled_at)
      const [booking] = await q<{ status: string }>('SELECT status FROM crm.booking_requests WHERE id = $1', [bookingId])
      assert.equal(booking.status, 'cancelled')
      const [act] = await activities(lead.leadId, 'meeting_cancelled')
      assert.equal(act.performed_by, 'crm_admin')
      assert.deepEqual(act.details, { reason: 'Cliente pediu outro dia', google: 'cancelled', bookingRequestReleased: true, sessionRef: ACTOR.sessionRef })
      // History preserved: meeting row, scheduling activity and tracking event still exist.
      assert.equal((await q("SELECT 1 FROM crm.lead_activities WHERE lead_id = $1 AND activity_kind = 'meeting_scheduled'", [lead.leadId])).length, 1)
      assert.equal((await q('SELECT 1 FROM crm.tracking_events WHERE appointment_id = $1', [appointmentId])).length, 1)
      // Slot is free again: another lead can take it; the same lead can book again.
      const other = await submit(email('pega.horario'))
      assert.equal((await reserveBookingSlot(pool, input(other, slot, cal))).status, 'reserved')
      const again = await submit(lead.email)
      assert.equal((await reserveBookingSlot(pool, input(again, slotAt(Date.now() + 5 * DAY), cal))).status, 'reserved')
    })

    it('falha no Google: NADA muda, horário segue ocupado; nova tentativa conclui', async () => {
      const lead = await submit(email('falha.google'))
      const cal = calendar()
      const slot = slotAt(Date.now() + 3 * DAY)
      const { bookingId, appointmentId } = await book(lead, slot, cal)
      const g = google([new Error('timeout'), 'already_cancelled'])
      const deps = { pool, cancelGoogleEvent: g.cancelGoogleEvent }
      const first = await cancelMeeting(deps, { leadId: lead.leadId, appointmentId, actor: ACTOR })
      assert.deepEqual(first, { status: 502, outcome: 'google_not_confirmed' })
      assert.equal((await q<{ status: string }>('SELECT status FROM crm.appointments WHERE id = $1', [appointmentId]))[0].status, 'confirmed')
      assert.equal((await q<{ status: string }>('SELECT status FROM crm.booking_requests WHERE id = $1', [bookingId]))[0].status, 'confirmed')
      assert.equal((await activities(lead.leadId, 'meeting_cancel_sync_failed')).length, 1)
      const other = await submit(email('tenta.pegar'))
      assert.equal((await reserveBookingSlot(pool, input(other, slot, cal))).status, 'slot_unavailable', 'horário não foi liberado')
      // Retry: Google answers 410 (it had actually been cancelled) → CRM completes.
      const second = await cancelMeeting(deps, { leadId: lead.leadId, appointmentId, actor: ACTOR })
      assert.equal(second.outcome, 'cancelled')
      assert.equal((await activities(lead.leadId, 'meeting_cancelled'))[0].details.google, 'already_cancelled')
    })

    it('evento inexistente no Google (404) e reunião sem evento: cancela no CRM com o registro do motivo', async () => {
      const lead = await submit(email('sem.evento'))
      const cal = calendar()
      const { appointmentId } = await book(lead, slotAt(Date.now() + 3 * DAY), cal)
      const g = google(['not_found'])
      assert.equal((await cancelMeeting({ pool, cancelGoogleEvent: g.cancelGoogleEvent }, { leadId: lead.leadId, appointmentId, actor: ACTOR })).outcome, 'cancelled')
      assert.equal((await activities(lead.leadId, 'meeting_cancelled'))[0].details.google, 'not_found')
      const manual = await submit(email('manual'))
      const [m] = await q<{ id: string }>(`INSERT INTO crm.appointments (lead_id, calendar_id, starts_at, ends_at, status)
        VALUES ($1, $2, now() + interval '2 days', now() + interval '2 days 30 minutes', 'pending') RETURNING id`, [manual.leadId, cal])
      const g2 = google()
      assert.equal((await cancelMeeting({ pool, cancelGoogleEvent: g2.cancelGoogleEvent }, { leadId: manual.leadId, appointmentId: m.id, actor: ACTOR })).outcome, 'cancelled')
      assert.equal(g2.calls.length, 0, 'sem evento vinculado: nenhuma chamada ao Google')
    })

    it('cancelamento repetido ou simultâneo não duplica (1 atividade, idempotente)', async () => {
      const lead = await submit(email('duplo'))
      const { appointmentId } = await book(lead, slotAt(Date.now() + 3 * DAY), calendar())
      const g = google(['cancelled', 'already_cancelled'])
      const deps = { pool, cancelGoogleEvent: g.cancelGoogleEvent }
      const results = await Promise.all([1, 2, 3].map(() => cancelMeeting(deps, { leadId: lead.leadId, appointmentId, actor: ACTOR })))
      assert.equal(results.filter(r => r.outcome === 'cancelled').length, 1)
      assert.ok(results.every(r => r.status === 200))
      assert.equal((await activities(lead.leadId, 'meeting_cancelled')).length, 1)
      const later = google()
      assert.equal((await cancelMeeting({ pool, cancelGoogleEvent: later.cancelGoogleEvent }, { leadId: lead.leadId, appointmentId, actor: ACTOR })).outcome, 'already_cancelled')
      assert.equal(later.calls.length, 0, 'já cancelada: não chama o Google de novo')
    })

    it('reunião encerrada, realizada ou de outro lead: recusado sem chamar o Google', async () => {
      const lead = await submit(email('encerrada'))
      const cal = calendar()
      const past = await book(lead, slotAt(Date.now() - 2 * DAY), cal)
      const g = google()
      assert.equal((await cancelMeeting({ pool, cancelGoogleEvent: g.cancelGoogleEvent }, { leadId: lead.leadId, appointmentId: past.appointmentId, actor: ACTOR })).outcome, 'already_ended')
      await pool.query("UPDATE crm.appointments SET status = 'completed', completed_at = now() WHERE id = $1", [past.appointmentId])
      assert.equal((await cancelMeeting({ pool, cancelGoogleEvent: g.cancelGoogleEvent }, { leadId: lead.leadId, appointmentId: past.appointmentId, actor: ACTOR })).outcome, 'not_cancellable')
      const future = await book(await submit(email('dono')), slotAt(Date.now() + 3 * DAY), cal)
      assert.equal((await cancelMeeting({ pool, cancelGoogleEvent: g.cancelGoogleEvent }, { leadId: lead.leadId, appointmentId: future.appointmentId, actor: ACTOR })).outcome, 'not_found')
      assert.equal(g.calls.length, 0)
    })
  })

  describe('marcar como não compareceu', () => {
    it('antes do início: recusado; depois do início: no_show, sem Google e sem liberar o horário', async () => {
      const lead = await submit(email('falta'))
      const cal = calendar()
      const startMs = Date.now() - 10 * MIN // meeting in progress
      const slot = slotAt(startMs)
      const { bookingId, appointmentId } = await book(lead, slot, cal)
      assert.equal((await markNoShow(pool, { leadId: lead.leadId, appointmentId, actor: ACTOR, now: new Date(startMs - 1) })).outcome, 'not_started')
      assert.equal((await markNoShow(pool, { leadId: lead.leadId, appointmentId, actor: ACTOR })).outcome, 'marked')
      assert.equal((await q<{ status: string }>('SELECT status FROM crm.appointments WHERE id = $1', [appointmentId]))[0].status, 'no_show')
      assert.equal((await q<{ status: string }>('SELECT status FROM crm.booking_requests WHERE id = $1', [bookingId]))[0].status, 'confirmed',
        'reserva continua ocupando o intervalo em andamento')
      const other = await submit(email('quer.mesmo.horario'))
      assert.equal((await reserveBookingSlot(pool, input(other, slot, cal))).status, 'slot_unavailable')
      // Same contact may book ANOTHER slot under the existing rules.
      const again = await submit(lead.email)
      assert.equal((await reserveBookingSlot(pool, input(again, slotAt(Date.now() + 4 * DAY), cal))).status, 'reserved')
      // Repeated click: no duplicate activity.
      assert.equal((await markNoShow(pool, { leadId: lead.leadId, appointmentId, actor: ACTOR })).outcome, 'already_marked')
      assert.equal((await activities(lead.leadId, 'meeting_no_show')).length, 1)
    })

    it('reunião cancelada ou realizada não pode virar falta', async () => {
      const lead = await submit(email('falta.invalida'))
      const { appointmentId } = await book(lead, slotAt(Date.now() - 2 * DAY), calendar())
      await pool.query("UPDATE crm.appointments SET status = 'completed', completed_at = now() WHERE id = $1", [appointmentId])
      assert.equal((await markNoShow(pool, { leadId: lead.leadId, appointmentId, actor: ACTOR })).outcome, 'not_markable')
    })
  })

  describe('corrigir classificação', () => {
    it('real → teste: registra quem/quando/de-para; registros antigos e eventos NÃO mudam; futuros herdam', async () => {
      const lead = await submit(email('classe'), false)
      const cal = calendar()
      const old = await book(lead, slotAt(Date.now() - 2 * DAY), cal)
      await pool.query("UPDATE crm.appointments SET status = 'completed', completed_at = now() WHERE id = $1", [old.appointmentId])
      await pool.query(`INSERT INTO crm.deals (lead_id, appointment_id, status, amount, closed_at, is_test) VALUES ($1, $2, 'won', 900, now(), false)`,
        [lead.leadId, old.appointmentId])
      const before = {
        appt: await q('SELECT is_test FROM crm.appointments WHERE lead_id = $1', [lead.leadId]),
        deals: await q('SELECT is_test FROM crm.deals WHERE lead_id = $1', [lead.leadId]),
        tracking: await q('SELECT id, metadata FROM crm.tracking_events WHERE lead_id = $1 ORDER BY id', [lead.leadId]),
      }
      const r = await setLeadClassification(pool, { leadId: lead.leadId, isTest: true, actor: ACTOR, reason: 'E-mail interno da agência' })
      assert.equal(r.outcome, 'changed')
      assert.equal((await q<{ is_test: boolean }>('SELECT is_test FROM crm.leads WHERE id = $1', [lead.leadId]))[0].is_test, true)
      const [act] = await activities(lead.leadId, 'classification_changed')
      assert.deepEqual(act.details, { from: 'real', to: 'test', reason: 'E-mail interno da agência', retroactive: false, sessionRef: ACTOR.sessionRef })
      assert.equal(act.performed_by, 'crm_admin')
      assert.ok(act.created_at instanceof Date)
      assert.deepEqual({
        appt: await q('SELECT is_test FROM crm.appointments WHERE lead_id = $1', [lead.leadId]),
        deals: await q('SELECT is_test FROM crm.deals WHERE lead_id = $1', [lead.leadId]),
        tracking: await q('SELECT id, metadata FROM crm.tracking_events WHERE lead_id = $1 ORDER BY id', [lead.leadId]),
      }, before, 'nada antigo foi alterado e nenhum evento novo foi criado')
      const fresh = await book(await submit(lead.email), slotAt(Date.now() + 3 * DAY), cal)
      assert.equal((await q<{ is_test: boolean }>('SELECT is_test FROM crm.appointments WHERE id = $1', [fresh.appointmentId]))[0].is_test, true)
    })

    it('mesma classificação: sem alteração e sem atividade; lead inexistente: not_found', async () => {
      const lead = await submit(email('igual'), true)
      assert.equal((await setLeadClassification(pool, { leadId: lead.leadId, isTest: true, actor: ACTOR })).outcome, 'unchanged')
      assert.equal((await activities(lead.leadId, 'classification_changed')).length, 0)
      assert.equal((await setLeadClassification(pool, { leadId: randomUUID(), isTest: false, actor: ACTOR })).outcome, 'not_found')
    })
  })

  describe('reservas travadas', () => {
    async function stuck(age = 20) {
      const lead = await submit(email('travada'))
      const cal = calendar()
      const slot = slotAt(Date.now() + 3 * DAY)
      const r = await reserveBookingSlot(pool, input(lead, slot, cal))
      const id = (r as { id: string }).id
      await pool.query(`UPDATE crm.booking_requests SET created_at = now() - make_interval(mins => $2::int) WHERE id = $1`, [id, age])
      return { lead, cal, slot, id }
    }
    const googleState = (state: GoogleEventState | Error) => {
      const calls: string[] = []
      return { calls, readGoogleEvent: async (c: string, e: string) => { calls.push(c + '/' + e); if (state instanceof Error) throw state; return state } }
    }

    it('lista apenas processing com mais de 15 minutos', async () => {
      const old = await stuck(20)
      const recent = await stuck(2)
      const ids = (await listStuckReservations(pool)).map(r => r.id)
      assert.ok(ids.includes(old.id))
      assert.equal(ids.includes(recent.id), false)
    })

    it('conferir é somente leitura e usa o id determinístico do evento', async () => {
      const s = await stuck()
      const g = googleState({ state: 'not_found' })
      const r = await inspectStuckReservation({ pool, readGoogleEvent: g.readGoogleEvent }, { bookingId: s.id })
      assert.deepEqual(r, { status: 200, outcome: 'checked', details: { google: 'not_found' } })
      assert.deepEqual(g.calls, [s.cal + '/' + bookingEventId(s.id)])
      assert.equal((await q<{ status: string }>('SELECT status FROM crm.booking_requests WHERE id = $1', [s.id]))[0].status, 'processing')
    })

    it('liberar: só sem evento ativo no Google; horário volta a ficar disponível; nada é apagado', async () => {
      const s = await stuck()
      const active = googleState({ state: 'active', meetingUrl: null })
      const denied = await resolveStuckReservation({ pool, readGoogleEvent: active.readGoogleEvent }, { bookingId: s.id, decision: 'release', actor: ACTOR })
      assert.deepEqual(denied, { status: 409, outcome: 'google_state_mismatch', details: { google: 'active' } })
      const other = await submit(email('quer.horario.travado'))
      assert.equal((await reserveBookingSlot(pool, input(other, s.slot, s.cal))).status, 'slot_unavailable')
      const none = googleState({ state: 'not_found' })
      assert.equal((await resolveStuckReservation({ pool, readGoogleEvent: none.readGoogleEvent }, { bookingId: s.id, decision: 'release', actor: ACTOR })).outcome, 'released')
      const [row] = await q<{ status: string; failure_code: string }>('SELECT status, failure_code FROM crm.booking_requests WHERE id = $1', [s.id])
      assert.deepEqual(row, { status: 'failed', failure_code: 'RECONCILED_NO_GOOGLE_EVENT' })
      assert.equal((await reserveBookingSlot(pool, input(await submit(email('agora.pode')), s.slot, s.cal))).status, 'reserved')
      assert.equal((await activities(s.lead.leadId, 'booking_reconciled')).length, 1)
      // Second attempt: no longer stuck.
      assert.equal((await resolveStuckReservation({ pool, readGoogleEvent: none.readGoogleEvent }, { bookingId: s.id, decision: 'release', actor: ACTOR })).outcome, 'not_stuck')
    })

    it('registrar: só com evento ativo; cria a reunião sem evento de conversão retroativo', async () => {
      const s = await stuck()
      const none = googleState({ state: 'cancelled' })
      assert.equal((await resolveStuckReservation({ pool, readGoogleEvent: none.readGoogleEvent }, { bookingId: s.id, decision: 'adopt', actor: ACTOR })).outcome, 'google_state_mismatch')
      const active = googleState({ state: 'active', meetingUrl: 'https://meet.google.com/xyz-abcd-efg' })
      const r = await resolveStuckReservation({ pool, readGoogleEvent: active.readGoogleEvent }, { bookingId: s.id, decision: 'adopt', actor: ACTOR })
      assert.equal(r.outcome, 'adopted')
      const [appt] = await q<{ status: string; calendar_event_id: string; meeting_url: string }>(
        'SELECT status, calendar_event_id, meeting_url FROM crm.appointments WHERE id = $1', [r.details!.appointmentId])
      assert.deepEqual(appt, { status: 'confirmed', calendar_event_id: bookingEventId(s.id), meeting_url: 'https://meet.google.com/xyz-abcd-efg' })
      assert.equal((await q<{ status: string }>('SELECT status FROM crm.booking_requests WHERE id = $1', [s.id]))[0].status, 'confirmed')
      assert.equal((await q('SELECT 1 FROM crm.tracking_events WHERE appointment_id = $1', [r.details!.appointmentId])).length, 0)
    })

    it('Google indisponível ou reserva recente: nada é alterado', async () => {
      const s = await stuck()
      const down = googleState(new Error('down'))
      assert.equal((await resolveStuckReservation({ pool, readGoogleEvent: down.readGoogleEvent }, { bookingId: s.id, decision: 'release', actor: ACTOR })).outcome, 'google_unavailable')
      assert.equal((await inspectStuckReservation({ pool, readGoogleEvent: down.readGoogleEvent }, { bookingId: s.id })).outcome, 'google_unavailable')
      const recent = await stuck(1)
      const none = googleState({ state: 'not_found' })
      assert.equal((await resolveStuckReservation({ pool, readGoogleEvent: none.readGoogleEvent }, { bookingId: recent.id, decision: 'release', actor: ACTOR })).outcome, 'not_stuck')
      assert.equal(none.calls.length, 0, 'reserva recente nem consulta o Google')
      for (const id of [s.id, recent.id]) {
        assert.equal((await q<{ status: string }>('SELECT status FROM crm.booking_requests WHERE id = $1', [id]))[0].status, 'processing')
      }
    })
  })
})
