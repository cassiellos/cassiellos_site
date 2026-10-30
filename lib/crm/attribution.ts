import { sanitizeUtmValue, UTM_KEYS } from '../privacy/url-sanitize'

/**
 * Atribuição do cadastro (padrão: docs/marketing/padrao-utm.md, decisões U1–U5).
 * Usa a estrutura existente (`form_submissions.answers.attribution`): nenhum campo novo é gravado.
 * - utm_*: higienizados (valor com aparência de e-mail é descartado), sem alterar maiúsculas/minúsculas
 *   (U4: campanhas ativas não mudam de agrupamento sem auditoria).
 * - fbclid: preservado como antes (sem uso atual; decisão da Etapa 4). gclid não é coletado.
 */
export const ATTRIBUTION_MAX_LENGTH = 180

export function sanitizeAttribution(
  raw: unknown,
  clean: (value: unknown, max: number) => string | null,
): Record<string, string> {
  const attribution: Record<string, string> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return attribution
  const input = raw as Record<string, unknown>
  for (const key of UTM_KEYS) {
    const safe = clean(sanitizeUtmValue(input[key]), ATTRIBUTION_MAX_LENGTH)
    if (safe) attribution[key] = safe
  }
  const fbclid = clean(input.fbclid, ATTRIBUTION_MAX_LENGTH)
  if (fbclid) attribution.fbclid = fbclid
  return attribution
}

export type AttributionChannel =
  | 'google_ads' | 'meta_ads' | 'instagram_organic' | 'facebook_organic' | 'partner'
  | 'whatsapp' | 'email' | 'internal' | 'direct' | 'other'

/** Canal derivado de utm_source + utm_medium (somente leitura, para exibição; nada é gravado). */
export function attributionChannel(source: string | null | undefined, medium: string | null | undefined): AttributionChannel {
  const s = (source ?? '').trim().toLowerCase()
  const m = (medium ?? '').trim().toLowerCase()
  if (!s && !m) return 'direct'
  if (s === 'google' && m === 'cpc') return 'google_ads'
  if (s === 'meta' && m === 'paid_social') return 'meta_ads'
  if (s === 'instagram' && m === 'organic_social') return 'instagram_organic'
  if (s === 'facebook' && m === 'organic_social') return 'facebook_organic'
  if (/^parceiro_[a-z0-9]+(?:_[a-z0-9]+)*$/.test(s) && m === 'referral') return 'partner'
  if (s === 'whatsapp' && m === 'messaging') return 'whatsapp'
  if (s === 'email' && m === 'email') return 'email'
  if (s === 'site' && m === 'referral') return 'internal'
  return 'other'
}

export const CHANNEL_LABELS: Record<AttributionChannel, string> = {
  google_ads: 'Google Ads',
  meta_ads: 'Anúncios da Meta',
  instagram_organic: 'Instagram orgânico',
  facebook_organic: 'Facebook orgânico',
  partner: 'Parceiro',
  whatsapp: 'WhatsApp',
  email: 'E-mail marketing',
  internal: 'Site Cassiellos',
  direct: 'Sem UTM',
  other: 'Fora do padrão de UTMs',
}
