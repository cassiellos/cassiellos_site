import { NextRequest, NextResponse } from 'next/server'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import { readNeonUsage } from '@/lib/crm/neon-usage-server'
import { isCrmRuntimeEnabled } from '@/lib/crm/runtime-env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 15

const headers = {
  'Cache-Control': 'private, no-store',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
}

export async function GET(request: NextRequest) {
  // Only in the CRM environments (lib/crm/runtime-env.ts); never on the institutional site's production (main).
  if (!isCrmRuntimeEnabled()) {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404, headers })
  }
  const session = request.cookies.get(crmSessionCookieName())?.value
  if (!verifyCrmSession(session)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401, headers })
  }
  // Manual refresh from the sidebar button; server throttles it to one Neon call per minute.
  const manual = request.nextUrl.searchParams.get('refresh') === '1'
  const result = await readNeonUsage({ manual })
  return NextResponse.json(result, { status: 200, headers })
}
