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
