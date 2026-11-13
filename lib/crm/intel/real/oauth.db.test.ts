/** OAuth do modo real: state de uso único, PKCE derivado, trocas de código e renovação — banco descartável + fetch falso. */
import assert from 'node:assert/strict'
import { after, before, beforeEach, describe, it } from 'node:test'
import type { Pool } from 'pg'
import { ConnectorError } from '../connectors/contracts'
import type { FetchLike } from '../connectors/http'
import { parseKeyRing, PgCredentialVault } from '../vault/pg-vault'
import { openLocalPool, REAL_DB_SKIP, resetIntelTables, testKey } from '../vault/test-db'
import * as oauth from './oauth'
import { createConnection, getConnection } from './repo'

const env = { MI_GOOGLE_ADS_CLIENT_ID: 'cid', MI_GOOGLE_ADS_CLIENT_SECRET: 'csecret', MI_GOOGLE_ADS_DEVELOPER_TOKEN: 'dev', MI_META_APP_ID: 'appid', MI_META_APP_SECRET: 'appsecret',
  MI_VAULT_KEYS: '1:' + testKey(9), MI_OAUTH_REDIRECT_BASE: 'https://crm.cassiellos.com.br' }
const ring = parseKeyRing(env)
const fetchOf = (h: (url: string, body?: string) => { status?: number; body: unknown }): FetchLike => async (url, init) => {
  const r = h(url, init.body); return { status: r.status ?? 200, headers: { get: () => null }, text: async () => JSON.stringify(r.body) }
}

