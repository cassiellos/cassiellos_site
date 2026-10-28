import { createHmac } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import type { PoolClient } from 'pg'
import { getCrmPool } from '@/lib/crm/db'
import { getBookingForm } from '@/lib/crm/booking-forms'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 20

const POLICY_VERSION = '2026-08-22'
const FORM_VERSION = 'odontologia-v1'
const MAX_BODY_SIZE = 12_000
const ATTRIBUTION_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'] as const

function response(body: unknown, status: number) {
  return NextResponse.json(body, {
    status, headers: {
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    },
  })
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().replace(/[\u0000-\u001f\u007f]/g, ' ')
  return v && v.length <= max ? v : null
}
function validatedName(value: unknown): string | null {
  const name = clean(value, 120)
  return name && name.length >= 2 ? name : null
}
function validatedEmail(value: unknown): string | null {
  const email = clean(value, 180)?.toLowerCase()
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null
}
function validatedPhone(value: unknown): string | null {
  const phone = clean(value, 24)
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 13 ? digits : null
}
function configuredAnswers(form: NonNullable<ReturnType<typeof getBookingForm>>, raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const answers: Record<string, string> = {}
  for (const field of form.fields) {
    const rawValue = (raw as Record<string, unknown>)[field.name]
    const value = clean(rawValue, 120)
    if (field.required && (!value || value.length < 2)) return null
    if (value && field.type === 'select' && !field.options?.includes(value)) return null
    if (value) answers[field.name] = value
  }
  return answers
}
async function intakeAllowed(request: NextRequest): Promise<boolean> {
  const secret = process.env.CRM_SESSION_SECRET
  if (!secret || !/^[0-9a-f]{64,}$/i.test(secret)) return false
  const forwarded = request.headers.get('x-vercel-forwarded-for') || 'unknown'
  const fingerprint = createHmac('sha256', Buffer.from(secret, 'hex'))
    .update('booking-lead-intake:' + forwarded.slice(0, 128))
    .digest('hex')
  const result = await getCrmPool().query<{ request_count: number }>(
    `INSERT INTO crm.booking_intake_limits
      (fingerprint, window_started_at, request_count, last_request_at)
      VALUES ($1, now(), 1, now())
      ON CONFLICT (fingerprint) DO UPDATE SET
        request_count = CASE WHEN crm.booking_intake_limits.window_started_at < now() - interval '1 hour'
          THEN 1 ELSE crm.booking_intake_limits.request_count + 1 END,
        window_started_at = CASE WHEN crm.booking_intake_limits.window_started_at < now() - interval '1 hour'
          THEN now() ELSE crm.booking_intake_limits.window_started_at END,
        last_request_at = now()
      RETURNING request_count`,
    [fingerprint],
  )
  return (result.rows[0]?.request_count ?? 999) <= 10
}

