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
