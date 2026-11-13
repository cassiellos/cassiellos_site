import assert from 'node:assert/strict'
import { before, describe, it } from 'node:test'
import { assertNoSecretsInPayload } from './credential-vault'
import { buildDemoSnapshot, type IntelSnapshot } from './demo/snapshot'
import { buildIntelPayload, FilterError, parseIntelFilters } from './view-model'
import type { ClientView, ConnectionsView, IntelFilters, OverviewView, ProspectingView } from './view-types'

const NOW = new Date('2026-11-13T15:00:00Z')
let snap: IntelSnapshot
before(async () => { snap = await buildDemoSnapshot(NOW) })
const f = (o: Partial<IntelFilters>): IntelFilters => ({ area: 'agencia', period: '30d', platform: 'all', status: 'all', client: 'all', campaign: '', ...o })
const client = (id: string, o: Partial<IntelFilters> = {}) => (buildIntelPayload(snap, f({ area: 'cliente', client: id, ...o }), NOW).view as ClientView)
const idsOfOthers = (clientId: string) => {
  const own = new Set(snap.dataset.links.filter(l => l.clientId === clientId).map(l => l.assetId))
  return snap.dataset.assets.filter(a => !own.has(a.id)).flatMap(a => [a.id, a.name, a.externalId])
}

