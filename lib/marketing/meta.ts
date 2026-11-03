/**
 * Meta Pixel / Conversions API — configuração e regras compartilhadas (sem segredos).
 *
 * - Desligado por padrão: só liga com META_PIXEL_ENABLED=true E um META_PIXEL_ID válido.
 * - Somente as páginas públicas do funil listadas aqui carregam o Pixel; o CRM nunca.
 * - Nome do evento na Meta e event_id são os MESMOS no Pixel e na CAPI (deduplicação).
 * - O CRM mantém seus nomes internos; o mapeamento para a Meta fica centralizado aqui.
 */

import { CONSENT_COOKIE, parseConsent, readCookie } from '../privacy/consent'

/** Páginas públicas do funil (prefixos). Ajuste aqui, não espalhe pelo código. */
export const META_TRACKED_PATH_PREFIXES: readonly string[] = ['/agendar/']

export function isMetaTrackedPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  if (pathname.startsWith('/crm') || pathname.startsWith('/api')) return false
  return META_TRACKED_PATH_PREFIXES.some(prefix => pathname.startsWith(prefix))
}

export type MetaPixelConfig = { enabled: true; pixelId: string } | { enabled: false }

/** Lido no servidor (build/execução). Sem a chave ou com ID inválido: desligado. */
export function getMetaPixelConfig(env: Record<string, string | undefined> = process.env): MetaPixelConfig {
  const pixelId = env.META_PIXEL_ID?.trim() || ''
  if (env.META_PIXEL_ENABLED?.trim() !== 'true' || !/^\d{10,20}$/.test(pixelId)) return { enabled: false }
  return { enabled: true, pixelId }
}

/** Eventos internos do CRM → eventos padrão da Meta. */
export const META_EVENT_MAP = {
  Lead: 'Lead',
  Chronos_Scheduled: 'Schedule',
} as const
export type InternalTrackedEvent = keyof typeof META_EVENT_MAP
export type MetaEventName = (typeof META_EVENT_MAP)[InternalTrackedEvent]

export function metaEventNameFor(internal: string): MetaEventName | null {
  return Object.prototype.hasOwnProperty.call(META_EVENT_MAP, internal)
    ? META_EVENT_MAP[internal as InternalTrackedEvent] : null
}

/**
 * Eventos PERSONALIZADOS da jornada do formulário (nomes exatos na Meta, enviados com `trackCustom`).
 * Não são conversões padrão: o agendamento confirmado continua sendo o `Schedule` (Chronos_Scheduled).
 * Enquanto não forem homologados, só saem numa liberação de homologação com escopo "chronos".
 */
export const CHRONOS_CUSTOM_EVENTS = ['ChronosView', 'ChronosFirstInteraction', 'ChronosSubmit', 'Chronos_View_Scheduled'] as const
export type ChronosCustomEvent = (typeof CHRONOS_CUSTOM_EVENTS)[number]

const CHRONOS_EVENT_ID_PREFIX: Record<ChronosCustomEvent, string> = {
  ChronosView: 'chronos_view',
  ChronosFirstInteraction: 'chronos_first_interaction',
  ChronosSubmit: 'chronos_submit',
  Chronos_View_Scheduled: 'chronos_view_scheduled',
}

export function isChronosCustomEvent(value: unknown): value is ChronosCustomEvent {
  return typeof value === 'string' && (CHRONOS_CUSTOM_EVENTS as readonly string[]).includes(value)
}

/**
 * event_id determinístico por EVENTO e SESSÃO do navegador (deduplicação: o mesmo evento da mesma sessão nunca
 * conta duas vezes). Sem dado pessoal: só o nome do evento e um identificador aleatório da sessão.
 */
export function chronosEventId(event: ChronosCustomEvent, sessionId: string): string | null {
  if (!isChronosCustomEvent(event) || !/^[a-f0-9]{32}$/.test(sessionId)) return null
  return CHRONOS_EVENT_ID_PREFIX[event] + '_' + sessionId
}

/**
 * Liberação COMERCIAL dos eventos personalizados Chronos (etapa independente da homologação).
 * Default OFF; somente valor literal `true` é aceito. Não habilita Pixel nem afeta Lead/Schedule.
 * A variável deve ser instalada somente após aprovação do titular e novo deploy.
 */
