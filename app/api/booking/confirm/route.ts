import { NextRequest, NextResponse } from 'next/server'
import { getBookingForm } from '@/lib/crm/booking-forms'
import { verifyBookingGrant } from '@/lib/crm/booking-grant'
import { getCrmPool } from '@/lib/crm/db'
import { isBookableDate, listBookingSlots } from '@/lib/crm/booking-slots'
import { createGoogleBooking, readGoogleBusyIntervals } from '@/lib/crm/google-calendar'
import { isCrmPreviewOrigin } from '@/lib/crm/preview-origins'
import type { PoolClient } from 'pg'

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

async function reserve(input: {
  leadId: string; submissionId: string; formSlug: string
  startAt: string; endAt: string; calendarId: string
  allowedEmail: string
}): Promise<{ status: 'reserved'; id: string; email: string; company: string } |
  { status: 'already_confirmed'; id: string } |
  { status: 'already_processing' | 'already_failed' | 'bad_submission' | 'email_not_allowed' | 'slot_unavailable' }> {
  const client: PoolClient = await getCrmPool().connect()
  let committed = false
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL statement_timeout = 6000')
    const registered = await client.query<{
      lead_id: string
      email: string
      company: string | null
      submission_id: string
    }>(
      `SELECT s.id AS submission_id, s.lead_id, l.email, l.company
         FROM crm.form_submissions s
         JOIN crm.leads l ON l.id = s.lead_id
         WHERE s.id = $1 AND s.lead_id = $2
           AND s.status = 'validated' AND s.answers ->> 'formSlug' = $3
         FOR UPDATE OF s`,
      [input.submissionId, input.leadId, input.formSlug],
    )
    const registeredLead = registered.rows[0]
    if (!registeredLead) {
      await client.query('COMMIT'); committed = true
      return { status: 'bad_submission' }
    }
    if (!registeredLead.email ||
      registeredLead.email.toLowerCase() !== input.allowedEmail.toLowerCase()) {
      await client.query('COMMIT'); committed = true
      return { status: 'email_not_allowed' }
    }
    const found = await client.query<{ id: string; status: string }>(
      'SELECT id, status FROM crm.booking_requests WHERE submission_id = $1',
      [input.submissionId],
    )
    if (found.rows[0]) {
      await client.query('COMMIT'); committed = true
      const old = found.rows[0]
      return old.status === 'confirmed'
        ? { status: 'already_confirmed', id: old.id }
        : { status: old.status === 'processing' ? 'already_processing' : 'already_failed' }
    }
    const active = await client.query<{ id: string }>(
      `SELECT b.id FROM crm.booking_requests b WHERE b.lead_id = $1
         AND b.status IN ('processing','confirmed') LIMIT 1`,
      [input.leadId],
    )
    if (active.rows[0]) {
      await client.query('COMMIT'); committed = true
      return { status: 'already_processing' }
    }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO crm.booking_requests
         (submission_id, lead_id, starts_at, ends_at, calendar_id, status)
         VALUES ($1, $2, $3::timestamptz, $4::timestamptz, $5, 'processing')
         RETURNING id`,
      [input.submissionId, input.leadId, input.startAt, input.endAt, input.calendarId],
    )
    await client.query('COMMIT')
    committed = true
    return { status: 'reserved', id: inserted.rows[0].id,
      email: registeredLead.email, company: registeredLead.company ?? '' }
  } catch (error) {
    const pgError = error as { code?: string }
    if (pgError.code === '23505') return { status: 'slot_unavailable' }
    throw error
  } finally {
    if (!committed) await client.query('ROLLBACK').catch(() => undefined)
    client.release(committed ? undefined : true)
  }
}

async function releaseBeforeGoogle(bookingId: string, reason: string): Promise<void> {
  await getCrmPool().query(
    `UPDATE crm.booking_requests SET status = 'failed',
       failure_code = $2, updated_at = now()
       WHERE id = $1 AND status = 'processing' AND google_event_id IS NULL`,
    [bookingId, reason],
  )
}

async function finalizeBooking(input: {
  bookingId: string; leadId: string; submissionId: string
  eventId: string; meetingUrl: string | null; startAt: string; endAt: string
  calendarId: string; formSlug: string; pageOrigin: string
}): Promise<{ appointmentId: string }> {
  const client = await getCrmPool().connect()
  let committed = false
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL statement_timeout = 6000')
    const appointment = await client.query<{ id: string }>(
      `INSERT INTO crm.appointments (lead_id, calendar_id, starts_at, ends_at,
          status, calendar_event_id, meeting_url, confirmed_at)
        VALUES ($1, $2, $3::timestamptz, $4::timestamptz,
          'confirmed', $5, $6, now()) RETURNING id`,
      [input.leadId, input.calendarId, input.startAt,
        input.endAt, input.eventId, input.meetingUrl],
    )
    const appointmentId = appointment.rows[0].id
    await client.query(
      `UPDATE crm.booking_requests SET status = 'confirmed',
          google_event_id = $2, appointment_id = $3, updated_at = now()
        WHERE id = $1 AND status = 'processing'`,
      [input.bookingId, input.eventId, appointmentId],
    )
    await client.query(
      `INSERT INTO crm.lead_activities
         (lead_id, appointment_id, activity_kind, performed_by, details)
         VALUES ($1, $2, 'meeting_scheduled', 'public_booking', $3::jsonb)`,
      [input.leadId, appointmentId, JSON.stringify({
        formSlug: input.formSlug, bookingRequestId: input.bookingId, environment: 'preview',
      })],
    )
    // Internal event only; Meta CAPI dispatch is a separate, not-yet-enabled pipeline.
    await client.query(
      `INSERT INTO crm.tracking_events
         (lead_id, appointment_id, event_id, event_name,
          source_category, event_source_url, action_source, metadata)
         VALUES ($1, $2, $3, 'Chronos_Scheduled', 'server', $4, 'website', $5::jsonb)`,
      [input.leadId, appointmentId,
        'chronos_scheduled_' + input.bookingId.replaceAll('-', ''),
        input.pageOrigin + '/agendar/' + encodeURIComponent(input.formSlug),
        JSON.stringify({ formSlug: input.formSlug, environment: 'preview' })],
    )
    await client.query('COMMIT')
    committed = true
    return { appointmentId }
  } finally {
    if (!committed) await client.query('ROLLBACK').catch(() => undefined)
    client.release(committed ? undefined : true)
  }
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

    const reservation = await reserve({
      leadId: grant.leadId, submissionId: grant.submissionId, formSlug: form.slug,
      startAt: normalizedStart, endAt: finishAt, calendarId, allowedEmail,
    })
    if (reservation.status === 'email_not_allowed') {
      return json({ error: 'TEST_EMAIL_NOT_ALLOWED' }, 403)
    }
    if (reservation.status === 'bad_submission') return json({ error: 'INVALID_SUBMISSION' }, 403)
    if (reservation.status === 'slot_unavailable') return json({ error: 'SLOT_UNAVAILABLE' }, 409)
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
      await releaseBeforeGoogle(reservation.id, 'EXTERNAL_CALENDAR_CONFLICT')
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
    const saved = await finalizeBooking({
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
