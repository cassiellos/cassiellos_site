import { NextRequest, NextResponse } from 'next/server'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import {
  adminActorFromSession, authorizeAdminMutation, inspectStuckReservation, listStuckReservations, resolveStuckReservation,
} from '@/lib/crm/admin-actions'
import { getCrmPool } from '@/lib/crm/db'
import { readBookingEventState } from '@/lib/crm/google-calendar'
import { isCrmPreviewOrigin } from '@/lib/crm/preview-origins'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 20

const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'X-Content-Type-Options': 'nosniff' }
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
function send(value: unknown, status = 200) { return NextResponse.json(value, { status, headers }) }

/** Fase 3.4 — reservas em processamento há mais de 15 minutos (somente administradores). */
export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview') return send({ error: 'NOT_FOUND' }, 404)
  if (!verifyCrmSession(req.cookies.get(crmSessionCookieName())?.value)) return send({ error: 'UNAUTHORIZED' }, 401)
  try {
    return send({ ok: true, reservations: await listStuckReservations(getCrmPool()) })
  } catch { return send({ error: 'RESERVATIONS_UNAVAILABLE' }, 503) }
}

/**
 * inspect: confere o evento no Google (somente leitura).
 * release / adopt: exigem confirmação explícita e são decididos por uma nova
 * conferência no Google feita no servidor. Nada é apagado.
 */
export async function POST(req: NextRequest) {
  const session = req.cookies.get(crmSessionCookieName())?.value
  const denied = authorizeAdminMutation({
    vercelEnv: process.env.VERCEL_ENV, sessionValid: verifyCrmSession(session),
    originAllowed: isCrmPreviewOrigin(req.headers.get('origin')), contentType: req.headers.get('content-type'),
  })
  if (denied) return send({ error: denied.error }, denied.status)
  let data: Record<string, unknown>
  try {
    const raw = await req.text()
    if (raw.length > 1000) return send({ error: 'INVALID_REQUEST' }, 400)
    data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return send({ error: 'INVALID_REQUEST' }, 400)
  } catch { return send({ error: 'INVALID_REQUEST' }, 400) }
  const bookingId = data.bookingId
  if (typeof bookingId !== 'string' || !uuid.test(bookingId)) return send({ error: 'INVALID_RESERVATION' }, 400)
  const deps = { pool: getCrmPool(), readGoogleEvent: readBookingEventState }
  const errors: Record<string, string> = {
    not_stuck: 'RESERVATION_NOT_STUCK', google_unavailable: 'GOOGLE_UNAVAILABLE', google_state_mismatch: 'GOOGLE_STATE_MISMATCH',
  }
  try {
    if (data.action === 'inspect') {
      const r = await inspectStuckReservation(deps, { bookingId })
      return send(r.status < 300 ? { ok: true, ...r.details } : { error: errors[r.outcome] }, r.status)
    }
    if (data.action !== 'release' && data.action !== 'adopt') return send({ error: 'INVALID_ACTION' }, 400)
    if (data.confirmed !== true) return send({ error: 'CONFIRMATION_REQUIRED' }, 400)
    const r = await resolveStuckReservation(deps, {
      bookingId, decision: data.action, actor: adminActorFromSession(session || ''),
    })
    return send(r.status < 300 ? { ok: true, outcome: r.outcome } : { error: errors[r.outcome], ...r.details }, r.status)
  } catch { return send({ error: 'ACTION_FAILED' }, 503) }
}
