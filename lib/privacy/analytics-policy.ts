import { VERCEL_MINIMIZE_CRM } from './flags/vercel-crm'
import { VERCEL_MINIMIZE_SITE } from './flags/vercel-site'
import { FLOW_MINIMIZE_CRM } from './flags/flow-crm'
import { FLOW_MINIMIZE_SITE } from './flags/flow-site'
import { isCrmScopePath } from './scope'
import { analyticsUrl, originAndPath, utmFromSearch } from './url-sanitize'

/**
 * Política de minimização por canal e escopo (P1/P2). Com a chave desligada, o comportamento é
 * EXATAMENTE o anterior; com a chave ligada, identificadores de clique não são enviados.
 */

function pathOf(url: string): string {
  try { return new URL(url).pathname } catch { return '' }
}

function vercelEnabled(pathname: string): boolean {
  return isCrmScopePath(pathname) ? VERCEL_MINIMIZE_CRM : VERCEL_MINIMIZE_SITE
}

/** URL enviada à Vercel Analytics. */
export function vercelAnalyticsUrl(url: string): string {
  return vercelEnabled(pathOf(url)) ? analyticsUrl(url) : url
}

/** URL enviada ao Speed Insights. */
export function speedInsightsUrl(url: string): string {
  return vercelEnabled(pathOf(url)) ? (originAndPath(url) || url) : url
}

export type FlowAttribution = {
  utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; utm_content: string | null
  gclid: string | null; fbclid: string | null
}

/** Atribuição enviada ao AnalyticsFlow (cassiellOS). Formato inalterado; com a chave ligada, gclid/fbclid = null. */
export function flowAttribution(pathname: string, search: string): FlowAttribution {
  const minimize = isCrmScopePath(pathname) ? FLOW_MINIMIZE_CRM : FLOW_MINIMIZE_SITE
  if (!minimize) {
    const params = new URLSearchParams(search)
    const raw = (key: string) => params.get(key) || null
    return {
      utm_source: raw('utm_source'), utm_medium: raw('utm_medium'), utm_campaign: raw('utm_campaign'),
      utm_content: raw('utm_content'), gclid: raw('gclid'), fbclid: raw('fbclid'),
    }
  }
  const utm = utmFromSearch(search)
  return {
    utm_source: utm.utm_source ?? null, utm_medium: utm.utm_medium ?? null, utm_campaign: utm.utm_campaign ?? null,
    utm_content: utm.utm_content ?? null, gclid: null, fbclid: null,
  }
}

// ── Consentimento de métricas (etapa 3) ─────────────────────────────────────────────────────────

/**
 * No escopo do CRM (funil /agendar e painel /crm), métricas opcionais — Vercel Web Analytics, Speed Insights,
 * AnalyticsFlow e eventos do funil — só funcionam com consentimento. O site institucional mantém o comportamento
 * atual (alterações institucionais dependem de autorização própria para a main).
 */
export function requiresAnalyticsConsent(pathname: string): boolean {
  return isCrmScopePath(pathname)
}

export function analyticsPermitted(pathname: string, consented: boolean): boolean {
  return !requiresAnalyticsConsent(pathname) || consented
}

/** URL para o beforeSend da Vercel Analytics; null = evento descartado (sem consentimento no escopo do CRM). */
export function vercelEventUrl(url: string, consented: boolean): string | null {
  return analyticsPermitted(pathOf(url), consented) ? vercelAnalyticsUrl(url) : null
}

/** URL para o beforeSend do Speed Insights; null = medição descartada. */
export function speedInsightsEventUrl(url: string, consented: boolean): string | null {
  return analyticsPermitted(pathOf(url), consented) ? speedInsightsUrl(url) : null
}
