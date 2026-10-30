import {
  CONSENT_COOKIE, consentCookieAttributes, parseConsent, readCookie, serializeConsent, type ConsentState,
} from './consent'

/** Funções de navegador do consentimento de métricas (sem React). */

export const CONSENT_CHANGE_EVENT = 'cassiellos:consent-change'
export const CONSENT_OPEN_EVENT = 'cassiellos:consent-open'

export function getConsent(): ConsentState | null {
  if (typeof document === 'undefined') return null
  return parseConsent(readCookie(document.cookie, CONSENT_COOKIE))
}

/** Métricas opcionais autorizadas AGORA (lido a cada chamada: a revogação vale imediatamente). */
export function analyticsAllowed(): boolean {
  return getConsent()?.analytics === true
}

export function setAnalyticsConsent(granted: boolean): void {
  if (typeof document === 'undefined') return
  document.cookie = CONSENT_COOKIE + '=' + serializeConsent(granted) + '; ' +
    consentCookieAttributes(window.location.protocol === 'https:')
  window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT))
}

/** Reabre o aviso ("Preferências de cookies"). */
export function openConsentPreferences(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CONSENT_OPEN_EVENT))
}
