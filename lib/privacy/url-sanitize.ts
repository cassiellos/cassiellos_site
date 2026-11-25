/**
 * Minimização de dados de URL antes de enviar a terceiros (P1/P2 de privacidade).
 *
 * - Identificadores de clique (gclid, fbclid, msclkid…) identificam um clique/visitante
 *   específico: não são enviados a ferramentas de análise nem ao n8n.
 * - Parâmetros UTM comerciais (utm_source, utm_medium, utm_campaign, utm_content, utm_term)
 *   são preservados para os relatórios, mas um valor com formato de dado pessoal (e-mail, telefone, CPF, CNPJ, CEP, IP, URL,
 *   código opaco longo, sequência numérica sem chave de ID) é descartado; origem e meio aceitam uma palavra só.
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

/** Prefixos explícitos aceitos em IDs "chave-número" (padrão v1, regra 6). `tel-`, `cpf-` etc. NÃO são chaves de ID. */
const ID_KEYS = 'cid|agid|asid|adid|ad|adset|cmp'
const PLATFORM_ID = new RegExp('^(?:\\d{15,20}|(?:' + ID_KEYS + ')-\\d{8,20})$')
const PLATFORM_NAME = /^[a-z][a-z0-9_-]{1,29}$/
const PLACEMENT = /^[A-Za-z][A-Za-z0-9 _.-]{1,59}$/
/** utm_source / utm_medium: UMA palavra (sem espaços), com letras, dígitos, "_", "." e "-" — nome de pessoa em texto livre não passa. */
const SOURCE_MEDIUM_TOKEN = /^[A-Za-z][A-Za-z0-9_.-]{0,39}$/

/** Valores conhecidos de origem/meio (padrão v1/v2). Passam direto; valor desconhecido ainda precisa do formato acima e dos filtros de dados pessoais. */
export const KNOWN_UTM_SOURCES: readonly string[] = [
  'meta', 'facebook', 'instagram', 'google', 'whatsapp', 'email', 'site', 'direct', 'youtube', 'linkedin', 'tiktok', 'bing',
]
export const KNOWN_UTM_MEDIUMS: readonly string[] = [
  'paid_social', 'cpc', 'organic_social', 'referral', 'email', 'messaging', 'organic', 'social', 'display', 'video',
]

const MAX_UTM_LENGTH = 200
const EMAIL_LIKE = /[^\s@/?#&=]+@[^\s@/?#&=]+\.[a-z]{2,}/i
// "%40" (arroba codificada) também denuncia e-mail em parâmetros duplamente codificados.
const ENCODED_AT = /%40/i

// ── Dados pessoais reconhecíveis por formato (F4). Cada regra tem espelho EXATO em docs/tracking/gtm/*.js. ──────────────
// IDs numéricos legítimos vêm sempre com chave explícita ("cid-123…__asid-123…__ad-123…"); são retirados antes dos testes.
const KEYED_ID = new RegExp('(^|[^a-z0-9])(?:' + ID_KEYS + ')-\\d{6,20}(?!\\d)', 'gi')
const URL_LIKE = /https?:|www\.|:\/\/|^\/\//i
const IPV4 = /(?:^|\D)\d{1,3}(?:\.\d{1,3}){3}(?:\D|$)/
const OPAQUE_TOKEN = /(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{32,}/
// 9–14 dígitos seguidos = telefone (com/sem +55), CPF, CNPJ; 15–20 dígitos seguidos = ID de plataforma (Meta) e passa; 21+ não é ID.
const DIGIT_RUN = /(?:^|\D)\d{9,14}(?:\D|$)|\d{21,}/
const DIGIT_SEQUENCE = /\+?\d(?:[ ().\/-]{0,2}\d)*/g
const FORMATTED_SHORT_NUMBER = /\d{5}-\d{3,4}/

/**
 * true quando o texto tem formato de dado pessoal: e-mail ou "@", telefone (com ou sem DDD/+55, com separadores), CPF, CNPJ,
 * CEP formatado, qualquer sequência de 9 a 14 dígitos sem chave de ID (IDs de plataforma de 15–20 dígitos passam), endereço IP, URL e códigos opacos longos (hash, token).
 * LIMITE CONHECIDO: nomes próprios e outros dados em texto livre (campanha, conteúdo, termo) NÃO são reconhecíveis por
 * expressão regular; a defesa é o conjunto de regras acima + o formato de uma palavra em origem/meio + a lista fechada de chaves.
 */
export function looksLikePersonalData(text: string): boolean {
  if (text.indexOf('@') >= 0 || ENCODED_AT.test(text) || EMAIL_LIKE.test(text)) return true
  const rest = text.replace(KEYED_ID, '$1 ')
  if (URL_LIKE.test(rest) || IPV4.test(rest) || OPAQUE_TOKEN.test(rest) || DIGIT_RUN.test(rest) || FORMATTED_SHORT_NUMBER.test(rest)) return true
  const sequences = rest.match(DIGIT_SEQUENCE) || []
  // Com separadores (espaço, parênteses, ponto, barra, hífen): 10+ dígitos somados = telefone/CPF/CNPJ formatado.
  for (const sequence of sequences) if (!/^\+?\d+$/.test(sequence) && sequence.replace(/\D/g, '').length >= 10) return true
  return false
}

function cleanText(value: unknown): string {
  if (typeof value !== 'string') return ''
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if (!text || text.indexOf('@') >= 0 || EMAIL_LIKE.test(text) || ENCODED_AT.test(text)) return ''
  return text.slice(0, MAX_UTM_LENGTH)
}

/** Valor de texto livre seguro para relatório: curto, sem controles e sem formato de dado pessoal. */
export function sanitizeUtmValue(value: unknown): string {
  const text = cleanText(value)
  return text && !looksLikePersonalData(text) ? text : ''
}

/** Valor de UMA chave UTM: texto livre (campanha, conteúdo, termo) ou, em origem e meio, uma palavra conhecida/bem formada. */
export function sanitizeUtmField(key: UtmKey, value: unknown): string {
  const text = sanitizeUtmValue(value)
  if (!text) return ''
  if (key === 'utm_source') return KNOWN_UTM_SOURCES.includes(text) || SOURCE_MEDIUM_TOKEN.test(text) ? text : ''
  if (key === 'utm_medium') return KNOWN_UTM_MEDIUMS.includes(text) || SOURCE_MEDIUM_TOKEN.test(text) ? text : ''
  return text
}

/** Valor de um parâmetro estendido, higienizado e conferido contra o formato da chave. Vazio quando inválido. */
export function sanitizeExtendedValue(key: ExtendedAttributionKey, value: unknown): string {
  // Os IDs têm 15–20 dígitos por definição: não passam pelo filtro de sequência numérica, só pelo formato estrito da chave.
  const base = cleanText(value)
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
      return PLACEMENT.test(base) && !looksLikePersonalData(base) ? base : ''
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
    const value = sanitizeUtmField(key, params.get(key))
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
    const value = sanitizeUtmField(key, params.get(key))
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
    const value = sanitizeUtmField(key, url.searchParams.get(key))
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
