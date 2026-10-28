import { createHmac } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getCrmPool } from '@/lib/crm/db'
import { getBookingForm } from '@/lib/crm/booking-forms'
import {
  CRM_BOOKING_TIME_ZONE,
  DEFAULT_BOOKING_POLICY,
  isBookableDate,
  isValidBookingDate,
  listBookingSlots,
} from '@/lib/crm/booking-slots'
import { readGoogleBusyIntervals } from '@/lib/crm/google-calendar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 20

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    },
  })
}

/** Preview only, no private event details. Limit calls before accessing Google. */
async function allowAvailabilityLookup(request: NextRequest): Promise<boolean> {
  const secret = process.env.CRM_SESSION_SECRET
  if (!secret || !/^[a-f0-9]{64,}$/i.test(secret)) return false
  const forwardedIp = request.headers.get('x-vercel-forwarded-for') || 'unknown'
  const fingerprint = createHmac('sha256', Buffer.from(secret, 'hex'))
    .update('calendar-availability:' + forwardedIp.slice(0, 128))
    .digest('hex')
  const result = await getCrmPool().query<{ request_count: number }>(
    `INSERT INTO crm.booking_availability_limits
      (fingerprint, window_started_at, request_count, last_request_at)
      VALUES ($1, now(), 1, now())
      ON CONFLICT (fingerprint) DO UPDATE SET
        request_count = CASE
          WHEN crm.booking_availability_limits.window_started_at < now() - interval '15 minutes'
          THEN 1 ELSE crm.booking_availability_limits.request_count + 1 END,
        window_started_at = CASE
          WHEN crm.booking_availability_limits.window_started_at < now() - interval '15 minutes'
          THEN now() ELSE crm.booking_availability_limits.window_started_at END,
        last_request_at = now()
      RETURNING request_count`,
    [fingerprint],
  )
  return (result.rows[0]?.request_count ?? 1000) <= 50
}

export async function GET(request: NextRequest) {
  // This endpoint can be made public only in the isolated Preview deployment.
  if (process.env.VERCEL_ENV !== 'preview') return json({ error: 'NOT_FOUND' }, 404)

  const form = request.nextUrl.searchParams.get('form') ?? ''
  const date = request.nextUrl.searchParams.get('date') ?? ''
  if (!getBookingForm(form) || !isValidBookingDate(date)) {
    return json({ error: 'INVALID_REQUEST' }, 400)
  }
  if (!isBookableDate(date)) {
    return json({ date, slots: [], timeZone: CRM_BOOKING_TIME_ZONE,
      slotMinutes: DEFAULT_BOOKING_POLICY.slotMinutes, provisionalPolicy: true }, 200)
  }

  let allowed: boolean
  try {
    allowed = await allowAvailabilityLookup(request)
  } catch {
    return json({ error: 'AVAILABILITY_UNAVAILABLE' }, 503)
  }
  if (!allowed) return json({ error: 'TOO_MANY_REQUESTS' }, 429)

  try {
    const busy = await readGoogleBusyIntervals(date)
    return json({
      date,
      slots: listBookingSlots(date, busy),
      timeZone: CRM_BOOKING_TIME_ZONE,
      slotMinutes: DEFAULT_BOOKING_POLICY.slotMinutes,
      provisionalPolicy: true,
    }, 200)
  } catch {
    return json({ error: 'AVAILABILITY_UNAVAILABLE' }, 503)
  }
}
