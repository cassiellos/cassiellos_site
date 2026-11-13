/**
 * Central de Inteligência — MONTAGEM DAS VISÕES (servidor). Recebe o estado (hoje: snapshot simulado) e os filtros e
 * devolve SÓ o necessário para a tela.
 *
 * Isolamento entre clientes: toda visão parte dos vínculos cliente × ativo. A visão individual só lê ativos com
 * vínculo `confirmed` DAQUELE cliente — nenhuma linha, campanha, alerta ou nome de ativo de outro cliente entra no
 * payload. Vínculos prováveis/não encontrados/sem acesso aparecem como pendências, nunca nas métricas.
 */
import { addDays, civilDateInZone, diffDays, eachDay, inRange, PERIOD_LABEL, PERIOD_PRESETS, periodRange, type CivilDate, type DateRange, type PeriodPreset } from './dates'
import { unit } from './connectors/mock'
import type { IntelPlatform } from './connectors/contracts'
import {
  conversionCost, cplMicros, costPerMeetingMicros, ratesFor, summarizeAds, ctr as ctrOf, cpcMicros, costPerConversionMicros, type AdsDailyFact, type MetricValue,
} from './metrics'
import { feedsMetrics, formatExternalId, type Asset, type ClientAsset, type MonitoredClient } from './model'
import { isStale } from './sync/engine'
import type { IntelSnapshot } from './demo/snapshot'
import type { SyncRun } from './sync/store'
import {
  INTEL_AREAS, type AdsKpis, type AssetCard, type AssetState, type CampaignRow, type CampaignStatusFilter, type ClientOption, type ClientView,
  type ConnectionRow, type ConnectionsView, type ConversionKpi, type CurrencyKpis, type IntelArea, type IntelFilters, type IntelPayload,
  type OverviewView, type PlatformFilter, type ProspectingView, type Trend, type TrendSeries, type ViewMeta,
} from './view-types'

export const DATA_NOTICE = 'Demonstração da fundação. Nenhuma conta real foi consultada e nenhum número representa clientes reais.'

/* ---------------- filtros ---------------- */
export class FilterError extends Error { constructor(readonly code: 'INVALID_FILTER' | 'CLIENT_NOT_FOUND', message: string) { super(message) } }

export function parseIntelFilters(params: URLSearchParams, clients: readonly MonitoredClient[]): IntelFilters {
  const pick = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
    const v = params.get(name)
    if (v === null || v === '') return fallback
    if (!(allowed as readonly string[]).includes(v)) throw new FilterError('INVALID_FILTER', name)
    return v as T
  }
  const area = pick<IntelArea>('area', INTEL_AREAS, 'agencia')
  const period = pick<PeriodPreset>('period', PERIOD_PRESETS, '30d')
  const platform = pick<PlatformFilter>('platform', ['all', 'google_ads', 'meta_ads'], 'all')
  const status = pick<CampaignStatusFilter>('status', ['all', 'active', 'paused'], 'all')
  const campaign = (params.get('campaign') ?? '').trim()
  if (campaign.length > 60 || /[<>{}]/.test(campaign)) throw new FilterError('INVALID_FILTER', 'campaign')
  const rawClient = params.get('client') ?? ''
  if (rawClient && !/^[a-z0-9_]{3,64}$/.test(rawClient)) throw new FilterError('INVALID_FILTER', 'client')
  const external = clients.filter(c => c.kind === 'client' && c.status !== 'archived')
  let client = rawClient || (area === 'cliente' ? external[0]?.id ?? '' : 'all')
  if (area === 'cliente' && client === 'all') client = external[0]?.id ?? ''
  if (client !== 'all' && !clients.some(c => c.id === client && c.status !== 'archived')) throw new FilterError('CLIENT_NOT_FOUND', 'client')
  if (area === 'cliente' && clients.find(c => c.id === client)?.kind !== 'client') throw new FilterError('CLIENT_NOT_FOUND', 'client')
  return { area, period, platform, status, client, campaign }
}

