import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ConnectorError, type AdsReadConnector } from '../connectors/contracts'
import { createMockAdsConnector, type MockAdAccountSpec, type MockWorldOptions } from '../connectors/mock'
import type { Asset } from '../model'
import { dailyRange, isStale, manualSyncAllowed, syncAdsAsset, type SyncDeps } from './engine'
import { MemorySyncStore } from './store'

const TODAY = '2026-11-13'
const NOW = new Date('2026-11-13T12:00:00Z')
const account: MockAdAccountSpec = {
  platform: 'google_ads', externalId: '9000000999', name: 'Conta de teste', currencyCode: 'BRL', timeZone: 'America/Sao_Paulo', status: 'active', parentExternalId: null,
  campaigns: [
    { externalId: '1', name: 'A', channel: 'SEARCH', activeFrom: '2026-10-01', activeUntil: null, dailyImpressions: 3000, ctrPct: 3, cpcMicros: 2_000_000, conversionRate: 0.1 },
    { externalId: '2', name: 'B', channel: 'SEARCH', activeFrom: '2026-10-01', activeUntil: null, dailyImpressions: 2000, ctrPct: 2, cpcMicros: 1_500_000, conversionRate: 0.1 },
  ],
}
const asset: Asset = { id: 'ast_test', platform: 'google_ads', externalId: '9000000999', externalContext: '', name: 'Conta de teste', currencyCode: 'BRL',
  timeZone: 'America/Sao_Paulo', accountStatus: 'active', connectionId: 'conn', accessPath: 'direct', loginCustomerId: null }
const world = (o: Partial<MockWorldOptions> = {}): MockWorldOptions => ({ connections: { conn: 'active' }, access: { conn: ['9000000999'] }, pageSize: 5, ...o })

function deps(store = new MemorySyncStore(), extra: Partial<SyncDeps> = {}) {
  const sleeps: number[] = []
  let n = 0
  const d: SyncDeps = { store, now: () => NOW, sleep: async ms => { sleeps.push(ms) }, owner: 'test', newRunId: () => 'run' + (++n), baseDelayMs: 1000, ...extra }
  return { d, sleeps, store }
}
const range = { start: '2026-11-06', end: '2026-11-12' }