describe('OAuth — URLs e PKCE', () => {
  it('Google: escopo único adwords, offline, PKCE S256, state, redirect do CRM', () => {
    const u = new URL(oauth.googleAuthorizeUrl(env, ring, 'S'.repeat(43)))
    assert.equal(u.origin + u.pathname, 'https://accounts.google.com/o/oauth2/v2/auth')
    assert.equal(u.searchParams.get('scope'), 'https://www.googleapis.com/auth/adwords')
    assert.equal(u.searchParams.get('access_type'), 'offline')
    assert.equal(u.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(u.searchParams.get('code_challenge'), oauth.pkceChallenge(oauth.pkceVerifier(ring, 'S'.repeat(43))))
    assert.equal(u.searchParams.get('redirect_uri'), 'https://crm.cassiellos.com.br/api/crm/intel/oauth/google/callback')
    assert.ok(!u.toString().includes('csecret'))
  })
  it('Meta: só ads_read', () => {
    const u = new URL(oauth.metaAuthorizeUrl(env, 'state'))
    assert.equal(u.searchParams.get('scope'), 'ads_read')
    assert.equal(u.pathname, '/v26.0/dialog/oauth')
  })
  it('verificador PKCE depende do state e da chave do cofre (43 caracteres)', () => {
    const v = oauth.pkceVerifier(ring, 'a'.repeat(43))
    assert.equal(v.length, 43)
    assert.notEqual(v, oauth.pkceVerifier(ring, 'b'.repeat(43)))
    assert.notEqual(v, oauth.pkceVerifier(parseKeyRing({ MI_VAULT_KEYS: '1:' + testKey(10) }), 'a'.repeat(43)))
  })
})

describe('OAuth — banco descartável', { skip: REAL_DB_SKIP }, () => {
  let pool: Pool
  before(async () => { pool = await openLocalPool() })
  beforeEach(async () => { await resetIntelTables(pool) })
  after(async () => { await pool?.end() })

  it('state: só hash no banco; uso único; preso à plataforma; vence em 10 min', async () => {
    const now = new Date('2026-11-13T12:00:00Z')
    const s = await oauth.createOAuthState(pool, 'google', 'admin1', now)
    const stored = (await pool.query(`SELECT state_hash FROM crm.mi_oauth_states`)).rows[0].state_hash
    assert.notEqual(stored, s); assert.match(stored, /^[a-f0-9]{64}$/)
    assert.equal(await oauth.consumeOAuthState(pool, 'meta', s, now), null, 'outra plataforma')
    assert.equal(await oauth.consumeOAuthState(pool, 'google', s, now), 'admin1')
    assert.equal(await oauth.consumeOAuthState(pool, 'google', s, now), null, 'repetido')
    const s2 = await oauth.createOAuthState(pool, 'google', 'admin1', now)
    assert.equal(await oauth.consumeOAuthState(pool, 'google', s2, new Date(now.getTime() + 11 * 60_000)), null, 'vencido')
    assert.equal(await oauth.consumeOAuthState(pool, 'google', 'forjado', now), null)
  })

  it('Google: troca de código exige refresh_token e escopo adwords; renovação com invalid_grant marca conexão expirada', async () => {
    let refreshCalls = 0
    const f = fetchOf((url, body) => {
      const p = new URLSearchParams(body)
      if (p.get('grant_type') === 'authorization_code') {
        assert.equal(p.get('code_verifier'), oauth.pkceVerifier(ring, 'X'.repeat(43)))
        return { body: { refresh_token: 'rt-ficticio', access_token: 'at-1', expires_in: 3600, scope: 'https://www.googleapis.com/auth/adwords' } }
      }
      refreshCalls++
      return p.get('refresh_token') === 'rt-ficticio' && refreshCalls === 1 ? { body: { access_token: 'at-2', expires_in: 3600 } } : { status: 400, body: { error: 'invalid_grant' } }
    })
    const ex = await oauth.googleExchangeCode(f, env, ring, 'codigo', 'X'.repeat(43))
    assert.equal(ex.refreshToken, 'rt-ficticio')
    await assert.rejects(oauth.googleExchangeCode(fetchOf(() => ({ body: { access_token: 'x', scope: 'email' } })), env, ring, 'c', 'X'.repeat(43)), ConnectorError)
    const vault = new PgCredentialVault(pool, ring)
    const meta = await vault.store({ connectionId: 'n', provider: 'google', secret: ex.refreshToken, scopes: ex.scopes, expiresAt: null })
    const conn = await createConnection(pool, 'admin1', { provider: 'google', authKind: 'oauth_user', label: 'Google Ads', credentialRef: meta.ref, scopes: ex.scopes, principalHint: null, expiresAt: null })
    let clock = 0
    const tokens = oauth.googleAccessTokenProvider({ db: pool, vault, fetch: f, env, now: () => clock })
    assert.equal(await tokens.get(conn.id), 'at-2')
    assert.equal(await tokens.get(conn.id), 'at-2', 'cache em memória')
    clock = 3_600_000
    await assert.rejects(tokens.get(conn.id), (e: unknown) => e instanceof ConnectorError && e.kind === 'auth_expired')
    assert.deepEqual([(await getConnection(pool, conn.id))?.status, (await getConnection(pool, conn.id))?.lastErrorCode], ['expired', 'INVALID_GRANT'])
  })

  it('Meta: código → token curto → longa duração; token vencido → auth_expired e conexão expirada', async () => {
    const f = fetchOf(url => (url.includes('fb_exchange_token') ? { body: { access_token: 'longo', expires_in: 5_184_000 } } : { body: { access_token: 'curto' } }))
    const ex = await oauth.metaExchangeCode(f, env, 'codigo', Date.parse('2026-11-13T00:00:00Z'))
    assert.deepEqual(ex, { token: 'longo', expiresAt: '2027-01-12T00:00:00.000Z' })
    const vault = new PgCredentialVault(pool, ring)
    const meta = await vault.store({ connectionId: 'n', provider: 'meta', secret: ex.token, scopes: ['ads_read'], expiresAt: ex.expiresAt })
    const conn = await createConnection(pool, 'admin1', { provider: 'meta', authKind: 'oauth_user', label: 'Meta', credentialRef: meta.ref, scopes: ['ads_read'], principalHint: null, expiresAt: ex.expiresAt })
    assert.equal(await oauth.metaAccessTokenProvider({ db: pool, vault, now: () => Date.parse('2026-12-01T00:00:00Z') }).get(conn.id), 'longo')
    await assert.rejects(oauth.metaAccessTokenProvider({ db: pool, vault, now: () => Date.parse('2027-02-01T00:00:00Z') }).get(conn.id), (e: unknown) => e instanceof ConnectorError && e.kind === 'auth_expired')
    assert.equal((await getConnection(pool, conn.id))?.status, 'expired')
  })
})
