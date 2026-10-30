import { NextRequest, NextResponse } from 'next/server'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import { adminActorFromSession } from '@/lib/crm/admin-actions'
import { isCrmPreviewOrigin } from '@/lib/crm/preview-origins'
import { handlePushAdmin } from '@/lib/crm/push/admin-request'
import { publicPushEnv } from '@/lib/crm/push/config'
import { pushRuntimeDeps } from '@/lib/crm/push/runtime'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Painel "Notificações" (lib/crm/push/admin-request.ts) — SOMENTE Preview, sessão administrativa.
 * GET: estado (sem chave privada nem endpoints completos). POST { action, ... }: inscrever/revogar aparelho,
 * teste, preferências, modelo do WhatsApp e reprocessamento. Log: só a referência não reversível da sessão.
 */
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' }

async function handle(req: NextRequest, method: 'GET' | 'POST') {
  const session = req.cookies.get(crmSessionCookieName())?.value
  const result = await handlePushAdmin({ ...pushRuntimeDeps(), envStatus: publicPushEnv }, {
    method,
    vercelEnv: process.env.VERCEL_ENV,
    sessionValid: verifyCrmSession(session),
    originAllowed: isCrmPreviewOrigin(req.headers.get('origin')),
    contentType: req.headers.get('content-type'),
    rawBody: method === 'POST' ? await req.text().catch(() => '') : undefined,
    actorRef: adminActorFromSession(session || '').sessionRef,
  })
  return NextResponse.json(result.body, { status: result.status, headers })
}

export function GET(req: NextRequest) { return handle(req, 'GET') }
export function POST(req: NextRequest) { return handle(req, 'POST') }
