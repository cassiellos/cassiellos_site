/**
 * Contrato de eventos do funil de formulário (dataLayer → GTM → GA4) — módulo puro, testável, sem navegador.
 *
 * Regras (missão de mensuração, 24/11/2026):
 * - Nenhum dado pessoal: nunca respostas, texto digitado, nome, e-mail, telefone, datas/horários escolhidos ou links.
 *   Só identificadores técnicos de etapa, códigos de erro e o modo do ambiente. Qualquer valor fora da lista permitida,
 *   com "@", espaços, barras ou sequência longa de dígitos é descartado.
 * - Só os parâmetros desta lista existem: form_id, form_version, step_id, step_index, step_order, step_type, funnel_stage,
 *   flow_variant, validation_error_code, environment_mode.
 * - `generate_lead` e `booking_meeting_confirmed` só existem DEPOIS da confirmação positiva do servidor.
 * - Cada marco tem chave de deduplicação (escopo: a aba): atualização da página, reenvio ou resposta idempotente do
 *   servidor não contam duas vezes.
 * - `environment_mode`: "live" (visitante real), "test" (ambiente de testes, e-mail de teste) e "preview" (prévia do
 *   painel administrativo — nunca emite). A classificação final de cada lead continua no servidor (`crm.leads.is_test`).
 * - Tempo entre etapas NÃO é enviado como parâmetro: o GA4 já registra o horário de cada evento e calcula o intervalo
 *   de forma agregada nas explorações. Abandono = diferença entre etapas observadas por sessão única (sem beforeunload).
 */
import { shortHash, type FunnelEventName } from '../crm/funnel-events'

export const TRACKING_EVENTS = [
  // ENTRADA (page_view é automático da tag do Google, não é emitido aqui)
  'form_view',
  'form_start',
  'form_cover_cta_click',
  // PERGUNTAS
  'form_step_view',
  'form_step_complete',
  'form_step_back',
  'form_validation_error',
  // CAPTAÇÃO
  'lead_submit_attempt',
  'generate_lead',
  'lead_submit_error',
  // CALENDÁRIO
  'booking_calendar_view',
  'booking_calendar_load_error',
  'booking_date_selected',
  'booking_slots_loaded',
  'booking_no_slots',
  'booking_slot_selected',
  // CONCLUSÃO
  'booking_submit_attempt',
  'booking_meeting_confirmed',
  'booking_confirmation_error',
] as const
export type TrackingEventName = typeof TRACKING_EVENTS[number]

export type TrackingMode = 'live' | 'test' | 'preview'
export type StepType = 'cover' | 'question' | 'contact' | 'calendar' | 'result'
export type FunnelStage = 'entry' | 'questions' | 'capture' | 'calendar' | 'conclusion'
export type FlowVariant = 'cover' | 'plain'

export type TrackingParams = {
  form_id: string
  environment_mode: TrackingMode
  form_version?: string
  step_id?: string
  step_index?: number
  /** Ordem fixa da etapa no desenho do fluxo (igual para todos os visitantes, mesmo com ramificações). */
  step_order?: number
  step_type?: StepType
  funnel_stage?: FunnelStage
  flow_variant?: FlowVariant
  validation_error_code?: string
}

/**
 * Parâmetros OPCIONAIS do contrato (tudo além de `form_id` e `environment_mode`, que todo evento traz).
 * O dataLayer do GTM é um modelo de dados que MESCLA cada push: o que um evento não repete continua valendo no
 * evento seguinte (um erro de validação "vazava" para o lead; o `step_id` de uma pergunta, para o calendário).
 * Por isso todo push reinicializa TODAS estas chaves (F1); a lista é a única fonte e é conferida por teste contra o tipo.
 */
export const OPTIONAL_TRACKING_PARAM_KEYS = [
  'form_version', 'step_id', 'step_index', 'step_order', 'step_type', 'funnel_stage', 'flow_variant', 'validation_error_code',
] as const satisfies readonly (keyof TrackingParams)[]

/**
 * Objeto empurrado ao dataLayer: `event` + os parâmetros pertinentes + `undefined` explícito em cada parâmetro opcional
 * que ESTE evento não tem. No modelo do GTM, `undefined` apaga o valor herdado; a tag do GA4 omite parâmetro indefinido.
 */
export function toDataLayerEvent(name: TrackingEventName, params: TrackingParams): Record<string, unknown> {
  const reset: Record<string, undefined> = {}
  for (const key of OPTIONAL_TRACKING_PARAM_KEYS) reset[key] = undefined
  return { event: name, ...reset, ...params }
}

