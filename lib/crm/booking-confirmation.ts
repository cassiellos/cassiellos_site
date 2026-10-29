import type { BookingForm } from './booking-forms'
import {
  checkBookingEligibility, finalizeBookingReservation, releaseReservationBeforeGoogle, reserveBookingSlot,
  type ConnectablePool, type EligibilityInput, type EligibilityResult, type ReserveResult,
} from './booking-reservation'
import { isBookableDate, listBookingSlots, type BusyInterval } from './booking-slots'
import type { HandlerResponse } from './booking-intake-request'

/**
 * Confirmação de reunião (POST /api/booking/confirm), sem dependências de framework.
 * Ordem segura:
 *   1. sessão de agendamento assinada (só existe após cadastro verificado pelo Turnstile);
 *   2. pré-checagem SOMENTE LEITURA no banco — contatos bloqueados, limite por e-mail,
 *      allowlist e envio sem verificação NÃO chegam a consultar o Google;
 *   3. disponibilidade real no Google → reserva sob trava → nova checagem no Google →
 *      criação do evento → registro da reunião.
 * Qualquer falha ambígua depois do Google fica para revisão manual (sem nova tentativa).
 */

export type BookingSession = { leadId: string; submissionId: string; formSlug: string }

export type CreatedEvent = { id: string; meetingUrl: string | null; htmlLink: string | null }

export type ConfirmDeps = {
  pool: ConnectablePool
  verifySession: (token: unknown) => BookingSession | null
  getForm: (slug: string) => BookingForm | null
  readBusy: (day: string) => Promise<BusyInterval[]>
  createEvent: (input: {
    title: string; description: string; startAt: string; endAt: string
    guestEmail: string; requestId: string; googleEventId: string
  }) => Promise<CreatedEvent>
  calendarId: string
  allowedEmail: string
  limits?: EligibilityInput['limits']
}

export function bookingDay(startAt: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(startAt))
  const v = (name: string) => parts.find(p => p.type === name)?.value || ''
  return v('year') + '-' + v('month') + '-' + v('day')
}

/** Mapeia bloqueios para códigos públicos genéricos (sem datas, links ou dados internos). */
export function blockedResponse(result: EligibilityResult | ReserveResult): HandlerResponse | null {
  switch (result.status) {
    case 'email_not_allowed': return { status: 403, body: { error: 'TEST_EMAIL_NOT_ALLOWED' } }
    case 'bad_submission': return { status: 403, body: { error: 'INVALID_SUBMISSION' } }
    case 'unverified_submission': return { status: 401, body: { error: 'BOOKING_SESSION_EXPIRED' } }
    case 'active_meeting': return { status: 409, body: { error: 'CONTACT_HAS_ACTIVE_MEETING' } }
    case 'limit_reached': return { status: 429, body: { error: 'BOOKING_LIMIT_REACHED' } }
    case 'already_processing':
    case 'already_failed': return { status: 409, body: { error: 'BOOKING_ALREADY_PROCESSING' } }
    case 'already_confirmed':
      return { status: 200, body: { ok: true, alreadyConfirmed: true, bookingRequestId: result.id } }
    default: return null
  }
}

