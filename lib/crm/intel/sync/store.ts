/**
 * Contrato do armazenamento da sincronização + implementação em MEMÓRIA (fundação/mock e testes).
 *
 * A implementação futura em PostgreSQL usará as tabelas da migração 0018 com as MESMAS garantias:
 * - upsert idempotente por chave natural (ativo, campanha, dia, definição da conversão);
 * - lease por ativo (impede duas sincronizações simultâneas da mesma conta);
 * - registro de cada execução (tentativas, linhas, erro sanitizado) e alertas deduplicados.
 */
import type { CivilDate, DateRange } from '../dates'
import type { CampaignInfo, ConnectorErrorKind, ExternalAccountStatus, Ga4DailyRow, GtmDiagnostics } from '../connectors/contracts'

export type SyncKind = 'ads_daily' | 'ga4_daily' | 'gtm_snapshot'
export type SyncTrigger = 'schedule' | 'manual' | 'backfill' | 'reprocess'
export type SyncStatus = 'succeeded' | 'partial' | 'failed' | 'skipped_locked'

export type SyncRun = {
  id: string
  assetId: string
  kind: SyncKind
  trigger: SyncTrigger
  range: DateRange | null
  status: SyncStatus
  attempts: number
  pagesDone: number
  rowsInserted: number
  rowsUpdated: number
  rowsUnchanged: number
  errorKind: ConnectorErrorKind | null
  /** Mensagem curta e SANITIZADA (nunca payload bruto, nunca segredo). */
  errorMessage: string | null
  nextAttemptAt: string | null
  startedAt: string
  finishedAt: string
}

export type StoredAdsRow = {
  assetId: string
  campaignExternalId: string
  day: CivilDate
  currency: string
  impressions: number
  clicks: number
  costMicros: number
  conversions: number | null
  conversionBasis: string
  attribution: string
  syncRunId: string
}

export type StoredCampaign = CampaignInfo & { assetId: string; lastSeenAt: string }
export type StoredGa4Row = Ga4DailyRow & { assetId: string; syncRunId: string }

export type AlertKind = 'auth_expired' | 'auth_revoked' | 'permission_denied' | 'rate_limited' | 'sync_failed' | 'sync_partial' | 'stale_data' | 'account_suspended'
export type Alert = { key: string; assetId: string; kind: AlertKind; openedAt: string; lastSeenAt: string; resolvedAt: string | null; message: string }

export type AssetObservation = { currencyCode: string; timeZone: string; accountStatus: ExternalAccountStatus; observedAt: string }

export type UpsertResult = { inserted: number; updated: number; unchanged: number }

export interface SyncStore {
  tryAcquireLease(assetId: string, owner: string, now: Date, ttlMs: number): boolean
  releaseLease(assetId: string, owner: string): void
  observeAsset(assetId: string, obs: AssetObservation): void
  upsertCampaigns(assetId: string, campaigns: readonly CampaignInfo[], now: Date): void
  upsertAdsRows(rows: readonly StoredAdsRow[]): UpsertResult
  upsertGa4Rows(rows: readonly StoredGa4Row[]): UpsertResult
  saveGtm(assetId: string, diag: GtmDiagnostics, now: Date): void
  recordRun(run: SyncRun): void
  openAlert(assetId: string, kind: AlertKind, message: string, now: Date): void
  resolveAlerts(assetId: string, kinds: readonly AlertKind[], now: Date): void
}

const adsKey = (r: Pick<StoredAdsRow, 'assetId' | 'campaignExternalId' | 'day' | 'conversionBasis'>) =>
  r.assetId + '|' + r.campaignExternalId + '|' + r.day + '|' + r.conversionBasis
const ga4Key = (r: StoredGa4Row) => [r.assetId, r.date, r.source, r.medium, r.campaign].join('|')

function sameAds(a: StoredAdsRow, b: StoredAdsRow) {
  return a.impressions === b.impressions && a.clicks === b.clicks && a.costMicros === b.costMicros &&
    a.conversions === b.conversions && a.currency === b.currency && a.attribution === b.attribution
}

