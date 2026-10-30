/**
 * Consentimento de métricas (cookies e tecnologias de análise) — módulo puro, usado no navegador e no servidor.
 *
 * - Um único cookie primário `cassiellos_consent` guarda SÓ a escolha (sem dados pessoais).
 * - Sem escolha registrada = métricas opcionais NÃO autorizadas no escopo do CRM (funil /agendar e painel).
 * - Recusar nunca impede o formulário ou o agendamento.
 * - A versão permite pedir nova escolha se o texto ou as ferramentas mudarem.
 * - Etapa 4 (Meta Pixel): acrescentar a categoria `marketing` neste MESMO objeto (ver
 *   docs/crm/integracao-etapa-3-privacidade.md), sem segundo cookie nem segundo aviso.
 */
export const CONSENT_COOKIE = 'cassiellos_consent'
export const CONSENT_VERSION = 1
export const CONSENT_MAX_AGE_DAYS = 180

export type ConsentState = { v: typeof CONSENT_VERSION; analytics: boolean; at: string }

export function parseConsent(raw: string | null | undefined): ConsentState | null {
  if (!raw) return null
  try {
    const data = JSON.parse(decodeURIComponent(raw)) as Partial<ConsentState>
    if (data.v !== CONSENT_VERSION || typeof data.analytics !== 'boolean' || typeof data.at !== 'string') return null
    if (!Number.isFinite(Date.parse(data.at))) return null
    return { v: CONSENT_VERSION, analytics: data.analytics, at: data.at }
  } catch {
    return null
  }
}

export function serializeConsent(analytics: boolean, now: Date = new Date()): string {
  return encodeURIComponent(JSON.stringify({ v: CONSENT_VERSION, analytics, at: now.toISOString() }))
}

/** Atributos do cookie: primário, todo o site, 180 dias, SameSite=Lax; Secure em HTTPS. */
export function consentCookieAttributes(secure: boolean): string {
  return 'Path=/; Max-Age=' + CONSENT_MAX_AGE_DAYS * 86_400 + '; SameSite=Lax' + (secure ? '; Secure' : '')
}

export function readCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

export function hasAnalyticsConsent(cookieHeader: string): boolean {
  return parseConsent(readCookie(cookieHeader, CONSENT_COOKIE))?.analytics === true
}