/* ---------------- utilidades ---------------- */
const BASIS_LABEL: Record<string, string> = { 'google:conversions': 'Conversões (definição da conta Google Ads)', 'meta:actions:lead': 'Leads reportados pela Meta (ação "lead")' }
const ATTRIBUTION_LABEL: Record<string, string> = { 'google:modelo-da-conta': 'Modelo de atribuição configurado na conta Google', 'meta:7d_click,1d_view': '7 dias após clique · 1 dia após visualização' }

type Ctx = { snap: IntelSnapshot; now: Date; filters: IntelFilters; reportTz: string }

function assetToday(ctx: Ctx, asset: Asset): CivilDate { return civilDateInZone(ctx.now, asset.timeZone ?? ctx.reportTz) }
function assetRange(ctx: Ctx, asset: Asset): DateRange { return periodRange(ctx.filters.period, assetToday(ctx, asset)) }
function previousOf(range: DateRange): DateRange { const len = diffDays(range.start, range.end) + 1; return { start: addDays(range.start, -len), end: addDays(range.start, -1) } }

function linksOf(ctx: Ctx, clientId: string): ClientAsset[] { return ctx.snap.dataset.links.filter(l => l.clientId === clientId) }
function assetById(ctx: Ctx, id: string): Asset {
  const a = ctx.snap.dataset.assets.find(x => x.id === id)
  if (!a) throw new Error('ativo inexistente: ' + id)
  return a
}
/** Ativos CONFIRMADOS do cliente (únicos que alimentam métricas). */
function confirmedAssets(ctx: Ctx, clientId: string): Asset[] {
  return linksOf(ctx, clientId).filter(l => feedsMetrics(l.status)).map(l => assetById(ctx, l.assetId))
}
const isAds = (p: IntelPlatform): p is 'google_ads' | 'meta_ads' => p === 'google_ads' || p === 'meta_ads'
function platformAllowed(ctx: Ctx, p: IntelPlatform) { return ctx.filters.platform === 'all' || ctx.filters.platform === p }

/** Linhas de anúncios de um conjunto de ativos, cada ativo no SEU intervalo civil (fuso da conta). */
function adsFacts(ctx: Ctx, assets: readonly Asset[], rangeOf: (a: Asset) => DateRange): AdsDailyFact[] {
  const out: AdsDailyFact[] = []
  for (const a of assets) {
    if (!isAds(a.platform) || !platformAllowed(ctx, a.platform)) continue
    const range = rangeOf(a)
    const platform = a.platform
    for (const r of ctx.snap.store.adsRowsFor(new Set([a.id]))) {
      if (!inRange(r.day, range)) continue
      out.push({ platform, assetId: a.id, campaignId: r.campaignExternalId, day: r.day, currency: r.currency, impressions: r.impressions,
        clicks: r.clicks, costMicros: r.costMicros, conversions: r.conversions, conversionBasis: r.conversionBasis, attribution: r.attribution })
    }
  }
  return out
}

function kpisOf(facts: readonly AdsDailyFact[], prevFacts: readonly AdsDailyFact[]): AdsKpis {
  const s = summarizeAds(facts)
  const prev = summarizeAds(prevFacts)
  const byCurrency: CurrencyKpis[] = s.byCurrency.map(t => ({
    currency: t.currency, costMicros: t.costMicros, impressions: t.impressions, clicks: t.clicks, ...ratesFor(t),
    previousCostMicros: prev.byCurrency.find(p => p.currency === t.currency)?.costMicros ?? null,
  }))
  const conversions: ConversionKpi[] = s.conversions.map(g => ({
    platform: g.platform, basisLabel: BASIS_LABEL[g.basis] ?? g.basis, attributionLabel: ATTRIBUTION_LABEL[g.attribution] ?? g.attribution,
    currency: g.currency, conversions: g.rowsWithConversions > 0 ? g.conversions : null, costPerConversionMicros: conversionCost(g),
  }))
  return { hasData: s.hasData, byCurrency, conversions }
}

