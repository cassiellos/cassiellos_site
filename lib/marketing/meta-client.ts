'use client'

import { getConsent, marketingAllowed } from '@/lib/privacy/consent-client'
import type { MarketingConsentInput, MetaEventName } from './meta'

/**
 * Funções de navegador do Meta Pixel. Nenhuma delas envia dados pessoais:
 * só nome do evento, event_id gerado pelo CRM e o slug do formulário.
 * O consentimento é o da Etapa 3 (lib/privacy), categoria `marketing`.
 */

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...a: unknown[]) => void; queue?: unknown[] }
declare global {
  interface Window { fbq?: Fbq; _fbq?: Fbq }
}

const SENT_KEY = 'cassiellos_meta_sent'
const EVENT_ID = /^[a-z0-9_]{6,120}$/

/** Remove os cookies da Meta deste domínio e do domínio pai quando o visitante recusa ou revoga. */
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
  const marketing = getConsent()?.marketing ?? null
  return { consent: marketing === true, decided: marketing !== null }
}

function sentIds(): string[] {
  try {
    const list: unknown = JSON.parse(sessionStorage.getItem(SENT_KEY) || '[]')
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []
  } catch { return [] }
}
function markSent(eventId: string): void {
  try {
    sessionStorage.setItem(SENT_KEY, JSON.stringify([...sentIds(), eventId].slice(-20)))
  } catch { /* storage unavailable: the CRM event_id still deduplicates on Meta's side */ }
}

/**
 * Conversão no navegador com o MESMO event_id do CRM (deduplicação futura com a CAPI).
 * Não faz nada se o Pixel não estiver carregado (chave desligada, página fora do funil ou sem
 * consentimento de marketing), se o event_id for inválido ou se já tiver sido enviado nesta aba.
 */
export function trackMetaConversion(
  eventName: MetaEventName, eventId: unknown, params: { content_name?: string; homologation?: boolean } = {},
): boolean {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return false
  if (!marketingAllowed()) return false
  if (typeof eventId !== 'string' || !EVENT_ID.test(eventId) || sentIds().includes(eventId)) return false
  const safe: Record<string, string> = typeof params.content_name === 'string' && /^[a-z0-9-]{1,64}$/.test(params.content_name)
    ? { content_name: params.content_name } : {}
  // Marca fixa e não pessoal dos eventos de homologação (enviados só ao dataset de homologação).
  if (params.homologation === true) safe.cassiellos_teste = 'homologacao'
  window.fbq('track', eventName, safe, { eventID: eventId })
  markSent(eventId)
  return true
}
