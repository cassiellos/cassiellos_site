import { NextRequest, NextResponse } from 'next/server'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import {
  GOOGLE_OAUTH_FLOW_COOKIE,
  createGoogleOAuthFlow,
  googleAuthorizationUrl,
  googleOAuthConfig,
} from '@/lib/crm/google-oauth'
import { isCrmRuntimeEnabled } from '@/lib/crm/runtime-env'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 15

/**
 * Somente admin autenticado, num ambiente do CRM (lib/crm/runtime-env.ts), e apenas no mesmo host do
 * CRM_GOOGLE_REDIRECT_URI (em Production: somente crm.cassiellos.com.br).
 * Uma autorização por vez por navegador; expira em 10 minutos.
 */
export async function GET(request: NextRequest) {
  if (!isCrmRuntimeEnabled() && process.env.NODE_ENV === 'production') {
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
      { error: 'USE_CONFIGURED_REDIRECT_HOSTNAME' },
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
