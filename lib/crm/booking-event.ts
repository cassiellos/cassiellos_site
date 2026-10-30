import { CRM_BOOKING_TIME_ZONE } from './booking-slots'

/**
 * Evento do Google Calendar para o agendamento público — SEM CONVIDADOS.
 *
 * - O e-mail informado pelo visitante não é adicionado ao evento: nenhum convite ou
 *   aviso automático do Google é enviado a um endereço cuja titularidade não foi verificada.
 * - `sendUpdates=none` garante, além disso, que a criação não dispare nenhum e-mail.
 * - O Google Meet continua sendo criado (conferenceData.createRequest, hangoutsMeet).
 * - Título e descrição não levam nome, e-mail ou telefone do lead: só o nome da reunião
 *   e uma referência interna (prefixo do id da reserva) para a equipe localizar no CRM.
 */

export type BookingEventInput = {
  title: string
  startAt: string
  endAt: string
  requestId: string
  googleEventId: string
  /** Referência interna não pessoal (ex.: prefixo do id da reserva). */
  reference: string
}

const MEET_URL = /^https:\/\/meet\.google\.com\/[a-z0-9-]{3,64}(?:\?[^\s]*)?$/i
const REFERENCE = /^[a-z0-9]{4,32}$/i

export function bookingEventDescription(reference: string): string {
  if (!REFERENCE.test(reference)) throw new Error('CRM_BOOKING_REFERENCE_INVALID')
  return 'Diagnóstico estratégico Cassiellos (agendamento online).\n' +
    'Referência no Mini CRM: ' + reference + '\n' +
    'Sem convidados no evento: o link do Google Meet foi exibido ao visitante na confirmação.'
}

/** Caminho e corpo da requisição de criação (sem attendees, sem envio de e-mail). */
export function buildBookingEventRequest(calendarId: string, input: BookingEventInput): { path: string; body: Record<string, unknown> } {
  return {
    path: 'calendars/' + encodeURIComponent(calendarId) + '/events?sendUpdates=none&conferenceDataVersion=1',
    body: {
      id: input.googleEventId,
      summary: input.title,
      description: bookingEventDescription(input.reference),
      start: { dateTime: input.startAt, timeZone: CRM_BOOKING_TIME_ZONE },
      end: { dateTime: input.endAt, timeZone: CRM_BOOKING_TIME_ZONE },
      guestsCanInviteOthers: false,
      guestsCanSeeOtherGuests: false,
      conferenceData: {
        createRequest: { requestId: input.requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } },
      },
    },
  }
}

export type ParsedCreatedEvent = { id: string; meetingUrl: string | null; htmlLink: string | null }

/** Lê a resposta do Google. Sem id = evento não confirmado. Link do Meet só se for meet.google.com. */
export function parseCreatedEvent(result: unknown): ParsedCreatedEvent {
  if (!result || typeof result !== 'object' || !('id' in result) || typeof result.id !== 'string' || !result.id) {
    throw new Error('CRM_GOOGLE_EVENT_UNCONFIRMED')
  }
  const link = 'hangoutLink' in result && typeof result.hangoutLink === 'string' ? result.hangoutLink : ''
  const htmlLink = 'htmlLink' in result && typeof result.htmlLink === 'string' ? result.htmlLink : null
  return { id: result.id, meetingUrl: MEET_URL.test(link) ? link : null, htmlLink }
}

export function isGoogleMeetUrl(value: unknown): value is string {
  return typeof value === 'string' && MEET_URL.test(value)
}
