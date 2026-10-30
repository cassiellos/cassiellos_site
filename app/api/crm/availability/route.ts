import { NextRequest, NextResponse } from 'next/server'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import { getCrmPool } from '@/lib/crm/db'
import { isCrmPreviewOrigin } from '@/lib/crm/preview-origins'
import { adminActorFromSession } from '@/lib/crm/admin-actions'
import { availabilityOverview, handleAvailabilityAction, type MeetingInterval } from '@/lib/crm/availability/admin'
import { loadAvailabilityRules } from '@/lib/crm/availability/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' }
function send(value: unknown, status = 200) { return NextResponse.json(value, { status, headers }) }
function session(req: NextRequest) { return req.cookies.get(crmSessionCookieName())?.value }

/** Seção DISPONIBILIDADE (somente Preview, sessão administrativa). */
export async function GET(req: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview') return send({ error: 'NOT_FOUND' }, 404)
  if (!verifyCrmSession(session(req))) return send({ error: 'UNAUTHORIZED' }, 401)
  try {
    const pool = getCrmPool()
    const rules = await loadAvailabilityRules(pool)
    // Somente leitura: reuniões ativas dos próximos dias, para avisar quando uma reserva interna coincide
    // com reunião já confirmada (a reunião é sempre mantida).
    const active = await pool.query<{ starts_at: Date; ends_at: Date }>(
      `SELECT starts_at, ends_at FROM crm.booking_requests
        WHERE status IN ('processing', 'confirmed') AND ends_at > now() AND starts_at < now() + interval '31 days'`)
    const meetings: MeetingInterval[] = active.rows.map(r => ({
      startsAt: new Date(r.starts_at).toISOString(), endsAt: new Date(r.ends_at).toISOString(),
    }))
    return send({ ok: true, ...availabilityOverview(rules, new Date(), meetings) })
  } catch {
    return send({ error: 'AVAILABILITY_UNAVAILABLE' }, 503)
  }
}

export async function POST(req: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview') return send({ error: 'NOT_FOUND' }, 404)
  if (!verifyCrmSession(session(req))) return send({ error: 'UNAUTHORIZED' }, 401)
  if (!isCrmPreviewOrigin(req.headers.get('origin'))) return send({ error: 'FORBIDDEN' }, 403)
  if (!req.headers.get('content-type')?.startsWith('application/json')) return send({ error: 'INVALID_REQUEST' }, 400)
  let data: Record<string, unknown>
  try {
    const raw = await req.text()
    if (raw.length > 2000) return send({ error: 'INVALID_REQUEST' }, 400)
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return send({ error: 'INVALID_REQUEST' }, 400)
    data = parsed as Record<string, unknown>
  } catch { return send({ error: 'INVALID_REQUEST' }, 400) }
  const actor = 'crm_admin:' + adminActorFromSession(session(req) || '').sessionRef
  const result = await handleAvailabilityAction(getCrmPool(), data, actor)
  return send(result.body, result.status)
}
