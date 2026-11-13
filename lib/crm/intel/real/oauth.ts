/**
 * OAuth do modo real (Google Ads e Meta). Somente servidor.
 *
 * - `state`: 32 bytes aleatórios; no banco só o sha256 (crm.mi_oauth_states), uso ÚNICO, validade de 10 min, preso à
 *   plataforma. Callback com state ausente, repetido, vencido ou de outra plataforma é recusado (CSRF).
 * - PKCE (Google): verificador derivado no servidor = HMAC(chave do cofre, state) — nada sensível é gravado.
 * - Google: `access_type=offline` + `prompt=consent` para obter refresh token; escopo único `adwords` (a escrita é
 *   bloqueada pela guarda de somente leitura, ver connectors/read-only-guard.ts).
 * - Meta: escopo `ads_read` apenas; o token curto é trocado pelo de longa duração (~60 dias) antes de ir ao cofre.
 * - Tokens de acesso Google ficam só em memória (cache curto por conexão); o refresh token fica cifrado no cofre.
 */
import { createHash, randomBytes } from 'node:crypto'
import { ConnectorError } from '../connectors/contracts'
import { kindForStatus, requestJson, safeCode, type FetchLike } from '../connectors/http'
import type { CredentialRef } from '../credential-vault'
import { deriveFromVaultKey, type KeyRing, type PgCredentialVault, type Queryable } from '../vault/pg-vault'
import { DEFAULT_META_GRAPH_VERSION } from '../connectors/meta-ads'
import { getConnection, markConnection } from './repo'
import { redirectBase, type Env } from './config'

export const GOOGLE_ADS_SCOPE = 'https://www.googleapis.com/auth/adwords'
export const META_SCOPES = ['ads_read'] as const
const STATE_TTL_MS = 10 * 60_000
const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex')

export const callbackUrl = (env: Env, provider: 'google' | 'meta') => redirectBase(env) + '/api/crm/intel/oauth/' + provider + '/callback'

export function pkceVerifier(ring: KeyRing, state: string): string {
  return deriveFromVaultKey(ring, 'mi-pkce', state).toString('base64url') // 43 caracteres
}
export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url')

export async function createOAuthState(db: Queryable, provider: 'google' | 'meta', actor: string, now = new Date()): Promise<string> {
  const state = randomBytes(32).toString('base64url')
  await db.query(`DELETE FROM crm.mi_oauth_states WHERE expires_at < $1`, [now])
  await db.query(`INSERT INTO crm.mi_oauth_states (state_hash, provider, actor, created_at, expires_at) VALUES ($1, $2, $3, $4, $5)`,
    [sha256hex(state), provider, actor.slice(0, 80), now, new Date(now.getTime() + STATE_TTL_MS)])
  return state
}

/** Consome o state (uma vez só). Devolve o ator que iniciou o fluxo, ou null se inválido. */
export async function consumeOAuthState(db: Queryable, provider: 'google' | 'meta', state: unknown, now = new Date()): Promise<string | null> {
  if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state)) return null
  const { rows } = await db.query(`UPDATE crm.mi_oauth_states SET used_at = $3 WHERE state_hash = $1 AND provider = $2 AND used_at IS NULL AND expires_at > $3 RETURNING actor`,
    [sha256hex(state), provider, now])
  return rows[0] ? String(rows[0].actor) : null
}

/* ---------------------------------------------------------------- Google ---------------------------------------------------------------- */

export function googleAuthorizeUrl(env: Env, ring: KeyRing, state: string): string {
  const p = new URLSearchParams({
    client_id: env.MI_GOOGLE_ADS_CLIENT_ID!, redirect_uri: callbackUrl(env, 'google'), response_type: 'code', scope: GOOGLE_ADS_SCOPE,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'false', state,
    code_challenge: pkceChallenge(pkceVerifier(ring, state)), code_challenge_method: 'S256',
  })
  return 'https://accounts.google.com/o/oauth2/v2/auth?' + p
}

function googleTokenError(status: number, body: unknown): ConnectorError {
  const code = safeCode((body as { error?: string })?.error)
  return new ConnectorError(code === 'invalid_grant' ? 'auth_expired' : kindForStatus(status), ['google_oauth', status, code].filter(Boolean).join(' '))
}

export async function googleExchangeCode(fetchImpl: FetchLike, env: Env, ring: KeyRing, code: string, state: string) {
  const form = new URLSearchParams({ code, client_id: env.MI_GOOGLE_ADS_CLIENT_ID!, client_secret: env.MI_GOOGLE_ADS_CLIENT_SECRET!,
    redirect_uri: callbackUrl(env, 'google'), grant_type: 'authorization_code', code_verifier: pkceVerifier(ring, state) })
  const { body } = await requestJson(fetchImpl, 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString() }, googleTokenError)
  const b = body as { refresh_token?: string; access_token?: string; expires_in?: number; scope?: string }
  if (!b.refresh_token) throw new ConnectorError('invalid_request', 'google_oauth sem refresh_token (revogue o acesso anterior e autorize de novo)')
  const scopes = (b.scope ?? '').split(' ').filter(Boolean)
  if (!scopes.includes(GOOGLE_ADS_SCOPE)) throw new ConnectorError('permission_denied', 'google_oauth escopo adwords não concedido')
  return { refreshToken: b.refresh_token, accessToken: b.access_token ?? null, expiresIn: b.expires_in ?? 0, scopes }
}

