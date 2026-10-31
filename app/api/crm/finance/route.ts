import { NextRequest, NextResponse } from 'next/server'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import { adminActorFromSession } from '@/lib/crm/admin-actions'
import { getCrmPool, isCrmDatabaseConfigured } from '@/lib/crm/db'
import { handleFinanceAdmin } from '@/lib/crm/finance/admin-request'
import { isCrmPreviewOrigin } from '@/lib/crm/preview-origins'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * FINANCEIRO (lib/crm/finance/admin-request.ts) — SOMENTE Preview, sessão administrativa.
 * GET ?month=AAAA-MM&client=&category=&source= → visão geral, listas e relatórios do mês.
 * POST { action, ... } → cadastros, recebimentos/pagamentos (idempotentes), estornos, cancelamentos e NF.
 * Respostas privadas e sem cache; nada financeiro vai para logs.
 */
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' }

async function handle(req: NextRequest, method: 'GET' | 'POST') {
  const session = req.cookies.get(crmSessionCookieName())?.value
  const sessionValid = verifyCrmSession(session)
  if (process.env.VERCEL_ENV === 'preview' && sessionValid && !isCrmDatabaseConfigured()) {
    return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503, headers })
  }
  const result = await handleFinanceAdmin({ pool: { connect: () => getCrmPool().connect() } }, {
    method, vercelEnv: process.env.VERCEL_ENV, sessionValid,
    originAllowed: isCrmPreviewOrigin(req.headers.get('origin')), contentType: req.headers.get('content-type'),
    rawBody: method === 'POST' ? await req.text().catch(() => '') : undefined,
    searchParams: req.nextUrl.searchParams,
    actorRef: adminActorFromSession(session || '').sessionRef,
  })
  return NextResponse.json(result.body, { status: result.status, headers })
}

export const GET = (req: NextRequest) => handle(req, 'GET')
export const POST = (req: NextRequest) => handle(req, 'POST')
