import { NextRequest, NextResponse } from 'next/server'
import {
  GOOGLE_OAUTH_FLOW_COOKIE,
  exchangeGoogleCode,
  googleOAuthConfig,
  parseGoogleOAuthFlow,
  saveGoogleRefreshToken,
} from '@/lib/crm/google-oauth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 20

/**
 * O cookie de sessao administrativa SameSite=Strict nao acompanha o retorno
 * do Google; a autorizacao foi exigida na rota /start e este callback valida
 * o cookie temporario assinado, o state e o PKCE.
 */
export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview' && process.env.NODE_ENV === 'production') {
    return new NextResponse(null, { status: 404 })
  }
  const config = googleOAuthConfig()
  if (!config || request.nextUrl.origin !== new URL(config.redirectUri).origin) {
    return new NextResponse(null, { status: 404 })
  }

  const resultUrl = new URL('/crm', config.redirectUri)
  const finish = (status: string) => {
    resultUrl.searchParams.set('google_calendar', status)
    const response = NextResponse.redirect(resultUrl, 303)
    response.cookies.set(GOOGLE_OAUTH_FLOW_COOKIE, '', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      expires: new Date(0),
    })
    response.headers.set('Cache-Control', 'no-store')
    response.headers.set('Referrer-Policy', 'no-referrer')
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
    return response
  }

  const cookie = request.cookies.get(GOOGLE_OAUTH_FLOW_COOKIE)?.value
  const state = request.nextUrl.searchParams.get('state') ?? ''
  const flow = parseGoogleOAuthFlow(cookie, state)
  if (!flow) return finish('invalid_state')
  if (request.nextUrl.searchParams.has('error')) return finish('denied')

  const code = request.nextUrl.searchParams.get('code')
  if (!code || code.length > 2048) return finish('invalid_response')

  try {
    const result = await exchangeGoogleCode(config, code, flow.verifier)
    await saveGoogleRefreshToken(result.refreshToken, result.scopes, result.expiresAt)
    return finish('connected')
  } catch {
    // Sem logs de OAuth codes, access tokens ou refresh tokens.
    return finish('connection_failed')
  }
}
