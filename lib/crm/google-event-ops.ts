import { buildBookingEventRequest, parseCreatedEvent, type BookingEventInput, type ParsedCreatedEvent } from './booking-event'

/**
 * Operações administrativas sobre eventos do Google Calendar (Fase 3.4), sem
 * dependência de credenciais para poderem ser testadas. O adaptador real fica em
 * google-calendar.ts e usa o mesmo escopo já autorizado (calendar.events.owned).
 *
 * - Cancelar: DELETE do evento com sendUpdates=all (o Google avisa o convidado).
 *   204/200 = cancelado; 410 = já estava cancelado; 404 = o evento não existe.
 *   Qualquer outra resposta, erro de rede ou tempo esgotado = NÃO confirmado.
 * - Consultar: GET do evento para reconciliar reservas travadas.
 */

export type GoogleRequest = (method: 'GET' | 'DELETE', path: string) =>
  Promise<{ status: number; json(): Promise<unknown> }>

export type GoogleCancelResult = 'cancelled' | 'already_cancelled' | 'not_found'
export type GoogleEventState =
  | { state: 'active'; meetingUrl: string | null }
  | { state: 'cancelled' }
  | { state: 'not_found' }

const EVENT_ID = /^[a-v0-9]{5,1024}$/
const CALENDAR_ID = /^[^/\s?#]{1,255}$/

export function bookingEventId(bookingId: string): string {
  return 'c' + bookingId.replaceAll('-', '').toLowerCase()
}

function eventPath(calendarId: string, eventId: string): string {
  if (!CALENDAR_ID.test(calendarId) || !EVENT_ID.test(eventId)) throw new Error('CRM_GOOGLE_EVENT_REFERENCE_INVALID')
  return 'calendars/' + encodeURIComponent(calendarId) + '/events/' + encodeURIComponent(eventId)
}

/** Cancela o evento. Lança erro quando o Google não confirma (nada deve ser liberado). */
export async function cancelGoogleEvent(request: GoogleRequest, calendarId: string, eventId: string): Promise<GoogleCancelResult> {
  const response = await request('DELETE', eventPath(calendarId, eventId) + '?sendUpdates=all')
  if (response.status === 204 || response.status === 200) return 'cancelled'
  if (response.status === 410) return 'already_cancelled'
  if (response.status === 404) return 'not_found'
  throw new Error('CRM_GOOGLE_CANCEL_UNCONFIRMED')
}

/** Estado atual do evento no Google (somente leitura). */
export async function readGoogleEventState(request: GoogleRequest, calendarId: string, eventId: string): Promise<GoogleEventState> {
  const response = await request('GET', eventPath(calendarId, eventId))
  if (response.status === 404) return { state: 'not_found' }
  if (response.status === 410) return { state: 'cancelled' }
  if (response.status !== 200) throw new Error('CRM_GOOGLE_EVENT_UNAVAILABLE')
  const data = await response.json()
  if (!data || typeof data !== 'object' || !('status' in data)) throw new Error('CRM_GOOGLE_EVENT_UNAVAILABLE')
  if (data.status === 'cancelled') return { state: 'cancelled' }
  const meetingUrl = 'hangoutLink' in data && typeof data.hangoutLink === 'string' &&
    /^https:\/\/meet\.google\.com\//.test(data.hangoutLink) ? data.hangoutLink : null
  return { state: 'active', meetingUrl }
}

export type GoogleInsert = (path: string, body: unknown) => Promise<{ status: number; json: unknown }>

/**
 * Criação do evento do agendamento (testável sem credenciais). Com participante: sendUpdates=all.
 * Se o Google RECUSAR o evento com participante (403), repete UMA vez sem participante — o id do evento é fixo,
 * então nunca há dois eventos nem dois Meet, e a reunião não trava por causa do convite. Qualquer outra falha
 * (inclusive 409: evento com esse id já existe) = não confirmado, para revisão manual (sem convite duplicado).
 */
export async function insertBookingEvent(
  insert: GoogleInsert, calendarId: string, input: BookingEventInput,
  onRetry?: (status: number) => void,
): Promise<ParsedCreatedEvent> {
  let effective = input
  let req = buildBookingEventRequest(calendarId, effective)
  let result = await insert(req.path, req.body)
  if (result.status === 403 && input.attendeeEmail) {
    onRetry?.(result.status)
    effective = { ...input, attendeeEmail: null }
    req = buildBookingEventRequest(calendarId, effective)
    result = await insert(req.path, req.body)
  }
  if (result.status < 200 || result.status >= 300) throw new Error('CRM_GOOGLE_CALENDAR_UNAVAILABLE')
  return parseCreatedEvent(result.json, effective.attendeeEmail)
}