/** Token de acesso Google por conexão (cache em memória, renovado pelo refresh token do cofre). */
export function googleAccessTokenProvider(deps: { db: Queryable; vault: PgCredentialVault; fetch: FetchLike; env: Env; now?: () => number }) {
  const cache = new Map<string, { token: string; exp: number }>()
  const now = deps.now ?? Date.now
  return {
    seed(connectionId: string, token: string, expiresIn: number) { cache.set(connectionId, { token, exp: now() + Math.max(0, expiresIn - 60) * 1000 }) },
    async get(connectionId: string): Promise<string> {
      const hit = cache.get(connectionId)
      if (hit && hit.exp > now()) return hit.token
      const conn = await getConnection(deps.db, connectionId)
      if (!conn || conn.provider !== 'google' || !conn.credentialRef) throw new ConnectorError('permission_denied', 'conexão inexistente')
      if (conn.status === 'revoked') throw new ConnectorError('auth_revoked', 'conexão revogada')
      try {
        const res = await deps.vault.withSecret(conn.credentialRef, refresh => requestJson(deps.fetch, 'https://oauth2.googleapis.com/token',
          { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
            client_id: deps.env.MI_GOOGLE_ADS_CLIENT_ID!, client_secret: deps.env.MI_GOOGLE_ADS_CLIENT_SECRET!, refresh_token: refresh, grant_type: 'refresh_token' }).toString() }, googleTokenError))
        const b = res.body as { access_token?: string; expires_in?: number }
        if (!b.access_token) throw new ConnectorError('transient', 'google_oauth resposta sem token')
        cache.set(connectionId, { token: b.access_token, exp: now() + Math.max(0, (b.expires_in ?? 0) - 60) * 1000 })
        if (conn.status !== 'active') await markConnection(deps.db, connectionId, 'active', null)
        return b.access_token
      } catch (e) {
        if (e instanceof ConnectorError && (e.kind === 'auth_expired' || e.kind === 'auth_revoked')) await markConnection(deps.db, connectionId, 'expired', 'INVALID_GRANT')
        throw e
      }
    },
    forget(connectionId: string) { cache.delete(connectionId) },
  }
}

/* ----------------------------------------------------------------- Meta ----------------------------------------------------------------- */

const metaVersion = (env: Env) => (env.MI_META_GRAPH_VERSION && /^v\d{2,3}\.\d$/.test(env.MI_META_GRAPH_VERSION) ? env.MI_META_GRAPH_VERSION : DEFAULT_META_GRAPH_VERSION)

export function metaAuthorizeUrl(env: Env, state: string): string {
  const p = new URLSearchParams({ client_id: env.MI_META_APP_ID!, redirect_uri: callbackUrl(env, 'meta'), state, response_type: 'code', scope: META_SCOPES.join(',') })
  return `https://www.facebook.com/${metaVersion(env)}/dialog/oauth?` + p
}

function metaTokenError(status: number, body: unknown): ConnectorError {
  const code = (body as { error?: { code?: number } })?.error?.code
  return new ConnectorError(code === 190 ? 'auth_expired' : kindForStatus(status), ['meta_oauth', status, typeof code === 'number' ? code : null].filter(v => v !== null).join(' '))
}

/** Código → token curto → token de longa duração (~60 dias). */
export async function metaExchangeCode(fetchImpl: FetchLike, env: Env, code: string, now = Date.now()) {
  const base = `https://graph.facebook.com/${metaVersion(env)}/oauth/access_token?`
  const short = await requestJson(fetchImpl, base + new URLSearchParams({ client_id: env.MI_META_APP_ID!, client_secret: env.MI_META_APP_SECRET!, redirect_uri: callbackUrl(env, 'meta'), code }), { method: 'GET', headers: {} }, metaTokenError)
  const shortToken = (short.body as { access_token?: string })?.access_token
  if (!shortToken) throw new ConnectorError('invalid_request', 'meta_oauth sem token')
  const long = await requestJson(fetchImpl, base + new URLSearchParams({ grant_type: 'fb_exchange_token', client_id: env.MI_META_APP_ID!, client_secret: env.MI_META_APP_SECRET!, fb_exchange_token: shortToken }), { method: 'GET', headers: {} }, metaTokenError)
  const b = long.body as { access_token?: string; expires_in?: number }
  if (!b.access_token) throw new ConnectorError('invalid_request', 'meta_oauth sem token de longa duração')
  return { token: b.access_token, expiresAt: b.expires_in ? new Date(now + b.expires_in * 1000).toISOString() : null }
}

/** Token Meta por conexão: o próprio token guardado no cofre (longa duração ou usuário de sistema). Vencido → auth_expired. */
export function metaAccessTokenProvider(deps: { db: Queryable; vault: PgCredentialVault; now?: () => number }) {
  const now = deps.now ?? Date.now
  return {
    async get(connectionId: string): Promise<string> {
      const conn = await getConnection(deps.db, connectionId)
      if (!conn || conn.provider !== 'meta' || !conn.credentialRef) throw new ConnectorError('permission_denied', 'conexão inexistente')
      if (conn.status === 'revoked') throw new ConnectorError('auth_revoked', 'conexão revogada')
      if (conn.expiresAt && Date.parse(conn.expiresAt) <= now()) {
        await markConnection(deps.db, connectionId, 'expired', 'TOKEN_EXPIRED')
        throw new ConnectorError('auth_expired', 'meta token vencido — reautorizar')
      }
      return deps.vault.withSecret(conn.credentialRef as CredentialRef, async t => t)
    },
  }
}
