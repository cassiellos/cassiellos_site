/**
 * Conector REAL da Meta (somente leitura) — Marketing API / Ads Insights (versão em MI_META_GRAPH_VERSION; padrão v26.0).
 *
 * - Toda chamada passa por `assertReadOnlyRequest` (só GET em /me/adaccounts, /act_<id>, /act_<id>/campaigns|insights).
 * - Token: usuário de sistema do portfólio empresarial (recomendado) ou token de usuário de longa duração, com `ads_read`.
 *   NÃO reutiliza o token do CAPI. Com o segredo do app configurado, envia `appsecret_proof`.
 * - Conversões: UMA definição explícita por ambiente (`MI_META_RESULT_ACTION`, padrão `lead`) → basis `meta:actions:<tipo>`,
 *   janela de atribuição explícita `7d_click,1d_view`. Nunca é igualada a conversão do Google Ads nem a lead do CRM.
 * - Uma linha por campanha e dia (investimento/impressões/cliques não são duplicados entre definições).
 * - Paginação por cursor (`paging.cursors.after`); uso informado em X-Business-Use-Case-Usage / X-Ad-Account-Usage.
 */
import { createHmac } from 'node:crypto'
import { assertReadOnlyRequest } from './read-only-guard'
import { ConnectorError, type AdAccountInfo, type AdsReadConnector, type CampaignInfo, type CampaignStatus, type ConnectorContext, type DailyAdsRow, type ExternalAccountStatus, type Page, type RateLimitState } from './contracts'
import { kindForStatus, requestJson, safeCode, type FetchLike } from './http'
import type { DateRange } from '../dates'

export const DEFAULT_META_GRAPH_VERSION = 'v26.0'
export const META_ATTRIBUTION = '7d_click,1d_view'
const GRAPH = 'https://graph.facebook.com'

export type MetaAdsConfig = {
  fetch: FetchLike
  graphVersion?: string
  /** Segredo do app (opcional) para appsecret_proof. */
  appSecret?: string | null
  /** Tipo de ação que conta como resultado (ex.: lead, purchase, offsite_conversion.fb_pixel_lead). */
  resultAction?: string
  accessToken: (connectionId: string) => Promise<string>
}

/** Códigos oficiais de limite (4, 17, 32, 613, 80000–80014) e de token (190, 102); permissão (10, 200–299). */
export function mapMetaError(status: number, body: unknown, headers: { get(n: string): string | null }): ConnectorError {
  const err = (body as { error?: { code?: number; error_subcode?: number; type?: string } })?.error
  const code = typeof err?.code === 'number' ? err.code : null
  let kind = kindForStatus(status)
  if (code !== null) {
    if (code === 190 || code === 102) kind = err?.error_subcode === 458 || err?.error_subcode === 460 ? 'auth_revoked' : 'auth_expired'
    else if ([4, 17, 32, 613].includes(code) || (code >= 80000 && code <= 80014)) kind = 'rate_limited'
    else if (code === 10 || (code >= 200 && code <= 299)) kind = 'permission_denied'
    else if (code === 100 && status === 404) kind = 'not_found'
    else if (code === 1 || code === 2) kind = 'transient'
  }
  let retry: number | null = null
  const usage = headers.get('x-business-use-case-usage')
  if (usage) try {
    for (const list of Object.values(JSON.parse(usage) as Record<string, { estimated_time_to_regain_access?: number }[]>))
      for (const u of list) if (u.estimated_time_to_regain_access) retry = Math.max(retry ?? 0, u.estimated_time_to_regain_access * 60)
  } catch { /* cabeçalho malformado: ignora */ }
  return new ConnectorError(kind, ['meta_ads', status, code, err?.error_subcode, safeCode(err?.type)].filter(v => v !== null && v !== undefined).join(' '), retry)
}

const accountStatus = (s: unknown): ExternalAccountStatus =>
  s === 1 || s === 9 ? 'active' : s === 2 || s === 3 || s === 7 || s === 8 ? 'suspended' : s === 100 || s === 101 ? 'closed' : 'unknown'
const campaignStatus = (s: unknown): CampaignStatus => (s === 'ACTIVE' ? 'active' : s === 'DELETED' || s === 'ARCHIVED' ? 'removed' : 'paused')
const num = (v: unknown) => { const x = typeof v === 'string' ? Number(v) : typeof v === 'number' ? v : 0; return Number.isFinite(x) && x >= 0 ? x : 0 }
const act = (id: string) => { const d = id.replace(/^act_/, ''); if (!/^\d{5,20}$/.test(d)) throw new ConnectorError('invalid_request', 'ID de conta inválido'); return d }
const ACCOUNT_FIELDS = 'account_id,name,currency,timezone_name,account_status,business'

