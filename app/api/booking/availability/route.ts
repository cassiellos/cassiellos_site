import { NextRequest, NextResponse } from 'next/server'
import { getCrmPool } from '@/lib/crm/db'
import { getBookingForm } from '@/lib/crm/booking-forms'
import { verifyBookingGrant } from '@/lib/crm/booking-grant'
import { checkAvailabilityAccess } from '@/lib/crm/booking-confirmation'
import { parseLimitExemptMailboxes } from '@/lib/crm/booking-reservation'
import { AVAILABILITY_LIMIT, consumeRequestQuota, requestFingerprint } from '@/lib/crm/request-limits'
import { CRM_BOOKING_TIME_ZONE, isValidBookingDate } from '@/lib/crm/booking-slots'
import { isOpenDate, listAvailableSlots, type AvailabilityRules } from '@/lib/crm/availability/engine'
import { loadAvailabilityRules } from '@/lib/crm/availability/store'
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

/** Preview only, no private event details. Limit calls before accessing Google (50 / 15 min / IP). */
async function allowAvailabilityLookup(request: NextRequest): Promise<boolean> {
  const fingerprint = requestFingerprint(AVAILABILITY_LIMIT, request.headers.get('x-vercel-forwarded-for'))
  return fingerprint ? consumeRequestQuota(getCrmPool(), AVAILABILITY_LIMIT, fingerprint) : false
}

export async function GET(request: NextRequest) {
  // This endpoint can be made public only in the isolated Preview deployment.
  if (process.env.VERCEL_ENV !== 'preview') return json({ error: 'NOT_FOUND' }, 404)

  const form = request.nextUrl.searchParams.get('form') ?? ''
  const date = request.nextUrl.searchParams.get('date') ?? ''
  if (!getBookingForm(form) || !isValidBookingDate(date)) {
    return json({ error: 'INVALID_REQUEST' }, 400)
  }
  // Phase 3 / item 4: only visitors holding a booking session (issued after the
  // server-side Turnstile check) can trigger calendar lookups.
  const session = verifyBookingGrant(request.headers.get('x-booking-session'))
  if (!session || session.formSlug !== form) return json({ error: 'BOOKING_SESSION_EXPIRED' }, 401)
  // Business hours, holidays, policies, manual blocks and exceptions (no Google call).
  let rules: AvailabilityRules
  try {
    rules = await loadAvailabilityRules(getCrmPool())
  } catch {
    return json({ error: 'AVAILABILITY_UNAVAILABLE' }, 503)
  }
  if (!isOpenDate(date, rules)) {
    return json({ date, slots: [], closed: true, timeZone: CRM_BOOKING_TIME_ZONE,
      slotMinutes: rules.settings.slotMinutes }, 200)
  }

  let allowed: boolean
  try {
    allowed = await allowAvailabilityLookup(request)
  } catch {
    return json({ error: 'AVAILABILITY_UNAVAILABLE' }, 503)
  }
  if (!allowed) return json({ error: 'TOO_MANY_REQUESTS' }, 429)

  try {
    // Blocked contacts (active meeting / e-mail limit) stop here, before Google.
    const denied = await checkAvailabilityAccess(getCrmPool(), session, form,
      { exemptMailboxes: parseLimitExemptMailboxes() })
    if (denied) return json(denied.body, denied.status)
  } catch {
    return json({ error: 'AVAILABILITY_UNAVAILABLE' }, 503)
  }

  try {
    const busy = await readGoogleBusyIntervals(date)
    // Include reservations in progress in Neon: they may not yet appear in Google.
    const midnight = new Date(date + 'T00:00:00-03:00')
    const endOfDay = new Date(midnight.getTime() + 86_400_000)
    const calendarId = process.env.CRM_GOOGLE_CALENDAR_ID?.trim() || 'primary'
    const reserved = await getCrmPool().query<{ starts_at: Date; ends_at: Date }>(
      `SELECT starts_at, ends_at FROM crm.booking_requests
       WHERE calendar_id = $1 AND status IN ('processing', 'confirmed')
         AND starts_at < $3 AND ends_at > $2`,
      [calendarId, midnight, endOfDay],
    )
    const internalBusy = reserved.rows.map(item => ({
      start: new Date(item.starts_at).toISOString(),
      end: new Date(item.ends_at).toISOString(),
    }))
    return json({
      date,
      slots: listAvailableSlots(date, [...busy, ...internalBusy], rules),
      timeZone: CRM_BOOKING_TIME_ZONE,
      slotMinutes: rules.settings.slotMinutes,
    }, 200)
  } catch {
    return json({ error: 'AVAILABILITY_UNAVAILABLE' }, 503)
  }
}
