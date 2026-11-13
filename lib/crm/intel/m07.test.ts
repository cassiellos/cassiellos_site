/**
 * Missão 07 — correções da homologação 06B: filtro de situação coerente (M1), bloqueio de sincronização de vínculos
 * não confirmados (M2), registros em memória (M4), política de filtros (M5), integração × status da campanha (m4),
 * atualização manual (m5), moedas e alertas (m6).
 */
import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { buildDemoSnapshot, checkManualSync, type IntelSnapshot } from './demo/snapshot'
import { normalizeForArea } from './filters'
import { formatMoney } from './format'
import { authorizeSync, selectSyncTargets } from './sync/eligibility'
import { buildIntelPayload, parseIntelFilters, STORAGE_NOTICE } from './view-model'
import type { ClientView, ConnectionsView, IntelFilters, OverviewView, ProspectingView } from './view-types'
import type { Asset, ClientAsset, Connection } from './model'

const NOW = new Date('2026-11-13T15:00:00Z')
let snap: IntelSnapshot
before(async () => { snap = await buildDemoSnapshot(NOW) })
const f = (o: Partial<IntelFilters>): IntelFilters => normalizeForArea({ area: 'agencia', period: '30d', platform: 'all', status: 'all', client: 'all', campaign: '', ...o })
const overview = (o: Partial<IntelFilters> = {}) => buildIntelPayload(snap, f(o), NOW).view as OverviewView
const client = (id: string, o: Partial<IntelFilters> = {}) => buildIntelPayload(snap, f({ area: 'cliente', client: id, ...o }), NOW).view as ClientView
const prosp = (o: Partial<IntelFilters> = {}) => buildIntelPayload(snap, f({ area: 'prospeccao', ...o }), NOW).view as ProspectingView
const sumTrend = (v: { trend: { series: { currency: string | null; unit: string; values: (number | null)[] }[] } }, ccy: string) =>
  v.trend.series.filter(s => s.unit === 'micros' && s.currency === ccy).reduce((t, s) => t + s.values.reduce<number>((a, x) => a + (x ?? 0), 0), 0)
const totalOf = (v: OverviewView, ccy: string, k: 'costMicros' | 'impressions' | 'clicks') => v.platformTotals.filter(p => p.currency === ccy).reduce((t, p) => t + p[k], 0)

