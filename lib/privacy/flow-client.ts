import { flowAttribution } from './analytics-policy'

/**
 * Envio ao AnalyticsFlow (cassiellOS, via /api/analyticsflow → os.cassiellos.com.br). Somente os tipos de evento
 * que o destino já recebe. Sem rótulos, valores de formulário, nome, e-mail ou telefone; URL e referrer só com
 * origem + caminho; atribuição pela política por escopo (no CRM: gclid/fbclid = null).
 * Quem chama decide o consentimento (no escopo do CRM, só com consentimento de métricas).
 */
const ANALYTICS_FLOW_ENDPOINT = '/api/analyticsflow/events'
const ANALYTICS_FLOW_CLIENT = 'cassiellos-site'

export type FlowEventType = 'page_view' | 'cta_click' | 'whatsapp_click' | 'form_submit'

function safePageUrl() {
  const url = new URL(window.location.href)
  return `${url.origin}${url.pathname}`
}

function safeReferrer() {
  if (!document.referrer) return null
  try {
    const url = new URL(document.referrer)
    return `${url.origin}${url.pathname}`
  } catch {
    return null
  }
}

export function trackAnalyticsFlow(eventType: FlowEventType, contentId?: string) {
  const payload = JSON.stringify({
    event_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    client_id: ANALYTICS_FLOW_CLIENT,
    event_type: eventType,
    url: safePageUrl(),
    referrer: safeReferrer(),
    content_id: contentId || null,
    ...flowAttribution(window.location.pathname, window.location.search),
  })
  void fetch(ANALYTICS_FLOW_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
    credentials: 'same-origin',
  }).catch(() => undefined)
}