describe('Central — sincronização (mock)', () => {
  it('janela diária: últimos 7 dias completos no fuso da conta', () => {
    assert.deepEqual(dailyRange(asset, NOW, 'America/Sao_Paulo'), range)
    // 02:00 UTC de 14/11: em São Paulo ainda é 13/11 → janela termina em 12/11
    assert.deepEqual(dailyRange(asset, new Date('2026-11-14T02:00:00Z'), 'America/Sao_Paulo'), range)
  })
  it('execução repetida é idempotente (nenhuma linha duplicada) e com paginação', async () => {
    const { d, store } = deps()
    const c = createMockAdsConnector('google_ads', [account], world(), () => TODAY)
    const first = await syncAdsAsset(d, c, asset, range, 'schedule')
    assert.equal(first.status, 'succeeded')
    assert.ok(first.pagesDone >= 3, 'paginou em várias páginas (pageSize 5, 14 linhas)')
    assert.equal(first.rowsInserted, 14)
    const size = store.ads.size
    const second = await syncAdsAsset(d, c, asset, range, 'schedule')
    assert.equal(second.status, 'succeeded')
    assert.deepEqual([second.rowsInserted, second.rowsUpdated, second.rowsUnchanged], [0, 0, 14])
    assert.equal(store.ads.size, size)
  })
  it('falha temporária: tenta de novo com backoff exponencial e conclui', async () => {
    const { d, sleeps } = deps()
    const c = createMockAdsConnector('google_ads', [account], world({ faults: { '9000000999': { kind: 'transient', calls: [3, 4] } } }), () => TODAY)
    const run = await syncAdsAsset(d, c, asset, range, 'schedule')
    assert.equal(run.status, 'succeeded')
    assert.deepEqual(sleeps, [1000, 2000])
  })
  it('erro 429: respeita Retry-After antes de tentar de novo', async () => {
    const { d, sleeps } = deps()
    const c = createMockAdsConnector('google_ads', [account], world({ faults: { '9000000999': { kind: 'rate_limited', retryAfterSeconds: 7, calls: [3] } } }), () => TODAY)
    const run = await syncAdsAsset(d, c, asset, range, 'schedule')
    assert.equal(run.status, 'succeeded')
    assert.deepEqual(sleeps, [7000])
  })
  it('429 persistente: para sem dados → failed, com próxima tentativa agendada e alerta', async () => {
    const { d, store } = deps()
    const c = createMockAdsConnector('google_ads', [account], world({ faults: { '9000000999': { kind: 'rate_limited', retryAfterSeconds: 30, calls: [1, 2, 3, 4, 5] } } }), () => TODAY)
    const run = await syncAdsAsset(d, c, asset, range, 'schedule')
    assert.equal(run.status, 'failed')
    assert.equal(run.errorKind, 'rate_limited')
    assert.equal(run.attempts, 4)
    assert.equal(run.nextAttemptAt, new Date(NOW.getTime() + 30_000).toISOString())
    assert.ok([...store.alerts.values()].some(a => a.kind === 'rate_limited' && !a.resolvedAt))
  })
  it('credencial expirada (simulada): para na 1ª tentativa, sem retry, e abre alerta', async () => {
    const { d, sleeps, store } = deps()
    const c = createMockAdsConnector('google_ads', [account], world({ connections: { conn: 'expired' } }), () => TODAY)
    const run = await syncAdsAsset(d, c, asset, range, 'schedule')
    assert.deepEqual([run.status, run.errorKind, run.attempts], ['failed', 'auth_expired', 1])
    assert.deepEqual(sleeps, [])
    assert.ok(store.alerts.get('ast_test|auth_expired'))
  })
  it('falha no meio → parcial; retomada segura completa a janela sem duplicar e resolve o alerta', async () => {
    const store = new MemorySyncStore()
    const { d } = deps(store)
    const failing = createMockAdsConnector('google_ads', [account], world({ faults: { '9000000999': { kind: 'transient', calls: [4, 5, 6, 7] } } }), () => TODAY)
    const partial = await syncAdsAsset(d, failing, asset, range, 'schedule')
    assert.equal(partial.status, 'partial')
    assert.equal(partial.pagesDone, 1)
    assert.equal(store.ads.size, 5)
    assert.ok(store.alerts.get('ast_test|sync_partial'))
    const ok = createMockAdsConnector('google_ads', [account], world(), () => TODAY)
    const resumed = await syncAdsAsset(d, ok, asset, range, 'manual')
    assert.equal(resumed.status, 'succeeded')
    assert.deepEqual([resumed.rowsInserted, resumed.rowsUnchanged], [9, 5])
    assert.equal(store.ads.size, 14)
    assert.ok(store.alerts.get('ast_test|sync_partial')?.resolvedAt)
  })
  it('execução concorrente da mesma conta: a segunda é recusada pelo lease', async () => {
    const store = new MemorySyncStore()
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const base = createMockAdsConnector('google_ads', [account], world(), () => TODAY)
    const slow: AdsReadConnector = { ...base, getAccount: async (ctx, id) => { await gate; return base.getAccount(ctx, id) } }
    const a = syncAdsAsset({ ...deps(store).d, owner: 'worker-1' }, slow, asset, range, 'schedule')
    const b = await syncAdsAsset({ ...deps(store).d, owner: 'worker-2' }, base, asset, range, 'manual')
    assert.equal(b.status, 'skipped_locked')
    release()
    assert.equal((await a).status, 'succeeded')
    assert.equal(store.leases.size, 0, 'lease liberado ao final')
  })
  it('lease expirado (processo interrompido) permite retomar', async () => {
    const store = new MemorySyncStore()
    store.tryAcquireLease('ast_test', 'morto', new Date(NOW.getTime() - 10 * 60_000), 5 * 60_000)
    const run = await syncAdsAsset(deps(store).d, createMockAdsConnector('google_ads', [account], world(), () => TODAY), asset, range, 'schedule')
    assert.equal(run.status, 'succeeded')
  })
  it('erros não previstos viram falha sanitizada (sem vazar valores longos)', async () => {
    const { d } = deps()
    const base = createMockAdsConnector('google_ads', [account], world(), () => TODAY)
    const broken: AdsReadConnector = { ...base, getAccount: async () => { throw new ConnectorError('invalid_request', 'falhou com token EAAsyntheticTOKENvalue0123456789abcdefXYZ') } }
    const run = await syncAdsAsset(d, broken, asset, range, 'schedule')
    assert.equal(run.status, 'failed')
    assert.doesNotMatch(run.errorMessage ?? '', /EAAsynthetic/)
  })
  it('ativo sem conexão não sincroniza', async () => {
    const run = await syncAdsAsset(deps().d, createMockAdsConnector('google_ads', [account], world(), () => TODAY), { ...asset, connectionId: null }, range, 'manual')
    assert.deepEqual([run.status, run.errorKind], ['failed', 'permission_denied'])
  })
  it('atualização manual: intervalo mínimo de 15 minutos; dados desatualizados após 36 h', () => {
    assert.deepEqual(manualSyncAllowed(null, NOW), { allowed: true, retryAt: null })
    assert.equal(manualSyncAllowed(new Date(NOW.getTime() - 5 * 60_000).toISOString(), NOW).allowed, false)
    assert.equal(manualSyncAllowed(new Date(NOW.getTime() - 16 * 60_000).toISOString(), NOW).allowed, true)
    assert.equal(isStale(new Date(NOW.getTime() - 37 * 3_600_000).toISOString(), NOW), true)
    assert.equal(isStale(new Date(NOW.getTime() - 3 * 3_600_000).toISOString(), NOW), false)
    assert.equal(isStale(null, NOW), true)
  })
})
