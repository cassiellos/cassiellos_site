import 'server-only'

import type { BusyInterval } from '@/lib/crm/booking-slots'
import { CRM_BOOKING_TIME_ZONE } from '@/lib/crm/booking-slots'
import { getGoogleRefreshToken, googleOAuthConfig } from '@/lib/crm/google-oauth'

/**
 * Adaptador de servidor: Google Calendar API <-> Cassiellos.
 * A conexão ocorre no backend Next.js, nunca diretamente no Neon ou no browser.
 * Exige OAuth offline; o refresh token fica cifrado em crm.integration_credentials.
 * Os tokens jamais são retornados ao cliente ou registrados em logs.
 */
type Credentials = {
  clientId: string
  clientSecret: string
  refreshToken: string
  calendarId: string
}

async function credentials(): Promise<Credentials | null> {
  const config = googleOAuthConfig()
  if (!config) return null
  const refreshToken = await getGoogleRefreshToken()
  if (!refreshToken) return null
  return { ...config, refreshToken }
}

export async function isGoogleCalendarConfigured(): Promise<boolean> {
  return Boolean(await credentials())
}

async function googleAccessToken(config: Credentials): Promise<string> {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: 'refresh_token',
  })
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body,
    cache: 'no-store',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) throw new Error('CRM_GOOGLE_TOKEN_UNAVAILABLE')
  const data: unknown = await response.json()
  if (typeof data !== 'object' || !data || !('access_token' in data) ||
      typeof data.access_token !== 'string' || !data.access_token) {
    throw new Error('CRM_GOOGLE_TOKEN_UNAVAILABLE')
  }
  return data.access_token
}

async function calendarRequest(
  config: Credentials,
  endpoint: string,
  body: unknown,
): Promise<unknown> {
  const token = await googleAccessToken(config)
  const response = await fetch('https://www.googleapis.com/calendar/v3/' + endpoint, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8_000),
  })
  if (!response.ok) throw new Error('CRM_GOOGLE_CALENDAR_UNAVAILABLE')
  return response.json()
}

function nextDate(date: string): string {
  const day = new Date(date + 'T12:00:00Z')
  day.setUTCDate(day.getUTCDate() + 1)
  return day.toISOString().slice(0, 10)
}

/** Apenas períodos ocupados: não retorna título, participantes ou outros dados privados. */
export async function readGoogleBusyIntervals(date: string): Promise<BusyInterval[]> {
  const config = await credentials()
  if (!config) throw new Error('CRM_GOOGLE_NOT_CONFIGURED')
  const response = await calendarRequest(config, 'freeBusy', {
    timeMin: date + 'T00:00:00-03:00',
    timeMax: nextDate(date) + 'T00:00:00-03:00',
    timeZone: CRM_BOOKING_TIME_ZONE,
    items: [{ id: config.calendarId }],
  })
  if (!response || typeof response !== 'object' || !('calendars' in response)) {
    throw new Error('CRM_GOOGLE_CALENDAR_UNAVAILABLE')
  }
  const calendars = response.calendars
  if (!calendars || typeof calendars !== 'object') {
    throw new Error('CRM_GOOGLE_CALENDAR_UNAVAILABLE')
  }
  const result = (calendars as Record<string, unknown>)[config.calendarId]
  if (!result || typeof result !== 'object' || !('busy' in result)) {
    throw new Error('CRM_GOOGLE_CALENDAR_UNAVAILABLE')
  }
  if ('errors' in result && Array.isArray(result.errors) && result.errors.length) {
    throw new Error('CRM_GOOGLE_CALENDAR_UNAVAILABLE')
  }
  const busy = result.busy
  if (!Array.isArray(busy)) throw new Error('CRM_GOOGLE_CALENDAR_UNAVAILABLE')
  return busy.filter((item): item is BusyInterval =>
    item !== null && typeof item === 'object' &&
    typeof item.start === 'string' && typeof item.end === 'string')
}

export type GoogleCreatedEvent = {
  id: string
  meetingUrl: string | null
  htmlLink: string | null
}

/**
 * Criar convite e solicitar link Google Meet. Reservado para o fluxo transacional
 * de agendamento, a ser ativado depois da conexão OAuth e deduplicação no Neon.
 */
export async function createGoogleBooking(input: {
  title: string
  description: string
  startAt: string
  endAt: string
  guestEmail: string
  requestId: string
}): Promise<GoogleCreatedEvent> {
  const config = await credentials()
  if (!config) throw new Error('CRM_GOOGLE_NOT_CONFIGURED')
  const endpoint = 'calendars/' + encodeURIComponent(config.calendarId) +
    '/events?sendUpdates=all&conferenceDataVersion=1'
  const result = await calendarRequest(config, endpoint, {
    summary: input.title,
    description: input.description,
    start: { dateTime: input.startAt, timeZone: CRM_BOOKING_TIME_ZONE },
    end: { dateTime: input.endAt, timeZone: CRM_BOOKING_TIME_ZONE },
    attendees: [{ email: input.guestEmail }],
    conferenceData: {
      createRequest: {
        requestId: input.requestId,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
  })
  if (!result || typeof result !== 'object' || !('id' in result) ||
      typeof result.id !== 'string') {
    throw new Error('CRM_GOOGLE_EVENT_UNCONFIRMED')
  }
  const meetingUrl = 'hangoutLink' in result && typeof result.hangoutLink === 'string'
    ? result.hangoutLink : null
  const htmlLink = 'htmlLink' in result && typeof result.htmlLink === 'string'
    ? result.htmlLink : null
  return { id: result.id, meetingUrl, htmlLink }
}