/** Série de investimento por plataforma e moeda (moedas nunca se misturam numa série). */
function spendTrend(days: readonly CivilDate[], facts: readonly AdsDailyFact[]): TrendSeries[] {
  const idx = new Map(days.map((d, i) => [d, i]))
  const series = new Map<string, TrendSeries>()
  for (const f of facts) {
    const key = 'spend|' + f.platform + '|' + f.currency
    let s = series.get(key)
    if (!s) { s = { key, label: (f.platform === 'google_ads' ? 'Google Ads' : 'Meta Ads') + ' · ' + f.currency, platform: f.platform, currency: f.currency, unit: 'micros', values: days.map(() => 0) }; series.set(key, s) }
    const i = idx.get(f.day)
    if (i !== undefined) s.values[i] = (s.values[i] ?? 0) + f.costMicros
  }
  return [...series.values()].sort((a, b) => a.key.localeCompare(b.key))
}

function reportDays(ctx: Ctx): { range: DateRange; days: CivilDate[] } {
  const range = periodRange(ctx.filters.period, civilDateInZone(ctx.now, ctx.reportTz))
  return { range, days: eachDay(range.start, range.end) }
}

function normalizeText(s: string) { return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase() }

function campaignsOf(ctx: Ctx, assets: readonly Asset[], facts: readonly AdsDailyFact[]): CampaignRow[] {
  const ids = new Set(assets.filter(a => isAds(a.platform) && platformAllowed(ctx, a.platform)).map(a => a.id))
  const q = normalizeText(ctx.filters.campaign)
  const rows: CampaignRow[] = []
  for (const c of ctx.snap.store.campaignsFor(ids)) {
    const asset = assetById(ctx, c.assetId)
    if (!isAds(asset.platform)) continue
    if (ctx.filters.status !== 'all' && c.status !== ctx.filters.status) continue
    if (q && !normalizeText(c.name).includes(q)) continue
    const mine = facts.filter(f => f.assetId === c.assetId && f.campaignId === c.externalId)
    const cost = mine.reduce((s, f) => s + f.costMicros, 0)
    const impressions = mine.reduce((s, f) => s + f.impressions, 0)
    const clicks = mine.reduce((s, f) => s + f.clicks, 0)
    const withConv = mine.filter(f => f.conversions !== null)
    const conversions = withConv.length ? withConv.reduce((s, f) => s + (f.conversions ?? 0), 0) : null
    rows.push({
      key: c.assetId + ':' + c.externalId, platform: asset.platform, assetName: asset.name, name: c.name, status: c.status, channel: c.channel,
      currency: ctx.snap.store.observations.get(asset.id)?.currencyCode ?? asset.currencyCode ?? '—', costMicros: cost, impressions, clicks,
      ctr: mine.length ? ctrOf(clicks, impressions) : { kind: 'no_data' }, cpcMicros: mine.length ? cpcMicros(cost, clicks) : { kind: 'no_data' },
      conversions, costPerConversionMicros: conversions === null ? { kind: 'no_data' } : costPerConversionMicros(cost, conversions), hasData: mine.length > 0,
    })
  }
  return rows.sort((a, b) => b.costMicros - a.costMicros || a.name.localeCompare(b.name))
}

/* ---------------- estado de cada ativo ---------------- */
function lastRunOf(ctx: Ctx, assetId: string, pred?: (r: SyncRun) => boolean) { return ctx.snap.store.lastRun(assetId, pred) }

