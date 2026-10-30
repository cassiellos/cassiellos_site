/**
 * "Adicionar à minha agenda" sem convite: gerado no navegador do visitante.
 * - Google Agenda: link de modelo (action=TEMPLATE). Abre a agenda do PRÓPRIO visitante para ele
 *   salvar; nada é enviado pela Cassiellos e nenhum convidado é incluído.
 * - Arquivo .ics (Apple, Outlook e outros): METHOD:PUBLISH, sem ORGANIZER e sem ATTENDEE,
 *   ou seja, é um compromisso pessoal e não um convite. Gerado localmente (Blob), sem rede.
 * Sem nome, e-mail ou telefone do visitante.
 */

export type CalendarEntry = {
  title: string
  startAt: string // ISO UTC
  endAt: string // ISO UTC
  meetUrl: string | null
  details?: string
}

const MEET_URL = /^https:\/\/meet\.google\.com\/[a-z0-9-]{3,64}(?:\?[^\s]*)?$/i

function utcStamp(iso: string): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) throw new Error('INVALID_DATE')
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
}

function safeMeet(url: string | null): string | null {
  return url && MEET_URL.test(url) ? url : null
}

function describe(entry: CalendarEntry): string {
  const meet = safeMeet(entry.meetUrl)
  return [entry.details ?? 'Reunião com a equipe Cassiellos.', meet ? 'Google Meet: ' + meet : '']
    .filter(Boolean).join('\n')
}

export function googleCalendarTemplateUrl(entry: CalendarEntry): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: entry.title,
    dates: utcStamp(entry.startAt) + '/' + utcStamp(entry.endAt),
    details: describe(entry),
    ctz: 'America/Sao_Paulo',
  })
  const meet = safeMeet(entry.meetUrl)
  if (meet) params.set('location', meet)
  return 'https://calendar.google.com/calendar/render?' + params.toString()
}

function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

/** Dobra linhas longas em 75 octetos (RFC 5545 §3.1). */
function fold(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= 75) return line
  const parts: string[] = []
  let current = ''
  let size = 0
  for (const char of line) {
    const n = new TextEncoder().encode(char).length
    if (size + n > (parts.length ? 74 : 75)) { parts.push(current); current = ''; size = 0 }
    current += char; size += n
  }
  parts.push(current)
  return parts.join('\r\n ')
}

export function buildIcs(entry: CalendarEntry & { uid: string; now?: Date }): string {
  const meet = safeMeet(entry.meetUrl)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cassiellos//Agendamento//PT-BR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:' + entry.uid.replace(/[^A-Za-z0-9@._-]/g, '') + '@agendamento.cassiellos.com.br',
    'DTSTAMP:' + utcStamp((entry.now ?? new Date()).toISOString()),
    'DTSTART:' + utcStamp(entry.startAt),
    'DTEND:' + utcStamp(entry.endAt),
    'SUMMARY:' + escapeText(entry.title),
    'DESCRIPTION:' + escapeText(describe(entry)),
    ...(meet ? ['LOCATION:' + escapeText(meet), 'URL:' + meet] : []),
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'DESCRIPTION:' + escapeText(entry.title),
    'TRIGGER:-PT30M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(fold).join('\r\n') + '\r\n'
}