describe('M1 — filtro de situação das campanhas (Ativas/Pausadas)', () => {
  it('Visão geral: Ativas + Pausadas = Todas em investimento, impressões e cliques (por moeda) e muda os indicadores', () => {
    const all = overview(), act = overview({ status: 'active' }), pau = overview({ status: 'paused' })
    for (const ccy of ['BRL', 'USD']) for (const k of ['costMicros', 'impressions', 'clicks'] as const)
      assert.equal(totalOf(act, ccy, k) + totalOf(pau, ccy, k), totalOf(all, ccy, k), ccy + ' ' + k)
    assert.ok(totalOf(pau, 'BRL', 'costMicros') > 0, 'campanhas pausadas HOJE têm investimento histórico no período')
    assert.ok(totalOf(act, 'BRL', 'costMicros') < totalOf(all, 'BRL', 'costMicros'), 'o filtro altera o investimento')
    assert.equal(totalOf(pau, 'USD', 'costMicros'), 0, 'a única campanha em USD está ativa')
  })
  it('gráfico, comparação, distribuição e tabela de clientes batem com os totais do recorte', () => {
    for (const status of ['all', 'active', 'paused'] as const) {
      const v = overview({ status })
      for (const ccy of ['BRL', 'USD']) {
        const total = totalOf(v, ccy, 'costMicros')
        assert.equal(sumTrend(v, ccy), total, status + ' tendência ' + ccy)
        assert.equal((v.comparison.find(c => c.currency === ccy)?.items ?? []).reduce((t, i) => t + i.costMicros, 0), total, status + ' comparação ' + ccy)
        assert.equal((v.distribution.find(d => d.currency === ccy)?.parts ?? []).reduce((t, p) => t + p.costMicros, 0), total, status + ' distribuição ' + ccy)
        assert.equal(v.rows.reduce((t, r) => t + (r.byCurrency.find(b => b.currency === ccy)?.costMicros ?? 0), 0), total, status + ' clientes ' + ccy)
      }
    }
  })
  it('taxas recalculadas a partir dos totais filtrados (nunca média de percentuais)', () => {
    const p = overview({ status: 'paused' }).platformTotals.find(x => x.platform === 'google_ads' && x.currency === 'BRL')!
    assert.deepEqual(p.ctr, { kind: 'value', value: Math.round((p.clicks / p.impressions) * 100 * 10_000) / 10_000 })
    assert.deepEqual(p.cpcMicros, { kind: 'value', value: Math.round(p.costMicros / p.clicks) })
  })
  it('contagem de campanhas e conversões seguem o recorte; estrutura e alertas não', () => {
    const all = overview(), act = overview({ status: 'active' }), pau = overview({ status: 'paused' })
    assert.equal(act.campaigns.paused, 0); assert.equal(pau.campaigns.active, 0)
    assert.equal(act.campaigns.active + pau.campaigns.paused, all.campaigns.active + all.campaigns.paused)
    const conv = (v: OverviewView) => v.conversions.reduce((t, c) => t + (c.conversions ?? 0), 0)
    assert.ok(conv(act) < conv(all) && conv(pau) > 0)
    assert.equal(act.monitoredClients, all.monitoredClients, 'clientes cadastrados: estrutural')
    assert.deepEqual(act.alerts, all.alerts, 'alertas administrativos independem do filtro de campanhas')
    assert.equal(act.meta.campaignScope.active, true); assert.equal(all.meta.campaignScope.active, false)
  })
  it('Cliente: KPI = soma da tabela de campanhas = soma do gráfico, no recorte', () => {
    for (const status of ['active', 'paused'] as const) {
      const v = client('cli_demo_a', { status })
      const brl = v.kpis.byCurrency.find(k => k.currency === 'BRL')
      const listSum = v.campaigns.filter(c => c.currency === 'BRL').reduce((t, c) => t + c.costMicros, 0)
      assert.equal(brl?.costMicros ?? 0, listSum, status)
      assert.equal(sumTrend(v, 'BRL'), listSum, status)
      assert.ok(v.campaigns.every(c => c.status === status))
    }
  })
  it('busca de campanha também recorta indicadores (coerência com a lista)', () => {
    const v = client('cli_demo_a', { campaign: 'marca' })
    assert.deepEqual(v.campaigns.map(c => c.name), ['Institucional · Marca'])
    assert.equal(v.kpis.byCurrency[0].costMicros, v.campaigns[0].costMicros)
  })
  it('Prospecção: anúncios seguem o recorte; leads/reuniões ficam indisponíveis (atribuição é por canal)', () => {
    const all = prosp(), act = prosp({ status: 'active' })
    assert.equal(all.funnel.available, true)
    assert.equal(act.funnel.available, false)
    assert.deepEqual([act.funnel.leads, act.funnel.meetings], [0, 0])
    assert.ok(act.funnel.byChannel.every(c => c.cplMicros.kind === 'no_data' && c.costPerMeetingMicros.kind === 'no_data'))
    assert.ok(!act.trend.series.some(s => s.platform === 'crm'))
    assert.ok(act.kpis.byCurrency[0].costMicros < all.kpis.byCurrency[0].costMicros)
    // o funil por canal NÃO muda com a busca/situação: só fica indisponível
    assert.match(act.funnel.scopeNote, /por canal/)
  })
})

