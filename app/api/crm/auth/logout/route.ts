import { NextRequest, NextResponse } from 'next/server'
import { crmSessionCookieName } from '@/lib/crm/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (process.env.VERCEL_ENV !== 'preview' && process.env.NODE_ENV !== 'development') {
    return new NextResponse(null, { status: 404 })
  }
  if (request.headers.get('origin') !== new URL(request.url).origin) {
    return new NextResponse(null, { status: 403, headers: { 'Cache-Control': 'no-store' } })
  }
  const response = NextResponse.redirect(new URL('/crm/login', request.url), 303)
  response.cookies.set(crmSessionCookieName(), '', {
    path: '/',
    maxAge: 0,
    expires: new Date(0),
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
