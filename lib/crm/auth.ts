import 'server-only'

import { createHmac, pbkdf2, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { getCrmPool } from '@/lib/crm/db'

const SESSION_DURATION_SECONDS = 8 * 60 * 60
type SessionPayload = { v: 1; sub: 'admin'; iat: number; exp: number; pwv: string }

export function isCrmAuthConfigured(): boolean {
  const secret = process.env.CRM_SESSION_SECRET
  const passwordHash = process.env.CRM_ADMIN_PASSWORD_HASH
  return Boolean(
    secret && /^[a-f0-9]{64,}$/i.test(secret) && secret.length % 2 === 0 &&
    passwordHash && /^(?:scrypt\$16384\$8\$1|pbkdf2_sha256\$600000)\$[a-f0-9]{32}\$[a-f0-9]{64}$/i.test(passwordHash) &&
    process.env.CRM_DATABASE_URL?.trim()
  )
}

function getSessionSecret(): Buffer | null {
  const value = process.env.CRM_SESSION_SECRET
  if (!value || !/^[a-f0-9]{64,}$/i.test(value) || value.length % 2) return null
  const secret = Buffer.from(value, 'hex')
  return secret.length >= 32 ? secret : null
}

export function crmSessionCookieName(): string {
  return process.env.NODE_ENV === 'production' ? '__Host-cassiellos_crm' : 'cassiellos_crm_dev'
}

function sign(encodedPayload: string, secret: Buffer): Buffer {
  return createHmac('sha256', secret).update(encodedPayload).digest()
}

function passwordVersion(secret: Buffer): string {
  return createHmac('sha256', secret).update(process.env.CRM_ADMIN_PASSWORD_HASH ?? '').digest('base64url')
}

export function issueCrmSession(): string {
  const secret = getSessionSecret()
  if (!secret || !isCrmAuthConfigured()) throw new Error('CRM_AUTH_NOT_CONFIGURED')
  const now = Math.floor(Date.now() / 1000)
  const payload: SessionPayload = { v: 1, sub: 'admin', iat: now, exp: now + SESSION_DURATION_SECONDS, pwv: passwordVersion(secret) }
  const encoded = Buffer.from(JSON.stringify({ ...payload, nonce: randomBytes(16).toString('hex') })).toString('base64url')
  return encoded + '.' + sign(encoded, secret).toString('base64url')
}

export function verifyCrmSession(token?: string | null): boolean {
  const secret = getSessionSecret()
  if (!isCrmAuthConfigured() || !secret || !token || token.length > 1000) return false
  const [encoded, signed, extra] = token.split('.')
  if (!encoded || !signed || extra) return false
  try {
    const actual = Buffer.from(signed, 'base64url')
    const expected = sign(encoded, secret)
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false
    const data = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<SessionPayload>
    const now = Math.floor(Date.now() / 1000)
    return data.v === 1 && data.sub === 'admin' && data.pwv === passwordVersion(secret) &&
      typeof data.iat === 'number' && typeof data.exp === 'number' &&
      data.iat <= now + 30 && data.exp > now &&
      data.exp - data.iat <= SESSION_DURATION_SECONDS &&
      data.iat >= now - SESSION_DURATION_SECONDS
  } catch {
    return false
  }
}

function derivePassword(password: string, salt: Buffer, algorithm: 'scrypt' | 'pbkdf2_sha256'): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const complete = (error: Error | null, key: Buffer) => error ? reject(error) : resolve(key)
    if (algorithm === 'pbkdf2_sha256') {
      pbkdf2(password, salt, 600_000, 32, 'sha256', complete)
    } else {
      scrypt(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, complete)
    }
  })
}

export async function verifyAdminCredentials(username: string, password: string): Promise<boolean> {
  const stored = process.env.CRM_ADMIN_PASSWORD_HASH
  if (!stored || !isCrmAuthConfigured()) return false
  if (password.length < 12 || password.length > 256 || username.length > 100) return false
  const parts = stored.split('
    return expected.length === calculated.length && timingSafeEqual(expected, calculated) &&
      username.trim().toLowerCase() === 'admin'
  } catch {
    return false
  }
}

/** HMAC: no raw visitor IP is stored in PostgreSQL. */
function fingerprintForIp(ip: string): string {
  const secret = getSessionSecret()
  if (!secret) throw new Error('CRM_AUTH_NOT_CONFIGURED')
  return createHmac('sha256', secret).update(ip).digest('hex')
}

