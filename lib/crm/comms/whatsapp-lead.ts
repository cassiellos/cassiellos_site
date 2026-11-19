import { whatsappLink, type BrazilianPhone } from '../whatsapp'
import { isPublicReference } from './reference'
import { wallClock } from './sao-paulo'

/**
 * Modo A — o LEAD abre a conversa com a Cassiellos. Não envia mensagem automaticamente.
 *
 * O servidor usa a data/hora REAL da reunião associada à sessão de agendamento, não
 * dados fornecidos pelo navegador. Tudo é convertido para America/Sao_Paulo, inclusive
 * as comparações "hoje"/"amanhã", de modo que a virada de dia em UTC não confunda o lead.
 *
 * A URL pública contém só o dia/horário e uma referência opaca, sem nome, e-mail,
 * telefone pessoal, link do Meet ou id de banco. A pessoa confirma o texto no WhatsApp.
 */

export const LEAD_MESSAGE_PREFIX = 'Olá! Passando para confirmar nossa reunião '

/** Sem webhook oficial, um link ou clique não prova que o lead enviou a mensagem. */
export const STATUS_AWAITING_LEAD = 'awaiting_lead' as const

const DAY_MS = 24 * 60 * 60 * 1000
const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Texto enviado por iniciativa do lead, com o horário do agendamento em Brasília.
 * Ex.: em 19/11, reunião 20/11 às 17h -> "amanhã às 17 horas".
 * Recalcula o relativo na hora de criar o link, jamais na hora de criar o formulário.
 */
export function leadWhatsappMessage(reference: string, startAt: string, now: Date = new Date()): string | null {
  if (!isPublicReference(reference)) return null
  const start = new Date(startAt)
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(now.getTime())) return null

  const meeting = wallClock(start)
  const today = wallClock(now)
  const meetingDay = Date.UTC(meeting.year, meeting.month - 1, meeting.day)
  const todayDay = Date.UTC(today.year, today.month - 1, today.day)
  const daysAhead = Math.round((meetingDay - todayDay) / DAY_MS)
  const when = daysAhead === 0 ? 'hoje' : daysAhead === 1 ? 'amanhã' :
    'no dia ' + pad(meeting.day) + '/' + pad(meeting.month) + '/' + meeting.year
  const oneOclock = meeting.hour === 1 && meeting.minute === 0
  const preposition = oneOclock ? 'à' : 'às'
  const time = meeting.minute === 0
    ? meeting.hour + (oneOclock ? ' hora' : ' horas')
    : meeting.hour + 'h' + pad(meeting.minute)

  return LEAD_MESSAGE_PREFIX + when + ' ' + preposition + ' ' + time + '. Referência: ' + reference + '.'
}

/** Extrai a referência de uma mensagem recebida (Modo B), independentemente do restante do texto. */
export function referenceFromIncomingMessage(body: unknown): string | null {
  if (typeof body !== 'string' || body.length > 4_000) return null
  const match = body.toLowerCase().match(/refer[êe]ncia:?\s*([a-hjkmnp-z2-9]{10})\b/)
  return match && isPublicReference(match[1]) ? match[1] : null
}

export type LeadWhatsappLink =
  | { ok: true; url: string; reference: string }
  | { ok: false; reason: 'BUSINESS_NUMBER_UNAVAILABLE' | 'INVALID_REFERENCE' | 'INVALID_MEETING_DATE' | 'LINK_TOO_LONG' }

export function buildLeadWhatsappLink(
  businessPhone: BrazilianPhone | null, reference: string, startAt: string, now: Date = new Date(),
): LeadWhatsappLink {
  if (!businessPhone) return { ok: false, reason: 'BUSINESS_NUMBER_UNAVAILABLE' }
  if (!isPublicReference(reference)) return { ok: false, reason: 'INVALID_REFERENCE' }
  const text = leadWhatsappMessage(reference, startAt, now)
  if (!text) return { ok: false, reason: 'INVALID_MEETING_DATE' }
  const url = whatsappLink(businessPhone, text)
  return url ? { ok: true, url, reference } : { ok: false, reason: 'LINK_TOO_LONG' }
}
