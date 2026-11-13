/**
 * Monta o "estado" de demonstração PASSANDO PELO MESMO MOTOR de sincronização que a integração real usará:
 * conectores mock → syncAdsAsset/syncGa4Asset/syncGtmAsset → MemorySyncStore. Assim a tela demonstra também
 * execuções, falhas, 429 com nova tentativa, sincronização parcial, autorização expirada e dados desatualizados.
 * Nada é persistido: o estado vive na memória do processo (somente demonstração) e nunca toca o Neon.
 */
import { civilDateInZone, syncWindow } from '../dates'
import { createMockAdsConnector, createMockGa4Connector, createMockGtmConnector, type MockWorldOptions } from '../connectors/mock'
import type { AdsReadConnector, Ga4ReadConnector, GtmReadConnector } from '../connectors/contracts'
import { DAILY_LOOKBACK_DAYS, syncAdsAsset, syncGa4Asset, syncGtmAsset, type SyncDeps } from '../sync/engine'
import { MemorySyncStore, type SyncRun, type SyncTrigger } from '../sync/store'
import type { Asset } from '../model'
import { buildDemoDataset, DEMO_HISTORY_DAYS, DEMO_REPORT_TZ, type DemoDataset } from './dataset'

export type IntelSnapshot = {
  builtAt: string
  today: string
  dataset: DemoDataset
  store: MemorySyncStore
  /** Última atualização manual (simulada) por ativo — controle de intervalo mínimo. */
  manualAt: Map<string, string>
  connectors: (now: () => Date, faults: boolean) => Connectors
}

type Connectors = { google: AdsReadConnector; meta: AdsReadConnector; ga4: Ga4ReadConnector; gtm: GtmReadConnector }

function worldFor(ds: DemoDataset, withFaults: boolean, pageSize: number): MockWorldOptions {
  const access: Record<string, string[]> = {}
  for (const a of ds.assets) if (a.connectionId) (access[a.connectionId] ??= []).push(a.externalId)
  return {
    pageSize,
    connections: Object.fromEntries(ds.connections.map(c => [c.id, c.status === 'expired' ? 'expired' : c.status === 'revoked' ? 'revoked' : 'active'])),
    access,
    faults: withFaults ? ds.latestRunFaults : undefined,
  }
}

let runCounter = 0
export function demoDeps(store: MemorySyncStore, now: () => Date, owner = 'demo'): SyncDeps {
  return { store, now, sleep: async () => undefined, owner, newRunId: () => 'run_demo_' + (++runCounter), baseDelayMs: 1 }
}

export async function syncAsset(snapshot: IntelSnapshot, asset: Asset, now: () => Date, trigger: SyncTrigger, faults: boolean, lookbackDays = DAILY_LOOKBACK_DAYS): Promise<SyncRun | null> {
  const c = snapshot.connectors(() => now(), faults)
  const deps = demoDeps(snapshot.store, now, 'demo-' + trigger)
  const range = syncWindow(civilDateInZone(now(), asset.timeZone ?? DEMO_REPORT_TZ), lookbackDays)
  switch (asset.platform) {
    case 'google_ads': return syncAdsAsset(deps, c.google, asset, range, trigger)
    case 'meta_ads': return syncAdsAsset(deps, c.meta, asset, range, trigger)
    case 'ga4': return syncGa4Asset(deps, c.ga4, asset, range, trigger)
    case 'gtm': return syncGtmAsset(deps, c.gtm, asset, trigger)
  }
}

export async function buildDemoSnapshot(now: Date): Promise<IntelSnapshot> {
  const today = civilDateInZone(now, DEMO_REPORT_TZ)
  const dataset = buildDemoDataset(today, now.toISOString())
  const store = new MemorySyncStore()
  const connectors = (clock: () => Date, faults: boolean): Connectors => {
    const opts = worldFor(dataset, faults, faults ? 10 : 200)
    const day = () => civilDateInZone(clock(), DEMO_REPORT_TZ)
    return {
      google: createMockAdsConnector('google_ads', dataset.adAccounts, opts, day),
      meta: createMockAdsConnector('meta_ads', dataset.adAccounts, opts, day),
      ga4: createMockGa4Connector(dataset.ga4, opts),
      gtm: createMockGtmConnector(dataset.gtm, opts),
    }
  }
  const snapshot: IntelSnapshot = { builtAt: now.toISOString(), today, dataset, store, manualAt: new Map(), connectors }
  const syncable = dataset.assets.filter(a => a.connectionId)
  // 1) histórico (carga inicial) — para conexões hoje expiradas, a carga ocorreu antes de expirar.
  for (const asset of syncable) {
    const lag = dataset.staleDays[asset.id] ?? 0
    const at = new Date(now.getTime() - lag * 86_400_000 - 6 * 3_600_000)
    const conn = dataset.connections.find(c => c.id === asset.connectionId)
    const backfillSnapshot: IntelSnapshot = conn?.status === 'expired'
      ? { ...snapshot, connectors: (clock, f) => { const o = worldFor({ ...dataset, connections: dataset.connections.map(c => ({ ...c, status: 'active' as const })) }, f, 200)
          const day = () => civilDateInZone(clock(), DEMO_REPORT_TZ)
          return { google: createMockAdsConnector('google_ads', dataset.adAccounts, o, day), meta: createMockAdsConnector('meta_ads', dataset.adAccounts, o, day),
            ga4: createMockGa4Connector(dataset.ga4, o), gtm: createMockGtmConnector(dataset.gtm, o) } } }
      : snapshot
    await syncAsset(backfillSnapshot, asset, () => at, 'backfill', false, DEMO_HISTORY_DAYS)
  }
  // 2) execução diária mais recente (revisão de 7 dias) com as falhas programadas.
  const daily = new Date(now.getTime() - 4 * 3_600_000)
  for (const asset of syncable) await syncAsset(snapshot, asset, () => daily, 'schedule', true)
  return snapshot
}

/* ---- cache por processo (demonstração): reconstrói a cada novo dia civil ---- */
let cached: { day: string; promise: Promise<IntelSnapshot> } | null = null
export function demoSnapshot(now: Date): Promise<IntelSnapshot> {
  const day = civilDateInZone(now, DEMO_REPORT_TZ)
  if (!cached || cached.day !== day) cached = { day, promise: buildDemoSnapshot(now) }
  return cached.promise
}
/** Somente testes. */
export function resetDemoSnapshotCache() { cached = null }
