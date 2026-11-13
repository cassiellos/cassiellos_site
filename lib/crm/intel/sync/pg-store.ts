/**
 * SyncStore em PostgreSQL (modo real) — tabelas das migrações 0017/0018.
 *
 * - Lease DISTRIBUÍDO: o job `running` em crm.mi_sync_jobs é único por ativo (índice parcial mi_sync_one_running).
 *   Duas instâncias não sincronizam a mesma conta ao mesmo tempo; um lease vencido (instância que caiu) é encerrado
 *   como falha antes de nova tentativa.
 * - Idempotência: upsert por chave natural (ativo, campanha, dia, definição da conversão); linha igual não é regravada.
 * - Cada execução fica registrada (tentativas, páginas, linhas, erro SANITIZADO); alertas deduplicados (um aberto por tipo).
 */
import type { CampaignInfo, GtmDiagnostics } from '../connectors/contracts'
import type { Queryable } from '../vault/pg-vault'
import { UPSERT_ADS_DAILY_SQL } from '../sql'
import type { AlertKind, AssetObservation, LeaseJob, StoredAdsRow, StoredGa4Row, SyncRun, SyncStore, UpsertResult } from './store'

export type PgClientLike = Queryable & { release?: () => void }
export type PgPoolLike = Queryable & { connect?: () => Promise<PgClientLike> }

const CAMPAIGN_ID_RE = /^[0-9A-Za-z_-]{1,40}$/
const clip = (s: string | null, n: number) => (s === null ? null : s.slice(0, n))

export class PgSyncStore implements SyncStore {
  /** runId → job em andamento desta instância (o lease). */
  private readonly running = new Map<string, { runId: string; owner: string }>()

  constructor(private readonly db: PgPoolLike) {}

  async tryAcquireLease(assetId: string, owner: string, now: Date, ttlMs: number, job?: LeaseJob): Promise<boolean> {
    if (!job) throw new Error('PgSyncStore exige os dados do job para o lease')
    // Lease vencido (instância que caiu no meio): encerra como falha transitória, liberando a conta.
    await this.db.query(`UPDATE crm.mi_sync_jobs SET status = 'failed', error_kind = 'transient', error_message = 'lease expirado (execução interrompida)',
        lease_owner = NULL, lease_until = NULL, finished_at = now() WHERE asset_id = $1 AND status = 'running' AND lease_until < $2`, [assetId, now])
    const { rows } = await this.db.query(
      `INSERT INTO crm.mi_sync_jobs (id, asset_id, kind, trigger, range_start, range_end, status, lease_owner, lease_until, started_at, attempts)
       VALUES ($1, $2, $3, $4, $5::date, $6::date, 'running', $7, $8, $9, 0)
       ON CONFLICT DO NOTHING RETURNING id`,
      [job.runId, assetId, job.kind, job.trigger, job.range?.start ?? null, job.range?.end ?? null, owner.slice(0, 80), new Date(now.getTime() + ttlMs), now])
    if (!rows[0]) return false
    this.running.set(assetId, { runId: job.runId, owner })
    return true
  }

  async releaseLease(assetId: string, owner: string): Promise<void> {
    const cur = this.running.get(assetId)
    if (!cur || cur.owner !== owner) return
    this.running.delete(assetId)
    // Segurança: se recordRun não encerrou o job (erro inesperado), não deixa o lease preso.
    await this.db.query(`UPDATE crm.mi_sync_jobs SET status = 'failed', error_kind = 'transient', error_message = 'execução encerrada sem registro',
      lease_owner = NULL, lease_until = NULL, finished_at = now() WHERE id = $1 AND status = 'running'`, [cur.runId])
  }

  async observeAsset(assetId: string, obs: AssetObservation): Promise<void> {
    await this.db.query(`UPDATE crm.mi_assets SET currency_code = $2, time_zone = $3, account_status = $4, last_seen_at = $5 WHERE id = $1`,
      [assetId, obs.currencyCode, obs.timeZone, obs.accountStatus, obs.observedAt])
  }

  async upsertCampaigns(assetId: string, campaigns: readonly CampaignInfo[], now: Date): Promise<void> {
    for (const c of campaigns) {
      if (!CAMPAIGN_ID_RE.test(c.externalId)) continue
      await this.db.query(`INSERT INTO crm.mi_campaigns (asset_id, external_id, name, status, channel, last_seen_at) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (asset_id, external_id) DO UPDATE SET name = EXCLUDED.name, status = EXCLUDED.status, channel = EXCLUDED.channel, last_seen_at = EXCLUDED.last_seen_at`,
        [assetId, c.externalId, (c.name || c.externalId).slice(0, 300), c.status, (c.channel ?? '').slice(0, 60), now])
    }
  }

  private async campaignIds(assetId: string, externalIds: readonly string[]): Promise<Map<string, string>> {
    const ids = [...new Set(externalIds.filter(id => CAMPAIGN_ID_RE.test(id)))]
    // Campanha com métricas mas fora da listagem (ex.: removida): registra o mínimo, sem inventar nome.
    for (const id of ids) {
      await this.db.query(`INSERT INTO crm.mi_campaigns (asset_id, external_id, name, status) VALUES ($1, $2, $3, 'removed') ON CONFLICT (asset_id, external_id) DO NOTHING`,
        [assetId, id, 'Campanha ' + id])
    }
    const { rows } = await this.db.query(`SELECT id, external_id FROM crm.mi_campaigns WHERE asset_id = $1 AND external_id = ANY($2::text[])`, [assetId, ids])
    return new Map(rows.map(r => [String(r.external_id), String(r.id)]))
  }

