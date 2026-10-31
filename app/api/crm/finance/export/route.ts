import { NextRequest, NextResponse } from 'next/server'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import { adminActorFromSession } from '@/lib/crm/admin-actions'
import { getCrmPool, isCrmDatabaseConfigured } from '@/lib/crm/db'
import { handleFinanceExport } from '@/lib/crm/finance/admin-request'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** Exportação CSV do Financeiro — SOMENTE Preview + sessão administrativa; download privado, sem cache. */
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' }

export async function GET(req: NextRequest) {
  const session = req.cookies.get(crmSessionCookieName())?.value
  const sessionValid = verifyCrmSession(session)
  if (process.env.VERCEL_ENV === 'preview' && sessionValid && !isCrmDatabaseConfigured()) {
    return NextResponse.json({ error: 'DATABASE_NOT_CONFIGURED' }, { status: 503, headers })
  }
  const result = await handleFinanceExport({ pool: { connect: () => getCrmPool().connect() } }, {
    method: 'GET', vercelEnv: process.env.VERCEL_ENV, sessionValid, originAllowed: false, contentType: null,
    searchParams: req.nextUrl.searchParams, actorRef: adminActorFromSession(session || '').sessionRef,
  })
  if ('csv' in result) {
    return new NextResponse(result.csv, { status: 200, headers: { ...headers, 'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${result.filename}"`, 'X-Content-Type-Options': 'nosniff' } })
  }
  return NextResponse.json(result.body, { status: result.status, headers })
}
