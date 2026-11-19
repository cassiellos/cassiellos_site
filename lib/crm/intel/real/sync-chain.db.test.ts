/**
 * Cadeia REAL da sincronização manual, de ponta a ponta, SEM rede e SEM conta real:
 * runtime de produção (buildRealRuntime) → conector Google Ads (createGoogleAdsConnector) → motor → PgSyncStore → PostgreSQL.
 * O `fetch` é falso e responde no formato documentado do OAuth do Google e da Google Ads API; qualquer outro destino falha.
 * Banco LOCAL descartável (0001–0019). A "carga inicial" aqui acontece só dentro desse banco de teste.
 */
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { Pool } from 'pg'
import type { FetchLike } from '../connectors/http'
import type { IntelRequest } from '../admin-request'
import { openLocalPool, REAL_DB_SKIP, resetIntelTables, testKey } from '../vault/test-db'
import { handleIntelReal } from './admin-real'
import * as repo from './repo'
import { buildRealRuntime } from './runtime'

const ENV = { MI_DATA_MODE: 'real', MI_VAULT_KEYS: '1:' + testKey(11), MI_OAUTH_REDIRECT_BASE: 'https://crm.cassiellos.com.br',
  MI_GOOGLE_ADS_ENABLED: 'true', MI_GOOGLE_ADS_CLIENT_ID: 'cid-teste', MI_GOOGLE_ADS_CLIENT_SECRET: 'cs-teste' }

type Call = { url: string; method: string; headers: Record<string, string>; body?: string }
function fakeGoogle(calls: Call[]): FetchLike {
  return async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body })
    const reply = (body: unknown) => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify(body) })
    if (url === 'https://oauth2.googleapis.com/token') return reply({ access_token: 'at-teste', expires_in: 3600 })
    if (url.startsWith('https://googleads.googleapis.com/') && url.endsWith('/customers/1111111111/googleAds:search')) {
      const q = JSON.parse(init.body ?? '{}').query as string
      if (/FROM customer\b/.test(q)) return reply({ results: [{ customer: { id: '1111111111', descriptiveName: 'Conta Teste', currencyCode: 'BRL', timeZone: 'America/Sao_Paulo', manager: false, status: 'ENABLED' } }] })
      if (/segments\.date BETWEEN/.test(q)) {
        const [, start, end] = /BETWEEN '([\d-]+)' AND '([\d-]+)'/.exec(q)!
        return reply({ results: [start, end].map(d => ({ campaign: { id: '777' }, segments: { date: d }, metrics: { impressions: '100', clicks: '5', costMicros: '2500000', conversions: 1 } })) })
      }
      if (/FROM campaign\b/.test(q)) return reply({ results: [{ campaign: { id: '777', name: 'Campanha Teste', status: 'ENABLED', advertisingChannelType: 'SEARCH' } }] })
    }
    throw new Error('destino não previsto no teste: ' + url)
  }
}

describe('sincronização real de ponta a ponta: conector Google Ads + PostgreSQL (sem rede)', { skip: REAL_DB_SKIP }, () => {
  let pool: Pool
  before(async () => { pool = await openLocalPool() })
  beforeEach(async () => { await resetIntelTables(pool) })
  after(async () => { await pool?.end() })

  it('runtime de produção monta o conector Google Ads; sync_now grava no banco via PgSyncStore', async () => {
    const calls: Call[] = []
    const rt = buildRealRuntime(pool, ENV, fakeGoogle(calls))
    assert.equal(rt.google?.platform, 'google_ads', 'Google habilitado e configurado → conector real do Google Ads')
    assert.equal(rt.meta, null, 'Meta desligada neste ambiente → sem conector')

    const cred = await rt.vault!.store({ connectionId: 'x', provider: 'google', secret: 'refresh-teste', scopes: ['https://www.googleapis.com/auth/adwords'], expiresAt: null })
    const conn = await repo.createConnection(pool, 'teste', { provider: 'google', authKind: 'oauth_user', label: 'Google Ads', credentialRef: cred.ref, scopes: ['https://www.googleapis.com/auth/adwords'], principalHint: null, expiresAt: null })
    await repo.upsertDiscoveredAccounts(pool, 'teste', conn.id, [{ platform: 'google_ads', externalId: '1111111111', name: 'Conta Teste', currencyCode: 'BRL', timeZone: 'America/Sao_Paulo', status: 'active', parentExternalId: null }])
    const asset = (await repo.listAssets(pool))[0]
    const client = await repo.createClient(pool, 'teste', { name: 'Cliente Teste' })
    await repo.confirmAssociation(pool, 'teste', client.id, asset.id)

    const req: IntelRequest = { vercelEnv: 'preview', intelEnabled: 'true', sessionValid: true, originAllowed: true, contentType: 'application/json',
      actorRef: 'abcdef0123456789', method: 'POST', rawBody: JSON.stringify({ action: 'sync_now', clientId: client.id, assetId: asset.id }) }
    const res = await handleIntelReal({ runtime: rt, now: () => new Date('2026-11-15T12:00:00Z'), log: () => undefined }, req)
    assert.equal(res.status, 200)
    const body = res.body as { storage: string; run: { status: string; inserted: number } }
    assert.deepEqual([body.storage, body.run.status], ['database', 'succeeded'])

    // conector Google Ads de verdade: OAuth do Google + REST da Google Ads API, token só no cabeçalho
    assert.ok(calls.some(c => c.url === 'https://oauth2.googleapis.com/token'))
    const ads = calls.filter(c => c.url.startsWith('https://googleads.googleapis.com/v26/customers/1111111111/googleAds:search'))
    assert.ok(ads.length >= 3, 'conta, campanhas e métricas pela Google Ads API')
    assert.ok(ads.every(c => c.headers.Authorization === 'Bearer at-teste' && c.method === 'POST'))
    assert.ok(calls.every(c => /^https:\/\/(oauth2|googleads)\.googleapis\.com\//.test(c.url)), 'nenhum outro destino')

    // persistência PostgreSQL (tabelas mi_* da 0018)
    const rows = (await pool.query(`SELECT d.conversion_basis, d.currency_code, c.external_id FROM crm.mi_ads_daily d JOIN crm.mi_campaigns c ON c.id = d.campaign_id`)).rows
    assert.equal(rows.length, body.run.inserted)
    assert.ok(rows.length > 0 && rows.every(r => r.conversion_basis === 'google:conversions' && r.currency_code === 'BRL' && r.external_id === '777'))
    const jobs = (await pool.query(`SELECT status, lease_owner FROM crm.mi_sync_jobs`)).rows
    assert.deepEqual(jobs, [{ status: 'succeeded', lease_owner: null }])
  })
})
