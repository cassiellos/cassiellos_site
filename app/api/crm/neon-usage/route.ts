import { NextRequest, NextResponse } from 'next/server'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import { readNeonUsage } from '@/lib/crm/neon-usage-server'

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
  // Never enable the administrative Neon API integration on the main production branch.
  if (process.env.VERCEL_ENV !== 'preview') {
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
