/**
 * Conector REAL do Google Ads (somente leitura) — REST da Google Ads API (versão em MI_GOOGLE_ADS_API_VERSION; padrão v26).
 *
 * - Toda chamada passa por `assertReadOnlyRequest` (só ListAccessibleCustomers e GoogleAdsService.Search com GAQL SELECT).
 * - Cabeçalhos: Authorization (token de acesso de curta duração, obtido no servidor); legacy developer-token
 *   é opcional desde 09/09/2026 e ignorado pela API; para MCC, login-customer-id com ID do gerente.
 * - Métricas: `metrics.conversions` = conversões PRINCIPAIS conforme as definições e o modelo de atribuição DA CONTA
 *   (basis `google:conversions`, attribution `google:modelo-da-conta`). Não é somado a conversões da Meta nem a leads do CRM.
 * - Valores int64 chegam como texto e campos zerados podem ser omitidos pela API (proto3 JSON): ausência = 0 real.
 */
import { assertReadOnlyRequest } from './read-only-guard'
import { ConnectorError, type AdAccountInfo, type AdsReadConnector, type CampaignInfo, type CampaignStatus, type ConnectorContext, type DailyAdsRow, type ExternalAccountStatus, type Page, type RateLimitState } from './contracts'
import { kindForStatus, requestJson, safeCode, type FetchLike } from './http'
import type { DateRange } from '../dates'

export const DEFAULT_GOOGLE_ADS_API_VERSION = 'v26'
const API = 'https://googleads.googleapis.com'

export type GoogleAdsConfig = {
  fetch: FetchLike
  apiVersion?: string
  developerToken?: string
  /** Token de acesso da conexão (renovado no servidor a partir do refresh token guardado no cofre). */
  accessToken: (connectionId: string) => Promise<string>
}

const MAX_DISCOVERY = 50
const CUSTOMER_FIELDS = 'customer.id, customer.descriptive_name, customer.currency_code, customer.time_zone, customer.manager, customer.status'

export function mapGoogleError(status: number, body: unknown, headers: { get(n: string): string | null }): ConnectorError {
  const err = (body as { error?: { status?: string; details?: { errors?: { errorCode?: Record<string, string> }[]; retryDelay?: string }[] } })?.error
  const codes = (err?.details ?? []).flatMap(d => (d.errors ?? []).flatMap(e => Object.values(e.errorCode ?? {}))).map(safeCode).filter(Boolean) as string[]
  const retryRaw = (err?.details ?? []).map(d => d.retryDelay).find(Boolean) ?? headers.get('retry-after')
  const retry = retryRaw ? Math.ceil(parseFloat(String(retryRaw))) : null
  let kind = kindForStatus(status)
  if (codes.includes('RESOURCE_EXHAUSTED') || codes.includes('RESOURCE_TEMPORARILY_EXHAUSTED')) kind = 'rate_limited'
  if (codes.includes('USER_PERMISSION_DENIED') || codes.includes('CUSTOMER_NOT_ENABLED')) kind = 'permission_denied'
  return new ConnectorError(kind, ['google_ads', status, safeCode(err?.status), ...codes.slice(0, 3)].filter(Boolean).join(' '), Number.isFinite(retry) ? retry : null)
}

const accountStatus = (s: unknown): ExternalAccountStatus =>
  s === 'ENABLED' ? 'active' : s === 'SUSPENDED' ? 'suspended' : s === 'CANCELED' || s === 'CLOSED' ? 'closed' : 'unknown'
const campaignStatus = (s: unknown): CampaignStatus => (s === 'ENABLED' ? 'active' : s === 'PAUSED' ? 'paused' : 'removed')
const n = (v: unknown) => { const x = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0; return Number.isFinite(x) && x >= 0 ? x : 0 }
const gaqlDate = (d: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new ConnectorError('invalid_request', 'data inválida'); return d }
const cid = (id: string) => { const d = id.replace(/-/g, ''); if (!/^\d{10}$/.test(d)) throw new ConnectorError('invalid_request', 'ID de conta inválido'); return d }

