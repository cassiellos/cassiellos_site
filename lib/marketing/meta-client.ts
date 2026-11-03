'use client'

import { getConsent, marketingAllowed } from '@/lib/privacy/consent-client'
import { chronosEventId, isChronosCustomEvent, type ChronosCustomEvent, type MarketingConsentInput, type MetaEventName } from './meta'

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
  // Marca fixa e não pessoal dos eventos de homologação (Pixel comercial; 1 Lead e 1 Schedule por liberação).
  if (params.homologation === true) safe.cassiellos_teste = 'homologacao'
  window.fbq('track', eventName, safe, { eventID: eventId })
  markSent(eventId)
  return true
}

const CHRONOS_SESSION_KEY = 'cassiellos_chronos_session'

/** Identificador aleatório da sessão desta aba (sessionStorage). Sem armazenamento: null (e nada é enviado). */
export function chronosSessionId(): string | null {
  try {
    const current = sessionStorage.getItem(CHRONOS_SESSION_KEY)
    if (current && /^[a-f0-9]{32}$/.test(current)) return current
    const bytes = new Uint8Array(16)
    globalThis.crypto.getRandomValues(bytes)
    const id = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
    sessionStorage.setItem(CHRONOS_SESSION_KEY, id)
    return sessionStorage.getItem(CHRONOS_SESSION_KEY) === id ? id : null
  } catch { return null }
}

/**
 * Evento PERSONALIZADO da jornada (fbq trackCustom). Mesmas garantias das conversões: só com o Pixel carregado e
 * consentimento de marketing; sem dados pessoais (apenas o slug do formulário e a marca de homologação); no máximo
 * uma vez por evento e sessão (event_id por evento+sessão, também lembrado nesta aba). Quem chama decide QUANDO
 * enviar (hoje: somente na liberação de homologação "chronos").
 */
export function trackChronosEvent(
  event: ChronosCustomEvent, params: { content_name?: string; homologation?: boolean } = {},
): boolean {
  if (typeof window === 'undefined' || typeof window.fbq !== 'function') return false
  if (!marketingAllowed() || !isChronosCustomEvent(event)) return false
  const sessionId = chronosSessionId()
  const eventId = sessionId ? chronosEventId(event, sessionId) : null
  if (!eventId || !EVENT_ID.test(eventId) || sentIds().includes(eventId)) return false
  const safe: Record<string, string> = typeof params.content_name === 'string' && /^[a-z0-9-]{1,64}$/.test(params.content_name)
    ? { content_name: params.content_name } : {}
  if (params.homologation === true) safe.cassiellos_teste = 'homologacao'
  window.fbq('trackCustom', event, safe, { eventID: eventId })
  markSent(eventId)
  return true
}
