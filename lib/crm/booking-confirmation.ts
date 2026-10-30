import type { BookingForm } from './booking-forms'
import {
  checkBookingEligibility, finalizeBookingReservation, releaseReservationBeforeGoogle, reserveBookingSlot,
  type ConnectablePool, type EligibilityInput, type EligibilityResult, type ReserveResult,
} from './booking-reservation'
import { isValidBookingDate, type BusyInterval } from './booking-slots'
import {
  DEFAULT_AVAILABILITY_RULES, isWithinWindow, listAvailableSlots, type AvailabilityRules,
} from './availability/engine'
import type { HandlerResponse } from './booking-intake-request'
import type { BookingEventInput } from './booking-event'
import { isGoogleMeetUrl } from './booking-event'

/** Grade de horários: 30 min (decisão D3). Como o fuso é -03:00, a grade local coincide com a UTC. */
const SLOT_GRID_MS = 30 * 60_000

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
  /** Evento SEM convidados (nenhum e-mail do lead é enviado ao Google). */
  createEvent: (input: BookingEventInput) => Promise<CreatedEvent>
  calendarId: string
  allowedEmail: string
  limits?: EligibilityInput['limits']
  /**
   * Regras de disponibilidade (horário comercial, feriados, bloqueios, exceções). Lidas a cada
   * confirmação: a mesma decisão da listagem pública vale para chamadas diretas à API.
   * Sem esta dependência, valem as regras padrão do código (inclui feriados).
   */
  loadRules?: () => Promise<AvailabilityRules>
}

/**
 * Mesma sessão depois de confirmada (página recarregada, clique repetido): devolve a reunião
 * registrada — inclusive o link do Meet — SOMENTE ao titular da sessão assinada daquela inscrição.
 * Como não há convite por e-mail, é assim que o visitante recupera o link sem criar outro evento.
 */
async function alreadyConfirmed(
  pool: ConnectablePool, bookingId: string, session: BookingSession, meetingTitle: string,
): Promise<HandlerResponse> {
  const base = { ok: true, alreadyConfirmed: true, bookingRequestId: bookingId }
  const client = await pool.connect()
  try {
    const found = await client.query<{ starts_at: Date; ends_at: Date; meeting_url: string | null }>(
      `SELECT a.starts_at, a.ends_at, a.meeting_url
         FROM crm.booking_requests b JOIN crm.appointments a ON a.id = b.appointment_id
        WHERE b.id = $1 AND b.lead_id = $2 AND b.submission_id = $3 AND b.status = 'confirmed'
          AND a.status IN ('pending', 'confirmed') AND a.ends_at > now()`,
      [bookingId, session.leadId, session.submissionId])
    const row = found.rows[0]
    if (!row) return { status: 200, body: base }
    const startAt = new Date(row.starts_at).toISOString()
    const meetUrl = isGoogleMeetUrl(row.meeting_url) ? row.meeting_url : null
    return { status: 200, body: {
      ...base, date: bookingDay(startAt), startAt, endAt: new Date(row.ends_at).toISOString(),
      googleMeetUrl: meetUrl, meetPending: !meetUrl, meetingTitle, invitationSent: false,
    } }
  } finally { client.release() }
}

