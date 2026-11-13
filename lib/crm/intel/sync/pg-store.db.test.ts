/** PgSyncStore + motor real + limites persistentes — PostgreSQL LOCAL descartável (0001–0019). Dados sintéticos. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { Pool } from 'pg'
import { ConnectorError, type AdAccountInfo, type AdsReadConnector, type DailyAdsRow } from '../connectors/contracts'
import type { Asset } from '../model'
import { openLocalPool, REAL_DB_SKIP, resetIntelTables } from '../vault/test-db'
import type { AuthorizedSyncTarget } from './eligibility'
import { syncAdsAsset, type SyncDeps } from './engine'
import { PgSyncStore } from './pg-store'
import { hitWindow, reserveInterval } from './rate-limit'

const ACCOUNT: AdAccountInfo = { platform: 'google_ads', externalId: '1234567890', name: 'Conta Teste', currencyCode: 'BRL', timeZone: 'America/Sao_Paulo', status: 'active', parentExternalId: null }

function fakeConnector(over: { rows?: () => DailyAdsRow[]; fail?: () => ConnectorError | null; pageSize?: number } = {}): AdsReadConnector {
  const rows = over.rows ?? (() => [
    { campaignExternalId: '111', date: '2026-11-10', impressions: 1000, clicks: 50, costMicros: 25_000_000, conversions: 3, conversionBasis: 'google:conversions', attribution: 'google:modelo-da-conta' },
    { campaignExternalId: '111', date: '2026-11-11', impressions: 800, clicks: 40, costMicros: 20_000_000, conversions: 2, conversionBasis: 'google:conversions', attribution: 'google:modelo-da-conta' },
    { campaignExternalId: '222', date: '2026-11-11', impressions: 300, clicks: 9, costMicros: 4_500_000, conversions: null, conversionBasis: 'google:conversions', attribution: 'google:modelo-da-conta' },
  ])
  return {
    platform: 'google_ads',
    async listAccessibleAccounts() { return { items: [ACCOUNT], nextPageToken: null } },
    async getAccount() { const f = over.fail?.(); if (f) throw f; return ACCOUNT },
    async listCampaigns() { return { items: [{ externalId: '111', name: 'Pesquisa', status: 'active', channel: 'SEARCH' }], nextPageToken: null } },
    async getDailyMetrics(_c, _id, _r, token) {
      const all = rows(); const size = over.pageSize ?? 100; const start = token ? Number(token) : 0
      return { items: all.slice(start, start + size), nextPageToken: start + size < all.length ? String(start + size) : null }
    },
    rateLimit() { return { remaining: null, usagePercent: null } },
  }
}

describe('PgSyncStore — sincronização persistente (banco descartável)', { skip: REAL_DB_SKIP }, () => {
  let pool: Pool
  let asset: Asset
  const now = new Date('2026-11-13T12:00:00Z')
  const deps = (store: PgSyncStore, owner = 'inst-a'): SyncDeps => ({ store, now: () => now, sleep: async () => undefined, owner, newRunId: randomUUID, baseDelayMs: 1 })
  const range = { start: '2026-11-06', end: '2026-11-12' }

  before(async () => { pool = await openLocalPool() })
  beforeEach(async () => {
    await resetIntelTables(pool)
    const id = (await pool.query(`INSERT INTO crm.mi_assets (platform, external_id, name) VALUES ('google_ads', '1234567890', 'Conta Teste') RETURNING id`)).rows[0].id
    asset = { id, platform: 'google_ads', externalId: '1234567890', externalContext: '', name: 'Conta Teste', currencyCode: null, timeZone: null,
      accountStatus: 'unknown', connectionId: 'c1', accessPath: 'direct', loginCustomerId: null }
  })
  after(async () => { await pool?.end() })
  const target = () => asset as AuthorizedSyncTarget

  it('grava campanhas e métricas diárias; repetir a mesma janela não duplica (idempotente)', async () => {
    const r1 = await syncAdsAsset(deps(new PgSyncStore(pool)), fakeConnector(), target(), range, 'manual')
    assert.equal(r1.status, 'succeeded'); assert.equal(r1.rowsInserted, 3)
    const r2 = await syncAdsAsset(deps(new PgSyncStore(pool)), fakeConnector(), target(), range, 'manual')
    assert.deepEqual([r2.rowsInserted, r2.rowsUpdated, r2.rowsUnchanged], [0, 0, 3])
    assert.equal((await pool.query(`SELECT count(*)::int n FROM crm.mi_ads_daily`)).rows[0].n, 3)
    const camp = (await pool.query(`SELECT external_id, name, status FROM crm.mi_campaigns ORDER BY 1`)).rows
    assert.deepEqual(camp.map(c => [c.external_id, c.status]), [['111', 'active'], ['222', 'removed']], 'campanha só vista nas métricas registrada sem nome inventado')
    const a = (await pool.query(`SELECT currency_code, time_zone, account_status FROM crm.mi_assets`)).rows[0]
    assert.deepEqual(a, { currency_code: 'BRL', time_zone: 'America/Sao_Paulo', account_status: 'active' })
    const jobs = (await pool.query(`SELECT status, rows_inserted, lease_owner FROM crm.mi_sync_jobs ORDER BY created_at`)).rows
    assert.deepEqual(jobs.map(j => j.status), ['succeeded', 'succeeded']); assert.ok(jobs.every(j => j.lease_owner === null))
    const conv = (await pool.query(`SELECT conversions FROM crm.mi_ads_daily WHERE campaign_id = (SELECT id FROM crm.mi_campaigns WHERE external_id = '222')`)).rows[0]
    assert.equal(conv.conversions, null, 'conversão não informada continua nula (não vira zero)')
  })

  it('reprocessamento: valor revisado pela plataforma é atualizado, não duplicado', async () => {
    await syncAdsAsset(deps(new PgSyncStore(pool)), fakeConnector(), target(), range, 'manual')
    const revised = fakeConnector({ rows: () => [{ campaignExternalId: '111', date: '2026-11-10', impressions: 1000, clicks: 50, costMicros: 25_000_000, conversions: 4, conversionBasis: 'google:conversions', attribution: 'google:modelo-da-conta' }] })
    const r = await syncAdsAsset(deps(new PgSyncStore(pool)), revised, target(), range, 'reprocess')
    assert.deepEqual([r.rowsInserted, r.rowsUpdated], [0, 1])
    assert.equal(Number((await pool.query(`SELECT conversions FROM crm.mi_ads_daily WHERE day = '2026-11-10'`)).rows[0].conversions), 4)
  })

  it('lease distribuído: duas instâncias na mesma conta → uma executa, a outra registra skipped_locked', async () => {
    let release!: () => void
    const gate = new Promise<void>(r => { release = r })
    const slow: AdsReadConnector = { ...fakeConnector(), async getAccount() { await gate; return ACCOUNT } }
    const first = syncAdsAsset(deps(new PgSyncStore(pool), 'inst-a'), slow, target(), range, 'manual')
    await new Promise(r => setTimeout(r, 50))
    const second = await syncAdsAsset(deps(new PgSyncStore(pool), 'inst-b'), fakeConnector(), target(), range, 'manual')
    assert.equal(second.status, 'skipped_locked')
    release()
    assert.equal((await first).status, 'succeeded')
    assert.equal((await pool.query(`SELECT count(*)::int n FROM crm.mi_sync_jobs WHERE status = 'running'`)).rows[0].n, 0)
  })

  it('lease vencido de instância que caiu é encerrado e não bloqueia para sempre', async () => {
    await pool.query(`INSERT INTO crm.mi_sync_jobs (asset_id, kind, trigger, range_start, range_end, status, lease_owner, lease_until, started_at)
      VALUES ($1, 'ads_daily', 'manual', '2026-11-01', '2026-11-02', 'running', 'morta', $2, $2)`, [asset.id, new Date(now.getTime() - 3_600_000)])
    const r = await syncAdsAsset(deps(new PgSyncStore(pool)), fakeConnector(), target(), range, 'manual')
    assert.equal(r.status, 'succeeded')
    const dead = (await pool.query(`SELECT status, error_message FROM crm.mi_sync_jobs WHERE lease_owner IS NULL AND status = 'failed'`)).rows
    assert.equal(dead.length, 1); assert.match(dead[0].error_message, /lease expirado/)
  })

  it('autorização expirada: falha sem nova tentativa, alerta único, resolvido no sucesso seguinte; sem segredo na mensagem', async () => {
    const expired = fakeConnector({ fail: () => new ConnectorError('auth_expired', 'invalid_grant token ya29.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA') })
    const r = await syncAdsAsset(deps(new PgSyncStore(pool)), expired, target(), range, 'manual')
    assert.equal(r.status, 'failed'); assert.equal(r.attempts, 1)
    await syncAdsAsset(deps(new PgSyncStore(pool)), expired, target(), range, 'manual')
    const alerts = (await pool.query(`SELECT kind, message FROM crm.mi_alerts WHERE resolved_at IS NULL`)).rows
    assert.deepEqual(alerts.map(a => a.kind), ['auth_expired'])
    assert.ok(!JSON.stringify((await pool.query(`SELECT * FROM crm.mi_sync_jobs`)).rows).includes('AAAAAAAAAAAAAAAAAAAAAAAA'), 'segredo omitido')
    await syncAdsAsset(deps(new PgSyncStore(pool)), fakeConnector(), target(), range, 'manual')
    assert.equal((await pool.query(`SELECT count(*)::int n FROM crm.mi_alerts WHERE resolved_at IS NULL`)).rows[0].n, 0)
  })

  it('429: novas tentativas limitadas; persistente → falha com próxima tentativa agendada', async () => {
    let calls = 0
    const limited = fakeConnector({ fail: () => (++calls, new ConnectorError('rate_limited', 'RESOURCE_EXHAUSTED', 30)) })
    const r = await syncAdsAsset(deps(new PgSyncStore(pool)), limited, target(), range, 'manual')
    assert.equal(r.status, 'failed'); assert.equal(calls, 4); assert.equal(r.errorKind, 'rate_limited'); assert.ok(r.nextAttemptAt)
  })

  it('falha no meio da paginação → partial; o que foi gravado permanece', async () => {
    let page = 0
    const c = fakeConnector({ pageSize: 1 })
    const flaky: AdsReadConnector = { ...c, async getDailyMetrics(ctx, id, rg, t) { if (++page === 2) throw new ConnectorError('permission_denied', 'sem acesso'); return c.getDailyMetrics(ctx, id, rg, t) } }
    const r = await syncAdsAsset(deps(new PgSyncStore(pool)), flaky, target(), range, 'manual')
    assert.equal(r.status, 'partial'); assert.equal(r.rowsInserted, 1)
  })
})

describe('limites persistentes (substituem N2) — banco descartável', { skip: REAL_DB_SKIP }, () => {
  let pool: Pool
  before(async () => { pool = await openLocalPool(); await resetIntelTables(pool) })
  after(async () => { await pool?.end() })

  it('intervalo mínimo: 10 pedidos concorrentes (instâncias diferentes) → exatamente 1 permitido', async () => {
    const now = new Date('2026-11-13T12:00:00Z')
    const res = await Promise.all(Array.from({ length: 10 }, () => reserveInterval(pool, 'manual_sync:abc', now, 15 * 60_000)))
    assert.equal(res.filter(r => r.allowed).length, 1)
    const denied = res.find(r => !r.allowed) as { retryAt: string }
    assert.equal(denied.retryAt, '2026-11-13T12:15:00.000Z')
    assert.equal((await reserveInterval(pool, 'manual_sync:abc', new Date('2026-11-13T12:15:00Z'), 15 * 60_000)).allowed, true, 'libera após o intervalo')
  })

  it('teto por janela: 30 pedidos concorrentes com limite 20 → 20 permitidos', async () => {
    const now = new Date('2026-11-13T12:00:30Z')
    const res = await Promise.all(Array.from({ length: 30 }, () => hitWindow(pool, 'manual_sync_global', now, 60_000, 20)))
    assert.equal(res.filter(r => r.allowed).length, 20)
    assert.equal((await hitWindow(pool, 'manual_sync_global', new Date('2026-11-13T12:01:00Z'), 60_000, 20)).allowed, true, 'nova janela')
  })
})