function assetCard(ctx: Ctx, link: ClientAsset): AssetCard {
  const asset = assetById(ctx, link.assetId)
  const conn = asset.connectionId ? ctx.snap.dataset.connections.find(c => c.id === asset.connectionId) ?? null : null
  const obs = ctx.snap.store.observations.get(asset.id)
  const accountStatus = obs?.accountStatus ?? asset.accountStatus
  const last = lastRunOf(ctx, asset.id, r => r.trigger !== 'backfill') ?? lastRunOf(ctx, asset.id)
  const lastOk = lastRunOf(ctx, asset.id, r => r.status === 'succeeded')
  const alerts = ctx.snap.store.openAlertsFor(new Set([asset.id])).map(a => ({ kind: a.kind, message: a.message }))
  let hasPeriodData = true
  if (isAds(asset.platform)) hasPeriodData = adsFacts({ ...ctx, filters: { ...ctx.filters, platform: 'all' } }, [asset], a => assetRange(ctx, a)).length > 0
  if (asset.platform === 'ga4') { const r = assetRange(ctx, asset); hasPeriodData = ctx.snap.store.ga4RowsFor(new Set([asset.id])).some(x => inRange(x.date, r)) }
  let state: AssetState
  if (link.status === 'not_found') state = 'not_found'
  else if (link.status === 'no_access') state = 'no_access'
  else if (link.status === 'probable') state = 'pending_validation'
  else if (!asset.connectionId || !conn) state = 'no_connection'
  else if (conn.status === 'expired' || conn.status === 'revoked') state = 'auth_expired'
  else if (accountStatus === 'suspended') state = 'suspended'
  else if (last && (last.status === 'failed' || last.status === 'partial')) state = 'sync_error'
  else if (isStale(lastOk?.finishedAt ?? null, ctx.now)) state = 'stale'
  else if (accountStatus === 'paused') state = 'paused'
  else if (!hasPeriodData) state = 'no_data'
  else state = 'connected'
  return {
    assetId: asset.id, platform: asset.platform, externalIdLabel: formatExternalId(asset.platform, asset.externalId), name: asset.name,
    currency: obs?.currencyCode ?? asset.currencyCode, timeZone: obs?.timeZone ?? asset.timeZone, association: link.status, accountStatus,
    connectionStatus: conn?.status ?? 'none', accessPath: asset.accessPath, state,
    lastSyncAt: last?.finishedAt ?? null, lastSuccessAt: lastOk?.finishedAt ?? null, lastRunStatus: last?.status ?? null, alerts, note: link.note,
  }
}

/** Situação do cliente: o problema mais grave entre as contas confirmadas; sem problema, "conectado" se alguma conta
 *  tem dados — conta pausada ou sem veiculação só define a situação quando TODAS estão assim. */
const PROBLEMS: AssetState[] = ['auth_expired', 'suspended', 'sync_error', 'stale', 'no_connection']
function worstState(cards: readonly AssetCard[]): AssetState | 'no_integration' {
  const confirmed = cards.filter(c => c.association === 'confirmed')
  if (!confirmed.length) return 'no_integration'
  const problem = PROBLEMS.find(s => confirmed.some(c => c.state === s))
  if (problem) return problem
  if (confirmed.some(c => c.state === 'connected')) return 'connected'
  return confirmed.some(c => c.state === 'no_data') ? 'no_data' : 'paused'
}

function metaOf(ctx: Ctx): ViewMeta {
  const { range } = reportDays(ctx)
  const today = civilDateInZone(ctx.now, ctx.reportTz)
  const prev = previousOf(range)
  return { simulated: true, dataNotice: DATA_NOTICE, generatedAt: ctx.now.toISOString(), reportTimeZone: ctx.reportTz,
    period: { preset: ctx.filters.period, label: PERIOD_LABEL[ctx.filters.period], start: range.start, end: range.end, includesToday: range.end === today },
    previous: prev, filters: ctx.filters }
}

const clientOptions = (ctx: Ctx): ClientOption[] => ctx.snap.dataset.clients.filter(c => c.kind === 'client' && c.status !== 'archived').map(c => ({ id: c.id, name: c.name, kind: c.kind }))

