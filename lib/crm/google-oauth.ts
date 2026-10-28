import 'server-only'

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { getCrmPool } from '@/lib/crm/db'

export const GOOGLE_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/calendar.freebusy',
  'https://www.googleapis.com/auth/calendar.events.owned',
] as const

const OAUTH_STATE_AGE_SECONDS = 10 * 60
export const GOOGLE_OAUTH_FLOW_COOKIE = '__Host-cassiellos_google_oauth'
const OAUTH_PROVIDER = 'google_calendar'

export type GoogleOAuthConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
  calendarId: string
}

function encryptionKey(): Buffer | null {
  const hex = process.env.CRM_GOOGLE_ENCRYPTION_KEY?.trim()
  return hex && /^[a-f0-9]{64}$/i.test(hex) ? Buffer.from(hex, 'hex') : null
}

export function googleOAuthConfig(): GoogleOAuthConfig | null {
  const clientId = process.env.CRM_GOOGLE_CLIENT_ID?.trim()
  const clientSecret = process.env.CRM_GOOGLE_CLIENT_SECRET?.trim()
  const redirectUri = process.env.CRM_GOOGLE_REDIRECT_URI?.trim()
  const calendarId = process.env.CRM_GOOGLE_CALENDAR_ID?.trim() || 'primary'
  if (!clientId || !clientSecret || !redirectUri || !encryptionKey()) return null
  try {
    const url = new URL(redirectUri)
    if (url.protocol !== 'https:' || !url.hostname.endsWith('.vercel.app') ||
      url.username || url.password || url.port || url.search || url.hash ||
      url.pathname !== '/api/crm/google/oauth/callback') return null
  } catch {
    return null
  }
  return { clientId, clientSecret, redirectUri, calendarId }
}

function oauthSign(encoded: string): Buffer {
  const secret = process.env.CRM_SESSION_SECRET
  if (!secret || !/^[a-f0-9]{64,}$/i.test(secret) || secret.length % 2) {
    throw new Error('CRM_GOOGLE_STATE_CONFIG_ERROR')
  }
  return createHmac('sha256', Buffer.from(secret, 'hex')).update(encoded).digest()
}

type OAuthFlow = { state: string; verifier: string; createdAt: number }

export function createGoogleOAuthFlow(): {
  cookie: string
  state: string
  challenge: string
} {
  const state = randomBytes(32).toString('base64url')
  const verifier = randomBytes(64).toString('base64url')
  const flow: OAuthFlow = { state, verifier, createdAt: Math.floor(Date.now() / 1000) }
  const encoded = Buffer.from(JSON.stringify(flow)).toString('base64url')
  return {
    cookie: encoded + '.' + oauthSign(encoded).toString('base64url'),
    state,
    challenge: createHash('sha256').update(verifier).digest('base64url'),
  }
}

export function parseGoogleOAuthFlow(cookie: string | undefined, state: string): OAuthFlow | null {
  if (!cookie || cookie.length > 2000 || !state || state.length > 256) return null
  const [encoded, signature, extra] = cookie.split('.')
  if (!encoded || !signature || extra) return null
  try {
    const expected = oauthSign(encoded)
    const actual = Buffer.from(signature, 'base64url')
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null
    const flow = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as OAuthFlow
    const now = Math.floor(Date.now() / 1000)
    if (typeof flow?.createdAt !== 'number' || flow.createdAt > now ||
      now - flow.createdAt > OAUTH_STATE_AGE_SECONDS ||
      typeof flow.state !== 'string' || typeof flow.verifier !== 'string') return null
    const actualState = Buffer.from(state)
    const expectedState = Buffer.from(flow.state)
    if (actualState.length !== expectedState.length || !timingSafeEqual(actualState, expectedState)) return null
    if (!/^[A-Za-z0-9_-]{43,128}$/.test(flow.verifier)) return null
    return flow
  } catch {
    return null
  }
}

