'use client'

import { CONSENT_COOKIE, CONSENT_MAX_AGE_DAYS, parseConsent, readCookie, serializeConsent, type ConsentState } from './consent'
import type { MarketingConsentInput, MetaEventName } from './meta'

/**
 * Funções de navegador do Meta Pixel. Nenhuma delas envia dados pessoais:
 * só nome do evento, event_id gerado pelo CRM e o slug do formulário.
 */

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...a: unknown[]) => void; queue?: unknown[] }
declare global {
  interface Window { fbq?: Fbq; _fbq?: Fbq }
}

export const CONSENT_CHANGE_EVENT = 'cassiellos:consent-change'
export const CONSENT_OPEN_EVENT = 'cassiellos:consent-open'
/** Ponto da página (no fluxo do conteúdo) onde o aviso de cookies é exibido. */
export const CONSENT_SLOT_ID = 'cassiellos-consent-slot'
const SENT_KEY = 'cassiellos_meta_sent'

export function getConsent(): ConsentState | null {
  if (typeof document === 'undefined') return null
  return parseConsent(readCookie(document.cookie, CONSENT_COOKIE))
}

export function hasMarketingConsentInBrowser(): boolean {
  return getConsent()?.marketing === true
}

export function setConsent(marketing: boolean): void {
  const secure = location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = CONSENT_COOKIE + '=' + serializeConsent(marketing) +
    '; Max-Age=' + CONSENT_MAX_AGE_DAYS * 86400 + '; Path=/; SameSite=Lax' + secure
  if (!marketing) clearMetaCookies()
  window.dispatchEvent(new Event(CONSENT_CHANGE_EVENT))
}

/** Remove os cookies da Meta deste domínio e do domínio pai quando o visitante recusa. */
export function clearMetaCookies(): void {
  const host = location.hostname
  const parent = host.split('.').slice(-3).join('.')
  for (const name of ['_fbp', '_fbc']) {
    for (const domain of ['', '; Domain=' + host, '; Domain=.' + parent]) {
      document.cookie = name + '=; Max-Age=0; Path=/' + domain
    }
  }
}

/**
 * O que o formulário envia ao CRM sobre marketing: SÓ a escolha (sim/não).
 * Decisão C2: os cookies _fbp/_fbc não são lidos nem enviados ao CRM.
 */
export function readMarketingConsent(): MarketingConsentInput {
  const choice = getConsent()
  return { consent: choice?.marketing === true, decided: choice !== null }
}

function alreadySent(eventId: string): boolean {
  try {
    const list: string[] = JSON.parse(sessionStorage.getItem(SENT_KEY) || '[]')
    return list.includes(eventId)
  } catch { return false }
}
function markSent(eventId: string): void {
  try {
    const list: string[] = JSON.parse(sessionStorage.getItem(SENT_KEY) || '[]')
    sessionStorage.setItem(SENT_KEY, JSON.stringify([...list, eventId].slice(-20)))
  } catch { /* storage unavailable: the CRM event_id still deduplicates on Meta's side */ }
}

/**
 * Conversão no navegador com o MESMO event_id do CRM. Não faz nada se o Pixel não
 * estiver carregado (chave desligada, página fora do funil ou sem consentimento).
 */
export function trackMetaConversion(eventName: MetaEventName, eventId: unknown, params: { content_name?: string } = {}): boolean {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return false
  if (!hasMarketingConsentInBrowser()) return false
  if (typeof eventId !== 'string' || !/^[a-z0-9_]{6,120}$/.test(eventId) || alreadySent(eventId)) return false
  window.fbq('track', eventName, params, { eventID: eventId })
  markSent(eventId)
  return true
}
