import { NextRequest, NextResponse } from 'next/server'
import { isCrmRuntimeEnabled } from '@/lib/crm/runtime-env'
import { getCrmPool } from '@/lib/crm/db'
import { sendEmail } from '@/lib/crm/comms/resend'
import { markFailure, markSent } from '@/lib/crm/comms/store'
import { authorizeSmoke, SMOKE_RECIPIENT, SMOKE_DEDUPE_KEY, SMOKE_FROM } from '@/lib/crm/comms/smoke'

/**
 * TEMPORARY, ONE-SHOT, bearer-protected production smoke test.
 * Never uses COMMS_RESEND_ENABLED and never sends to a lead.
 * Deletes itself in the follow-up cleanup PR.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const respond = (body: unknown, status: number) =>
  NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  })

export async function POST(request: NextRequest) {
  const permitted = authorizeSmoke({
    serverToken: process.env.CRM_COMMS_SMOKE_TOKEN,
    authorization: request.headers.get('authorization'),
    environment: process.env.VERCEL_ENV,
    activeAutomations: [
      process.env.COMMS_RESEND_ENABLED,
      process.env.COMMS_EMAIL_CONFIRMATION,
      process.env.COMMS_EMAIL_REMINDERS,
    ].includes('true'),
  })
  if (!isCrmRuntimeEnabled() || !permitted) return respond({ error: 'NOT_FOUND' }, 404)

  // All destinations and from-addresses are immutable. Ignore user-supplied input entirely.
  const apiKey = process.env.RESEND_API_KEY?.trim()
  if (!apiKey || process.env.RESEND_FROM?.trim() !== SMOKE_FROM)
    return respond({ error: 'SMOKE_NOT_CONFIGURED' }, 503)

  const pool = getCrmPool()
  let id: string
  try {
    const row = await pool.query<{ id: string }>(
      `INSERT INTO crm.comms_messages
        (appointment_id, channel, kind, dedupe_key, recipient_masked, status, attempts, claimed_at)
       SELECT a.id, 'email', 'confirmation', $1, 'ca***@gmail.com', 'sending', 1, now()
         FROM crm.appointments a JOIN crm.leads l ON l.id = a.lead_id
        WHERE a.is_test IS TRUE AND lower(l.email) = $2
        ORDER BY a.created_at DESC
        LIMIT 1
       ON CONFLICT (dedupe_key) DO NOTHING RETURNING id`,
      [SMOKE_DEDUPE_KEY, SMOKE_RECIPIENT],
    )
    if (!row.rows[0]) return respond({ error: 'ALREADY_USED_OR_TEST_APPOINTMENT_MISSING' }, 409)
    id = row.rows[0].id
  } catch {
    return respond({ error: 'SMOKE_DATABASE_UNAVAILABLE' }, 503)
  }

  const result = await sendEmail((url, init) => fetch(url, init), apiKey, {
    from: SMOKE_FROM,
    to: SMOKE_RECIPIENT,
    subject: 'Teste técnico de entrega | CRM Cassiellos',
    text: 'Este é um único teste autorizado da integração Resend com o CRM Cassiellos. Não há nenhuma reunião sendo marcada nem lembretes ativados.',
    html: '<p>Este é um único teste autorizado da integração <strong>Resend</strong> com o <strong>CRM Cassiellos</strong>.</p><p>Não há nenhuma reunião sendo marcada nem lembretes ativados.</p>',
    idempotencyKey: SMOKE_DEDUPE_KEY,
  })
  if (result.ok) {
    await markSent(pool, id, { providerMessageId: result.id, scheduled: false })
    console.info(JSON.stringify({ scope: 'crm_smoke_resend', event: 'accepted', messageId: id }))
    return respond({ ok: true, accepted: true, messageId: id }, 200)
  }
  const uncertain = result.status === null || result.status === 408 || (result.status !== null && result.status >= 500)
  await markFailure(pool, id, {
    error: uncertain ? 'NETWORK_OR_TIMEOUT' : result.error,
    retriable: false,
  })
  console.info(JSON.stringify({ scope: 'crm_smoke_resend', event: 'provider_rejected', status: result.status }))
  return respond({ ok: false, accepted: false, providerStatus: result.status }, 502)
}

export async function GET() {
  return respond({ error: 'METHOD_NOT_ALLOWED' }, 405)
}