/* ---------------- visões ---------------- */
export function buildClientView(ctx: Ctx, clientId: string): ClientView {
  const client = ctx.snap.dataset.clients.find(c => c.id === clientId && c.kind === 'client')
  if (!client) throw new FilterError('CLIENT_NOT_FOUND', 'client')
  const cards = linksOf(ctx, client.id).map(l => assetCard(ctx, l))
  const assets = confirmedAssets(ctx, client.id)
  const facts = adsFacts(ctx, assets, a => assetRange(ctx, a))
  const prevFacts = adsFacts(ctx, assets, a => previousOf(assetRange(ctx, a)))
  const { days } = reportDays(ctx)
  const ga4 = ctx.filters.platform === 'all' ? assets.filter(a => a.platform === 'ga4').map(a => {
    const r = assetRange(ctx, a)
    const rows = ctx.snap.store.ga4RowsFor(new Set([a.id])).filter(x => inRange(x.date, r))
    const sum = (k: 'sessions' | 'totalUsers' | 'engagedSessions' | 'keyEvents') => rows.reduce((s, x) => s + x[k], 0)
    const bySource = new Map<string, { source: string; medium: string; sessions: number }>()
    for (const x of rows) { const k = x.source + '|' + x.medium; const v = bySource.get(k) ?? { source: x.source, medium: x.medium, sessions: 0 }; v.sessions += x.sessions; bySource.set(k, v) }
    const sessions = sum('sessions')
    return { assetId: a.id, name: a.name, hasData: rows.length > 0, sessions, totalUsers: sum('totalUsers'), engagedSessions: sum('engagedSessions'), keyEvents: sum('keyEvents'),
      engagementRate: rows.length ? ctrOf(sum('engagedSessions'), sessions) : { kind: 'no_data' } as MetricValue,
      sources: [...bySource.values()].sort((x, y) => y.sessions - x.sessions).slice(0, 6) }
  }) : []
  const gtm = ctx.filters.platform === 'all' ? assets.filter(a => a.platform === 'gtm').flatMap(a => {
    const d = ctx.snap.store.gtm.get(a.id)
    return d ? [{ assetId: a.id, publicId: d.publicId, name: a.name, liveVersionId: d.liveVersionId, tagCount: d.tagCount, hasGa4Tag: d.hasGa4Tag, hasMetaPixelTag: d.hasMetaPixelTag, fetchedAt: d.fetchedAt }] : []
  }) : []
  return {
    meta: metaOf(ctx), clients: clientOptions(ctx),
    client: { id: client.id, name: client.name, kind: client.kind, financeLinked: client.financeClientId !== null, state: worstState(cards) },
    assets: cards.filter(c => c.association === 'confirmed'), pendingAssets: cards.filter(c => c.association !== 'confirmed'),
    kpis: kpisOf(facts, prevFacts), trend: { days, series: spendTrend(days, facts) }, campaigns: campaignsOf(ctx, assets, facts), ga4, gtm,
  }
}