/** Referência interna não pessoal usada no evento do Google (8 primeiros caracteres da reserva). */
export function bookingReference(bookingId: string): string {
  return bookingId.replaceAll('-', '').slice(0, 8).toLowerCase()
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
  // Decisão D-D: 400 somente para pedido estruturalmente inválido (formato, data inexistente,
  // horário fora da grade de 30 min). Horário bem formado que não está disponível = 409.
  const ms = Date.parse(startAt)
  if (!Number.isFinite(ms)) return { status: 400, body: { error: 'INVALID_SLOT' } }
  const normalizedStart = new Date(ms).toISOString()
  if (normalizedStart.slice(0, 19) !== startAt.slice(0, 19)) return { status: 400, body: { error: 'INVALID_SLOT' } }
  if (ms % SLOT_GRID_MS !== 0) return { status: 400, body: { error: 'INVALID_SLOT' } }
  const day = bookingDay(normalizedStart)
  if (!isValidBookingDate(day)) return { status: 400, body: { error: 'INVALID_SLOT' } }
  const finishAt = new Date(ms + form.durationMinutes * 60_000).toISOString()
  const base = {
    leadId: session.leadId, submissionId: session.submissionId, formSlug: form.slug,
    allowedEmail: deps.allowedEmail, limits: deps.limits,
  }

  try {
    // Availability rules first (no Google). Decisão D-D: data passada ou além da janela, fim de
    // semana, dia não atendido, feriado/política, bloqueio ou fora do expediente = 409, sem Google.
    const rules = deps.loadRules ? await deps.loadRules() : DEFAULT_AVAILABILITY_RULES
    if (!isWithinWindow(day, rules) ||
      !listAvailableSlots(day, [], rules).some(item => item.startAt === normalizedStart && item.endAt === finishAt)) {
      return { status: 409, body: { error: 'SLOT_UNAVAILABLE' } }
    }

    // Read-only gate: blocked contacts never trigger a Google request.
    const eligibility = await checkBookingEligibility(deps.pool, base)
    if (eligibility.status === 'already_confirmed') return alreadyConfirmed(deps.pool, eligibility.id, session, form.meetingName)
    if (eligibility.status !== 'eligible') return blockedResponse(eligibility)!

    // Google external availability is checked first; internal races are guarded
    // with the per-mailbox lock and the unique active-slot index.
    const busy = await deps.readBusy(day)
    const slot = listAvailableSlots(day, busy, rules).find(item =>
      item.startAt === normalizedStart && item.endAt === finishAt)
    if (!slot) return { status: 409, body: { error: 'SLOT_UNAVAILABLE' } }

    const reservation = await reserveBookingSlot(deps.pool, {
      ...base, startAt: normalizedStart, endAt: finishAt, calendarId: deps.calendarId,
    })
    if (reservation.status === 'slot_unavailable') return { status: 409, body: { error: 'SLOT_UNAVAILABLE' } }
    if (reservation.status === 'already_confirmed') return alreadyConfirmed(deps.pool, reservation.id, session, form.meetingName)
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
    const stillFree = listAvailableSlots(day, latestBusy, rules).some(item =>
      item.startAt === normalizedStart && item.endAt === finishAt)
    if (!stillFree) {
      await releaseReservationBeforeGoogle(deps.pool, reservation.id, 'EXTERNAL_CALENDAR_CONFLICT')
      return { status: 409, body: { error: 'SLOT_UNAVAILABLE' } }
    }

    // Sem convidados: o e-mail do lead (reservation.email) NÃO vai ao Google.
    const event = await deps.createEvent({
      title: form.meetingName,
      startAt: normalizedStart,
      endAt: finishAt,
      requestId: reservation.id,
      googleEventId: 'c' + reservation.id.replaceAll('-', ''),
      reference: bookingReference(reservation.id),
    })
    const saved = await finalizeBookingReservation(deps.pool, {
      bookingId: reservation.id,
      leadId: session.leadId, submissionId: session.submissionId,
      eventId: event.id, meetingUrl: isGoogleMeetUrl(event.meetingUrl) ? event.meetingUrl : null,
      startAt: normalizedStart, endAt: finishAt, calendarId: deps.calendarId, formSlug: form.slug,
      pageOrigin: input.pageOrigin,
    })
    return {
      status: 201,
      body: {
        ok: true, appointmentId: saved.appointmentId, bookingRequestId: reservation.id,
        date: day, startAt: normalizedStart, endAt: finishAt,
        // Sem htmlLink: ele aponta para a agenda interna da Cassiellos (não serve ao visitante).
        googleMeetUrl: isGoogleMeetUrl(event.meetingUrl) ? event.meetingUrl : null,
        meetPending: !isGoogleMeetUrl(event.meetingUrl),
        meetingTitle: form.meetingName,
        invitationSent: false,
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