/** Etapa do funil de cada evento quando quem chama não informa outra (etapas de pergunta × contato). */
export const DEFAULT_FUNNEL_STAGE: Record<TrackingEventName, FunnelStage> = {
  form_view: 'entry',
  form_start: 'entry',
  form_cover_cta_click: 'entry',
  form_step_view: 'questions',
  form_step_complete: 'questions',
  form_step_back: 'questions',
  form_validation_error: 'questions',
  lead_submit_attempt: 'capture',
  generate_lead: 'capture',
  lead_submit_error: 'capture',
  booking_calendar_view: 'calendar',
  booking_calendar_load_error: 'calendar',
  booking_date_selected: 'calendar',
  booking_slots_loaded: 'calendar',
  booking_no_slots: 'calendar',
  booking_slot_selected: 'calendar',
  booking_submit_attempt: 'conclusion',
  booking_meeting_confirmed: 'conclusion',
  booking_confirmation_error: 'conclusion',
}

/**
 * ESCOPO EXCLUSIVO desta implantação (F2): só o formulário publicado em /formularios/hamburguerias mede e carrega o GTM.
 * Correspondência EXATA do slug canônico (o de `crm.form_flows.slug`, sem decodificar, sem maiúsculas/minúsculas, sem prefixo):
 * "hamburguerias-2", "hamburgueria", "Hamburguerias", "hamburguerias/x" ou "hamburguerias " ficam de fora.
 * Ampliar o escopo exige mudar esta lista (revisão de código) e nova autorização; nenhuma variável de ambiente o amplia.
 */
export const TRACKING_SCOPE_PATHS: readonly string[] = ['/formularios/hamburguerias']
const FORM_PATH_PREFIX = '/formularios/'

/** true somente para o slug cuja rota (`/formularios/<slug>`) é exatamente uma das rotas do escopo. */
export function isTrackingScopeForm(slug: unknown): boolean {
  return typeof slug === 'string' && slug.length > 0 && TRACKING_SCOPE_PATHS.includes(FORM_PATH_PREFIX + slug)
}

const SAFE_TOKEN = /^[a-z0-9][a-z0-9_:-]{0,63}$/i
const LONG_DIGITS = /\d{6,}/
const VERSION = /^v\d{1,4}$/
const MODES = new Set<string>(['live', 'test', 'preview'])
const STEP_TYPES = new Set<string>(['cover', 'question', 'contact', 'calendar', 'result'])
const STAGES = new Set<string>(['entry', 'questions', 'capture', 'calendar', 'conclusion'])
const VARIANTS = new Set<string>(['cover', 'plain'])

function safeToken(value: unknown): string | null {
  if (typeof value !== 'string' || !SAFE_TOKEN.test(value) || LONG_DIGITS.test(value)) return null
  return value
}

export function isTrackingEvent(name: unknown): name is TrackingEventName {
  return typeof name === 'string' && (TRACKING_EVENTS as readonly string[]).includes(name)
}

/** Parâmetros permitidos, já higienizados. null = evento descartado (formulário fora do escopo, ou formulário/modo inválido). */
export function sanitizeTrackingParams(input: Record<string, unknown>): TrackingParams | null {
  const formId = safeToken(input.form_id)
  if (!formId || !isTrackingScopeForm(formId)) return null
  const mode = typeof input.environment_mode === 'string' && MODES.has(input.environment_mode)
    ? input.environment_mode as TrackingMode : null
  if (!formId || !mode) return null
  const params: TrackingParams = { form_id: formId, environment_mode: mode }
  if (typeof input.form_version === 'string' && VERSION.test(input.form_version)) params.form_version = input.form_version
  const stepId = safeToken(input.step_id)
  if (stepId) params.step_id = stepId
  if (typeof input.step_index === 'number' && Number.isInteger(input.step_index) && input.step_index >= 0 && input.step_index <= 50) {
    params.step_index = input.step_index
  }
  if (typeof input.step_order === 'number' && Number.isInteger(input.step_order) && input.step_order >= 0 && input.step_order <= 50) {
    params.step_order = input.step_order
  }
  if (typeof input.step_type === 'string' && STEP_TYPES.has(input.step_type)) params.step_type = input.step_type as StepType
  if (typeof input.funnel_stage === 'string' && STAGES.has(input.funnel_stage)) params.funnel_stage = input.funnel_stage as FunnelStage
  if (typeof input.flow_variant === 'string' && VARIANTS.has(input.flow_variant)) params.flow_variant = input.flow_variant as FlowVariant
  const code = safeToken(input.validation_error_code)
  if (code) params.validation_error_code = code.toUpperCase()
  return params
}

/** Texto da versão publicada do fluxo ("v3"). */
export function formVersionLabel(version: unknown): string | undefined {
  return typeof version === 'number' && Number.isInteger(version) && version >= 0 && version <= 9999 ? 'v' + version : undefined
}

/**
 * Chave de deduplicação por marco (escopo: a sessão da aba). null = não pode ser deduplicado com segurança → descartado.
 * - entrada, calendário aberto e primeira data escolhida: uma vez por formulário;
 * - etapa vista, concluída ou revisitada: uma vez por etapa;
 * - validação: uma vez por etapa + código; erros de envio/agenda: uma vez por código;
 * - envio, lead, horários, horário escolhido, tentativa e reunião: uma vez por referência (hash, nunca o valor).
 */
