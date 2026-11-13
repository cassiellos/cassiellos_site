/**
 * API do MODO REAL de ponta a ponta (banco descartável 0001–0019 + conectores FALSOS, sem rede):
 * sessão/flag/origem, cadastro, vínculo explícito, sincronização com limites persistentes, isolamento entre clientes,
 * selo de dados reais só após importação efetiva, ausência de segredos nas respostas e retorno do OAuth.
 */
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { Pool } from 'pg'
import type { AdAccountInfo, AdsReadConnector } from '../connectors/contracts'
import type { FetchLike } from '../connectors/http'
import type { IntelRequest } from '../admin-request'
import { parseKeyRing, PgCredentialVault } from '../vault/pg-vault'
import { openLocalPool, REAL_DB_SKIP, resetIntelTables, testKey } from '../vault/test-db'
import { handleIntelReal } from './admin-real'
import { createOAuthState } from './oauth'
import { handleOAuthCallback } from './oauth-callback'
import * as repo from './repo'
import type { RealRuntime } from './runtime'

const ENV = { MI_DATA_MODE: 'real', MI_VAULT_KEYS: '1:' + testKey(5), MI_OAUTH_REDIRECT_BASE: 'https://crm.cassiellos.com.br',
  MI_GOOGLE_ADS_ENABLED: 'true', MI_GOOGLE_ADS_CLIENT_ID: 'cid', MI_GOOGLE_ADS_CLIENT_SECRET: 'cs', MI_GOOGLE_ADS_DEVELOPER_TOKEN: 'dev',
  MI_META_ADS_ENABLED: 'false' }
const ACCTS: AdAccountInfo[] = [
  { platform: 'google_ads', externalId: '1111111111', name: 'Conta Sorriso', currencyCode: 'BRL', timeZone: 'America/Sao_Paulo', status: 'active', parentExternalId: null },
  { platform: 'google_ads', externalId: '2222222222', name: 'Conta Outra Marca', currencyCode: 'USD', timeZone: 'America/New_York', status: 'active', parentExternalId: '9999999999' },
]
const fakeGoogle: AdsReadConnector = {
  platform: 'google_ads', rateLimit: () => ({ remaining: null, usagePercent: null }),
  async listAccessibleAccounts() { return { items: ACCTS, nextPageToken: null } },
  async getAccount(_c, id) { return ACCTS.find(a => a.externalId === id)! },
  async listCampaigns(_c, id) { return { items: [{ externalId: id === '1111111111' ? '501' : '502', name: id === '1111111111' ? 'Implantes · Pesquisa' : 'Outra marca', status: 'active', channel: 'SEARCH' }], nextPageToken: null } },
  async getDailyMetrics(_c, id, range) {
    const days: string[] = []
    for (let d = new Date(range.start + 'T00:00:00Z'); d <= new Date(range.end + 'T00:00:00Z'); d = new Date(d.getTime() + 86_400_000)) days.push(d.toISOString().slice(0, 10))
    return { items: days.map(day => ({ campaignExternalId: id === '1111111111' ? '501' : '502', date: day, impressions: 1000, clicks: 40, costMicros: 30_000_000, conversions: 2, conversionBasis: 'google:conversions', attribution: 'google:modelo-da-conta' })), nextPageToken: null }
  },
}