export function createGoogleAdsConnector(cfg: GoogleAdsConfig): AdsReadConnector {
  const version = cfg.apiVersion && /^v\d{2,3}$/.test(cfg.apiVersion) ? cfg.apiVersion : DEFAULT_GOOGLE_ADS_API_VERSION
  let lastQuota: RateLimitState = { remaining: null, usagePercent: null }

  async function headers(ctx: ConnectorContext, loginCustomerId: string | null) {
    const h: Record<string, string> = { Authorization: 'Bearer ' + (await cfg.accessToken(ctx.connectionId)), 'Content-Type': 'application/json' }
    if (cfg.developerToken?.trim()) h['developer-token'] = cfg.developerToken.trim()
    if (loginCustomerId) h['login-customer-id'] = cid(loginCustomerId)
    return h
  }

  async function search(ctx: ConnectorContext, customerId: string, query: string, pageToken: string | null, loginCustomerId: string | null) {
    assertReadOnlyRequest({ platform: 'google_ads', service: 'GoogleAdsService', method: 'Search', query })
    const { body } = await requestJson(cfg.fetch, `${API}/${version}/customers/${cid(customerId)}/googleAds:search`,
      { method: 'POST', headers: await headers(ctx, loginCustomerId), body: JSON.stringify(pageToken ? { query, pageToken } : { query }) }, mapGoogleError)
    const b = (body ?? {}) as { results?: Record<string, Record<string, unknown>>[]; nextPageToken?: string }
    return { results: b.results ?? [], nextPageToken: b.nextPageToken || null }
  }

  const toAccount = (c: Record<string, unknown>, parent: string | null): AdAccountInfo => ({
    platform: 'google_ads', externalId: cid(String(c.id)), name: String(c.descriptiveName ?? '') || cid(String(c.id)),
    currencyCode: String(c.currencyCode ?? ''), timeZone: String(c.timeZone ?? ''), status: accountStatus(c.status), parentExternalId: parent,
  })

  return {
    platform: 'google_ads',
    rateLimit: () => lastQuota,

    async listAccessibleAccounts(ctx) {
      assertReadOnlyRequest({ platform: 'google_ads', service: 'CustomerService', method: 'ListAccessibleCustomers' })
      const { body } = await requestJson(cfg.fetch, `${API}/${version}/customers:listAccessibleCustomers`, { method: 'GET', headers: await headers(ctx, null) }, mapGoogleError)
      const ids = ((body as { resourceNames?: string[] })?.resourceNames ?? []).map(r => r.replace(/^customers\//, '')).filter(id => /^\d{10}$/.test(id)).slice(0, MAX_DISCOVERY)
      const out = new Map<string, AdAccountInfo>()
      for (const id of ids) {
        let me: Record<string, unknown> | undefined
        try { me = (await search(ctx, id, `SELECT ${CUSTOMER_FIELDS} FROM customer LIMIT 1`, null, id)).results[0]?.customer } catch (e) {
          if (e instanceof ConnectorError && (e.kind === 'permission_denied' || e.kind === 'not_found')) continue
          throw e
        }
        if (!me) continue
        if (me.manager === true) {
          // Conta gerente (MCC): lista as contas clientes diretas; acesso a elas usa login-customer-id = gerente.
          let token: string | null = null
          do {
            const page = await search(ctx, id, `SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.time_zone, customer_client.status, customer_client.manager, customer_client.level FROM customer_client WHERE customer_client.level <= 1 AND customer_client.manager = false`, token, id)
            for (const r of page.results) { const cc = r.customerClient; if (cc) { const a = toAccount(cc, id); if (!out.has(a.externalId)) out.set(a.externalId, a) } }
            token = page.nextPageToken
          } while (token)
        } else {
          out.set(id, toAccount(me, null)) // acesso direto tem prioridade sobre o caminho via MCC
        }
      }
      return { items: [...out.values()], nextPageToken: null }
    },

    async getAccount(ctx, externalId) {
      const { results } = await search(ctx, externalId, `SELECT ${CUSTOMER_FIELDS} FROM customer LIMIT 1`, null, ctx.loginCustomerId ?? null)
      if (!results[0]?.customer) throw new ConnectorError('not_found', 'conta não encontrada')
      return toAccount(results[0].customer, ctx.loginCustomerId ?? null)
    },

    async listCampaigns(ctx, externalId, pageToken): Promise<Page<CampaignInfo>> {
      const page = await search(ctx, externalId, `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type FROM campaign`, pageToken ?? null, ctx.loginCustomerId ?? null)
      return { items: page.results.map(r => ({ externalId: String(r.campaign?.id ?? ''), name: String(r.campaign?.name ?? ''), status: campaignStatus(r.campaign?.status), channel: String(r.campaign?.advertisingChannelType ?? '') }))
        .filter(c => /^\d{1,20}$/.test(c.externalId)), nextPageToken: page.nextPageToken }
    },

    async getDailyMetrics(ctx, externalId, range: DateRange, pageToken): Promise<Page<DailyAdsRow>> {
      const q = `SELECT campaign.id, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE segments.date BETWEEN '${gaqlDate(range.start)}' AND '${gaqlDate(range.end)}'`
      const page = await search(ctx, externalId, q, pageToken ?? null, ctx.loginCustomerId ?? null)
      return {
        items: page.results.map(r => ({
          campaignExternalId: String(r.campaign?.id ?? ''), date: String(r.segments?.date ?? ''),
          impressions: n(r.metrics?.impressions), clicks: n(r.metrics?.clicks), costMicros: Math.round(n(r.metrics?.costMicros)), conversions: n(r.metrics?.conversions),
          conversionBasis: 'google:conversions', attribution: 'google:modelo-da-conta',
        })).filter(x => /^\d{1,20}$/.test(x.campaignExternalId) && /^\d{4}-\d{2}-\d{2}$/.test(x.date)),
        nextPageToken: page.nextPageToken,
      }
    },
  }
}
