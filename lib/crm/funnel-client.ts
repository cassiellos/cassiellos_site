import { track } from '@vercel/analytics'
import { analyticsAllowed } from '../privacy/consent-client'
import { trackAnalyticsFlow } from '../privacy/flow-client'
import { ensureVercelQueue } from '../privacy/vercel-client'
import { funnelDedupeKey, sanitizeFunnelProps, type FunnelEventName } from './funnel-events'

/**
 * Emissor dos eventos do funil no navegador.
 * - Sem consentimento de métricas: nada é enviado, nada é guardado (nem a chave de deduplicação).
 * - Com consentimento: Vercel Web Analytics (evento personalizado, propriedades higienizadas) e o evento local
 *   `cassiellos:funnel` — ponto único em que a Etapa 4 poderá ligar o Meta Pixel, com consentimento de marketing
 *   próprio e somente para mode = "live". Nada é enviado à Meta nesta etapa.
 * - AnalyticsFlow (cassiellOS): só o lead registrado em modo "live", como `form_submit` (tipo já aceito pelo
 *   destino). Eventos de teste não chegam ao AnalyticsFlow como conversão.
 */
export const FUNNEL_EVENT = 'cassiellos:funnel'
const STORAGE_KEY = 'cassiellos_funnel_sent'
const sentInThisPage = new Set<string>()

function storedKeys(): string[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    const list: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function alreadySent(key: string): boolean {
  return sentInThisPage.has(key) || storedKeys().includes(key)
}

function markSent(key: string) {
  sentInThisPage.add(key)
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...storedKeys().filter(item => item !== key), key].slice(-60)))
  } catch {
    // Sem sessionStorage (modo privado/bloqueio): vale a deduplicação desta página.
  }
}

/** Envia um marco do funil. Retorna true quando o evento saiu (com consentimento e sem duplicidade). */
export function emitFunnel(name: FunnelEventName, input: Record<string, unknown>, ref?: string | null): boolean {
  if (typeof window === 'undefined' || !analyticsAllowed()) return false
  const props = sanitizeFunnelProps(input)
  if (!props) return false
  const key = funnelDedupeKey(name, props, ref)
  if (!key || alreadySent(key)) return false
  markSent(key)

  window.dispatchEvent(new CustomEvent(FUNNEL_EVENT, { detail: { name, ...props } }))
  ensureVercelQueue()
  track(name, props)
  if (name === 'booking_lead_registered' && props.mode === 'live') trackAnalyticsFlow('form_submit', 'booking:' + props.form)
  return true
}
