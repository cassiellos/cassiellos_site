import { NextRequest, NextResponse } from 'next/server'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import { isCrmPreviewOrigin } from '@/lib/crm/preview-origins'
import { adminActorFromSession } from '@/lib/crm/admin-actions'
import {
  HOMOLOGATION_MAX_MINUTES, activeHomologation, getHomologationConfig, homologationCookieName, issueHomologationGrant,
} from '@/lib/marketing/homologation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Homologação do Meta Pixel (lib/marketing/homologation.ts) — SOMENTE Preview, sessão administrativa.
 * GET: estado. POST { confirmed: true, minutes?, scope? }: libera ESTE navegador por até 30 min. DELETE: encerra.
 * scope "chronos": somente os eventos personalizados da jornada (sem Lead/Schedule de teste).
 * O registro (log do servidor) leva só a referência não reversível da sessão e o horário — nunca o cookie.
 */
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' }
function send(value: unknown, status = 200) { return NextResponse.json(value, { status, headers }) }
function session(req: NextRequest) { return req.cookies.get(crmSessionCookieName())?.value }
function audit(event: string, details: Record<string, unknown>) {
  console.info(JSON.stringify({ scope: 'meta_homologation', event, ...details }))
}

function guard(req: NextRequest, mutating: boolean): NextResponse | null {
  if (process.env.VERCEL_ENV !== 'preview') return send({ error: 'NOT_FOUND' }, 404)
  if (!verifyCrmSession(session(req))) return send({ error: 'UNAUTHORIZED' }, 401)
  if (mutating && !isCrmPreviewOrigin(req.headers.get('origin'))) return send({ error: 'FORBIDDEN' }, 403)
  return null
}

export async function GET(req: NextRequest) {
  const blocked = guard(req, false)
  if (blocked) return blocked
  const available = getHomologationConfig() !== null
  const active = activeHomologation(req.headers.get('cookie'))
  return send({ ok: true, available, active: Boolean(active), expiresAt: active?.expiresAt ?? null,
    scope: active?.scope ?? null, maxMinutes: HOMOLOGATION_MAX_MINUTES })
}

export async function POST(req: NextRequest) {
  const blocked = guard(req, true)
  if (blocked) return blocked
  if (!getHomologationConfig()) return send({ error: 'HOMOLOGATION_UNAVAILABLE' }, 409)
  let data: { confirmed?: unknown; minutes?: unknown; scope?: unknown }
  try {
    const raw = await req.text()
    if (raw.length > 500) return send({ error: 'INVALID_REQUEST' }, 400)
    data = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return send({ error: 'INVALID_REQUEST' }, 400)
  } catch { return send({ error: 'INVALID_REQUEST' }, 400) }
  if (data.confirmed !== true) return send({ error: 'CONFIRMATION_REQUIRED' }, 400)
  if (data.scope !== undefined && data.scope !== 'conversions' && data.scope !== 'chronos') return send({ error: 'INVALID_REQUEST' }, 400)
  const scope = data.scope === 'chronos' ? 'chronos' : 'conversions'
  const actorRef = adminActorFromSession(session(req) || '').sessionRef
  let issued
  try {
    issued = issueHomologationGrant(process.env.CRM_SESSION_SECRET, {
      minutes: typeof data.minutes === 'number' ? data.minutes : HOMOLOGATION_MAX_MINUTES, actorRef, scope,
    })
  } catch { return send({ error: 'HOMOLOGATION_UNAVAILABLE' }, 409) }
  audit('enabled', { actorRef, expiresAt: issued.grant.expiresAt, homologationScope: scope })
  const res = send({ ok: true, active: true, expiresAt: issued.grant.expiresAt, scope })
  res.cookies.set(homologationCookieName(), issued.token, {
    httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: issued.maxAgeSeconds,
  })
  return res
}

export async function DELETE(req: NextRequest) {
  const blocked = guard(req, true)
  if (blocked) return blocked
  audit('disabled', { actorRef: adminActorFromSession(session(req) || '').sessionRef })
  const res = send({ ok: true, active: false })
  res.cookies.set(homologationCookieName(), '', { httpOnly: true, secure: true, sameSite: 'strict', path: '/', maxAge: 0 })
  return res
}
