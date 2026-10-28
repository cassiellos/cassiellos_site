import { NextRequest, NextResponse } from 'next/server'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import {
  GOOGLE_OAUTH_FLOW_COOKIE,
  createGoogleOAuthFlow,
  googleAuthorizationUrl,
  googleOAuthConfig,
} from '@/lib/crm/google-oauth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 15

/**
 * Somente admin autenticado e apenas no hostname estável do Preview.
 * Uma autorização por vez por navegador; expira em 10 minutos.
 */
export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview' && process.env.NODE_ENV === 'production') {
    return new NextResponse(null, { status: 404 })
  }
  const session = request.cookies.get(crmSessionCookieName())?.value
  if (!verifyCrmSession(session)) {
    return NextResponse.redirect(new URL('/crm/login', request.url), 303)
  }
  const config = googleOAuthConfig()
  if (!config) return NextResponse.json(
    { error: 'GOOGLE_OAUTH_NOT_CONFIGURED' },
    { status: 503, headers: { 'Cache-Control': 'no-store' } },
  )
  if (new URL(request.url).origin !== new URL(config.redirectUri).origin) {
    return NextResponse.json(
      { error: 'USE_STABLE_PREVIEW_BRANCH_HOSTNAME' },
      { status: 400, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  const flow = createGoogleOAuthFlow()
  const response = NextResponse.redirect(googleAuthorizationUrl(config, flow), 303)
  response.cookies.set(GOOGLE_OAUTH_FLOW_COOKIE, flow.cookie, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 600,
    priority: 'high',
  })
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('Referrer-Policy', 'no-referrer')
  response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return response
}