const RESERVE_ATTEMPT_SQL = [
  'INSERT INTO crm.auth_login_attempts',
  '(fingerprint, attempts, window_started_at, last_attempt_at, locked_until)',
  'VALUES ($1, 1, now(), now(), NULL)',
  'ON CONFLICT (fingerprint) DO UPDATE SET',
  'attempts = CASE WHEN crm.auth_login_attempts.window_started_at < now() - interval \'15 minutes\'',
  'THEN 1 ELSE crm.auth_login_attempts.attempts + 1 END,',
  'window_started_at = CASE WHEN crm.auth_login_attempts.window_started_at < now() - interval \'15 minutes\'',
  'THEN now() ELSE crm.auth_login_attempts.window_started_at END,',
  'last_attempt_at = now(),',
  'locked_until = CASE',
  'WHEN crm.auth_login_attempts.locked_until > now() THEN crm.auth_login_attempts.locked_until',
  'WHEN crm.auth_login_attempts.window_started_at < now() - interval \'15 minutes\' THEN NULL',
  'WHEN crm.auth_login_attempts.attempts + 1 >= 6 THEN now() + interval \'15 minutes\'',
  'ELSE NULL END',
  'RETURNING locked_until',
].join(' ')

export async function reserveCrmLoginAttempt(ip: string): Promise<boolean> {
  const fingerprint = fingerprintForIp(ip)
  const result = await getCrmPool().query<{ locked_until: Date | null }>(RESERVE_ATTEMPT_SQL, [fingerprint])
  return !result.rows[0]?.locked_until || new Date(result.rows[0].locked_until).getTime() <= Date.now()
}

export async function resetCrmLoginAttempts(ip: string): Promise<void> {
  await getCrmPool().query('DELETE FROM crm.auth_login_attempts WHERE fingerprint = $1', [fingerprintForIp(ip)])
}

export function getCrmClientIp(headers: Headers): string {
  // Use the Vercel-controlled forwarded header; fail into one shared bucket if absent.
  return (headers.get('x-vercel-forwarded-for') || 'unknown').slice(0, 128)
}

export const CRM_SESSION_MAX_AGE = SESSION_DURATION_SECONDS
)
  const isPbkdf2 = parts[0] === 'pbkdf2_sha256' && parts[1] === '600000' && parts.length === 4
  const isScrypt = parts[0] === 'scrypt' && parts[1] === '16384' && parts[2] === '8' && parts[3] === '1' && parts.length === 6
  if (!isPbkdf2 && !isScrypt) return false
  try {
    const expected = Buffer.from(isPbkdf2 ? parts[3] : parts[5], 'hex')
    const salt = Buffer.from(isPbkdf2 ? parts[2] : parts[4], 'hex')
    const calculated = await derivePassword(password, salt, isPbkdf2 ? 'pbkdf2_sha256' : 'scrypt')
    return expected.length === calculated.length && timingSafeEqual(expected, calculated) &&
      username.trim().toLowerCase() === 'admin'
  } catch {
    return false
  }
}

/** HMAC: no raw visitor IP is stored in PostgreSQL. */
function fingerprintForIp(ip: string): string {
  const secret = getSessionSecret()
  if (!secret) throw new Error('CRM_AUTH_NOT_CONFIGURED')
  return createHmac('sha256', secret).update(ip).digest('hex')
}

const RESERVE_ATTEMPT_SQL = [
  'INSERT INTO crm.auth_login_attempts',
  '(fingerprint, attempts, window_started_at, last_attempt_at, locked_until)',
  'VALUES ($1, 1, now(), now(), NULL)',
  'ON CONFLICT (fingerprint) DO UPDATE SET',
  'attempts = CASE WHEN crm.auth_login_attempts.window_started_at < now() - interval \'15 minutes\'',
  'THEN 1 ELSE crm.auth_login_attempts.attempts + 1 END,',
  'window_started_at = CASE WHEN crm.auth_login_attempts.window_started_at < now() - interval \'15 minutes\'',
  'THEN now() ELSE crm.auth_login_attempts.window_started_at END,',
  'last_attempt_at = now(),',
  'locked_until = CASE',
  'WHEN crm.auth_login_attempts.locked_until > now() THEN crm.auth_login_attempts.locked_until',
  'WHEN crm.auth_login_attempts.window_started_at < now() - interval \'15 minutes\' THEN NULL',
  'WHEN crm.auth_login_attempts.attempts + 1 >= 6 THEN now() + interval \'15 minutes\'',
  'ELSE NULL END',
  'RETURNING locked_until',
].join(' ')

export async function reserveCrmLoginAttempt(ip: string): Promise<boolean> {
  const fingerprint = fingerprintForIp(ip)
  const result = await getCrmPool().query<{ locked_until: Date | null }>(RESERVE_ATTEMPT_SQL, [fingerprint])
  return !result.rows[0]?.locked_until || new Date(result.rows[0].locked_until).getTime() <= Date.now()
}

export async function resetCrmLoginAttempts(ip: string): Promise<void> {
  await getCrmPool().query('DELETE FROM crm.auth_login_attempts WHERE fingerprint = $1', [fingerprintForIp(ip)])
}

export function getCrmClientIp(headers: Headers): string {
  // Use the Vercel-controlled forwarded header; fail into one shared bucket if absent.
  return (headers.get('x-vercel-forwarded-for') || 'unknown').slice(0, 128)
}

export const CRM_SESSION_MAX_AGE = SESSION_DURATION_SECONDS