export class MemorySyncStore implements SyncStore {
  readonly leases = new Map<string, { owner: string; until: number }>()
  readonly observations = new Map<string, AssetObservation>()
  readonly campaigns = new Map<string, StoredCampaign>()
  readonly ads = new Map<string, StoredAdsRow>()
  readonly ga4 = new Map<string, StoredGa4Row>()
  readonly gtm = new Map<string, GtmDiagnostics & { fetchedAt: string }>()
  readonly runs: SyncRun[] = []
  readonly alerts = new Map<string, Alert>()

  tryAcquireLease(assetId: string, owner: string, now: Date, ttlMs: number): boolean {
    const cur = this.leases.get(assetId)
    if (cur && cur.until > now.getTime() && cur.owner !== owner) return false
    this.leases.set(assetId, { owner, until: now.getTime() + ttlMs })
    return true
  }
  releaseLease(assetId: string, owner: string): void {
    if (this.leases.get(assetId)?.owner === owner) this.leases.delete(assetId)
  }
  observeAsset(assetId: string, obs: AssetObservation): void { this.observations.set(assetId, obs) }
  upsertCampaigns(assetId: string, campaigns: readonly CampaignInfo[], now: Date): void {
    for (const c of campaigns) this.campaigns.set(assetId + '|' + c.externalId, { ...c, assetId, lastSeenAt: now.toISOString() })
  }
  upsertAdsRows(rows: readonly StoredAdsRow[]): UpsertResult {
    const out = { inserted: 0, updated: 0, unchanged: 0 }
    for (const r of rows) {
      const k = adsKey(r)
      const cur = this.ads.get(k)
      if (!cur) { this.ads.set(k, { ...r }); out.inserted++ }
      else if (sameAds(cur, r)) out.unchanged++
      else { this.ads.set(k, { ...r }); out.updated++ }
    }
    return out
  }
  upsertGa4Rows(rows: readonly StoredGa4Row[]): UpsertResult {
    const out = { inserted: 0, updated: 0, unchanged: 0 }
    for (const r of rows) {
      const k = ga4Key(r)
      const cur = this.ga4.get(k)
      if (!cur) { this.ga4.set(k, { ...r }); out.inserted++ }
      else if (cur.sessions === r.sessions && cur.totalUsers === r.totalUsers && cur.engagedSessions === r.engagedSessions && cur.keyEvents === r.keyEvents) out.unchanged++
      else { this.ga4.set(k, { ...r }); out.updated++ }
    }
    return out
  }
  saveGtm(assetId: string, diag: GtmDiagnostics, now: Date): void { this.gtm.set(assetId, { ...diag, fetchedAt: now.toISOString() }) }
  recordRun(run: SyncRun): void { this.runs.push({ ...run }) }
  openAlert(assetId: string, kind: AlertKind, message: string, now: Date): void {
    const key = assetId + '|' + kind
    const cur = this.alerts.get(key)
    if (cur && !cur.resolvedAt) { cur.lastSeenAt = now.toISOString(); cur.message = message; return }
    this.alerts.set(key, { key, assetId, kind, message, openedAt: now.toISOString(), lastSeenAt: now.toISOString(), resolvedAt: null })
  }
  resolveAlerts(assetId: string, kinds: readonly AlertKind[], now: Date): void {
    for (const k of kinds) { const a = this.alerts.get(assetId + '|' + k); if (a && !a.resolvedAt) a.resolvedAt = now.toISOString() }
  }

  /* ---- leitura (view model) ---- */
  adsRowsFor(assetIds: ReadonlySet<string>): StoredAdsRow[] { return [...this.ads.values()].filter(r => assetIds.has(r.assetId)) }
  ga4RowsFor(assetIds: ReadonlySet<string>): StoredGa4Row[] { return [...this.ga4.values()].filter(r => assetIds.has(r.assetId)) }
  campaignsFor(assetIds: ReadonlySet<string>): StoredCampaign[] { return [...this.campaigns.values()].filter(c => assetIds.has(c.assetId)) }
  lastRun(assetId: string, predicate: (r: SyncRun) => boolean = () => true): SyncRun | null {
    for (let i = this.runs.length - 1; i >= 0; i--) if (this.runs[i].assetId === assetId && predicate(this.runs[i])) return this.runs[i]
    return null
  }
  openAlertsFor(assetIds: ReadonlySet<string>): Alert[] { return [...this.alerts.values()].filter(a => !a.resolvedAt && assetIds.has(a.assetId)) }
}
