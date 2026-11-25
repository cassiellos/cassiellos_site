import { analyticsAllowed } from '../privacy/consent-client'
import { trackAnalyticsFlow } from '../privacy/flow-client'
import {
  sanitizeTrackingParams, toDataLayerEvent, trackingDedupeKey, type TrackingEventName, type TrackingParams,
} from './funnel-contract'

/**
 * Emissor ÚNICO dos eventos do funil no navegador (dataLayer do GTM).
 * - Sem consentimento de métricas do CRM: nada é enviado, nada é guardado (nem a chave de deduplicação).
 * - Prévia do painel (`environment_mode = preview`): nunca emite.
 * - Só os parâmetros do contrato (lib/tracking/funnel-contract) chegam ao dataLayer; o resto é descartado.
 * - Só o formulário do escopo (`isTrackingScopeForm`) emite; qualquer outro `form_id` é descartado (F2).
 * - Cada push reinicializa os parâmetros opcionais ausentes (nada herdado do evento anterior; F1).
 * - Deduplicação por marco, na memória da página e no sessionStorage da aba (guarda só um resumo da chave).
 * - `generate_lead` de visitante real também vira UM `form_submit` no AnalyticsFlow (o mesmo critério do /agendar),
 *   substituindo a contagem antiga por pergunta respondida.
 * - Nenhuma chamada de rede além do AnalyticsFlow que já existia; o GTM só lê o dataLayer, se estiver carregado.
 */
export const TRACK_EVENT = 'cassiellos:track'
const STORAGE_KEY = 'cassiellos_dl_sent'
const sentInThisPage = new Set<string>()

declare global {
  interface Window { dataLayer?: unknown[] }
}

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
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...storedKeys().filter(item => item !== key), key].slice(-80)))
  } catch {
    // Sem sessionStorage (modo privado/bloqueio): vale a deduplicação desta página.
  }
}

/** Empurra um evento do funil. Retorna true quando o evento saiu (com consentimento, sem duplicidade e higienizado). */
export function pushTrackingEvent(
  name: TrackingEventName,
  input: Record<string, unknown>,
  ref?: string | null,
  options: { dedupe?: boolean } = {},
): boolean {
  if (typeof window === 'undefined' || !analyticsAllowed()) return false
  const params: TrackingParams | null = sanitizeTrackingParams(input)
  if (!params || params.environment_mode === 'preview') return false
  if (options.dedupe !== false) {
    const key = trackingDedupeKey(name, params, ref)
    if (!key || alreadySent(key)) return false
    markSent(key)
  }
  window.dataLayer = window.dataLayer || []
  // F1: cada push reinicializa os parâmetros opcionais que este evento não tem (o modelo do GTM mescla pushes).
  window.dataLayer.push(toDataLayerEvent(name, params))
  window.dispatchEvent(new CustomEvent(TRACK_EVENT, { detail: { name, ...params } }))
  if (name === 'generate_lead' && params.environment_mode === 'live') {
    trackAnalyticsFlow('form_submit', 'form:' + params.form_id)
  }
  return true
}