describe('M2 — vínculos não confirmados não são sincronizados', () => {
  const asset: Asset = { id: 'ast_x', platform: 'google_ads', externalId: '9000000999', externalContext: '', name: 'X', currencyCode: 'BRL', timeZone: 'America/Sao_Paulo',
    accountStatus: 'active', connectionId: 'c1', accessPath: 'direct', loginCustomerId: null }
  const conn = (status: Connection['status']): Connection[] => [{ id: 'c1', provider: 'google', label: 'c', authKind: 'oauth_user', status, scopes: [], lastVerifiedAt: null, lastErrorCode: null }]
  const link = (status: ClientAsset['status'], clientId = 'k1'): ClientAsset => ({ clientId, assetId: 'ast_x', status, validatedAt: null, note: '' })
  it('regra explícita por status do vínculo, em todos os propósitos (histórico, diário, manual, reprocessamento)', () => {
    for (const purpose of ['backfill', 'schedule', 'manual', 'reprocess'] as const) {
      assert.equal(authorizeSync(asset, [link('confirmed')], conn('active'), purpose).eligible, true, purpose)
      for (const st of ['probable', 'not_found', 'no_access', 'ended'] as const)
        assert.deepEqual(authorizeSync(asset, [link(st)], conn('active'), purpose), { eligible: false, reason: 'not_confirmed' }, purpose + ' ' + st)
      assert.deepEqual(authorizeSync(asset, [], conn('active'), purpose), { eligible: false, reason: 'not_confirmed' })
    }
  })
  it('conexão expirada, revogada, pendente ou com erro bloqueia; conta suspensa bloqueia só o manual', () => {
    assert.deepEqual(authorizeSync(asset, [link('confirmed')], conn('expired'), 'schedule'), { eligible: false, reason: 'connection_expired' })
    assert.deepEqual(authorizeSync(asset, [link('confirmed')], conn('revoked'), 'reprocess'), { eligible: false, reason: 'connection_revoked' })
    assert.deepEqual(authorizeSync(asset, [link('confirmed')], conn('pending'), 'backfill'), { eligible: false, reason: 'connection_inactive' })
    assert.deepEqual(authorizeSync(asset, [link('confirmed')], conn('error'), 'manual'), { eligible: false, reason: 'connection_inactive' })
    assert.deepEqual(authorizeSync({ ...asset, accountStatus: 'suspended' }, [link('confirmed')], conn('active'), 'manual'), { eligible: false, reason: 'account_suspended' })
    assert.equal(authorizeSync({ ...asset, accountStatus: 'suspended' }, [link('confirmed')], conn('active'), 'schedule').eligible, true)
  })
  it('ativo com vários vínculos: sincroniza se houver UM confirmado, mas só o cliente confirmado vê os dados', async () => {
    const s2 = await buildDemoSnapshot(NOW)
    s2.dataset.links.push({ clientId: 'cli_demo_b', assetId: 'ast_demo_g_a1', status: 'probable', validatedAt: null, note: 'teste' })
    assert.equal(selectSyncTargets(s2.dataset.assets, s2.dataset.links, s2.dataset.connections, 'schedule').targets.some(t => t.id === 'ast_demo_g_a1'), true)
    const b = buildIntelPayload(s2, f({ area: 'cliente', client: 'cli_demo_b' }), NOW).view as ClientView
    assert.ok(!b.campaigns.some(c => c.key.startsWith('ast_demo_g_a1')), 'cliente B não recebe dados da conta')
    const pend = b.pendingAssets.find(p => p.assetId === 'ast_demo_g_a1')!
    assert.deepEqual([pend.association, pend.lastSyncAt, pend.syncAuthorized], ['probable', null, false])
  })
  it('snapshot: nenhuma execução nem linha para provável, sem acesso ou não encontrado; expirada não é consultada', () => {
    for (const id of ['ast_demo_g_a3', 'ast_demo_g_b_nf', 'ast_demo_ga4_c']) {
      assert.equal(snap.store.runs.some(r => r.assetId === id), false, id)
      assert.equal([...snap.store.ads.values()].some(r => r.assetId === id), false, id)
    }
    const bRuns = snap.store.runs.filter(r => r.assetId === 'ast_demo_m_b')
    assert.deepEqual(bRuns.map(r => r.trigger), ['backfill'], 'só a carga histórica de quando a conexão estava ativa')
    assert.ok(snap.store.alerts.get('ast_demo_m_b|auth_expired') && !snap.store.alerts.get('ast_demo_m_b|auth_expired')!.resolvedAt)
    const plan = selectSyncTargets(snap.dataset.assets, snap.dataset.links, snap.dataset.connections, 'reprocess')
    assert.deepEqual(plan.blocked.map(b => b.assetId).sort(), ['ast_demo_g_a3', 'ast_demo_g_b_nf', 'ast_demo_ga4_c', 'ast_demo_m_b'])
  })
  it('atualização manual: bloqueada para pendente, outro cliente, expirada e suspensa; liberada para confirmada ativa', () => {
    assert.equal(checkManualSync(snap, 'cli_demo_a', 'ast_demo_g_a3', NOW).allowed, false)
    assert.deepEqual(checkManualSync(snap, 'cli_demo_b', 'ast_demo_g_a1', NOW), { allowed: false, reason: 'not_in_client', retryAt: null })
    assert.deepEqual(checkManualSync(snap, 'cli_demo_b', 'ast_demo_m_b', NOW), { allowed: false, reason: 'connection_expired', retryAt: null })
    assert.deepEqual(checkManualSync(snap, 'cli_demo_c', 'ast_demo_m_c_susp', NOW), { allowed: false, reason: 'account_suspended', retryAt: null })
    assert.equal(checkManualSync(snap, 'cli_demo_a', 'ast_demo_g_a1', NOW).allowed, true)
  })
  it('interface diferencia conexão técnica, acesso à plataforma e vínculo; pendências sem horários de sincronização', () => {
    const conn = buildIntelPayload(snap, f({ area: 'conexoes' }), NOW).view as ConnectionsView
    const prob = conn.rows.find(r => r.assetName.includes('Conta encontrada pela busca'))!
    assert.deepEqual([prob.association, prob.syncAuthorized, prob.lastSyncAt, prob.lastRunStatus], ['probable', false, null, null])
    assert.equal(prob.authStatus, 'active', 'existe conexão técnica ativa...')
    assert.match(prob.syncBlockReason ?? '', /não confirmado/, '...mas o vínculo não autoriza sincronizar')
    assert.equal(conn.rows.find(r => r.assetName === 'Exemplo C · Site')!.platformAccess, 'no')
    assert.equal(conn.recentRuns.some(r => r.assetName.includes('Conta encontrada pela busca')), false)
  })
})