export function googleAuthorizationUrl(config: GoogleOAuthConfig, flow: {
  state: string; challenge: string
}): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', config.clientId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', GOOGLE_OAUTH_SCOPES.join(' '))
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('include_granted_scopes', 'true')
  url.searchParams.set('state', flow.state)
  url.searchParams.set('code_challenge', flow.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

export async function exchangeGoogleCode(
  config: GoogleOAuthConfig,
  code: string,
  verifier: string,
): Promise<{ refreshToken: string; scopes: string; expiresAt: Date | null }> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code, code_verifier: verifier,
      client_id: config.clientId, client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error('CRM_GOOGLE_OAUTH_EXCHANGE_FAILED')
  const payload: unknown = await response.json()
  if (!payload || typeof payload !== 'object' ||
      !('refresh_token' in payload) || typeof payload.refresh_token !== 'string' ||
      !('scope' in payload) || typeof payload.scope !== 'string' ||
      payload.refresh_token.length < 10) {
    throw new Error('CRM_GOOGLE_OAUTH_REFRESH_MISSING')
  }
  const granted = new Set(payload.scope.split(/\s+/))
  if (!GOOGLE_OAUTH_SCOPES.every(scope => granted.has(scope))) {
    throw new Error('CRM_GOOGLE_OAUTH_SCOPES_MISSING')
  }
  const expiration = 'refresh_token_expires_in' in payload &&
    typeof payload.refresh_token_expires_in === 'number' &&
    Number.isFinite(payload.refresh_token_expires_in) &&
    payload.refresh_token_expires_in > 0 ? new Date(Date.now() + payload.refresh_token_expires_in * 1000) : null
  return { refreshToken: payload.refresh_token, scopes: payload.scope, expiresAt: expiration }
}

function encrypt(value: string): string {
  const key = encryptionKey()
  if (!key) throw new Error('CRM_GOOGLE_CIPHER_NOT_CONFIGURED')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from('cassiellos:crm:google_calendar:v1'))
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return ['v1', iv.toString('hex'), cipher.getAuthTag().toString('hex'), encrypted.toString('hex')].join(':')
}

function decrypt(value: string): string {
  const key = encryptionKey()
  if (!key) throw new Error('CRM_GOOGLE_CIPHER_NOT_CONFIGURED')
  const parts = value.split(':')
  if (parts.length !== 4 || parts[0] !== 'v1' ||
    !/^[0-9a-f]{24}$/i.test(parts[1]) || !/^[0-9a-f]{32}$/i.test(parts[2]) ||
    !/^[0-9a-f]+$/i.test(parts[3]) || parts[3].length % 2) {
    throw new Error('CRM_GOOGLE_CIPHER_INVALID')
  }
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'hex'))
  decipher.setAAD(Buffer.from('cassiellos:crm:google_calendar:v1'))
  decipher.setAuthTag(Buffer.from(parts[2], 'hex'))
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'hex')), decipher.final()]).toString('utf8')
}

export async function saveGoogleRefreshToken(token: string, scopes: string, expiresAt: Date | null): Promise<void> {
  const ciphertext = encrypt(token)
  await getCrmPool().query(
    `INSERT INTO crm.integration_credentials
      (provider, encrypted_refresh_token, granted_scopes, token_expires_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (provider) DO UPDATE
      SET encrypted_refresh_token = EXCLUDED.encrypted_refresh_token,
          granted_scopes = EXCLUDED.granted_scopes,
          token_expires_at = EXCLUDED.token_expires_at,
          updated_at = now()`,
    [OAUTH_PROVIDER, ciphertext, scopes, expiresAt],
  )
}

export async function getGoogleRefreshToken(): Promise<string | null> {
  if (!googleOAuthConfig()) return null
  const result = await getCrmPool().query<{ encrypted_refresh_token: string; token_expires_at: Date | null }>(
    'SELECT encrypted_refresh_token, token_expires_at FROM crm.integration_credentials WHERE provider = $1',
    [OAUTH_PROVIDER],
  )
  if (!result.rows.length) return null
  const row = result.rows[0]
  if (row.token_expires_at && new Date(row.token_expires_at).getTime() <= Date.now()) return null
  return decrypt(row.encrypted_refresh_token)
}

export async function getGoogleOAuthConnectionStatus(): Promise<{ configured: boolean; connected: boolean }> {
  if (!googleOAuthConfig()) return { configured: false, connected: false }
  return { configured: true, connected: Boolean(await getGoogleRefreshToken()) }
}