describe('Central — visões (dados simulados)', () => {
  it('troca de cliente: cada visão só contém ativos, campanhas e nomes do próprio cliente', () => {
    for (const id of ['cli_demo_a', 'cli_demo_b', 'cli_demo_c', 'cli_demo_d']) {
      const json = JSON.stringify(client(id))
      for (const foreign of idsOfOthers(id)) assert.ok(!json.includes(foreign), id + ' vazou ' + foreign)
    }
    // A → C → A: a mesma consulta devolve exatamente o mesmo conteúdo (sem estado residual entre trocas)
    const a1 = JSON.stringify(client('cli_demo_a')); client('cli_demo_c'); assert.equal(JSON.stringify(client('cli_demo_a')), a1)
  })
  it('múltiplas contas por cliente (2 Google Ads + GA4 + GTM) e vínculo provável fora das métricas', () => {
    const a = client('cli_demo_a')
    assert.deepEqual(a.assets.map(x => x.platform).sort(), ['ga4', 'google_ads', 'google_ads', 'gtm'])
    assert.deepEqual(a.pendingAssets.map(x => [x.name, x.association, x.state]), [['Exemplo A · Conta encontrada pela busca', 'probable', 'pending_validation']])
    assert.ok(!a.campaigns.some(c => c.name === 'Campanha não validada'), 'campanha da conta provável não entra')
    assert.ok(![...snap.store.ads.values()].some(r => r.assetId === 'ast_demo_g_a3'), 'a conta provável NÃO é sincronizada')
    assert.equal(snap.store.runs.some(r => r.assetId === 'ast_demo_g_a3'), false, 'nenhuma execução para a conta provável')
    const pending = a.pendingAssets[0]
    assert.deepEqual([pending.lastSyncAt, pending.lastSuccessAt, pending.syncAuthorized, pending.manualSync.allowed], [null, null, false, false])
    assert.equal(a.ga4.length, 1); assert.equal(a.gtm.length, 1)
    assert.equal(a.assets.find(x => x.assetId === 'ast_demo_g_a2')?.accessPath, 'manager')
  })
  it('cliente sem integração: nenhum dado, estado "sem integração"', () => {
    const d = client('cli_demo_d')
    assert.equal(d.client.state, 'no_integration')
    assert.deepEqual([d.assets.length, d.campaigns.length, d.kpis.hasData, d.trend.series.length], [0, 0, false, 0])
  })
  it('estados previstos aparecem: expirada, desatualizada, suspensa, erro, pausada, sem dados, não encontrada, sem acesso', () => {
    const b = client('cli_demo_b')
    assert.equal(b.assets[0].state, 'auth_expired')
    assert.equal(b.pendingAssets[0].state, 'not_found')
    const c = client('cli_demo_c')
    const st = Object.fromEntries(c.assets.map(x => [x.assetId, x.state]))
    assert.equal(st.ast_demo_m_c_susp, 'suspended')
    assert.equal(st.ast_demo_g_c, 'sync_error')
    assert.equal(c.pendingAssets[0].state, 'no_access')
    const a = client('cli_demo_a', { period: '7d' })
    assert.equal(a.assets.find(x => x.assetId === 'ast_demo_g_a2')?.state, 'paused')
    const conn = buildIntelPayload(snap, f({ area: 'conexoes' }), NOW).view as ConnectionsView
    assert.ok(conn.rows.some(r => r.authStatus === 'expired'))
    assert.ok(conn.recentRuns.some(r => r.status === 'partial'))
  })
  it('dados desatualizados: a última sincronização bem-sucedida da conta expirada tem mais de 36 h', () => {
    const b = client('cli_demo_b')
    assert.ok(Date.parse(b.assets[0].lastSuccessAt!) < NOW.getTime() - 8 * 86_400_000)
    const ov = buildIntelPayload(snap, f({}), NOW).view as OverviewView
    assert.ok(ov.alerts.some(x => x.kind === 'auth_expired' && x.clientName === 'Cliente Exemplo B'))
  })
  it('moedas distintas: cliente C tem BRL e USD separados, sem total único', () => {
    const c = client('cli_demo_c')
    assert.deepEqual(c.kpis.byCurrency.map(k => k.currency), ['BRL', 'USD'])
    const ov = buildIntelPayload(snap, f({}), NOW).view as OverviewView
    assert.deepEqual(ov.distribution.map(d => d.currency), ['BRL', 'USD'])
    assert.ok(ov.trend.series.every(s => s.currency === 'BRL' || s.currency === 'USD'))
  })
  it('conversões por plataforma sem soma entre Google e Meta', () => {
    const c = client('cli_demo_c')
    const platforms = c.kpis.conversions.map(x => x.platform)
    assert.ok(platforms.includes('google_ads') && platforms.includes('meta_ads'))
    assert.ok(!JSON.stringify(c.kpis).match(/totalConversions|leadsUnicos/))
  })
  it('totalização por período: o total do período = soma das linhas de cada dia do período', () => {
    const a = client('cli_demo_a', { period: '7d', platform: 'google_ads' })
    const brl = a.kpis.byCurrency.find(k => k.currency === 'BRL')!
    const sumTrend = a.trend.series.filter(s => s.currency === 'BRL').reduce((s, x) => s + x.values.reduce<number>((t, v) => t + (v ?? 0), 0), 0)
    assert.equal(brl.costMicros, sumTrend)
    assert.equal(a.meta.period.end, '2026-11-12')
    assert.equal(a.meta.period.start, '2026-11-06')
  })
  it('ausência de dados ≠ zero: período sem veiculação devolve "sem dados", não 0', () => {
    // Filial Norte parou há 45 dias: no período de 7 dias não há linhas
    const a = client('cli_demo_a', { period: '7d' })
    const filial = a.campaigns.find(c => c.name === 'Filial Norte · Pesquisa')
    assert.equal(filial?.hasData, false)
    assert.deepEqual(filial?.ctr, { kind: 'no_data' })
  })
  it('filtro de plataforma e de situação/busca de campanhas', () => {
    const c = client('cli_demo_c', { platform: 'meta_ads' })
    assert.ok(c.campaigns.every(x => x.platform === 'meta_ads'))
    assert.ok(c.kpis.conversions.every(x => x.platform === 'meta_ads'))
    const paused = client('cli_demo_a', { status: 'paused' })
    assert.ok(paused.campaigns.length > 0 && paused.campaigns.every(x => x.status === 'paused'))
    const found = client('cli_demo_a', { campaign: 'MARCA' })
    assert.deepEqual(found.campaigns.map(x => x.name), ['Institucional · Marca'])
  })
  it('visão geral exclui a agência; prospecção usa só a agência e funil simulado', () => {
    const ov = buildIntelPayload(snap, f({}), NOW).view as OverviewView
    assert.ok(!ov.rows.some(r => r.name === 'Cassiellos Demo'))
    assert.equal(ov.monitoredClients, 4)
    const p = buildIntelPayload(snap, f({ area: 'prospeccao' }), NOW).view as ProspectingView
    assert.equal(p.funnel.simulated, true)
    assert.ok(p.assets.every(a => a.name.startsWith('Cassiellos Demo')))
    assert.ok(p.funnel.byChannel.every(ch => ch.cplMicros.kind !== 'value' || ch.cplMicros.value > 0))
    assert.equal(p.meta.simulated, true)
  })
  it('nenhuma credencial no payload de nenhuma área', () => {
    for (const area of ['prospeccao', 'agencia', 'cliente', 'conexoes'] as const) {
      const payload = buildIntelPayload(snap, f({ area, client: area === 'cliente' ? 'cli_demo_a' : 'all' }), NOW)
      assertNoSecretsInPayload(payload)
      assert.doesNotMatch(JSON.stringify(payload), /vault:|EAA[A-Za-z0-9]{10}|ya29\.|financeClientId/)
    }
  })
  it('filtros inválidos e cliente inexistente são recusados', () => {
    const clients = snap.dataset.clients
    assert.throws(() => parseIntelFilters(new URLSearchParams({ period: '999d' }), clients), FilterError)
    assert.throws(() => parseIntelFilters(new URLSearchParams({ area: 'cliente', client: 'cli_outro' }), clients), (e: unknown) => e instanceof FilterError && e.code === 'CLIENT_NOT_FOUND')
    assert.throws(() => parseIntelFilters(new URLSearchParams({ area: 'cliente', client: 'cli_demo_cassiellos' }), clients), FilterError) // agência não é "cliente"
    assert.throws(() => parseIntelFilters(new URLSearchParams({ campaign: '<script>' }), clients), FilterError)
    assert.throws(() => parseIntelFilters(new URLSearchParams({ client: "x' OR 1=1" }), clients), FilterError)
    assert.equal(parseIntelFilters(new URLSearchParams({ area: 'cliente' }), clients).client, 'cli_demo_a')
  })
})
