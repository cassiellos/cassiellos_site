import { CRM_BOOKING_TIME_ZONE } from './booking-slots'

/**
 * Evento do Google Calendar para o agendamento público.
 *
 * - UM evento por reserva, criado na agenda da Cassiellos com Google Meet (conferenceData.createRequest,
 *   hangoutsMeet) e id fixo derivado da reserva: repetir a criação nunca gera segundo evento nem segundo Meet.
 * - CONVITE: quando habilitado, o e-mail informado pelo lead entra como ÚNICO participante e a criação usa
 *   sendUpdates=all — o próprio Google envia o convite (com o botão do Meet) e, depois, avisos de alteração/cancelamento.
 *   Desligado (attendeeEmail ausente) = comportamento anterior: sem participantes e sendUpdates=none.
 * - Conteúdo fixo, sem texto digitado pelo visitante (nome, clínica, respostas): o convite não pode ser usado para
 *   levar conteúdo arbitrário a terceiros. Só título, data/horário de Brasília, duração e Agência Cassiellos (a
 *   referência do agendamento só aparece em evento SEM convidado, interno).
 * - Participante não vê outros convidados, não convida outros e não altera o evento.
 */

export type BookingEventInput = {
  title: string
  startAt: string
  endAt: string
  requestId: string
  googleEventId: string
  /** Referência interna não pessoal (ex.: prefixo do id da reserva). */
  reference: string
  /** E-mail do lead a convidar. Ausente/null = evento sem participantes e sem e-mail (sendUpdates=none). */
  attendeeEmail?: string | null
}

const MEET_URL = /^https:\/\/meet\.google\.com\/[a-z0-9-]{3,64}(?:\?[^\s]*)?$/i
const REFERENCE = /^[a-z0-9]{4,32}$/i
const EMAIL = /^[^\s@<>"(),;:]{1,64}@[a-z0-9.-]{1,253}\.[a-z]{2,}$/i

export const BOOKING_ORGANIZER_NAME = 'Agência Cassiellos'

const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: CRM_BOOKING_TIME_ZONE, weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })
const shortDateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: CRM_BOOKING_TIME_ZONE, day: '2-digit', month: '2-digit' })
const timePartsFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: CRM_BOOKING_TIME_ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })

function validTimes(startAt: string, endAt: string): { start: Date; end: Date; minutes: number } {
  const start = new Date(startAt)
  const end = new Date(endAt)
  const minutes = Math.round((end.getTime() - start.getTime()) / 60_000)
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('CRM_BOOKING_TIME_INVALID')
  return { start, end, minutes }
}

/** Hora no formato brasileiro curto, em Brasília: 09h, 09h30, 14h05. */
export function bookingHour(date: Date): string {
  const parts = timePartsFmt.formatToParts(date)
  const hour = parts.find(p => p.type === 'hour')?.value ?? '00'
  const minute = parts.find(p => p.type === 'minute')?.value ?? '00'
  return hour + 'h' + (minute === '00' ? '' : minute)
}

/**
 * Título do convite (aparece primeiro nas notificações do celular): marca + confirmação + data/hora reais em
 * Brasília. Ex.: "Agência Cassiellos | Reunião confirmada — 06/11 às 09h".
 */
export function bookingEventTitle(startAt: string): string {
  const start = new Date(startAt)
  if (!Number.isFinite(start.getTime())) throw new Error('CRM_BOOKING_TIME_INVALID')
  return BOOKING_ORGANIZER_NAME + ' | Reunião confirmada — ' + shortDateFmt.format(start) + ' às ' + bookingHour(start)
}

/**
 * Descrição curta, só em português e sem dados internos para o convidado. A referência do agendamento só entra
 * quando NÃO há convidado (evento interno da agenda da Cassiellos, usado na conciliação).
 */
export function bookingEventDescription(input: { reference: string; startAt: string; endAt: string; invited: boolean }): string {
  if (!REFERENCE.test(input.reference)) throw new Error('CRM_BOOKING_REFERENCE_INVALID')
  const { start, end, minutes } = validTimes(input.startAt, input.endAt)
  return [
    'Reunião confirmada com a ' + BOOKING_ORGANIZER_NAME + '.',
    '',
    'Data: ' + dateFmt.format(start),
    'Horário: ' + bookingHour(start) + ' às ' + bookingHour(end) + ' — Brasília',
    'Duração: ' + minutes + ' minutos',
    '',
    'Acesse a reunião pelo link do Google Meet disponível neste convite.',
    ...(input.invited ? [] : ['', 'Referência do agendamento: ' + input.reference]),
  ].join('\n')
}

export function isInvitableEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 254 && EMAIL.test(value)
}

/** Caminho e corpo da requisição de criação. Com convidado: sendUpdates=all; sem: nenhum e-mail. */
export function buildBookingEventRequest(calendarId: string, input: BookingEventInput): { path: string; body: Record<string, unknown> } {
  const attendee = input.attendeeEmail?.trim().toLowerCase() || null
  if (attendee !== null && !isInvitableEmail(attendee)) throw new Error('CRM_BOOKING_ATTENDEE_INVALID')
  const invited = attendee !== null
  return {
    path: 'calendars/' + encodeURIComponent(calendarId) + '/events?sendUpdates=' + (invited ? 'all' : 'none') + '&conferenceDataVersion=1',
    body: {
      id: input.googleEventId,
      summary: input.title,
      description: bookingEventDescription({ reference: input.reference, startAt: input.startAt, endAt: input.endAt, invited }),
      start: { dateTime: input.startAt, timeZone: CRM_BOOKING_TIME_ZONE },
      end: { dateTime: input.endAt, timeZone: CRM_BOOKING_TIME_ZONE },
      ...(invited ? { attendees: [{ email: attendee }] } : {}),
      guestsCanInviteOthers: false,
      guestsCanSeeOtherGuests: false,
      guestsCanModify: false,
      conferenceData: {
        createRequest: { requestId: input.requestId, conferenceSolutionKey: { type: 'hangoutsMeet' } },
      },
    },
  }
}

export type ParsedCreatedEvent = {
  id: string; meetingUrl: string | null; htmlLink: string | null
  /** O Google aceitou o evento COM o participante e sendUpdates=all. NÃO significa convite entregue nem aceito. */
  invitationRequested: boolean
}

/** Lê a resposta do Google. Sem id = evento não confirmado. Link do Meet só se for meet.google.com. */
export function parseCreatedEvent(result: unknown, attendeeEmail?: string | null): ParsedCreatedEvent {
  if (!result || typeof result !== 'object' || !('id' in result) || typeof result.id !== 'string' || !result.id) {
    throw new Error('CRM_GOOGLE_EVENT_UNCONFIRMED')
  }
  const link = 'hangoutLink' in result && typeof result.hangoutLink === 'string' ? result.hangoutLink : ''
  const htmlLink = 'htmlLink' in result && typeof result.htmlLink === 'string' ? result.htmlLink : null
  const wanted = attendeeEmail?.trim().toLowerCase() || null
  const attendees = 'attendees' in result && Array.isArray(result.attendees) ? result.attendees as unknown[] : []
  const invitationRequested = wanted !== null && attendees.some(a =>
    !!a && typeof a === 'object' && 'email' in a && typeof a.email === 'string' && a.email.toLowerCase() === wanted)
  return { id: result.id, meetingUrl: MEET_URL.test(link) ? link : null, htmlLink, invitationRequested }
}

export function isGoogleMeetUrl(value: unknown): value is string {
  return typeof value === 'string' && MEET_URL.test(value)
}
