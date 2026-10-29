import { NextRequest, NextResponse } from 'next/server'
import { getBookingForm } from '@/lib/crm/booking-forms'
import { verifyBookingGrant } from '@/lib/crm/booking-grant'
import { getCrmPool } from '@/lib/crm/db'
import { isBookableDate, listBookingSlots } from '@/lib/crm/booking-slots'
import { createGoogleBooking, readGoogleBusyIntervals } from '@/lib/crm/google-calendar'
import { isCrmPreviewOrigin } from '@/lib/crm/preview-origins'
import {
  finalizeBookingReservation, releaseReservationBeforeGoogle, reserveBookingSlot,
} from '@/lib/crm/booking-reservation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function json(data: unknown, status: number) {
  return NextResponse.json(data, {
    status, headers: {
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

function bookingsEnabled(): boolean {
  return process.env.VERCEL_ENV === 'preview' &&
    process.env.CRM_GOOGLE_BOOKINGS_ENABLED === 'true' &&
    Boolean(process.env.CRM_BOOKING_ALLOWED_EMAIL?.trim())
}

function bookingDay(startAt: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(startAt))
  const v = (name: string) => parts.find(p => p.type === name)?.value || ''
  return v('year') + '-' + v('month') + '-' + v('day')
}

/**
 * PREVIEW ONLY. Deliberately OFF unless the owner opts in and adds two
 * branch-scoped environment variables after a controlled real-email test plan.
 * An external Google event is never retried automatically after uncertain failure.
 */
export async function POST(request: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview') return json({ error: 'NOT_FOUND' }, 404)
  if (!bookingsEnabled()) return json({ error: 'BOOKING_DISABLED' }, 423)
  const origin = request.headers.get('origin')
  if (!isCrmPreviewOrigin(origin)) return json({ error: 'FORBIDDEN' }, 403)
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return json({ error: 'INVALID_REQUEST' }, 400)

  let data: { bookingToken?: unknown; startAt?: unknown }
  try {
    const raw = await request.text()
    if (raw.length > 2_000) return json({ error: 'INVALID_REQUEST' }, 400)
    data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return json({ error: 'INVALID_REQUEST' }, 400)
  } catch { return json({ error: 'INVALID_REQUEST' }, 400) }

  const grant = verifyBookingGrant(data.bookingToken)
  if (!grant) return json({ error: 'BOOKING_SESSION_EXPIRED' }, 401)
  const form = getBookingForm(grant.formSlug)
  if (!form) return json({ error: 'UNKNOWN_FORM' }, 400)
  const startAt = data.startAt
  if (typeof startAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(startAt)) {
    return json({ error: 'INVALID_SLOT' }, 400)
  }
  const ms = Date.parse(startAt)
  if (!Number.isFinite(ms)) return json({ error: 'INVALID_SLOT' }, 400)
  const normalizedStart = new Date(ms).toISOString()
  const day = bookingDay(normalizedStart)
  if (!isBookableDate(day)) return json({ error: 'INVALID_SLOT' }, 400)
  const calendarId = process.env.CRM_GOOGLE_CALENDAR_ID?.trim() || 'primary'
  const allowedEmail = process.env.CRM_BOOKING_ALLOWED_EMAIL?.trim() || ''
  const finishAt = new Date(ms + form.durationMinutes * 60_000).toISOString()

  try {
    // Google external availability is checked first; internal races are guarded
    // with the unique active-slot index on crm.booking_requests.
    const busy = await readGoogleBusyIntervals(day)
    const slot = listBookingSlots(day, busy).find(item =>
      item.startAt === normalizedStart && item.endAt === finishAt)
    if (!slot) return json({ error: 'SLOT_UNAVAILABLE' }, 409)

    const reservation = await reserveBookingSlot(getCrmPool(), {
      leadId: grant.leadId, submissionId: grant.submissionId, formSlug: form.slug,
      startAt: normalizedStart, endAt: finishAt, calendarId, allowedEmail,
    })
    if (reservation.status === 'email_not_allowed') {
      return json({ error: 'TEST_EMAIL_NOT_ALLOWED' }, 403)
    }
    if (reservation.status === 'bad_submission') return json({ error: 'INVALID_SUBMISSION' }, 403)
    if (reservation.status === 'slot_unavailable') return json({ error: 'SLOT_UNAVAILABLE' }, 409)
    // Generic on purpose: never reveals date, time, Meet link or internal state.
    if (reservation.status === 'active_meeting') return json({ error: 'CONTACT_HAS_ACTIVE_MEETING' }, 409)
    if (reservation.status === 'already_confirmed') {
      return json({ ok: true, alreadyConfirmed: true, bookingRequestId: reservation.id }, 200)
    }
    if (reservation.status !== 'reserved') return json({ error: 'BOOKING_ALREADY_PROCESSING' }, 409)

    // Recheck the Google calendar after claiming the slot, before creating an event.
    // If ambiguous Google/DB failure occurs later, leave reservation locked for
    // manual reconciliation rather than risk sending duplicate invitations.
    let latestBusy
    try {
      latestBusy = await readGoogleBusyIntervals(day)
    } catch { return json({ error: 'BOOKING_REQUIRES_REVIEW' }, 503) }
    const stillFree = listBookingSlots(day, latestBusy).some(item =>
      item.startAt === normalizedStart && item.endAt === finishAt)
    if (!stillFree) {
      await releaseReservationBeforeGoogle(getCrmPool(), reservation.id, 'EXTERNAL_CALENDAR_CONFLICT')
      return json({ error: 'SLOT_UNAVAILABLE' }, 409)
    }

    const event = await createGoogleBooking({
      title: form.meetingName,
      description: 'Agendamento do diagnóstico estratégico Cassiellos.',
      startAt: normalizedStart,
      endAt: finishAt,
      guestEmail: reservation.email,
      requestId: reservation.id,
      googleEventId: 'c' + reservation.id.replaceAll('-', ''),
    })
    const saved = await finalizeBookingReservation(getCrmPool(), {
      bookingId: reservation.id,
      leadId: grant.leadId, submissionId: grant.submissionId,
      eventId: event.id, meetingUrl: event.meetingUrl,
      startAt: normalizedStart, endAt: finishAt, calendarId, formSlug: form.slug,
      pageOrigin: origin,
    })
    return json({
      ok: true, appointmentId: saved.appointmentId, bookingRequestId: reservation.id,
      date: day, startAt: normalizedStart, endAt: finishAt,
      googleMeetUrl: event.meetingUrl, googleCalendarUrl: event.htmlLink,
      meetPending: !event.meetingUrl,
      environment: 'preview',
    }, 201)
  } catch {
    // Do not issue a second calendar request after ambiguous partial completion.
    return json({ error: 'BOOKING_REQUIRES_REVIEW' }, 503)
  }
}
