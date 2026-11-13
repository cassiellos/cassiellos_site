/**
 * Carrega o MODO REAL do banco do CRM para as MESMAS estruturas que os quatro painéis já usam (dataset + armazenamento
 * de leitura). Assim gráficos, filtros, comparações e regras de isolamento são exatamente os já homologados — mas sobre
 * clientes, contas, vínculos, campanhas e métricas reais. Nada de conector mock, nada de número fictício: sem conexão,
 * sem vínculo confirmado ou sem importação, os painéis mostram o estado correspondente e nenhum valor.
 *
 * Isolamento: só entram métricas de contas com vínculo CONFIRMADO e vigente; o filtro por cliente do view-model continua
 * valendo (cada cliente vê só as próprias contas confirmadas).
 */
import { civilDateInZone, addDays } from '../dates'
import type { IntelSnapshot } from '../demo/snapshot'
import type { Asset, ClientAsset, Connection, MonitoredClient } from '../model'
import { MemorySyncStore, type AlertKind, type SyncRun } from '../sync/store'
import type { Queryable } from '../vault/pg-vault'
import { listAssets, listAssociations, listClients, listConnections } from './repo'

/** Janela carregada: cobre o maior período (90 dias) + período anterior de comparação, com folga. */
export const REAL_HISTORY_DAYS = 400
const iso = (v: unknown) => new Date(v as string).toISOString()

