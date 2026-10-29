/**
 * Consentimento de cookies de marketing (LGPD) — módulo puro, usado no navegador e no servidor.
 *
 * - Um único cookie primário `cassiellos_consent` guarda SÓ a escolha (sem dados pessoais).
 * - Sem escolha registrada = marketing NÃO autorizado (nenhum rastreador de marketing carrega).
 * - Recusar nunca impede o formulário ou o agendamento.
 * - A versão permite pedir nova escolha se a política mudar no futuro.
 */
export const CONSENT_COOKIE = 'cassiellos_consent'
export const CONSENT_VERSION = 1
export const CONSENT_MAX_AGE_DAYS = 180

export type ConsentState = { v: number; marketing: boolean; at: string }

export function parseConsent(raw: string | null | undefined): ConsentState | null {
  if (!raw) return null
  try {
    const data = JSON.parse(decodeURIComponent(raw)) as Partial<ConsentState>
    if (data.v !== CONSENT_VERSION || typeof data.marketing !== 'boolean' || typeof data.at !== 'string') return null
    if (!Number.isFinite(Date.parse(data.at))) return null
    return { v: data.v, marketing: data.marketing, at: data.at }
  } catch {
    return null
  }
}

export function serializeConsent(marketing: boolean, now: Date = new Date()): string {
  return encodeURIComponent(JSON.stringify({ v: CONSENT_VERSION, marketing, at: now.toISOString() }))
}

export function readCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

export function hasMarketingConsent(cookieHeader: string): boolean {
  return parseConsent(readCookie(cookieHeader, CONSENT_COOKIE))?.marketing === true
}
