import { NextRequest, NextResponse } from 'next/server'
import { getCrmPool } from '@/lib/crm/db'
import { getBookingForm } from '@/lib/crm/booking-forms'
import { createBookingGrant } from '@/lib/crm/booking-grant'
import { handleLeadIntake } from '@/lib/crm/booking-intake-request'
import { classifyNewLeadAsTest, getCrmBookingMode } from '@/lib/crm/booking-mode'
import { saveLeadSubmission } from '@/lib/crm/lead-intake'
import { CRM_CANONICAL_ORIGIN, isCrmPreviewOrigin } from '@/lib/crm/preview-origins'
import { INTAKE_LIMIT, consumeRequestQuota, requestFingerprint } from '@/lib/crm/request-limits'
import { TURNSTILE_BOOKING_ACTION, getTurnstileConfig, verifyTurnstileToken } from '@/lib/crm/turnstile'
import { activeHomologation } from '@/lib/marketing/homologation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 20

const MAX_BODY_SIZE = 12_000

function response(body: unknown, status: number) {
  return NextResponse.json(body, {
    status, headers: {
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
    },
  })
}

/** Turnstile tokens are accepted only for the CRM host (local test keys also allow localhost). */
function expectedHostnames(usingTestKeys: boolean): string[] {
  const hosts = [new URL(CRM_CANONICAL_ORIGIN).hostname]
  return usingTestKeys ? [...hosts, 'localhost', '127.0.0.1', 'example.com'] : hosts
}

export async function POST(request: NextRequest) {
  // Preview only: no production intake before integration review and approval.
  if (process.env.VERCEL_ENV !== 'preview') return response({ error: 'NOT_FOUND' }, 404)
  const origin = request.headers.get('origin')
  // Vercel may use the deployment hostname internally even when the browser uses
  // the stable Git branch alias or crm.cassiellos.com.br. Check against the allowlisted
  // Preview origins, not NextRequest.nextUrl.origin, without weakening the same-origin requirement.
  if (!isCrmPreviewOrigin(origin)) return response({ error: 'FORBIDDEN' }, 403)
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

  const forwardedFor = request.headers.get('x-vercel-forwarded-for')
  const turnstileConfig = getTurnstileConfig()
  const hostnames = expectedHostnames(turnstileConfig.status === 'ready' && turnstileConfig.usingTestKeys)
  const result = await handleLeadIntake({
    getForm: getBookingForm,
    turnstileConfig,
    expectedHostnames: hostnames,
    verifyTurnstile: ({ token, secretKey, remoteIp }) => verifyTurnstileToken({
      token, secretKey, remoteIp, expectedAction: TURNSTILE_BOOKING_ACTION, expectedHostnames: hostnames,
    }),
    consumeIpQuota: async () => {
      const fingerprint = requestFingerprint(INTAKE_LIMIT, forwardedFor)
      return fingerprint ? consumeRequestQuota(getCrmPool(), INTAKE_LIMIT, fingerprint) : false
    },
    saveLead: input => saveLeadSubmission(getCrmPool(), input),
    createGrant: createBookingGrant,
    classifyNewLeadAsTest: email => classifyNewLeadAsTest({ email }),
    bookingMode: getCrmBookingMode(),
    publicOrigin: CRM_CANONICAL_ORIGIN,
    metaHomologation: activeHomologation(request.headers.get('cookie')) !== null,
    // Reason codes only: never the token, IP, e-mail or secret.
    log: (event, details) => console.warn('[booking-leads]', event, details.reason ?? '', (details.codes ?? []).join(',')),
  }, { value, remoteIp: forwardedFor, cookieHeader: request.headers.get('cookie') })
  return response(result.body, result.status)
}
