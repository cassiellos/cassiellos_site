/**
 * Adaptadores MOCK (reprodutíveis) dos contratos de leitura. Nenhuma rede, nenhum SDK, nenhum segredo.
 *
 * Os números são gerados de forma DETERMINÍSTICA a partir de (semente, campanha, dia): a mesma consulta sempre devolve
 * o mesmo resultado — testes e telas de demonstração são estáveis. Também simulam paginação, moeda, fuso, estado da
 * conta, limites de chamadas e falhas (429, transitórias, autorização expirada), para exercitar a sincronização.
 */
import { eachDay, type CivilDate, type DateRange } from '../dates'
import {
  ConnectorError, type AdAccountInfo, type AdsPlatformId, type AdsReadConnector, type CampaignInfo, type CampaignStatus,
  type ConnectorContext, type ConnectorErrorKind, type DailyAdsRow, type ExternalAccountStatus, type Ga4DailyRow,
  type Ga4PropertyInfo, type Ga4ReadConnector, type GtmContainerInfo, type GtmDiagnostics, type GtmReadConnector, type Page, type RateLimitState,
} from './contracts'

/* ---------- aleatoriedade determinística ---------- */
export function hash32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) }
  return h >>> 0
}
/** Número em [0, 1) derivado do texto. */
export function unit(text: string): number { return hash32(text) / 0x1_0000_0000 }

/* ---------- especificação do mundo simulado ---------- */
export type MockCampaignSpec = {
  externalId: string
  name: string
  channel: string
  /** Período de veiculação (fora dele não há linhas = sem investimento). */
  activeFrom: CivilDate
  activeUntil: CivilDate | null
  /** Pausas temporárias (dias sem investimento). */
  gaps?: readonly DateRange[]
  dailyImpressions: number
  ctrPct: number
  cpcMicros: number
  /** Taxa de conversão sobre cliques; null = conversões não reportadas por esta campanha. */
  conversionRate: number | null
}

export type MockAdAccountSpec = {
  platform: AdsPlatformId
  externalId: string
  name: string
  currencyCode: string
  timeZone: string
  status: ExternalAccountStatus
  parentExternalId: string | null
  campaigns: readonly MockCampaignSpec[]
}

export type MockFault = { kind: ConnectorErrorKind; retryAfterSeconds?: number; /** chamadas que falham (1-based) */ calls: readonly number[] }

export type MockWorldOptions = {
  pageSize?: number
  /** Conexões e seu estado: expirada/revogada faz QUALQUER chamada falhar. */
  connections: Readonly<Record<string, 'active' | 'expired' | 'revoked'>>
  /** Contas que cada conexão enxerga (acesso direto ou via gerente). */
  access: Readonly<Record<string, readonly string[]>>
  /** Falhas programadas por conta (contagem de chamadas por conta). */
  faults?: Readonly<Record<string, MockFault>>
  quotaPerDay?: number
}

const ATTRIBUTION: Record<AdsPlatformId, string> = { google_ads: 'google:modelo-da-conta', meta_ads: 'meta:7d_click,1d_view' }
const BASIS: Record<AdsPlatformId, string> = { google_ads: 'google:conversions', meta_ads: 'meta:actions:lead' }

function isActiveOn(c: MockCampaignSpec, day: CivilDate): boolean {
  if (day < c.activeFrom) return false
  if (c.activeUntil && day > c.activeUntil) return false
  return !(c.gaps ?? []).some(g => day >= g.start && day <= g.end)
}

function weekdayFactor(day: CivilDate): number {
  const dow = new Date(day + 'T12:00:00Z').getUTCDay() // dia civil → dia da semana (meio-dia UTC: sem risco de virada)
  return dow === 0 ? 0.62 : dow === 6 ? 0.74 : 1
}