export function buildOverviewView(ctx: Ctx): OverviewView {
  const clients = ctx.snap.dataset.clients.filter(c => c.kind === 'client' && c.status !== 'archived' && (ctx.filters.client === 'all' || c.id === ctx.filters.client))
  const { days } = reportDays(ctx)
  const allFacts: AdsDailyFact[] = []
  const allPrev: AdsDailyFact[] = []
  const rows = clients.map(client => {
    const cards = linksOf(ctx, client.id).map(l => assetCard(ctx, l))
    const assets = confirmedAssets(ctx, client.id)
    const facts = adsFacts(ctx, assets, a => assetRange(ctx, a))
    const prev = adsFacts(ctx, assets, a => previousOf(assetRange(ctx, a)))
    allFacts.push(...facts); allPrev.push(...prev)
    const camps = campaignsOf({ ...ctx, filters: { ...ctx.filters, status: 'all', campaign: '' } }, assets, facts)
    const k = kpisOf(facts, prev)
    const successes = cards.filter(c => c.association === 'confirmed').map(c => c.lastSuccessAt).filter((x): x is string => !!x).sort()
    return {
      id: client.id, name: client.name, state: worstState(cards),
      platforms: [...new Set(assets.map(a => a.platform))].sort() as IntelPlatform[],
      byCurrency: k.byCurrency, conversions: k.conversions,
      activeCampaigns: camps.filter(c => c.status === 'active').length, pausedCampaigns: camps.filter(c => c.status === 'paused').length,
      lastSuccessAt: successes.length ? successes[0] : null, // a MAIS ANTIGA entre as contas: indica o elo mais desatualizado
      openAlerts: cards.reduce((s, c) => s + c.alerts.length + (c.association === 'confirmed' ? 0 : 1), 0),
      _cards: cards, _facts: facts,
    }
  })
  const platformTotals = (['google_ads', 'meta_ads'] as const).flatMap(p => {
    const k = kpisOf(allFacts.filter(f => f.platform === p), allPrev.filter(f => f.platform === p))
    return k.byCurrency.map(c => ({ ...c, platform: p }))
  })
  const currencies = [...new Set(allFacts.map(f => f.currency))].sort()
  const distribution = currencies.map(currency => {
    const total = allFacts.filter(f => f.currency === currency).reduce((s, f) => s + f.costMicros, 0)
    const parts = (['google_ads', 'meta_ads'] as const).map(platform => {
      const cost = allFacts.filter(f => f.currency === currency && f.platform === platform).reduce((s, f) => s + f.costMicros, 0)
      return { platform, costMicros: cost, sharePct: total > 0 ? Math.round((cost / total) * 1000) / 10 : 0 }
    }).filter(p => p.costMicros > 0)
    return { currency, parts }
  })
  const comparison = currencies.map(currency => ({
    currency, items: rows.map(r => ({ clientId: r.id, name: r.name, costMicros: r._facts.filter(f => f.currency === currency).reduce((s, f) => s + f.costMicros, 0) }))
      .filter(i => i.costMicros > 0).sort((a, b) => b.costMicros - a.costMicros),
  }))
  const alerts: OverviewView['alerts'] = []
  for (const r of rows) for (const c of r._cards) {
    for (const a of c.alerts) alerts.push({ clientName: r.name, assetName: c.name, platform: c.platform, kind: a.kind, message: a.message, since: c.lastSyncAt ?? '' })
    if (c.association !== 'confirmed') alerts.push({ clientName: r.name, assetName: c.name, platform: c.platform, kind: 'association_' + c.association, message: c.note || 'vínculo não confirmado', since: '' })
    else if (c.state === 'no_data' || c.state === 'stale') alerts.push({ clientName: r.name, assetName: c.name, platform: c.platform, kind: c.state, message: c.state === 'stale' ? 'dados desatualizados' : 'sem dados no período', since: c.lastSuccessAt ?? '' })
  }
  const totalCamps = rows.reduce((s, r) => ({ active: s.active + r.activeCampaigns, paused: s.paused + r.pausedCampaigns }), { active: 0, paused: 0 })
  return {
    meta: metaOf(ctx), clients: clientOptions(ctx), monitoredClients: rows.length, platformTotals, distribution,
    conversions: kpisOf(allFacts, allPrev).conversions, campaigns: totalCamps, trend: { days, series: spendTrend(days, allFacts) },
    rows: rows.map(({ _cards, _facts, ...r }) => { void _cards; void _facts; return r }), comparison, alerts,
  }
}