export async function loadRealSnapshot(db: Queryable, now: Date): Promise<IntelSnapshot> {
  const [clientRows, connRows, assetRows, linkRows] = await Promise.all([listClients(db), listConnections(db), listAssets(db), listAssociations(db)])
  const clients: MonitoredClient[] = clientRows.map(c => ({ id: c.id, name: c.name, kind: c.kind, status: c.status, financeClientId: c.financeClientId, reportTimeZone: c.reportTimeZone }))
  const connections: Connection[] = connRows.map(c => ({ id: c.id, provider: c.provider, label: c.label, authKind: c.authKind, status: c.status, scopes: c.scopes, lastVerifiedAt: c.lastVerifiedAt, lastErrorCode: c.lastErrorCode }))
  const linkedIds = new Set(linkRows.map(l => l.assetId))
  const assets: Asset[] = assetRows.filter(a => linkedIds.has(a.id)).map(a => ({
    id: a.id, platform: a.platform, externalId: a.externalId, externalContext: '', name: a.name, currencyCode: a.currencyCode, timeZone: a.timeZone,
    accountStatus: (['active', 'paused', 'suspended', 'closed'].includes(a.accountStatus) ? a.accountStatus : 'unknown') as Asset['accountStatus'],
    connectionId: a.connectionId, accessPath: a.accessPath, loginCustomerId: a.loginCustomerId,
  }))
  const links: ClientAsset[] = linkRows.map(l => ({ clientId: l.clientId, assetId: l.assetId, status: l.status, validatedAt: l.validatedAt, note: l.note }))

  const store = new MemorySyncStore()
  const ids = assets.map(a => a.id)
  const confirmedIds = [...new Set(links.filter(l => l.status === 'confirmed').map(l => l.assetId))]
  for (const a of assetRows) if (linkedIds.has(a.id) && a.currencyCode && a.timeZone)
    store.observations.set(a.id, { currencyCode: a.currencyCode, timeZone: a.timeZone, accountStatus: assets.find(x => x.id === a.id)!.accountStatus, observedAt: a.lastSeenAt ?? now.toISOString() })

  let manualAt = new Map<string, string>()
  if (ids.length) {
    const since = addDays(civilDateInZone(now, 'America/Sao_Paulo'), -REAL_HISTORY_DAYS)
    const [camps, rows, jobs, alerts, marks] = await Promise.all([
      db.query(`SELECT asset_id, external_id, name, status, channel, last_seen_at FROM crm.mi_campaigns WHERE asset_id = ANY($1::uuid[])`, [ids]),
      confirmedIds.length ? db.query(`SELECT d.asset_id, c.external_id, d.day::text AS day, d.currency_code, d.impressions, d.clicks, d.cost_micros, d.conversions, d.conversion_basis, d.attribution, d.sync_job_id
          FROM crm.mi_ads_daily d JOIN crm.mi_campaigns c ON c.id = d.campaign_id
         WHERE d.asset_id = ANY($1::uuid[]) AND d.day >= $2::date`, [confirmedIds, since]) : Promise.resolve({ rows: [] }),
      db.query(`SELECT * FROM (SELECT j.*, row_number() OVER (PARTITION BY asset_id ORDER BY created_at DESC) AS rn FROM crm.mi_sync_jobs j
          WHERE asset_id = ANY($1::uuid[]) AND status IN ('succeeded', 'partial', 'failed', 'skipped_locked')) x WHERE rn <= 15 ORDER BY created_at`, [ids]),
      db.query(`SELECT id, asset_id, kind, message, opened_at, last_seen_at FROM crm.mi_alerts WHERE scope = 'asset' AND resolved_at IS NULL AND asset_id = ANY($1::uuid[])`, [ids]),
      db.query(`SELECT key, last_at FROM crm.mi_rate_marks WHERE key = ANY($1::text[])`, [ids.map(id => 'manual_sync:' + id)]),
    ])
    for (const c of camps.rows) store.campaigns.set(c.asset_id + '|' + c.external_id, { assetId: String(c.asset_id), externalId: String(c.external_id), name: String(c.name), status: c.status as 'active', channel: String(c.channel ?? ''), lastSeenAt: iso(c.last_seen_at) })
    for (const r of rows.rows) store.ads.set([r.asset_id, r.external_id, r.day, r.conversion_basis].join('|'), {
      assetId: String(r.asset_id), campaignExternalId: String(r.external_id), day: String(r.day), currency: String(r.currency_code), impressions: Number(r.impressions),
      clicks: Number(r.clicks), costMicros: Number(r.cost_micros), conversions: r.conversions === null ? null : Number(r.conversions), conversionBasis: String(r.conversion_basis),
      attribution: String(r.attribution), syncRunId: String(r.sync_job_id ?? ''),
    })
    for (const j of jobs.rows) {
      const run: SyncRun = { id: String(j.id), assetId: String(j.asset_id), kind: j.kind as SyncRun['kind'], trigger: j.trigger as SyncRun['trigger'], range: j.range_start ? { start: String(j.range_start).slice(0, 10), end: String(j.range_end).slice(0, 10) } : null,
        status: j.status as SyncRun['status'], attempts: Number(j.attempts), pagesDone: Number(j.pages_done), rowsInserted: Number(j.rows_inserted), rowsUpdated: Number(j.rows_updated), rowsUnchanged: Number(j.rows_unchanged),
        errorKind: (j.error_kind ?? null) as SyncRun['errorKind'], errorMessage: (j.error_message as string | null) ?? null, nextAttemptAt: j.next_attempt_at ? iso(j.next_attempt_at) : null,
        startedAt: iso(j.started_at ?? j.created_at), finishedAt: iso(j.finished_at ?? j.created_at) }
      store.runs.push(run)
    }
    for (const a of alerts.rows) store.alerts.set(a.asset_id + '|' + a.kind, { key: a.asset_id + '|' + a.kind, assetId: String(a.asset_id), kind: a.kind as AlertKind, message: String(a.message), openedAt: iso(a.opened_at), lastSeenAt: iso(a.last_seen_at), resolvedAt: null })
    manualAt = new Map(marks.rows.map(m => [String(m.key).slice('manual_sync:'.length), iso(m.last_at)]))
  }

  return {
    mode: 'real', builtAt: now.toISOString(), today: civilDateInZone(now, 'America/Sao_Paulo'),
    dataset: { clients, connections, assets, links, adAccounts: [], ga4: [], gtm: [], staleDays: {}, latestRunFaults: {} },
    store, manualAt,
    connectors: () => { throw new Error('modo real: conectores são resolvidos no servidor (real/runtime.ts)') },
  }
}
