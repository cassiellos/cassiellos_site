import {
  CONSENT_COOKIE, consentCookieAttributes, parseConsent, readCookie, serializeConsent,
  type ConsentChoices, type ConsentState,
} from './consent'

/** Funções de navegador do consentimento (sem React). */

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

/** Marketing (Meta Pixel) autorizado AGORA (lido a cada chamada: a revogação vale imediatamente). */
export function marketingAllowed(): boolean {
  return getConsent()?.marketing === true
}

function writeConsent(update: Partial<ConsentChoices>): void {
  if (typeof document === 'undefined') return
  const current = getConsent()
  // Cada categoria muda só a si mesma: a outra escolha do visitante é preservada.
  const next: ConsentChoices = {
    analytics: update.analytics !== undefined ? update.analytics : current?.analytics ?? null,
    marketing: update.marketing !== undefined ? update.marketing : current?.marketing ?? null,
  }
  document.cookie = CONSENT_COOKIE + '=' + serializeConsent(next) + '; ' +
    consentCookieAttributes(window.location.protocol === 'https:')
  window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT))
}

export function setAnalyticsConsent(granted: boolean): void {
  writeConsent({ analytics: granted })
}

export function setMarketingConsent(granted: boolean): void {
  writeConsent({ marketing: granted })
}

/** Reabre o aviso ("Preferências de cookies"). */
export function openConsentPreferences(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(CONSENT_OPEN_EVENT))
}