/** Funil SIMULADO da agência (leads/reuniões fictícios derivados dos cliques simulados). Nunca lê o CRM real. */
export function simulateAgencyFunnel(facts: readonly AdsDailyFact[]) {
  const byDayPlatform = new Map<string, number>()
  for (const f of facts) byDayPlatform.set(f.day + '|' + f.platform, (byDayPlatform.get(f.day + '|' + f.platform) ?? 0) + f.clicks)
  const out: { day: string; platform: 'google_ads' | 'meta_ads'; leads: number; meetings: number }[] = []
  for (const [k, clicks] of byDayPlatform) {
    const [day, platform] = k.split('|') as [string, 'google_ads' | 'meta_ads']
    const leads = Math.round(clicks * (platform === 'google_ads' ? 0.065 : 0.045) * (0.6 + unit('lead' + k) * 0.8))
    const meetings = Math.round(leads * (0.25 + unit('meet' + k) * 0.25))
    out.push({ day, platform, leads, meetings })
  }
  return out
}

export function buildProspectingView(ctx: Ctx): ProspectingView {
  const agency = ctx.snap.dataset.clients.find(c => c.kind === 'agency')
  if (!agency) throw new FilterError('CLIENT_NOT_FOUND', 'agency')
  const cards = linksOf(ctx, agency.id).map(l => assetCard(ctx, l))
  const assets = confirmedAssets(ctx, agency.id)
  const facts = adsFacts(ctx, assets, a => assetRange(ctx, a))
  const prev = adsFacts(ctx, assets, a => previousOf(assetRange(ctx, a)))
  const { days, range } = reportDays(ctx)
  const funnelDays = simulateAgencyFunnel(facts)
  const unattributed = days.filter(d => d <= range.end).reduce((s, d) => s + Math.round(unit('na' + d) * 2.4), 0)
  const kpis = kpisOf(facts, prev)
  const byChannel = (['google_ads', 'meta_ads'] as const).filter(p => platformAllowed(ctx, p)).flatMap(p => {
    const pf = facts.filter(f => f.platform === p)
    if (!pf.length) return []
    const currency = pf[0].currency
    const cost = pf.filter(f => f.currency === currency).reduce((s, f) => s + f.costMicros, 0)
    const leads = funnelDays.filter(x => x.platform === p).reduce((s, x) => s + x.leads, 0)
    const meetings = funnelDays.filter(x => x.platform === p).reduce((s, x) => s + x.meetings, 0)
    const conv = kpis.conversions.filter(c => c.platform === p && c.currency === currency)
    const platformConversions = conv.some(c => c.conversions !== null) ? conv.reduce((s, c) => s + (c.conversions ?? 0), 0) : null
    return [{ platform: p, currency, costMicros: cost, leads, meetings, cplMicros: cplMicros(cost, leads), costPerMeetingMicros: costPerMeetingMicros(cost, meetings), platformConversions }]
  })
  const idx = new Map(days.map((d, i) => [d, i]))
  const count = (key: 'leads' | 'meetings', label: string): TrendSeries => {
    const values: (number | null)[] = days.map(() => 0)
    for (const x of funnelDays) { const i = idx.get(x.day); if (i !== undefined) values[i] = (values[i] ?? 0) + x[key] }
    return { key: 'crm|' + key, label, platform: 'crm', currency: null, unit: 'count', values }
  }
  const trend: Trend = { days, series: [...spendTrend(days, facts), count('leads', 'Leads (simulados)'), count('meetings', 'Reuniões (simuladas)')] }
  return {
    meta: metaOf(ctx), assets: cards, kpis,
    funnel: { simulated: true, leads: byChannel.reduce((s, c) => s + c.leads, 0) + (ctx.filters.platform === 'all' ? unattributed : 0),
      meetings: byChannel.reduce((s, c) => s + c.meetings, 0), unattributedLeads: ctx.filters.platform === 'all' ? unattributed : 0, byChannel },
    trend, campaigns: campaignsOf(ctx, assets, facts),
  }
}

