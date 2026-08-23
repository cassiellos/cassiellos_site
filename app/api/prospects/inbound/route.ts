import { createHmac } from 'node:crypto'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BODY_BYTES = 64 * 1024
const UPSTREAM_TIMEOUT_MS = 10_000

const LIMITS = {
  name: 100,
  role: 100,
  whatsapp: 40,
  email: 254,
  company: 150,
  segment: 150,
  location: 150,
  website_or_instagram: 500,
  main_challenge: 1500,
  success_definition: 1500,
  additional_context: 2000,
  request_token: 160,
  page_url: 2048,
  utm: 200,
} as const

type Input = Record<string, unknown>

type ValidationResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; fields: Record<string, string> }

function text(input: Input, key: string, max: number) {
  const value = typeof input[key] === 'string' ? input[key].trim() : ''
  return value.length <= max ? value : value.slice(0, max + 1)
}

function list(input: Input, key: string) {
  if (!Array.isArray(input[key])) return []
  return input[key]
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20)
    .map((item) => item.slice(0, 180))
}

function normalizeWhatsapp(raw: string) {
  const trimmed = raw.trim()
  const hasPlus = trimmed.startsWith('+')
  const digits = trimmed.replace(/\D/g, '')
  return `${hasPlus ? '+' : ''}${digits}`
}

function validate(input: Input): ValidationResult {
  const fields: Record<string, string> = {}
  const name = text(input, 'name', LIMITS.name)
  const role = text(input, 'role', LIMITS.role)
  const whatsappRaw = text(input, 'whatsapp', LIMITS.whatsapp)
  const email = text(input, 'email', LIMITS.email)
  const company = text(input, 'company', LIMITS.company)
  const segment = text(input, 'segment', LIMITS.segment)
  const location = text(input, 'location', LIMITS.location)
  const websiteOrInstagram = text(input, 'website_or_instagram', LIMITS.website_or_instagram)
  const mainChallenge = text(input, 'main_challenge', LIMITS.main_challenge)
  const successDefinition = text(input, 'success_definition', LIMITS.success_definition)
  const additionalContext = text(input, 'additional_context', LIMITS.additional_context)
  const requestToken = text(input, 'request_token', LIMITS.request_token)
  const goals = list(input, 'goals')
  const marketingSetup = list(input, 'marketing_setup')
  const channels = list(input, 'channels')
  const privacyConsent = input.privacy_consent === true
  const whatsappNormalized = normalizeWhatsapp(whatsappRaw)
  const whatsappDigits = whatsappNormalized.replace(/\D/g, '')

  if (!name || name.length > LIMITS.name) fields.name = 'INVALID'
  if (!whatsappRaw || whatsappRaw.length > LIMITS.whatsapp || whatsappDigits.length < 6 || whatsappDigits.length > 20) fields.whatsapp = 'INVALID'
  if (!company || company.length > LIMITS.company) fields.company = 'INVALID'
  if (!segment || segment.length > LIMITS.segment) fields.segment = 'INVALID'
  if (!location || location.length > LIMITS.location) fields.location = 'INVALID'
  if (goals.length < 1) fields.goals = 'INVALID'
  if (!mainChallenge || mainChallenge.length > LIMITS.main_challenge) fields.main_challenge = 'INVALID'
  if (!successDefinition || successDefinition.length > LIMITS.success_definition) fields.success_definition = 'INVALID'
  if (!privacyConsent) fields.privacy_consent = 'INVALID'
  if (!requestToken || requestToken.length > LIMITS.request_token) fields.request_token = 'INVALID'
  if (email && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > LIMITS.email)) fields.email = 'INVALID'
  if (role.length > LIMITS.role) fields.role = 'INVALID'
  if (websiteOrInstagram.length > LIMITS.website_or_instagram) fields.website_or_instagram = 'INVALID'
  if (additionalContext.length > LIMITS.additional_context) fields.additional_context = 'INVALID'

  if (Object.keys(fields).length) return { ok: false, fields }

  return {
    ok: true,
    data: {
      request_token: requestToken,
      name,
      role,
      whatsapp_raw: whatsappRaw,
      whatsapp_normalized: whatsappNormalized,
      email,
      company,
      segment,
      location,
      website_or_instagram: websiteOrInstagram,
      goals,
      main_challenge: mainChallenge,
      marketing_setup: marketingSetup,
      channels,
      success_definition: successDefinition,
      investment_range: text(input, 'investment_range', 100),
      start_timing: text(input, 'start_timing', 100),
      additional_context: additionalContext,
      privacy_consent: true,
    },
  }
}

