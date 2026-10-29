/**
 * Meta Pixel / Conversions API — configuração e regras compartilhadas (sem segredos).
 *
 * - Desligado por padrão: só liga com META_PIXEL_ENABLED=true E um META_PIXEL_ID válido.
 * - Somente as páginas públicas do funil listadas aqui carregam o Pixel; o CRM nunca.
 * - Nome do evento na Meta e event_id são os MESMOS no Pixel e na CAPI (deduplicação).
 * - O CRM mantém seus nomes internos; o mapeamento para a Meta fica centralizado aqui.
 */

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

/** Formatos documentados pela Meta: fb.<subdomínio>.<timestamp ms>.<valor>. */
export function isValidFbp(value: unknown): value is string {
  return typeof value === 'string' && /^fb\.[0-2]\.\d{10,13}\.\d{1,30}$/.test(value)
}
export function isValidFbc(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 600 && /^fb\.[0-2]\.\d{10,13}\.[A-Za-z0-9_-]{8,500}$/.test(value)
}

/** fbc a partir do fbclid da URL quando o cookie _fbc ainda não existe. */
export function buildFbcFromFbclid(fbclid: unknown, createdAtMs: number): string | null {
  if (typeof fbclid !== 'string' || !/^[A-Za-z0-9_-]{8,500}$/.test(fbclid)) return null
  const value = 'fb.1.' + Math.floor(createdAtMs) + '.' + fbclid
  return isValidFbc(value) ? value : null
}

/** Identificadores de navegador aceitos SOMENTE com consentimento de marketing. */
export type MarketingSignals = { consent: boolean; fbp?: string; fbc?: string }

export function sanitizeMarketingSignals(raw: unknown): MarketingSignals {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { consent: false }
  const value = raw as Record<string, unknown>
  if (value.consent !== true) return { consent: false }
  const signals: MarketingSignals = { consent: true }
  if (isValidFbp(value.fbp)) signals.fbp = value.fbp
  if (isValidFbc(value.fbc)) signals.fbc = value.fbc
  return signals
}