export function createMetaAdsConnector(cfg: MetaAdsConfig): AdsReadConnector {
  const version = cfg.graphVersion && /^v\d{2,3}\.\d$/.test(cfg.graphVersion) ? cfg.graphVersion : DEFAULT_META_GRAPH_VERSION
  const resultAction = cfg.resultAction && /^[a-z0-9_.]{2,60}$/.test(cfg.resultAction) ? cfg.resultAction : 'lead'
  let usage: RateLimitState = { remaining: null, usagePercent: null }

  async function get(ctx: ConnectorContext, path: string, params: Record<string, string>) {
    assertReadOnlyRequest({ platform: 'meta_ads', httpMethod: 'GET', path })
    const token = await cfg.accessToken(ctx.connectionId)
    const qs = new URLSearchParams(params)
    if (cfg.appSecret) qs.set('appsecret_proof', createHmac('sha256', cfg.appSecret).update(token).digest('hex'))
    const { body, headers } = await requestJson(cfg.fetch, `${GRAPH}/${version}${path}?${qs}`, { method: 'GET', headers: { Authorization: 'Bearer ' + token } }, mapMetaError)
    const h = headers.get('x-ad-account-usage') ?? headers.get('x-business-use-case-usage')
    if (h) try { const p = JSON.stringify(JSON.parse(h)).match(/"(?:acc_id_util_pct|call_count)":\s*([\d.]+)/); usage = { remaining: null, usagePercent: p ? Number(p[1]) : null } } catch { /* ignora */ }
    return body as { data?: Record<string, unknown>[]; paging?: { cursors?: { after?: string }; next?: string } } & Record<string, unknown>
  }
  const nextOf = (b: { paging?: { cursors?: { after?: string }; next?: string } }) => (b.paging?.next && b.paging.cursors?.after ? b.paging.cursors.after : null)

  const toAccount = (a: Record<string, unknown>): AdAccountInfo => ({
    platform: 'meta_ads', externalId: act(String(a.account_id ?? a.id ?? '')), name: String(a.name ?? '') || String(a.account_id ?? ''),
    currencyCode: String(a.currency ?? ''), timeZone: String(a.timezone_name ?? ''), status: accountStatus(a.account_status),
    parentExternalId: (a.business as { id?: string } | undefined)?.id ?? null,
  })

  return {
    platform: 'meta_ads',
    rateLimit: () => usage,

    async listAccessibleAccounts(ctx, pageToken) {
      const b = await get(ctx, '/me/adaccounts', { fields: ACCOUNT_FIELDS, limit: '100', ...(pageToken ? { after: pageToken } : {}) })
      return { items: (b.data ?? []).map(toAccount), nextPageToken: nextOf(b) }
    },

    async getAccount(ctx, externalId) {
      return toAccount(await get(ctx, '/act_' + act(externalId), { fields: ACCOUNT_FIELDS }))
    },

    async listCampaigns(ctx, externalId, pageToken): Promise<Page<CampaignInfo>> {
      const b = await get(ctx, `/act_${act(externalId)}/campaigns`, { fields: 'id,name,effective_status,objective', limit: '200', ...(pageToken ? { after: pageToken } : {}) })
      return { items: (b.data ?? []).map(c => ({ externalId: String(c.id ?? ''), name: String(c.name ?? ''), status: campaignStatus(c.effective_status), channel: String(c.objective ?? '').slice(0, 60) }))
        .filter(c => /^\d{1,25}$/.test(c.externalId)), nextPageToken: nextOf(b) }
    },

    async getDailyMetrics(ctx, externalId, range: DateRange, pageToken): Promise<Page<DailyAdsRow>> {
      const b = await get(ctx, `/act_${act(externalId)}/insights`, {
        level: 'campaign', time_increment: '1', time_range: JSON.stringify({ since: range.start, until: range.end }),
        fields: 'campaign_id,date_start,impressions,reach,frequency,clicks,spend,actions',
        action_attribution_windows: JSON.stringify(['7d_click', '1d_view']), limit: '500', ...(pageToken ? { after: pageToken } : {}),
      })
      return {
        items: (b.data ?? []).map(r => {
          const actions = (r.actions as { action_type?: string; value?: string }[] | undefined)
          const hit = actions?.find(x => x.action_type === resultAction)
          return {
            campaignExternalId: String(r.campaign_id ?? ''), date: String(r.date_start ?? ''),
            impressions: num(r.impressions), clicks: num(r.clicks),
            // `spend` vem na moeda da conta com 2 casas; micros = × 1.000.000 (arredondado)
            costMicros: Math.round(num(r.spend) * 1_000_000),
            conversions: actions === undefined ? 0 : hit ? num(hit.value) : 0,
            conversionBasis: 'meta:actions:' + resultAction, attribution: 'meta:' + META_ATTRIBUTION,
          }
        }).filter(x => /^\d{1,25}$/.test(x.campaignExternalId) && /^\d{4}-\d{2}-\d{2}$/.test(x.date)),
        nextPageToken: nextOf(b),
      }
    },
  }
}
