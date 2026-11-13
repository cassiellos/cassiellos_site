/**
 * Monta o "estado" de demonstração PASSANDO PELO MESMO MOTOR de sincronização que a integração real usará:
 * conectores mock → syncAdsAsset/syncGa4Asset/syncGtmAsset → MemorySyncStore. Assim a tela demonstra também
 * execuções, falhas, 429 com nova tentativa, sincronização parcial, autorização expirada e dados desatualizados.
 * Nada é persistido: o estado vive na MEMÓRIA do processo (MemorySyncStore) e nunca toca o Neon nem nenhum banco.
 * Reinicializações do processo (novo deploy, nova instância) descartam execuções e atualizações manuais simuladas.
 */
import { civilDateInZone, syncWindow } from '../dates'
import { createMockAdsConnector, createMockGa4Connector, createMockGtmConnector, type MockWorldOptions } from '../connectors/mock'
import type { AdsReadConnector, Ga4ReadConnector, GtmReadConnector } from '../connectors/contracts'
import { DAILY_LOOKBACK_DAYS, manualSyncAllowed, syncAdsAsset, syncGa4Asset, syncGtmAsset, type SyncDeps } from '../sync/engine'
import { authorizeSync, selectSyncTargets, type AuthorizedSyncTarget, type SyncBlockReason } from '../sync/eligibility'
import { MemorySyncStore, type SyncRun, type SyncTrigger } from '../sync/store'
import { buildDemoDataset, DEMO_HISTORY_DAYS, DEMO_REPORT_TZ, type DemoDataset } from './dataset'

export type IntelSnapshot = {
  builtAt: string
  today: string
  dataset: DemoDataset
  store: MemorySyncStore
  /** Última atualização manual (simulada) por ativo — controle de intervalo mínimo. */
  manualAt: Map<string, string>
  connectors: (now: () => Date, faults: boolean, connections?: DemoDataset['connections']) => Connectors
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

export async function syncAsset(snapshot: IntelSnapshot, target: AuthorizedSyncTarget, now: () => Date, trigger: SyncTrigger, faults: boolean, lookbackDays = DAILY_LOOKBACK_DAYS): Promise<SyncRun> {
  const c = snapshot.connectors(() => now(), faults)
  const deps = demoDeps(snapshot.store, now, 'demo-' + trigger)
  const range = syncWindow(civilDateInZone(now(), target.timeZone ?? DEMO_REPORT_TZ), lookbackDays)
  switch (target.platform) {
    case 'google_ads': return syncAdsAsset(deps, c.google, target, range, trigger)
    case 'meta_ads': return syncAdsAsset(deps, c.meta, target, range, trigger)
    case 'ga4': return syncGa4Asset(deps, c.ga4, target, range, trigger)
    case 'gtm': return syncGtmAsset(deps, c.gtm, target, trigger)
  }
}

const BLOCK_ALERT: Partial<Record<SyncBlockReason, 'auth_expired' | 'auth_revoked'>> = { connection_expired: 'auth_expired', connection_revoked: 'auth_revoked' }

export async function buildDemoSnapshot(now: Date): Promise<IntelSnapshot> {
  const today = civilDateInZone(now, DEMO_REPORT_TZ)
  const dataset = buildDemoDataset(today, now.toISOString())
  const store = new MemorySyncStore()
  const connectors = (clock: () => Date, faults: boolean, connections = dataset.connections): Connectors => {
    const opts = worldFor({ ...dataset, connections }, faults, faults ? 10 : 200)
    const day = () => civilDateInZone(clock(), DEMO_REPORT_TZ)
    return {
      google: createMockAdsConnector('google_ads', dataset.adAccounts, opts, day),
      meta: createMockAdsConnector('meta_ads', dataset.adAccounts, opts, day),
      ga4: createMockGa4Connector(dataset.ga4, opts),
      gtm: createMockGtmConnector(dataset.gtm, opts),
    }
  }
  const snapshot: IntelSnapshot = { builtAt: now.toISOString(), today, dataset, store, manualAt: new Map(), connectors }

  // 1) Carga histórica. A conexão hoje expirada estava ATIVA quando a carga ocorreu (há `staleDays` dias): a decisão
  //    usa o estado da conexão NAQUELE momento. Vínculos não confirmados ficam de fora (nem chegam ao conector).
  const historicalConnections = dataset.connections.map(c => (c.status === 'expired' ? { ...c, status: 'active' as const } : c))
  const history = selectSyncTargets(dataset.assets, dataset.links, historicalConnections, 'backfill')
  const historicalSnapshot: IntelSnapshot = { ...snapshot, connectors: (clock, f) => connectors(clock, f, historicalConnections) }
  for (const target of history.targets) {
    const lag = dataset.staleDays[target.id] ?? 0
    const at = new Date(now.getTime() - lag * 86_400_000 - 6 * 3_600_000)
    await syncAsset(lag ? historicalSnapshot : snapshot, target, () => at, 'backfill', false, DEMO_HISTORY_DAYS)
  }
  // 2) Execução diária mais recente (revisão de 7 dias), com as falhas programadas. Conexões expiradas/revogadas NÃO
  //    são consultadas: abre-se o alerta correspondente sem chamar a plataforma.
  const daily = new Date(now.getTime() - 4 * 3_600_000)
  const plan = selectSyncTargets(dataset.assets, dataset.links, dataset.connections, 'schedule')
  for (const target of plan.targets) await syncAsset(snapshot, target, () => daily, 'schedule', true)
  for (const b of plan.blocked) {
    const kind = BLOCK_ALERT[b.reason]
    if (kind) store.openAlert(b.assetId, kind, kind === 'auth_expired' ? 'autorização expirada — sincronização não executada' : 'autorização revogada — sincronização não executada', daily)
  }
  return snapshot
}

export type ManualSyncCheck =
  | { allowed: true; target: AuthorizedSyncTarget }
  | { allowed: false; reason: SyncBlockReason | 'not_in_client' | 'unknown_asset' | 'too_soon'; retryAt: string | null }

/**
 * Atualização manual (simulada): o ativo precisa pertencer ao cliente informado com vínculo CONFIRMADO, passar pela
 * autorização de sincronização (conexão ativa, conta não suspensa) e respeitar o intervalo mínimo de 15 minutos.
 */
export function checkManualSync(snapshot: IntelSnapshot, clientId: string | null, assetId: string, now: Date): ManualSyncCheck {
  const asset = snapshot.dataset.assets.find(a => a.id === assetId)
  if (!asset) return { allowed: false, reason: 'unknown_asset', retryAt: null }
  if (clientId !== null && !snapshot.dataset.links.some(l => l.clientId === clientId && l.assetId === assetId && l.status === 'confirmed'))
    return { allowed: false, reason: 'not_in_client', retryAt: null }
  const decision = authorizeSync(asset, snapshot.dataset.links, snapshot.dataset.connections, 'manual', snapshot.store.observations.get(asset.id)?.accountStatus)
  if (!decision.eligible) return { allowed: false, reason: decision.reason, retryAt: null }
  const gate = manualSyncAllowed(snapshot.manualAt.get(asset.id) ?? null, now)
  if (!gate.allowed) return { allowed: false, reason: 'too_soon', retryAt: gate.retryAt }
  return { allowed: true, target: decision.target }
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