export function getChronosLiveEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.META_CHRONOS_LIVE_ENABLED?.trim() === 'true'
}

export type ChronosDispatchMode = 'off' | 'homologation' | 'live'

/**
 * Proteções fail-closed:
 * - sem Pixel: nunca dispara;
 * - homologação Chronos: somente os 4 eventos personalizados de teste;
 * - homologação Lead/Schedule: não mistura os eventos comerciais Chronos;
 * - modo real: flag explícita + formulário live; páginas de teste/allowlist não enviam.
 * A camada de navegador também exige consentimento de marketing vigente em cada envio.
 */
export function chronosDispatchMode(input: {
  pixelReady: boolean
  bookingMode: 'live' | 'test'
  liveEnabled: boolean
  homologationScope?: 'conversions' | 'chronos' | null
}): ChronosDispatchMode {
  if (!input.pixelReady) return 'off'
  if (input.homologationScope === 'chronos') return 'homologation'
  if (input.homologationScope === 'conversions') return 'off'
  return input.liveEnabled && input.bookingMode === 'live' ? 'live' : 'off'
}

/** event_id do Lead: um por lead (reenvios do mesmo contato não contam como nova conversão). */
export function leadTrackingEventId(leadId: string): string {
  return 'lead_' + leadId.replaceAll('-', '').toLowerCase()
}

/**
 * Formatos documentados pela Meta: fb.<subdomínio>.<timestamp ms>.<valor>.
 * Usados apenas para validar identificadores que a futura CAPI receber no momento do envio
 * (nada é persistido no CRM — decisão C2).
 */
export function isValidFbp(value: unknown): value is string {
  return typeof value === 'string' && /^fb\.[0-2]\.\d{10,13}\.\d{1,30}$/.test(value)
}
export function isValidFbc(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 600 && /^fb\.[0-2]\.\d{10,13}\.[A-Za-z0-9_-]{8,500}$/.test(value)
}

/**
 * Escolha de marketing enviada pelo navegador ao CRM: SÓ o sim/não.
 * Decisão C2 (29/10/2026): enquanto a Conversions API estiver desativada, os identificadores
 * _fbp/_fbc NÃO vão ao CRM e NÃO são gravados. Qualquer outro campo recebido é descartado.
 * O próprio Pixel continua lendo seus cookies no navegador depois do consentimento.
 */
export type MarketingConsentInput = {
  consent: boolean
  /** true quando o visitante ESCOLHEU (aceitou ou recusou) no aviso; false = ainda sem escolha. */
  decided: boolean
}

export function sanitizeMarketingConsent(raw: unknown): MarketingConsentInput {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { consent: false, decided: false }
  const value = raw as Record<string, unknown>
  const consent = value.consent === true
  return { consent, decided: consent || value.decided === true }
}

/**
 * Escolha de marketing VALIDADA NO SERVIDOR antes de qualquer gravação.
 * - Aceite só vale se o cookie de consentimento da própria requisição (cassiellos_consent,
 *   válido e na versão atual) também registrar o aceite. Divergência = sem consentimento.
 * - Recusa explícita vale mesmo sem cookie (é a opção mais protetiva).
 * O servidor não tem como verificar mais do que a escolha guardada pelo navegador.
 */
export function resolveMarketingConsent(claimed: unknown, cookieHeader: string | null | undefined): MarketingConsentInput {
  const body = sanitizeMarketingConsent(claimed)
  const stored = parseConsent(readCookie(cookieHeader || '', CONSENT_COOKIE))
  if (body.consent && stored?.marketing === true) return { consent: true, decided: true }
  if (body.decided && !body.consent) return { consent: false, decided: true }
  return { consent: false, decided: false }
}

/**
 * Identificador de clique da Meta presente nos links de anúncios (decisão G2, 29/10/2026):
 * só é guardado no CRM com consentimento de marketing validado; nas páginas do funil nunca vai
 * para as ferramentas de medição de navegação (Vercel Analytics, AnalyticsFlow/cassiellOS).
 */
export const META_CLICK_ID_PARAM = 'fbclid'