const PLANNED: Record<AssetState, string> = {
  not_found: 'Confirmar o ID da conta com o cliente', no_access: 'Solicitar acesso de leitura ao cliente', pending_validation: 'Validar o vínculo (titular)',
  no_connection: 'Conectar conta — disponível em fase futura', auth_expired: 'Reautorizar a conexão — disponível em fase futura',
  suspended: 'Verificar a situação da conta na plataforma', sync_error: 'Acompanhar a nova tentativa automática', stale: 'Verificar a conexão e sincronizar novamente',
  paused: 'Nenhuma (conta pausada pelo anunciante)', no_data: 'Nenhuma (sem veiculação no período)', connected: 'Nenhuma ação necessária',
}

export function buildConnectionsView(ctx: Ctx): ConnectionsView {
  const rows: ConnectionRow[] = []
  const visibleAssets = new Set<string>()
  for (const client of ctx.snap.dataset.clients) {
    if (client.status === 'archived' || (ctx.filters.client !== 'all' && client.id !== ctx.filters.client)) continue
    for (const link of linksOf(ctx, client.id)) {
      const card = assetCard(ctx, link)
      if (!platformAllowed(ctx, card.platform) && isAds(card.platform)) continue
      if (ctx.filters.platform !== 'all' && !isAds(card.platform)) continue
      const asset = assetById(ctx, link.assetId)
      const conn = asset.connectionId ? ctx.snap.dataset.connections.find(c => c.id === asset.connectionId) ?? null : null
      const last = lastRunOf(ctx, asset.id, r => r.trigger !== 'backfill')
      visibleAssets.add(asset.id)
      rows.push({ clientId: client.id, clientName: client.name, platform: card.platform, assetName: card.name, externalIdLabel: card.externalIdLabel,
        association: link.status, connectionLabel: conn?.label ?? null, authStatus: conn?.status ?? 'none', accessPath: asset.accessPath,
        lastVerifiedAt: conn?.lastVerifiedAt ?? null, lastSyncAt: card.lastSyncAt, lastRunStatus: card.lastRunStatus,
        lastError: last?.errorMessage ?? null, plannedAction: PLANNED[card.state] })
    }
  }
  const nameOf = (id: string) => ctx.snap.dataset.assets.find(a => a.id === id)
  const recentRuns = ctx.snap.store.runs.filter(r => visibleAssets.has(r.assetId)).slice(-20).reverse().map(r => ({
    assetName: nameOf(r.assetId)?.name ?? '—', platform: nameOf(r.assetId)?.platform ?? 'google_ads' as IntelPlatform, kind: r.kind, trigger: r.trigger, status: r.status,
    attempts: r.attempts, rows: r.rowsInserted + r.rowsUpdated + r.rowsUnchanged, startedAt: r.startedAt, error: r.errorMessage,
  }))
  return {
    meta: metaOf(ctx), rows,
    clients: ctx.snap.dataset.clients.filter(c => c.status !== 'archived').map(c => ({ id: c.id, name: c.name, kind: c.kind })),
    connections: ctx.snap.dataset.connections.map(c => ({ id: c.id, label: c.label, provider: c.provider, authKind: c.authKind, status: c.status, lastVerifiedAt: c.lastVerifiedAt, scopes: c.scopes })),
    recentRuns,
  }
}

export function buildIntelPayload(snap: IntelSnapshot, filters: IntelFilters, now: Date): IntelPayload {
  const ctx: Ctx = { snap, now, filters, reportTz: snap.dataset.clients[0]?.reportTimeZone ?? 'America/Sao_Paulo' }
  switch (filters.area) {
    case 'prospeccao': return { area: 'prospeccao', view: buildProspectingView(ctx) }
    case 'agencia': return { area: 'agencia', view: buildOverviewView(ctx) }
    case 'cliente': return { area: 'cliente', view: buildClientView(ctx, filters.client) }
    case 'conexoes': return { area: 'conexoes', view: buildConnectionsView(ctx) }
  }
}