async function saveLead(input: {
  idempotencyKey: string
  name: string
  email: string
  phone: string
  formSlug: string
  niche: string
  answers: Record<string, string>
  attribution: Record<string, string>
}): Promise<{ leadId: string; submissionId: string; reused: boolean }> {
  const client: PoolClient = await getCrmPool().connect()
  let committed = false
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL statement_timeout = 6000')
    // Serialize duplicate submissions for this person across simultaneous requests.
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [input.email])

    const submitted = await client.query<{ lead_id: string; id: string }>(
      'SELECT lead_id, id FROM crm.form_submissions WHERE idempotency_key = $1',
      [input.idempotencyKey],
    )
    if (submitted.rows[0]) {
      await client.query('COMMIT')
      committed = true
      return { leadId: submitted.rows[0].lead_id, submissionId: submitted.rows[0].id, reused: true }
    }

    const existing = await client.query<{ id: string }>(
      'SELECT id FROM crm.leads WHERE lower(email) = $1 LIMIT 1 FOR UPDATE',
      [input.email],
    )
    let leadId: string
    if (existing.rows[0]) {
      leadId = existing.rows[0].id
      await client.query(
        `UPDATE crm.leads SET full_name = $2, whatsapp = $3,
         company = $4, segment = $5, updated_at = now()
         WHERE id = $1`,
        [leadId, input.name, input.phone, input.answers.clinic ?? null, input.niche],
      )
    } else {
      const result = await client.query<{ id: string }>(
        `INSERT INTO crm.leads (full_name, email, whatsapp, company, segment, stage)
         VALUES ($1,$2,$3,$4,$5,'new') RETURNING id`,
        [input.name, input.email, input.phone, input.answers.clinic ?? null, input.niche],
      )
      leadId = result.rows[0].id
    }

    const submission = await client.query<{ id: string }>(
      `INSERT INTO crm.form_submissions
       (lead_id, form_version, answers, idempotency_key, status)
       VALUES ($1,$2,$3::jsonb,$4,'validated') RETURNING id`,
      [leadId, FORM_VERSION,
        JSON.stringify({ niche: input.niche, formSlug: input.formSlug,
          questions: input.answers, attribution: input.attribution }), input.idempotencyKey],
    )
    const submissionId = submission.rows[0].id
    await client.query(
      `INSERT INTO crm.consents
       (lead_id, purpose, legal_basis, granted, policy_version)
       VALUES ($1,'diagnostic_contact','consent',true,$2)`,
      [leadId, POLICY_VERSION],
    )
    await client.query(
      `INSERT INTO crm.lead_activities (lead_id, activity_kind, performed_by, details)
       VALUES ($1, 'form_completed', 'public_booking', $2::jsonb)`,
      [leadId, JSON.stringify({ submissionId, formSlug: input.formSlug, formVersion: FORM_VERSION, environment: 'preview' })],
    )
    await client.query('COMMIT')
    committed = true
    return { leadId, submissionId, reused: false }
  } finally {
    if (!committed) await client.query('ROLLBACK').catch(() => undefined)
    client.release(committed ? undefined : true)
  }
}

export async function POST(request: NextRequest) {
  // Preview only: no production intake before integration review and approval.
  if (process.env.VERCEL_ENV !== 'preview') return response({ error: 'NOT_FOUND' }, 404)
  const origin = request.headers.get('origin')
  if (!origin || origin !== request.nextUrl.origin) return response({ error: 'FORBIDDEN' }, 403)
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return response({ error: 'INVALID_CONTENT_TYPE' }, 415)
  const length = Number(request.headers.get('content-length') || '0')
  if (length > MAX_BODY_SIZE) return response({ error: 'PAYLOAD_TOO_LARGE' }, 413)

  let value: Record<string, unknown>
  try {
    const raw = await request.text()
    if (raw.length > MAX_BODY_SIZE) return response({ error: 'PAYLOAD_TOO_LARGE' }, 413)
    value = JSON.parse(raw)
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('INVALID_JSON')
  } catch {
    return response({ error: 'INVALID_REQUEST' }, 400)
  }

  if (value.website) return response({ error: 'INVALID_REQUEST' }, 400) // hidden bot trap
  const formSlug = clean(value.formSlug, 80)
  const form = formSlug && getBookingForm(formSlug)
  if (!form) return response({ error: 'UNKNOWN_FORM' }, 400)
  const idempotencyKey = clean(value.idempotencyKey, 50)
  if (!idempotencyKey || !/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(idempotencyKey))
    return response({ error: 'INVALID_REQUEST_KEY' }, 400)
  const name = validatedName(value.name)
  const email = validatedEmail(value.email)
  const phone = validatedPhone(value.whatsapp)
  const answers = configuredAnswers(form, value.answers)
  if (!name || !email || !phone || !answers || value.privacyAccepted !== true)
    return response({ error: 'INVALID_FIELDS' }, 400)

  const attribution: Record<string, string> = {}
  const rawAttribution = value.attribution
  if (rawAttribution && typeof rawAttribution === 'object' && !Array.isArray(rawAttribution)) {
    for (const key of ATTRIBUTION_KEYS) {
      const safe = clean((rawAttribution as Record<string, unknown>)[key], 180)
      if (safe) attribution[key] = safe
    }
  }
  try {
    if (!(await intakeAllowed(request))) return response({ error: 'TOO_MANY_REQUESTS' }, 429)
    const result = await saveLead({
      idempotencyKey, name, email, phone, formSlug: form.slug,
      niche: form.niche, answers, attribution,
    })
    return response({ ok: true, leadId: result.leadId, submissionId: result.submissionId,
      reused: result.reused, environment: 'preview' }, result.reused ? 200 : 201)
  } catch {
    // No user input, SQL or credentials should ever appear in logs or error responses.
    return response({ error: 'LEAD_INTAKE_UNAVAILABLE' }, 503)
  }
}