describe('M4/M5/m4/m5/m6', () => {
  it('M4: registros em memória comunicados explicitamente', () => {
    const conn = buildIntelPayload(snap, f({ area: 'conexoes' }), NOW).view as ConnectionsView
    assert.equal(conn.storageNotice, STORAGE_NOTICE)
    assert.match(STORAGE_NOTICE, /memória/); assert.match(STORAGE_NOTICE, /reiniciado/)
    assert.equal(conn.meta.storage, 'memory')
  })
  it('M5: filtros inválidos para a área são normalizados no servidor e devolvidos como efetivos', () => {
    const clients = snap.dataset.clients
    const c = parseIntelFilters(new URLSearchParams({ area: 'conexoes', status: 'paused', campaign: 'marca', platform: 'meta_ads', period: '7d' }), clients)
    assert.deepEqual([c.status, c.campaign, c.platform, c.period], ['all', '', 'meta_ads', '7d'])
    const a = parseIntelFilters(new URLSearchParams({ area: 'agencia', status: 'active', campaign: 'marca' }), clients)
    assert.deepEqual([a.status, a.campaign], ['active', ''])
    const p = parseIntelFilters(new URLSearchParams({ area: 'prospeccao', client: 'cli_demo_a', status: 'paused' }), clients)
    assert.deepEqual([p.client, p.status], ['all', 'paused'])
    const v = buildIntelPayload(snap, c, NOW).view
    assert.deepEqual(v.meta.filters, c)
  })
  it('m4: campanha "Ativa" em conta com integração expirada traz o estado da integração separado', () => {
    const b = client('cli_demo_b')
    const active = b.campaigns.filter(c => c.status === 'active')
    assert.ok(active.length > 0 && active.every(c => c.dataState === 'auth_expired'))
  })
  it('m5: estado do botão vem do backend (permitido, aguardando, bloqueado)', () => {
    const a = client('cli_demo_a').assets.find(x => x.assetId === 'ast_demo_g_a1')!
    assert.deepEqual(a.manualSync, { allowed: true, reason: null, retryAt: null })
    const c = client('cli_demo_c').assets.find(x => x.assetId === 'ast_demo_m_c_susp')!
    assert.equal(c.manualSync.allowed, false); assert.match(c.manualSync.reason ?? '', /suspensa/)
    const s = snap.manualAt; s.set('ast_demo_g_a1', NOW.toISOString())
    const waiting = client('cli_demo_a').assets.find(x => x.assetId === 'ast_demo_g_a1')!.manualSync
    s.delete('ast_demo_g_a1')
    assert.equal(waiting.allowed, false); assert.match(waiting.reason ?? '', /15 minutos/); assert.equal(waiting.retryAt, new Date(NOW.getTime() + 15 * 60_000).toISOString())
  })
  it('m6: moeda em pt-BR com centavos; BRL e USD nunca somados', () => {
    const norm = (x: string) => x.replace(/ /g, ' ')
    assert.equal(norm(formatMoney(43_392_000_000, 'BRL')), 'R$ 43.392,00')
    assert.equal(norm(formatMoney(4_491_570_000, 'USD')), 'US$ 4.491,57')
    assert.equal(norm(formatMoney(1_234_500_000_000, 'BRL')), 'R$ 1.234.500,00')
    const v = overview()
    assert.ok(v.platformTotals.every(p => p.currency === 'BRL' || p.currency === 'USD'))
    assert.equal(new Set(v.platformTotals.map(p => p.platform + p.currency)).size, v.platformTotals.length)
  })
  it('m6: alertas de dados seguem o filtro de plataforma; vínculo e segurança nunca são ocultados', () => {
    const all = overview(), meta = overview({ platform: 'meta_ads' })
    const keep = all.alerts.filter(a => a.scope !== 'data')
    for (const a of keep) assert.ok(meta.alerts.some(m => m.assetName === a.assetName && m.kind === a.kind), a.kind + ' ' + a.assetName)
    assert.ok(meta.alerts.filter(a => a.scope === 'data').every(a => a.platform === 'meta_ads'))
    assert.ok(all.alerts.some(a => a.scope === 'data' && a.platform === 'google_ads'), 'há alerta de dados do Google sem filtro')
  })
})
