/**
 * Minimização de dados de URL antes de enviar a terceiros (P1/P2 de privacidade).
 *
 * - Identificadores de clique (gclid, fbclid, msclkid…) identificam um clique/visitante
 *   específico: não são enviados a ferramentas de análise nem ao n8n.
 * - Parâmetros UTM comerciais (utm_source, utm_medium, utm_campaign, utm_content, utm_term)
 *   são preservados para os relatórios, mas um valor com aparência de e-mail é descartado.
 * - Demais parâmetros de consulta e o fragmento (#) não são enviados às análises.
 * Funções puras: usadas no navegador e no servidor.
 */

export const CLICK_ID_PARAMS: readonly string[] = [
  'gclid', 'gbraid', 'wbraid', 'gclsrc', 'dclid', 'gad_source', 'gad_campaignid', '_gl',
  'fbclid', 'igshid', 'msclkid', 'ttclid', 'twclid', 'li_fat_id', 'epik', 'rdt_cid', 'sccid',
  'yclid', 'mc_eid', 'irclickid',
]

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const
export type UtmKey = typeof UTM_KEYS[number]

/**
 * Parâmetros de atribuição estendidos (padrão UTM v2, proposta). Formato estrito: valor fora do formato é descartado.
 * - utm_id, adset_id, ad_id: ID de plataforma. Meta usa 15 a 20 dígitos; aceita também "chave-número" (ex.: cid-22334455667,
 *   regra 6 do padrão v1). Número curto sem chave (telefone, CPF, CNPJ, CEP) é descartado.
 * - utm_source_platform: nome curto da plataforma em minúsculas (ex.: meta, google).
 * - placement: posicionamento legível (ex.: Instagram_Reels).
 */
export const EXTENDED_ATTRIBUTION_KEYS = ['utm_id', 'utm_source_platform', 'adset_id', 'ad_id', 'placement'] as const
export type ExtendedAttributionKey = typeof EXTENDED_ATTRIBUTION_KEYS[number]

const PLATFORM_ID = /^(?:\d{15,20}|[a-z]{1,8}-\d{8,20})$/
const PLATFORM_NAME = /^[a-z][a-z0-9_-]{1,29}$/
const PLACEMENT = /^[A-Za-z][A-Za-z0-9 _.-]{1,59}$/

const MAX_UTM_LENGTH = 200
const EMAIL_LIKE = /[^\s@/?#&=]+@[^\s@/?#&=]+\.[a-z]{2,}/i
// "%40" (arroba codificada) também denuncia e-mail em parâmetros duplamente codificados.
const ENCODED_AT = /%40/i

/** Valor UTM seguro para relatório: texto curto, sem controles e sem e-mail. */
export function sanitizeUtmValue(value: unknown): string {
  if (typeof value !== 'string') return ''
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if (!text || EMAIL_LIKE.test(text) || ENCODED_AT.test(text)) return ''
  return text.slice(0, MAX_UTM_LENGTH)
}

/** Valor de um parâmetro estendido, higienizado e conferido contra o formato da chave. Vazio quando inválido. */
export function sanitizeExtendedValue(key: ExtendedAttributionKey, value: unknown): string {
  const base = sanitizeUtmValue(value)
  if (!base) return ''
  switch (key) {
    case 'utm_id':
    case 'adset_id':
    case 'ad_id':
      return PLATFORM_ID.test(base) ? base : ''
    case 'utm_source_platform': {
      const lower = base.toLowerCase()
      return PLATFORM_NAME.test(lower) ? lower : ''
    }
    case 'placement':
      return PLACEMENT.test(base) ? base : ''
  }
}

export function isClickIdParam(name: string): boolean {
  return CLICK_ID_PARAMS.includes(name.toLowerCase())
}

/** origem + caminho (sem consulta e sem fragmento). Vazio quando não é http(s). */
export function originAndPath(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return ''
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    return url.origin + url.pathname
  } catch {
    return ''
  }
}

/** UTMs permitidos de uma query string, já higienizados (vazios omitidos). */
export function utmFromSearch(search: string): Partial<Record<UtmKey, string>> {
  const params = new URLSearchParams(search)
  const result: Partial<Record<UtmKey, string>> = {}
  for (const key of UTM_KEYS) {
    const value = sanitizeUtmValue(params.get(key))
    if (value) result[key] = value
  }
  return result
}