export async function confirmBookingRequest(
  deps: ConfirmDeps,
  input: { bookingToken: unknown; startAt: unknown; pageOrigin: string },
): Promise<HandlerResponse> {
  const session = deps.verifySession(input.bookingToken)
  if (!session) return { status: 401, body: { error: 'BOOKING_SESSION_EXPIRED' } }
  const form = deps.getForm(session.formSlug)
  if (!form) return { status: 400, body: { error: 'UNKNOWN_FORM' } }
  const startAt = input.startAt
  if (typeof startAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(startAt)) {
    return { status: 400, body: { error: 'INVALID_SLOT' } }
  }
  const ms = Date.parse(startAt)
  if (!Number.isFinite(ms)) return { status: 400, body: { error: 'INVALID_SLOT' } }
  const normalizedStart = new Date(ms).toISOString()
  const day = bookingDay(normalizedStart)
  if (!isBookableDate(day)) return { status: 400, body: { error: 'INVALID_SLOT' } }
  const finishAt = new Date(ms + form.durationMinutes * 60_000).toISOString()
  const base = {
    leadId: session.leadId, submissionId: session.submissionId, formSlug: form.slug,
    allowedEmail: deps.allowedEmail, limits: deps.limits,
  }

  try {
    // Read-only gate: blocked contacts never trigger a Google request.
    const eligibility = await checkBookingEligibility(deps.pool, base)
    if (eligibility.status !== 'eligible') return blockedResponse(eligibility)!

    // Google external availability is checked first; internal races are guarded
    // with the per-mailbox lock and the unique active-slot index.
    const busy = await deps.readBusy(day)
    const slot = listBookingSlots(day, busy).find(item =>
      item.startAt === normalizedStart && item.endAt === finishAt)
    if (!slot) return { status: 409, body: { error: 'SLOT_UNAVAILABLE' } }

    const reservation = await reserveBookingSlot(deps.pool, {
      ...base, startAt: normalizedStart, endAt: finishAt, calendarId: deps.calendarId,
    })
    if (reservation.status === 'slot_unavailable') return { status: 409, body: { error: 'SLOT_UNAVAILABLE' } }
    if (reservation.status !== 'reserved') {
      return blockedResponse(reservation) ?? { status: 409, body: { error: 'BOOKING_ALREADY_PROCESSING' } }
    }

    // Recheck the Google calendar after claiming the slot, before creating an event.
    // If ambiguous Google/DB failure occurs later, leave reservation locked for
    // manual reconciliation rather than risk sending duplicate invitations.
    let latestBusy: BusyInterval[]
    try {
      latestBusy = await deps.readBusy(day)
    } catch { return { status: 503, body: { error: 'BOOKING_REQUIRES_REVIEW' } } }
    const stillFree = listBookingSlots(day, latestBusy).some(item =>
      item.startAt === normalizedStart && item.endAt === finishAt)
    if (!stillFree) {
      await releaseReservationBeforeGoogle(deps.pool, reservation.id, 'EXTERNAL_CALENDAR_CONFLICT')
      return { status: 409, body: { error: 'SLOT_UNAVAILABLE' } }
    }

    const event = await deps.createEvent({
      title: form.meetingName,
      description: 'Agendamento do diagnóstico estratégico Cassiellos.',
      startAt: normalizedStart,
      endAt: finishAt,
      guestEmail: reservation.email,
      requestId: reservation.id,
      googleEventId: 'c' + reservation.id.replaceAll('-', ''),
    })
    const saved = await finalizeBookingReservation(deps.pool, {
      bookingId: reservation.id,
      leadId: session.leadId, submissionId: session.submissionId,
      eventId: event.id, meetingUrl: event.meetingUrl,
      startAt: normalizedStart, endAt: finishAt, calendarId: deps.calendarId, formSlug: form.slug,
      pageOrigin: input.pageOrigin,
    })
    return {
      status: 201,
      body: {
        ok: true, appointmentId: saved.appointmentId, bookingRequestId: reservation.id,
        date: day, startAt: normalizedStart, endAt: finishAt,
        googleMeetUrl: event.meetingUrl, googleCalendarUrl: event.htmlLink,
        meetPending: !event.meetingUrl,
        environment: 'preview',
      },
    }
  } catch {
    // Do not issue a second calendar request after ambiguous partial completion.
    return { status: 503, body: { error: 'BOOKING_REQUIRES_REVIEW' } }
  }
}

/**
 * Consulta de horários (GET /api/booking/availability): exige a sessão de agendamento
 * emitida após o cadastro verificado e bloqueia cedo contatos com reunião ativa ou
 * limite atingido — sem consultar o Google. Devolve null quando a consulta pode seguir.
 */
export async function checkAvailabilityAccess(
  pool: ConnectablePool,
  session: BookingSession | null,
  formSlug: string,
  limits?: EligibilityInput['limits'],
): Promise<HandlerResponse | null> {
  if (!session || session.formSlug !== formSlug) return { status: 401, body: { error: 'BOOKING_SESSION_EXPIRED' } }
  const result = await checkBookingEligibility(pool, {
    leadId: session.leadId, submissionId: session.submissionId, formSlug,
    allowedEmail: '', skipAllowlist: true, limits,
  })
  if (result.status === 'eligible') return null
  if (result.status === 'active_meeting' || result.status === 'limit_reached') return blockedResponse(result)
  return { status: 401, body: { error: 'BOOKING_SESSION_EXPIRED' } }
}