function stableSubmissionId(requestToken: string, secret: string) {
  const hex = createHmac('sha256', secret).update(`website_form:${requestToken}`).digest('hex').slice(0, 32)
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`
}

function safeMeta(input: Input, key: string, max: number) {
  return typeof input[key] === 'string' ? input[key].trim().slice(0, max) : ''
}

export async function POST(request: Request) {
  const requestId = globalThis.crypto.randomUUID()
  const contentLength = Number(request.headers.get('content-length') || 0)
  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, effect: 'NO_WRITE', error: 'PAYLOAD_TOO_LARGE', request_id: requestId }, { status: 413 })
  }

  let raw = ''
  try {
    raw = await request.text()
  } catch {
    return NextResponse.json({ ok: false, effect: 'NO_WRITE', error: 'INVALID_BODY', request_id: requestId }, { status: 400 })
  }

  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return NextResponse.json({ ok: false, effect: 'NO_WRITE', error: 'PAYLOAD_TOO_LARGE', request_id: requestId }, { status: 413 })
  }

  let input: Input
  try {
    input = JSON.parse(raw) as Input
  } catch {
    return NextResponse.json({ ok: false, effect: 'NO_WRITE', error: 'INVALID_JSON', request_id: requestId }, { status: 400 })
  }

  if (typeof input.company_website_confirm === 'string' && input.company_website_confirm.trim()) {
    return NextResponse.json({ ok: true, effect: 'COMPLETE', submission_id: 'accepted', prospect_id: 'accepted' })
  }

  const validation = validate(input)
  if (!validation.ok) {
    return NextResponse.json({ ok: false, effect: 'NO_WRITE', error: 'VALIDATION_FAILED', fields: validation.fields, request_id: requestId }, { status: 422 })
  }

  const webhookUrl = process.env.N8N_PROSPECT_INBOUND_WEBHOOK_URL
  const webhookSecret = process.env.N8N_PROSPECT_INBOUND_WEBHOOK_SECRET
  if (!webhookUrl || !webhookSecret) {
    return NextResponse.json({ ok: false, effect: 'NO_WRITE', error: 'INTEGRATION_NOT_CONFIGURED', request_id: requestId }, { status: 503 })
  }

  const now = new Date().toISOString()
  const locale = input.locale === 'en' ? 'en' : 'pt'
  const submissionId = stableSubmissionId(String(validation.data.request_token), webhookSecret)
  const body = {
    ...validation.data,
    request_token: undefined,
    submission_id: submissionId,
    source: 'website_form',
    status: 'NEW_INBOUND',
    created_at: now,
    updated_at: now,
    privacy_consent_at: now,
    locale,
    page_url: safeMeta(input, 'page_url', LIMITS.page_url),
    referrer: (request.headers.get('referer') || '').slice(0, LIMITS.page_url),
    utm_source: safeMeta(input, 'utm_source', LIMITS.utm),
    utm_medium: safeMeta(input, 'utm_medium', LIMITS.utm),
    utm_campaign: safeMeta(input, 'utm_campaign', LIMITS.utm),
    utm_content: safeMeta(input, 'utm_content', LIMITS.utm),
    utm_term: safeMeta(input, 'utm_term', LIMITS.utm),
    notification_email: process.env.CONTACT_NOTIFICATION_EMAIL || 'cassiellosagencia@gmail.com',
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS)

  try {
    const upstream = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CassiellOS-Key': webhookSecret,
        'X-Cassiellos-Submission-Id': submissionId,
      },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: controller.signal,
    })

    const result = await upstream.json().catch(() => null) as Record<string, unknown> | null
    const complete = upstream.ok
      && result?.ok === true
      && result?.effect === 'COMPLETE'
      && result?.submission_id === submissionId
      && typeof result?.prospect_id === 'string'
      && result.prospect_id.length > 0

    if (!complete) {
      return NextResponse.json({ ok: false, effect: 'NO_WRITE', error: 'UPSTREAM_NO_WRITE', submission_id: submissionId, request_id: requestId }, { status: 502 })
    }

    return NextResponse.json({
      ok: true,
      effect: 'COMPLETE',
      submission_id: submissionId,
      prospect_id: result.prospect_id,
      notification_email_status: result.notification_email_status || 'UNKNOWN',
    })
  } catch (error) {
    const timedOut = error instanceof Error && error.name === 'AbortError'
    return NextResponse.json({ ok: false, effect: 'NO_WRITE', error: timedOut ? 'UPSTREAM_TIMEOUT' : 'UPSTREAM_UNAVAILABLE', submission_id: submissionId, request_id: requestId }, { status: timedOut ? 504 : 502 })
  } finally {
    clearTimeout(timeout)
  }
}