/**
 * URL para análises (Vercel Analytics): origem + caminho + apenas UTMs permitidos.
 * Remove identificadores de clique, outros parâmetros e o fragmento.
 */
export function analyticsUrl(raw: string): string {
  let url: URL
  try { url = new URL(raw) } catch { return raw }
  const kept = new URLSearchParams()
  for (const [key, value] of Object.entries(utmFromSearch(url.search))) kept.set(key, value)
  const query = kept.toString()
  return url.origin + url.pathname + (query ? '?' + query : '')
}

/**
 * Atribuição enviada pelo navegador no cadastro/agendamento: UTMs, parâmetros estendidos e, só com consentimento de
 * marketing, o fbclid. Parâmetro repetido na URL: vale a PRIMEIRA ocorrência (URLSearchParams.get), as demais são ignoradas.
 * Outros identificadores de clique (gclid, gbraid, wbraid, msclkid, ttclid…) e qualquer parâmetro fora da lista nunca saem
 * do navegador por aqui. O servidor repete a higienização (lib/crm/attribution).
 */
export function attributionFromSearch(search: string, options: { allowFbclid: boolean }): Record<string, string> {
  const params = new URLSearchParams(search)
  const result: Record<string, string> = {}
  for (const key of UTM_KEYS) {
    const value = sanitizeUtmValue(params.get(key))
    if (value) result[key] = value.slice(0, 180)
  }
  for (const key of EXTENDED_ATTRIBUTION_KEYS) {
    const value = sanitizeExtendedValue(key, params.get(key))
    if (value) result[key] = value
  }
  if (options.allowFbclid) {
    const fbclid = params.get('fbclid')
    if (fbclid) result.fbclid = fbclid.slice(0, 180)
  }
  return result
}

// ---------------------------------------------------------------------------------------------------------------------
// page_location / page_referrer enviados ao GA4 (pela variável do GTM; o texto da variável fica em
// docs/tracking/gtm/page-location-sanitizado.js e é testado contra estas funções).
// ---------------------------------------------------------------------------------------------------------------------

/** Identificadores de clique do Google. Hoje NUNCA vão ao GA4 (sinais de anúncios negados e sem campanha no Google Ads).
 *  Só passam quando a opção `allowGoogleClickIds` for ligada, o que exige: texto de privacidade citando o Google Ads,
 *  consentimento de anúncios concedido e vínculo GA4 × Google Ads (ver docs/marketing/padrao-utm-v2.md, seção 6.4). */
export const GOOGLE_CLICK_ID_PARAMS = ['gclid', 'gbraid', 'wbraid', 'gad_source', 'gad_campaignid'] as const
const CLICK_ID_VALUE = /^[A-Za-z0-9_-]{6,200}$/

/**
 * URL enviada ao GA4 como page_location: origem + caminho + SOMENTE as chaves de atribuição válidas (UTMs e parâmetros
 * estendidos, com o mesmo formato estrito do cadastro). Tudo o mais é removido: fbclid, msclkid, ttclid, _gl, outros
 * identificadores de clique, qualquer parâmetro desconhecido (podem conter e-mail, telefone, nome) e o fragmento (#).
 * Parâmetro repetido: vale a primeira ocorrência. Devolve a entrada inalterada se não for uma URL http(s).
 */
export function ga4PageLocation(raw: string, options: { allowGoogleClickIds?: boolean } = {}): string {
  let url: URL
  try { url = new URL(raw) } catch { return raw }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return raw
  const kept = new URLSearchParams()
  for (const key of UTM_KEYS) {
    const value = sanitizeUtmValue(url.searchParams.get(key))
    if (value) kept.set(key, value.slice(0, 180))
  }
  for (const key of EXTENDED_ATTRIBUTION_KEYS) {
    const value = sanitizeExtendedValue(key, url.searchParams.get(key))
    if (value) kept.set(key, value)
  }
  if (options.allowGoogleClickIds) {
    for (const key of GOOGLE_CLICK_ID_PARAMS) {
      const value = url.searchParams.get(key)
      if (value && CLICK_ID_VALUE.test(value)) kept.set(key, value)
    }
  }
  const query = kept.toString()
  return url.origin + url.pathname + (query ? '?' + query : '')
}

/** Origem de referência para o GA4 (page_referrer): origem + caminho, sem consulta nem fragmento. Vazio se não for http(s). */
export function ga4PageReferrer(raw: string): string {
  return originAndPath(raw)
}