export function trackingDedupeKey(name: TrackingEventName, params: TrackingParams, ref?: string | null): string | null {
  const base = name + ':' + params.form_id
  switch (name) {
    case 'form_view':
    case 'form_start':
    case 'form_cover_cta_click':
    case 'booking_calendar_view':
    case 'booking_date_selected':
      return base
    case 'form_step_view':
    case 'form_step_complete':
    case 'form_step_back':
      return params.step_id ? base + ':' + params.step_id : null
    case 'form_validation_error':
      return base + ':' + (params.step_id ?? 'none') + ':' + (params.validation_error_code ?? 'UNKNOWN')
    case 'lead_submit_error':
    case 'booking_calendar_load_error':
    case 'booking_confirmation_error':
      return base + ':' + (params.validation_error_code ?? 'UNKNOWN')
    case 'lead_submit_attempt':
    case 'generate_lead':
    case 'booking_slots_loaded':
    case 'booking_no_slots':
    case 'booking_slot_selected':
    case 'booking_submit_attempt':
    case 'booking_meeting_confirmed':
      return ref ? base + ':' + shortHash(ref) : null
  }
}

// ── Mapeamento determinístico dos eventos já existentes do /agendar (lib/crm/funnel-events) ─────────────────────────
const LEGACY_STAGE_TO_FUNNEL_STAGE: Record<string, FunnelStage> = {
  question: 'questions', lead: 'capture', availability: 'calendar', confirm: 'conclusion',
}
const LEGACY_ERROR_EVENT: Record<string, TrackingEventName> = {
  question: 'form_validation_error',
  lead: 'lead_submit_error',
  availability: 'booking_calendar_load_error',
  confirm: 'booking_confirmation_error',
}
const LEGACY_EVENT: Record<Exclude<FunnelEventName, 'booking_form_error'>, TrackingEventName> = {
  booking_form_view: 'form_view',
  booking_form_start: 'form_start',
  booking_step_completed: 'form_step_complete',
  booking_form_submit: 'lead_submit_attempt',
  booking_lead_registered: 'generate_lead',
  booking_slot_selected: 'booking_slot_selected',
  booking_meeting_confirmed: 'booking_meeting_confirmed',
}

/**
 * Converte o detalhe do evento local `cassiellos:funnel` (já higienizado pelo emissor do /agendar) para o contrato do
 * dataLayer. Retorna null quando o evento não tem equivalente. Nada além dos parâmetros permitidos é copiado.
 */
export function mapLegacyFunnelEvent(detail: unknown): { name: TrackingEventName; params: TrackingParams } | null {
  if (!detail || typeof detail !== 'object') return null
  const raw = detail as Record<string, unknown>
  const legacyName = typeof raw.name === 'string' ? raw.name : ''
  const stage = typeof raw.stage === 'string' ? raw.stage : ''
  let name: TrackingEventName | undefined
  if (legacyName === 'booking_form_error') name = LEGACY_ERROR_EVENT[stage]
  else name = (LEGACY_EVENT as Record<string, TrackingEventName>)[legacyName]
  if (!name) return null
  const params = sanitizeTrackingParams({
    form_id: raw.form,
    environment_mode: raw.mode,
    step_id: raw.step,
    step_index: raw.step_index,
    step_order: raw.step_order,
    funnel_stage: LEGACY_STAGE_TO_FUNNEL_STAGE[stage] ?? DEFAULT_FUNNEL_STAGE[name],
    validation_error_code: raw.code,
  })
  return params ? { name, params } : null
}

type OrderableStep = { id: string; type: string; next?: string; branches?: { to: string }[] }

/**
 * Ordem fixa das etapas de um fluxo, calculada só com o desenho (ids), nunca com respostas:
 * profundidade a partir do início (menor caminho) e, em empate, a ordem em que a etapa foi declarada.
 * Assim "limited" (que pode ser alcançada de mais de uma pergunta) ocupa sempre a mesma posição no relatório,
 * enquanto `step_index` mostra a posição no caminho que o visitante realmente percorreu.
 */
export function flowStepOrder(start: string, steps: OrderableStep[]): Record<string, number> {
  const byId = new Map(steps.map((step, index) => [step.id, { step, index }]))
  const depth = new Map<string, number>()
  const queue: string[] = []
  if (byId.has(start)) { depth.set(start, 0); queue.push(start) }
  while (queue.length) {
    const id = queue.shift()!
    const entry = byId.get(id)!
    const targets = entry.step.type === 'question'
      ? [entry.step.next, ...(entry.step.branches ?? []).map(branch => branch.to)] : []
    for (const target of targets) {
      if (typeof target === 'string' && byId.has(target) && !depth.has(target)) {
        depth.set(target, depth.get(id)! + 1)
        queue.push(target)
      }
    }
  }
  const ranked = steps
    .map((step, index) => ({ id: step.id, depth: depth.get(step.id) ?? 1000, index }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index)
  const order: Record<string, number> = {}
  ranked.forEach((item, rank) => { order[item.id] = rank })
  return order
}