describe('API do modo real (banco descartável + conectores falsos)', { skip: REAL_DB_SKIP }, () => {
  let pool: Pool
  let rt: RealRuntime
  let clock = new Date('2026-11-13T15:00:00Z')
  const req = (over: Partial<IntelRequest>): IntelRequest => ({ vercelEnv: 'preview', intelEnabled: 'true', sessionValid: true, originAllowed: true, contentType: 'application/json', actorRef: 'abcdef0123456789', method: 'GET', ...over })
  const get = (params: Record<string, string>, over: Partial<IntelRequest> = {}) => handleIntelReal({ runtime: rt, now: () => clock, log: () => undefined }, req({ method: 'GET', searchParams: new URLSearchParams(params), ...over }))
  const post = (body: Record<string, unknown>, over: Partial<IntelRequest> = {}) => handleIntelReal({ runtime: rt, now: () => clock, log: () => undefined }, req({ method: 'POST', rawBody: JSON.stringify(body), ...over }))

  before(async () => { pool = await openLocalPool() })
  beforeEach(async () => {
    await resetIntelTables(pool)
    clock = new Date('2026-11-13T15:00:00Z')
    const ring = parseKeyRing(ENV)
    rt = { db: pool, env: ENV, fetch: async () => { throw new Error('sem rede nos testes') }, ring, vault: new PgCredentialVault(pool, ring), google: fakeGoogle, meta: null, googleTokens: null }
  })
  after(async () => { await pool?.end() })

  async function setupConnection() {
    const meta = await rt.vault!.store({ connectionId: 'x', provider: 'google', secret: 'refresh-ficticio', scopes: ['adwords'], expiresAt: null })
    return repo.createConnection(pool, 'crm_admin:abc', { provider: 'google', authKind: 'oauth_user', label: 'Google Ads', credentialRef: meta.ref, scopes: ['adwords'], principalHint: null, expiresAt: null })
  }

  it('proteções: flag ausente → 404; sem sessão → 401; POST de outra origem → 403', async () => {
    assert.equal((await get({ area: 'agencia' }, { intelEnabled: undefined })).status, 404)
    assert.equal((await get({ area: 'agencia' }, { sessionValid: false })).status, 401)
    assert.equal((await post({ action: 'create_client', name: 'X Teste' }, { originAllowed: false })).status, 403)
    assert.equal((await pool.query(`SELECT count(*)::int n FROM crm.mi_clients`)).rows[0].n, 0)
  })

  it('sem clientes: área Cliente mostra só o cadastro (view nula, nenhum número); selo de simulado desligado', async () => {
    const r = await get({ area: 'cliente' })
    assert.equal(r.status, 200)
    const b = r.body as { simulated: boolean; view: unknown; admin: { clients: unknown[]; providers: { google: { enabled: boolean; configured: boolean } } } }
    assert.deepEqual([b.simulated, b.view, b.admin.clients.length], [false, null, 0])
    assert.deepEqual([b.admin.providers.google.enabled, b.admin.providers.google.configured], [true, true])
    const ag = await get({ area: 'agencia' })
    const meta = (ag.body as { view: { meta: { mode: string; simulated: boolean; hasImportedData: boolean } } }).view.meta
    assert.deepEqual([meta.mode, meta.simulated, meta.hasImportedData], ['real', false, false])
  })

  it('D2: client=all com zero clientes ativos mantém o cadastro acessível e retorna 200', async () => {
    for (const client of ['', 'all']) {
      const r = await get({ area: 'cliente', client })
      assert.equal(r.status, 200)
      const body = r.body as { simulated: boolean; mode: string; view: unknown; admin: { clients: unknown[] } }
      assert.deepEqual([body.simulated, body.mode, body.view, body.admin.clients.length], [false, 'real', null, 0])
    }
  })

  it('D1: URL de cliente arquivado seleciona outro ativo ou mostra estado vazio, sem 404', async () => {
    const a = (await post({ action: 'create_client', name: 'Teste Arquivar A' })).body as { client: { id: string } }
    const b = (await post({ action: 'create_client', name: 'Teste Arquivar B' })).body as { client: { id: string } }
    assert.equal((await post({ action: 'archive_client', clientId: a.client.id })).status, 200)
    const alternate = await get({ area: 'cliente', client: a.client.id })
    assert.equal(alternate.status, 200)
    const view = (alternate.body as { view: { client: { id: string }; meta: { filters: { client: string } } } }).view
    assert.equal(view.client.id, b.client.id)
    assert.equal(view.meta.filters.client, b.client.id)
    assert.equal((await post({ action: 'archive_client', clientId: b.client.id })).status, 200)
    const empty = await get({ area: 'cliente', client: a.client.id })
    assert.equal(empty.status, 200)
    const body = empty.body as { view: unknown; admin: { clients: { status: string }[] } }
    assert.equal(body.view, null)
    assert.equal(body.admin.clients.filter(c => c.status !== 'archived').length, 0)
  })

  it('fluxo completo: cadastro → descoberta → proposta → confirmação → sincronização → dados reais; limites e isolamento', async () => {
    const a = (await post({ action: 'create_client', name: 'Clínica Sorriso', notes: 'cliente desde 2025' })).body as { client: { id: string } }
    const b = (await post({ action: 'create_client', name: 'Outra Marca' })).body as { client: { id: string } }
    const conn = await setupConnection()
    const disc = await post({ action: 'discover', connectionId: conn.id })
    assert.deepEqual(disc.body, { ok: true, discovered: 2 })
    const assets = await repo.listAssets(pool)
    const sorriso = assets.find(x => x.externalId === '1111111111')!
    const outra = assets.find(x => x.externalId === '2222222222')!
    assert.equal(outra.loginCustomerId, '9999999999')

    // antes de confirmar: nada alimenta o cliente; sincronizar é recusado
    await post({ action: 'propose_link', clientId: a.client.id, assetId: sorriso.id })
    assert.equal((await post({ action: 'sync_now', clientId: a.client.id, assetId: sorriso.id })).status, 403)
    let view = (await get({ area: 'cliente', client: a.client.id })).body as { view: { assets: unknown[]; pendingAssets: { state: string }[]; kpis: unknown; meta: { hasImportedData: boolean } } }
    assert.equal(view.view.assets.length, 0); assert.equal(view.view.pendingAssets[0].state, 'pending_validation'); assert.equal(view.view.meta.hasImportedData, false)

    assert.equal((await post({ action: 'confirm_link', clientId: a.client.id, assetId: sorriso.id })).status, 200)
    assert.equal((await post({ action: 'confirm_link', clientId: b.client.id, assetId: sorriso.id })).status, 409, 'dono único')
    await post({ action: 'confirm_link', clientId: b.client.id, assetId: outra.id })

    const s1 = await post({ action: 'sync_now', clientId: a.client.id, assetId: sorriso.id })
    const run = (s1.body as { run: { status: string; inserted: number; range: { start: string; end: string } } }).run
    assert.equal(s1.status, 200); assert.equal(run.status, 'succeeded'); assert.equal(run.inserted, 90, 'carga inicial: 90 dias')
    assert.equal((await post({ action: 'sync_now', clientId: a.client.id, assetId: sorriso.id })).status, 429, 'intervalo persistente')
    assert.equal((await post({ action: 'sync_now', clientId: b.client.id, assetId: sorriso.id })).status, 403, 'conta de outro cliente')

    view = (await get({ area: 'cliente', client: a.client.id, period: '7d' })).body as typeof view
    assert.equal(view.view.meta.hasImportedData, true, 'selo de dados reais só após importação efetiva')
    const vb = (await get({ area: 'cliente', client: b.client.id, period: '7d' })).body as { view: { kpis: { platforms: { costMicros: number }[] }; meta: { hasImportedData: boolean } } }
    assert.equal(vb.view.meta.hasImportedData, false, 'cliente B ainda sem importação')
    assert.ok(!JSON.stringify(vb).includes('Implantes'), 'cliente B não vê campanhas do cliente A')

    // segunda sincronização (após 15 min): revisão de 7 dias, idempotente
    clock = new Date(clock.getTime() + 16 * 60_000)
    const s2 = (await post({ action: 'sync_now', clientId: a.client.id, assetId: sorriso.id })).body as { run: { inserted: number; unchanged: number } }
    assert.deepEqual([s2.run.inserted, s2.run.unchanged], [0, 7])

    // visão geral: moedas separadas, nada somado entre BRL e USD
    await post({ action: 'sync_now', clientId: b.client.id, assetId: outra.id })
    const ov = JSON.stringify((await get({ area: 'agencia', period: '7d' })).body)
    assert.ok(ov.includes('"BRL"') && ov.includes('"USD"'))

    // nenhuma resposta carrega referência de cofre ou segredo
    const all = JSON.stringify([(await get({ area: 'conexoes' })).body, (await get({ area: 'cliente', client: a.client.id })).body])
    assert.ok(!all.includes('vault:') && !all.includes('refresh-ficticio'))
    const audit = (await repo.recentAudit(pool, 50)).map(x => x.action)
    for (const act of ['client_created', 'accounts_discovered', 'association_proposed', 'association_confirmed', 'manual_sync']) assert.ok(audit.includes(act), act)
  })

  it('Prospecção sem agência pede ativação; com agência, funil NUNCA simulado no modo real', async () => {
    const r = await get({ area: 'prospeccao' })
    assert.equal((r.body as { needsAgency?: boolean }).needsAgency, true)
    await post({ action: 'ensure_agency' })
    const p = (await get({ area: 'prospeccao' })).body as { view: { funnel: { simulated: boolean; available: boolean; leads: number }; meta: { simulated: boolean } } }
    assert.deepEqual([p.view.funnel.simulated, p.view.funnel.available, p.view.funnel.leads, p.view.meta.simulated], [false, false, 0, false])
  })

  it('arquivar cliente encerra vínculos e esconde o cliente; revogar conexão bloqueia sincronização', async () => {
    const a = (await post({ action: 'create_client', name: 'Cliente Arquivável' })).body as { client: { id: string } }
    const conn = await setupConnection()
    await post({ action: 'discover', connectionId: conn.id })
    const asset = (await repo.listAssets(pool))[0]
    await post({ action: 'confirm_link', clientId: a.client.id, assetId: asset.id })
    await post({ action: 'revoke_connection', connectionId: conn.id })
    assert.equal((await post({ action: 'sync_now', clientId: a.client.id, assetId: asset.id })).status, 409)
    await post({ action: 'archive_client', clientId: a.client.id })
    const archived = await get({ area: 'cliente', client: a.client.id })
    assert.equal(archived.status, 200, 'URL antiga deve voltar ao estado vazio')
    assert.equal((archived.body as { view: unknown }).view, null)
    assert.equal((await repo.listAssociations(pool, { includeEnded: true }))[0].status, 'ended')
  })

  it('OAuth: início exige plataforma pronta; retorno com state inválido recusa; válido cria conexão sem expor segredo', async () => {
    const meta = await post({ action: 'start_oauth', provider: 'meta' })
    assert.equal(meta.status, 409, 'Meta desabilitada neste ambiente')
    const start = (await post({ action: 'start_oauth', provider: 'google' })).body as { url: string }
    const state = new URL(start.url).searchParams.get('state')!
    const bad = await handleOAuthCallback(rt, { provider: 'google', code: 'c', state: 'x'.repeat(43), error: null, intelEnabled: 'true', runtimeEnabled: true }, clock)
    assert.equal(bad.status, 400)
    const fetchOk: FetchLike = async () => ({ status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ refresh_token: 'rt-novo', access_token: 'at', expires_in: 3600, scope: 'https://www.googleapis.com/auth/adwords' }) })
    const ok = await handleOAuthCallback({ ...rt, fetch: fetchOk }, { provider: 'google', code: 'codigo', state, error: null, intelEnabled: 'true', runtimeEnabled: true }, clock)
    assert.equal(ok.status, 200); assert.ok(!ok.html.includes('rt-novo') && !ok.html.includes('codigo'))
    assert.equal((await repo.listConnections(pool)).length, 1)
    const again = await handleOAuthCallback({ ...rt, fetch: fetchOk }, { provider: 'google', code: 'codigo', state, error: null, intelEnabled: 'true', runtimeEnabled: true }, clock)
    assert.equal(again.status, 400, 'state de uso único')
    const demo = await handleOAuthCallback({ ...rt, env: { ...ENV, MI_DATA_MODE: undefined } }, { provider: 'google', code: 'c', state: await createOAuthState(pool, 'google', 'a'), error: null, intelEnabled: 'true', runtimeEnabled: true }, clock)
    assert.equal(demo.status, 404, 'modo demonstração não aceita retorno OAuth')
  })
})
