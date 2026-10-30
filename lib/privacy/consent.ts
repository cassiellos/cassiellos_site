/**
 * Consentimento de cookies e tecnologias opcionais — módulo puro, usado no navegador e no servidor.
 *
 * - Um único cookie primário `cassiellos_consent` guarda SÓ as escolhas (sem dados pessoais).
 * - Categorias independentes: `analytics` (métricas de uso, Etapa 3) e `marketing` (Meta Pixel, Etapa 4).
 *   `null` = ainda não perguntado/escolhido; nunca vale como autorização.
 * - Sem escolha registrada = nada opcional autorizado no escopo do CRM (funil /agendar e painel).
 * - Recusar nunca impede o formulário ou o agendamento.
 * - Versão 2 acrescenta `marketing`. Registros da versão 1 (só `analytics`) continuam valendo para métricas,
 *   com `marketing: null` — a escolha do visitante não é sobrescrita, e o marketing é perguntado à parte.
 */
export const CONSENT_COOKIE = 'cassiellos_consent'
export const CONSENT_VERSION = 2
export const CONSENT_MAX_AGE_DAYS = 180

export type ConsentChoice = boolean | null
export type ConsentChoices = { analytics: ConsentChoice; marketing: ConsentChoice }
export type ConsentState = ConsentChoices & { v: typeof CONSENT_VERSION; at: string }

function choice(value: unknown): ConsentChoice | undefined {
  if (value === true || value === false) return value
  if (value === null || value === undefined) return null
  return undefined
}

export function parseConsent(raw: string | null | undefined): ConsentState | null {
  if (!raw) return null
  try {
    const data = JSON.parse(decodeURIComponent(raw)) as Record<string, unknown>
    if (!data || typeof data !== 'object' || typeof data.at !== 'string' || !Number.isFinite(Date.parse(data.at))) return null
    if (data.v === 1) {
      // Etapa 3: só métricas, sempre decidida.
      if (typeof data.analytics !== 'boolean') return null
      return { v: CONSENT_VERSION, analytics: data.analytics, marketing: null, at: data.at }
    }
    if (data.v !== CONSENT_VERSION) return null
    const analytics = choice(data.analytics)
    const marketing = choice(data.marketing)
    if (analytics === undefined || marketing === undefined || (analytics === null && marketing === null)) return null
    return { v: CONSENT_VERSION, analytics, marketing, at: data.at }
  } catch {
    return null
  }
}

export function serializeConsent(choices: ConsentChoices, now: Date = new Date()): string {
  return encodeURIComponent(JSON.stringify({
    v: CONSENT_VERSION, analytics: choices.analytics, marketing: choices.marketing, at: now.toISOString(),
  }))
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

export function hasMarketingConsent(cookieHeader: string): boolean {
  return parseConsent(readCookie(cookieHeader, CONSENT_COOKIE))?.marketing === true
}
