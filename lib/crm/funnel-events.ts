/**
 * Eventos do funil de agendamento (/agendar) — módulo puro (sem navegador), testável.
 *
 * Regras:
 * - Nenhum dado pessoal: só nomes de etapa (nunca respostas), códigos de erro e estados. Valores fora da lista
 *   permitida, com "@", espaços, barras ou sequências longas de dígitos são descartados.
 * - Cada evento tem uma chave de deduplicação: o mesmo marco não é contado duas vezes em atualização da página,
 *   nova tentativa ou resposta idempotente do servidor.
 * - `mode`: "test" para o ambiente de testes e e-mails de teste; só "live" pode ser tratado como conversão real.
 * - Reunião confirmada só com confirmação real do backend.
 */
export const FUNNEL_EVENTS = [
  'booking_form_view',
  'booking_form_start',
  'booking_step_completed',
  'booking_form_submit',
  'booking_lead_registered',
  'booking_slot_selected',
  'booking_meeting_confirmed',
  'booking_form_error',
] as const
export type FunnelEventName = typeof FUNNEL_EVENTS[number]
export type FunnelMode = 'test' | 'live'

export type FunnelProps = {
  form: string
  mode: FunnelMode
  step?: string
  step_index?: number
  stage?: 'question' | 'lead' | 'availability' | 'confirm'
  code?: string
  state?: 'confirmed' | 'link_pending'
  days_ahead?: number
}

const SAFE_TOKEN = /^[a-z0-9][a-z0-9_:-]{0,63}$/i
const LONG_DIGITS = /\d{6,}/
const STAGES = new Set(['question', 'lead', 'availability', 'confirm'])
const STATES = new Set(['confirmed', 'link_pending'])

function safeToken(value: unknown): string | null {
  if (typeof value !== 'string' || !SAFE_TOKEN.test(value) || LONG_DIGITS.test(value)) return null
  return value
}

function safeInt(value: unknown, max: number): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : null
}

export function isFunnelEvent(name: unknown): name is FunnelEventName {
  return typeof name === 'string' && (FUNNEL_EVENTS as readonly string[]).includes(name)
}

/** Propriedades permitidas, já higienizadas. null = evento descartado (formulário ou modo inválido). */
export function sanitizeFunnelProps(input: Record<string, unknown>): FunnelProps | null {
  const form = safeToken(input.form)
  const mode = input.mode === 'live' ? 'live' : input.mode === 'test' ? 'test' : null
  if (!form || !mode) return null
  const props: FunnelProps = { form, mode }
  const step = safeToken(input.step)
  if (step) props.step = step
  const stepIndex = safeInt(input.step_index, 50)
  if (stepIndex !== null) props.step_index = stepIndex
  if (typeof input.stage === 'string' && STAGES.has(input.stage)) props.stage = input.stage as FunnelProps['stage']
  const code = safeToken(input.code)
  if (code) props.code = code.toUpperCase()
  if (typeof input.state === 'string' && STATES.has(input.state)) props.state = input.state as FunnelProps['state']
  const daysAhead = safeInt(input.days_ahead, 30)
  if (daysAhead !== null) props.days_ahead = daysAhead
  return props
}

/** Resumo curto e não reversível de um identificador interno (a chave guardada no navegador não expõe o id). */
export function shortHash(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/**
 * Chave de deduplicação por marco (escopo: a sessão da aba).
 * - visualização e início: uma vez por formulário;
 * - etapa concluída: uma vez por etapa;
 * - envio: uma vez por chave de idempotência do envio;
 * - lead registrado: uma vez por lead (atualização + reenvio do mesmo contato não conta de novo);
 * - horário escolhido: uma vez por horário;
 * - reunião confirmada: uma vez por reunião (repetição idempotente "alreadyConfirmed" não conta de novo);
 * - erro: uma vez por etapa + código.
 */
export function funnelDedupeKey(name: FunnelEventName, props: FunnelProps, ref?: string | null): string | null {
  const base = name + ':' + props.form
  switch (name) {
    case 'booking_form_view':
    case 'booking_form_start':
      return base
    case 'booking_step_completed':
      return props.step ? base + ':' + props.step : null
    case 'booking_form_submit':
    case 'booking_lead_registered':
    case 'booking_meeting_confirmed':
    case 'booking_slot_selected':
      return ref ? base + ':' + shortHash(ref) : null
    case 'booking_form_error':
      return base + ':' + (props.stage ?? 'unknown') + ':' + (props.code ?? 'UNKNOWN')
  }
}

/**
 * Modo do evento. "live" só quando o ambiente está em modo real (CRM_BOOKING_MODE=live) SEM allowlist de teste;
 * a classificação final de cada lead continua no servidor (is_test).
 */
export function funnelModeFor(input: { bookingMode: string; allowlistActive: boolean }): FunnelMode {
  return input.bookingMode === 'live' && !input.allowlistActive ? 'live' : 'test'
}

/** Dias corridos entre hoje e a data escolhida (sem horário nem data exata no evento). */
export function daysAhead(today: string, day: string): number | null {
  const from = Date.parse(today + 'T12:00:00Z')
  const to = Date.parse(day + 'T12:00:00Z')
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) return null
  return Math.round((to - from) / 86_400_000)
}
