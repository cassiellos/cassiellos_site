import { parseBrazilianWhatsapp, whatsappLink, type BrazilianPhone } from './whatsapp'

/**
 * Mensagem de confirmação da reunião para o cliente, enviada MANUALMENTE pelo administrador
 * (o botão só abre o WhatsApp com o texto pronto). Sem dependências de servidor: roda no navegador.
 */

export const DEFAULT_WHATSAPP_TEMPLATE = [
  'Olá, {primeiro_nome}! Tudo bem?',
  '',
  'Sua reunião com a Cassiellos está confirmada para {data}, às {horario}.',
  '',
  'Este é o link da nossa reunião:',
  '{link_meet}',
  '',
  'Até lá! 🦈',
].join('\n')

export const WHATSAPP_TEMPLATE_LIMIT = 600

export const WHATSAPP_VARIABLES = [
  { name: 'nome', description: 'Nome completo informado no formulário' },
  { name: 'primeiro_nome', description: 'Primeiro nome' },
  { name: 'empresa', description: 'Empresa / clínica' },
  { name: 'data', description: 'Data da reunião (dd/mm/aaaa)' },
  { name: 'dia_semana', description: 'Dia da semana' },
  { name: 'horario', description: 'Horário de início (Brasília)' },
  { name: 'horario_fim', description: 'Horário de término (Brasília)' },
  { name: 'link_meet', description: 'Link do Google Meet' },
  { name: 'reuniao', description: 'Nome da reunião' },
] as const

export type WhatsappVariable = typeof WHATSAPP_VARIABLES[number]['name']
const KNOWN = new Set<string>(WHATSAPP_VARIABLES.map(v => v.name))
const PLACEHOLDER = /\{([a-z_]+)\}/g

/** Remove caracteres de controle e de direção de texto (exceto quebra de linha) e limita o tamanho. */
export function cleanText(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '')
    .trim().slice(0, max)
}

export type TemplateCheck = { ok: true; value: string } |
  { ok: false; error: 'TEMPLATE_EMPTY' | 'TEMPLATE_TOO_LONG' | 'TEMPLATE_UNKNOWN_VARIABLE'; detail?: string }

export function validateWhatsappTemplate(raw: unknown): TemplateCheck {
  if (typeof raw !== 'string') return { ok: false, error: 'TEMPLATE_EMPTY' }
  const normalized = raw.replace(/\r\n?/g, '\n')
  if (normalized.length > WHATSAPP_TEMPLATE_LIMIT) return { ok: false, error: 'TEMPLATE_TOO_LONG' }
  const value = cleanText(normalized, WHATSAPP_TEMPLATE_LIMIT)
  if (!value) return { ok: false, error: 'TEMPLATE_EMPTY' }
  for (const match of value.matchAll(PLACEHOLDER)) {
    if (!KNOWN.has(match[1])) return { ok: false, error: 'TEMPLATE_UNKNOWN_VARIABLE', detail: match[1].slice(0, 30) }
  }
  return { ok: true, value }
}

const TZ = 'America/Sao_Paulo'
const dateFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric' })
const timeFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const weekdayFmt = new Intl.DateTimeFormat('pt-BR', { timeZone: TZ, weekday: 'long' })

export type MeetingForMessage = {
  name: string | null
  company: string | null
  startsAt: string | Date
  endsAt: string | Date
  meetingUrl: string | null
  meetingName: string
}

export const MEET_PENDING_TEXT = '[link do Meet pendente]'

export function messageValues(m: MeetingForMessage): Record<WhatsappVariable, string> {
  const name = cleanText(m.name, 120)
  const start = new Date(m.startsAt)
  const end = new Date(m.endsAt)
  return {
    nome: name || 'cliente',
    primeiro_nome: name ? name.split(/\s+/)[0] : 'cliente',
    empresa: cleanText(m.company, 120),
    data: dateFmt.format(start),
    dia_semana: weekdayFmt.format(start),
    horario: timeFmt.format(start),
    horario_fim: timeFmt.format(end),
    link_meet: m.meetingUrl || MEET_PENDING_TEXT,
    reuniao: cleanText(m.meetingName, 120) || 'Reunião Cassiellos',
  }
}

export function renderWhatsappMessage(template: string, m: MeetingForMessage): string {
  const values = messageValues(m)
  return template.replace(PLACEHOLDER, (whole, key: string) => KNOWN.has(key) ? values[key as WhatsappVariable] : whole)
}

/** Link wa.me pronto (número E.164 + texto codificado) ou motivo da indisponibilidade. */
export function whatsappSendLink(whatsapp: string | null, text: string):
  { ok: true; url: string; phone: BrazilianPhone } | { ok: false; reason: 'INVALID_WHATSAPP' | 'TEXT_TOO_LONG' | 'EMPTY_TEXT' } {
  const phone = parseBrazilianWhatsapp(whatsapp)
  if (!phone) return { ok: false, reason: 'INVALID_WHATSAPP' }
  const clean = cleanText(text, 2000)
  if (!clean) return { ok: false, reason: 'EMPTY_TEXT' }
  const url = whatsappLink(phone, clean)
  return url ? { ok: true, url, phone } : { ok: false, reason: 'TEXT_TOO_LONG' }
}
