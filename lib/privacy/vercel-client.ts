import { speedInsightsEventUrl, vercelEventUrl } from './analytics-policy'
import { analyticsAllowed } from './consent-client'

/**
 * beforeSend únicos da Vercel (Web Analytics e Speed Insights): releem o consentimento a cada envio (a revogação
 * vale na hora) e minimizam a URL conforme o escopo. null = envio descartado.
 */
export function vercelBeforeSend<T extends { url: string }>(event: T): T | null {
  const url = vercelEventUrl(event.url, analyticsAllowed())
  return url === null ? null : { ...event, url }
}

export function speedInsightsBeforeSend<T extends { url: string }>(event: T): T | null {
  const url = speedInsightsEventUrl(event.url, analyticsAllowed())
  return url === null ? null : { ...event, url }
}

type VaWindow = Window & { va?: (...params: unknown[]) => void; vaq?: unknown[][] }

/**
 * Garante a fila da Vercel ANTES de um evento do funil (mesma fila que a biblioteca cria em initQueue), já com o
 * beforeSend na frente: um evento emitido no instante do aceite — antes de o script montar — não se perde e
 * também não sai sem minimização.
 */
export function ensureVercelQueue(): void {
  const win = window as VaWindow
  if (win.va) return
  win.va = function queue(...params: unknown[]) {
    if (!win.vaq) win.vaq = []
    win.vaq.push(params)
  }
  win.va('beforeSend', vercelBeforeSend)
}
