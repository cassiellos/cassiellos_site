import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

const MAX_AGE_SECONDS = 2 * 60 * 60

type BookingGrant = {
  v: 1
  leadId: string
  submissionId: string
  formSlug: string
  iat: number
  exp: number
}

function secret(): Buffer {
  const raw = process.env.CRM_SESSION_SECRET
  if (!raw || !/^[a-f0-9]{64,}$/i.test(raw) || raw.length % 2) {
    throw new Error('BOOKING_GRANT_NOT_CONFIGURED')
  }
  return Buffer.from(raw, 'hex')
}

function sign(encoded: string): Buffer {
  return createHmac('sha256', secret()).update('booking-grant:v1:' + encoded).digest()
}

export function createBookingGrant(data: {
  leadId: string
  submissionId: string
  formSlug: string
}): string {
  const now = Math.floor(Date.now() / 1000)
  const encoded = Buffer.from(JSON.stringify({
    v: 1, ...data, iat: now, exp: now + MAX_AGE_SECONDS,
  } satisfies BookingGrant)).toString('base64url')
  return encoded + '.' + sign(encoded).toString('base64url')
}

/**
 * Short-lived proof that the visitor completed exactly this form submission.
 * IDs alone must never authorize booking another visitor's meeting.
 */
export function verifyBookingGrant(token: unknown): BookingGrant | null {
  if (typeof token !== 'string' || token.length > 800) return null
  const [encoded, signature, extra] = token.split('.')
  if (!encoded || !signature || extra) return null
  try {
    const actual = Buffer.from(signature, 'base64url')
    const expected = sign(encoded)
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
    const data: BookingGrant = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    const now = Math.floor(Date.now() / 1000)
    const validUuid = (value: unknown) =>
      typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value)
    if (data.v !== 1 || !validUuid(data.leadId) || !validUuid(data.submissionId) ||
      typeof data.formSlug !== 'string' || !/^[a-z0-9_-]{2,80}$/.test(data.formSlug) ||
      typeof data.iat !== 'number' || typeof data.exp !== 'number' ||
      data.exp <= now || data.iat > now + 30 ||
      data.exp - data.iat > MAX_AGE_SECONDS || data.iat < now - MAX_AGE_SECONDS) return null
    return data
  } catch {
    return null
  }
}