  async upsertAdsRows(rows: readonly StoredAdsRow[]): Promise<UpsertResult> {
    const out = { inserted: 0, updated: 0, unchanged: 0 }
    const byAsset = new Map<string, StoredAdsRow[]>()
    for (const r of rows) (byAsset.get(r.assetId) ?? byAsset.set(r.assetId, []).get(r.assetId)!).push(r)
    for (const [assetId, list] of byAsset) {
      const ids = await this.campaignIds(assetId, list.map(r => r.campaignExternalId))
      for (const r of list) {
        const campaignId = ids.get(r.campaignExternalId)
        if (!campaignId) continue
        const res = await this.db.query(UPSERT_ADS_DAILY_SQL, [assetId, campaignId, r.day, r.conversionBasis, r.currency, r.impressions, r.clicks,
          r.costMicros, r.conversions, null, r.attribution, r.syncRunId])
        if (!res.rows[0]) out.unchanged++
        else if (res.rows[0].inserted) out.inserted++
        else out.updated++
      }
    }
    return out
  }

  async upsertGa4Rows(rows: readonly StoredGa4Row[]): Promise<UpsertResult> {
    const out = { inserted: 0, updated: 0, unchanged: 0 }
    for (const r of rows) {
      const res = await this.db.query(`INSERT INTO crm.mi_ga4_daily (asset_id, day, session_source, session_medium, session_campaign, sessions, total_users, engaged_sessions, key_events, sync_job_id)
        VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (asset_id, day, session_source, session_medium, session_campaign) DO UPDATE SET sessions = EXCLUDED.sessions, total_users = EXCLUDED.total_users,
          engaged_sessions = EXCLUDED.engaged_sessions, key_events = EXCLUDED.key_events, sync_job_id = EXCLUDED.sync_job_id, fetched_at = now()
        WHERE (crm.mi_ga4_daily.sessions, crm.mi_ga4_daily.total_users, crm.mi_ga4_daily.engaged_sessions, crm.mi_ga4_daily.key_events)
          IS DISTINCT FROM (EXCLUDED.sessions, EXCLUDED.total_users, EXCLUDED.engaged_sessions, EXCLUDED.key_events)
        RETURNING (xmax = 0) AS inserted`,
        [r.assetId, r.date, r.source.slice(0, 200), r.medium.slice(0, 200), r.campaign.slice(0, 300), r.sessions, r.totalUsers, r.engagedSessions, r.keyEvents, r.syncRunId])
      if (!res.rows[0]) out.unchanged++
      else if (res.rows[0].inserted) out.inserted++
      else out.updated++
    }
    return out
  }

  async saveGtm(assetId: string, diag: GtmDiagnostics, now: Date): Promise<void> {
    await this.db.query(`INSERT INTO crm.mi_gtm_snapshot (asset_id, live_version_id, last_published_at, tag_count, has_ga4_tag, has_meta_pixel_tag, fetched_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`, [assetId, diag.liveVersionId, diag.lastPublishedAt, diag.tagCount, diag.hasGa4Tag, diag.hasMetaPixelTag, now])
  }

  async recordRun(run: SyncRun): Promise<void> {
    const values = [run.status, Math.min(run.attempts, 20), run.pagesDone, run.rowsInserted, run.rowsUpdated, run.rowsUnchanged,
      run.errorKind, clip(run.errorMessage, 300), run.nextAttemptAt, run.finishedAt]
    if (run.status !== 'skipped_locked' && this.running.get(run.assetId)?.runId === run.id) {
      await this.db.query(`UPDATE crm.mi_sync_jobs SET status = $2, attempts = $3, pages_done = $4, rows_inserted = $5, rows_updated = $6, rows_unchanged = $7,
          error_kind = $8, error_message = $9, next_attempt_at = $10, finished_at = $11, lease_owner = NULL, lease_until = NULL WHERE id = $1`, [run.id, ...values])
      return
    }
    // Execução que não obteve o lease: só o registro (sem dados).
    await this.db.query(`INSERT INTO crm.mi_sync_jobs (id, asset_id, kind, trigger, range_start, range_end, status, attempts, pages_done, rows_inserted, rows_updated,
        rows_unchanged, error_kind, error_message, next_attempt_at, finished_at, started_at)
      VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17) ON CONFLICT (id) DO NOTHING`,
      [run.id, run.assetId, run.kind, run.trigger, run.range?.start ?? null, run.range?.end ?? null, ...values, run.startedAt])
  }

  async openAlert(assetId: string, kind: AlertKind, message: string, now: Date): Promise<void> {
    await this.db.query(`INSERT INTO crm.mi_alerts (scope, asset_id, kind, message, opened_at, last_seen_at) VALUES ('asset', $1, $2, $3, $4, $4)
      ON CONFLICT (asset_id, kind) WHERE resolved_at IS NULL AND scope = 'asset' DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at, message = EXCLUDED.message`,
      [assetId, kind, message.slice(0, 300), now])
  }

  async resolveAlerts(assetId: string, kinds: readonly AlertKind[], now: Date): Promise<void> {
    await this.db.query(`UPDATE crm.mi_alerts SET resolved_at = $3 WHERE scope = 'asset' AND asset_id = $1 AND kind = ANY($2::text[]) AND resolved_at IS NULL`,
      [assetId, [...kinds], now])
  }
}