/** Linha determinística de uma campanha num dia (null = sem veiculação). */
export function simulateDay(account: MockAdAccountSpec, c: MockCampaignSpec, day: CivilDate): DailyAdsRow | null {
  if (!isActiveOn(c, day)) return null
  const noise = 0.7 + unit(account.externalId + '|' + c.externalId + '|' + day) * 0.6
  const impressions = Math.max(0, Math.round(c.dailyImpressions * noise * weekdayFactor(day)))
  if (impressions === 0) return null
  const clicks = Math.round(impressions * (c.ctrPct / 100) * (0.85 + unit('c' + c.externalId + day) * 0.3))
  const costMicros = Math.round(clicks * c.cpcMicros * (0.9 + unit('$' + c.externalId + day) * 0.2) / 10_000) * 10_000 // centavos inteiros
  const conversions = c.conversionRate === null ? null : Math.round(clicks * c.conversionRate * (0.6 + unit('v' + c.externalId + day) * 0.8))
  return { campaignExternalId: c.externalId, date: day, impressions, clicks, costMicros, conversions,
    conversionBasis: BASIS[account.platform], attribution: ATTRIBUTION[account.platform] }
}

function campaignStatusOn(c: MockCampaignSpec, today: CivilDate): CampaignStatus {
  return c.activeUntil && c.activeUntil < today ? 'paused' : 'active'
}

function paginate<T>(all: readonly T[], pageToken: string | null | undefined, pageSize: number): Page<T> {
  const offset = pageToken ? Number(pageToken) : 0
  if (!Number.isInteger(offset) || offset < 0 || offset > all.length) throw new ConnectorError('invalid_request', 'token de página inválido')
  const items = all.slice(offset, offset + pageSize)
  return { items, nextPageToken: offset + pageSize < all.length ? String(offset + pageSize) : null }
}

/** Contabiliza chamadas, aplica estado da conexão, permissões e falhas programadas. */
class MockGate {
  private calls = new Map<string, number>()
  private total = 0
  constructor(private readonly opts: MockWorldOptions) {}
  check(ctx: ConnectorContext, accountId: string | null) {
    const state = this.opts.connections[ctx.connectionId]
    if (!state) throw new ConnectorError('permission_denied', 'conexão desconhecida')
    if (state === 'expired') throw new ConnectorError('auth_expired', 'autorização expirada (simulado)')
    if (state === 'revoked') throw new ConnectorError('auth_revoked', 'autorização revogada (simulado)')
    this.total++
    if (this.opts.quotaPerDay !== undefined && this.total > this.opts.quotaPerDay) throw new ConnectorError('rate_limited', 'cota diária esgotada (simulado)', 60)
    if (accountId === null) return
    if (!(this.opts.access[ctx.connectionId] ?? []).includes(accountId)) throw new ConnectorError('permission_denied', 'sem acesso à conta (simulado)')
    const n = (this.calls.get(accountId) ?? 0) + 1
    this.calls.set(accountId, n)
    const fault = this.opts.faults?.[accountId]
    if (fault && fault.calls.includes(n)) throw new ConnectorError(fault.kind, 'falha simulada: ' + fault.kind, fault.retryAfterSeconds ?? null)
  }
  remaining(): RateLimitState {
    return { remaining: this.opts.quotaPerDay === undefined ? null : Math.max(0, this.opts.quotaPerDay - this.total), usagePercent: null }
  }
}

export function createMockAdsConnector(platform: AdsPlatformId, accounts: readonly MockAdAccountSpec[], opts: MockWorldOptions, today: () => CivilDate): AdsReadConnector {
  const gate = new MockGate(opts)
  const pageSize = opts.pageSize ?? 50
  const mine = accounts.filter(a => a.platform === platform)
  const find = (id: string) => {
    const a = mine.find(x => x.externalId === id)
    if (!a) throw new ConnectorError('not_found', 'conta não encontrada (simulado)')
    return a
  }
  const info = (a: MockAdAccountSpec): AdAccountInfo => ({ platform, externalId: a.externalId, name: a.name, currencyCode: a.currencyCode,
    timeZone: a.timeZone, status: a.status, parentExternalId: a.parentExternalId })
  return {
    platform,
    async listAccessibleAccounts(ctx, pageToken) {
      gate.check(ctx, null)
      const visible = mine.filter(a => (opts.access[ctx.connectionId] ?? []).includes(a.externalId)).map(info)
      return paginate(visible, pageToken, pageSize)
    },
    async getAccount(ctx, id) { gate.check(ctx, id); return info(find(id)) },
    async listCampaigns(ctx, id, pageToken) {
      gate.check(ctx, id)
      const t = today()
      const list: CampaignInfo[] = find(id).campaigns.map(c => ({ externalId: c.externalId, name: c.name, status: campaignStatusOn(c, t), channel: c.channel }))
      return paginate(list, pageToken, pageSize)
    },
    async getDailyMetrics(ctx, id, range, pageToken) {
      gate.check(ctx, id)
      const a = find(id)
      const rows: DailyAdsRow[] = []
      for (const day of eachDay(range.start, range.end)) for (const c of a.campaigns) { const r = simulateDay(a, c, day); if (r) rows.push(r) }
      return paginate(rows, pageToken, pageSize)
    },
    rateLimit: () => gate.remaining(),
  }
}

