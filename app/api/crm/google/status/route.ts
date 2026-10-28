import { NextRequest, NextResponse } from 'next/server'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import { getGoogleOAuthConnectionStatus } from '@/lib/crm/google-oauth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 15

export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview' && process.env.NODE_ENV === 'production') {
    return new NextResponse(null, { status: 404 })
  }
  if (!verifyCrmSession(request.cookies.get(crmSessionCookieName())?.value)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401, headers: { 'Cache-Control': 'no-store' } })
  }
  try {
    const status = await getGoogleOAuthConnectionStatus()
    return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } })
  } catch {
    return NextResponse.json({ error: 'INTEGRATION_STATUS_UNAVAILABLE' }, {
      status: 503, headers: { 'Cache-Control': 'no-store' },
    })
  }
}