/* ---------- GA4 ---------- */
export type MockGa4Spec = { externalId: string; name: string; timeZone: string; currencyCode: string; accountExternalId: string; dailySessions: number; activeFrom: CivilDate }
const GA4_SOURCES: readonly [string, string, string, number][] = [
  ['google', 'cpc', 'pesquisa_marca', 0.34], ['meta', 'paid_social', 'leads_regiao', 0.22], ['google', 'organic', '(organic)', 0.24],
  ['(direct)', '(none)', '(direct)', 0.12], ['instagram', 'organic_social', '(not set)', 0.08],
]
export function createMockGa4Connector(props: readonly MockGa4Spec[], opts: MockWorldOptions): Ga4ReadConnector {
  const gate = new MockGate(opts)
  const pageSize = opts.pageSize ?? 50
  return {
    platform: 'ga4',
    async listProperties(ctx, pageToken) {
      gate.check(ctx, null)
      const visible: Ga4PropertyInfo[] = props.filter(p => (opts.access[ctx.connectionId] ?? []).includes(p.externalId))
        .map(p => ({ externalId: p.externalId, name: p.name, timeZone: p.timeZone, currencyCode: p.currencyCode, accountExternalId: p.accountExternalId }))
      return paginate(visible, pageToken, pageSize)
    },
    async runDailyReport(ctx, id, range, pageToken) {
      gate.check(ctx, id)
      const p = props.find(x => x.externalId === id)
      if (!p) throw new ConnectorError('not_found', 'propriedade não encontrada (simulado)')
      const rows: Ga4DailyRow[] = []
      for (const day of eachDay(range.start, range.end)) {
        if (day < p.activeFrom) continue
        for (const [source, medium, campaign, share] of GA4_SOURCES) {
          const sessions = Math.round(p.dailySessions * share * weekdayFactor(day) * (0.7 + unit(id + source + day) * 0.6))
          if (sessions === 0) continue
          const engaged = Math.round(sessions * (0.48 + unit('e' + id + source + day) * 0.2))
          rows.push({ date: day, source, medium, campaign, sessions, totalUsers: Math.round(sessions * 0.86), engagedSessions: engaged,
            keyEvents: Math.round(engaged * 0.05 * (0.5 + unit('k' + id + source + day))) })
        }
      }
      return paginate(rows, pageToken, pageSize)
    },
    rateLimit: () => gate.remaining(),
  }
}

/* ---------- GTM (somente diagnóstico) ---------- */
export type MockGtmSpec = GtmContainerInfo & { diagnostics: Omit<GtmDiagnostics, 'publicId'> }
export function createMockGtmConnector(containers: readonly MockGtmSpec[], opts: MockWorldOptions): GtmReadConnector {
  const gate = new MockGate(opts)
  return {
    platform: 'gtm',
    async listContainers(ctx, pageToken) {
      gate.check(ctx, null)
      const visible = containers.filter(c => (opts.access[ctx.connectionId] ?? []).includes(c.publicId))
        .map(({ publicId, accountExternalId, containerExternalId, name }) => ({ publicId, accountExternalId, containerExternalId, name }))
      return paginate(visible, pageToken, opts.pageSize ?? 50)
    },
    async getDiagnostics(ctx, publicId) {
      gate.check(ctx, publicId)
      const c = containers.find(x => x.publicId === publicId)
      if (!c) throw new ConnectorError('not_found', 'contêiner não encontrado (simulado)')
      return { publicId, ...c.diagnostics }
    },
  }
}
