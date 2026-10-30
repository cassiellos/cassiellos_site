import { NextRequest, NextResponse } from 'next/server'
import { safeCrmReturnPath } from '@/lib/crm/return-path'
import { CRM_SESSION_MAX_AGE, crmSessionCookieName, getCrmClientIp, isCrmAuthConfigured, issueCrmSession, reserveCrmLoginAttempt, resetCrmLoginAttempts, verifyAdminCredentials } from '@/lib/crm/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 15

function loginRedirect(request: NextRequest, error: string, next: string | null = null): NextResponse {
  const response = NextResponse.redirect(new URL('/crm/login?error=' + error + (next ? '&next=' + encodeURIComponent(next) : ''), request.url), 303)
  response.headers.set('Cache-Control', 'no-store')
  response.headers.set('X-Robots-Tag', 'noindex, nofollow')
  return response
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (process.env.VERCEL_ENV !== 'preview' && process.env.NODE_ENV !== 'development') {
    return new NextResponse(null, { status: 404 })
  }

  const origin = request.headers.get('origin')
  // Prevent cross-site login CSRF; only accept a real same-origin browser form.
  if (!origin || origin !== new URL(request.url).origin) {
    return new NextResponse(null, { status: 403, headers: { 'Cache-Control': 'no-store' } })
  }
  const length = Number(request.headers.get('content-length') ?? 0)
  if (!Number.isFinite(length) || length > 4096) {
    return new NextResponse(null, { status: 413, headers: { 'Cache-Control': 'no-store' } })
  }

  if (!isCrmAuthConfigured()) return loginRedirect(request, 'setup')
  let username: FormDataEntryValue | null
  let password: FormDataEntryValue | null
  let next: string | null = null
  try {
    const data = await request.formData()
    username = data.get('username')
    password = data.get('password')
    // Retorno seguro após o login (somente caminhos internos do CRM).
    next = safeCrmReturnPath(data.get('next'))
  } catch {
    return loginRedirect(request, 'invalid')
  }
  if (typeof username !== 'string' || typeof password !== 'string' ||
      username.length > 100 || password.length > 256) {
    return loginRedirect(request, 'invalid', next)
  }

  const ip = getCrmClientIp(request.headers)
  try {
    if (!(await reserveCrmLoginAttempt(ip))) return loginRedirect(request, 'locked', next)
    const valid = await verifyAdminCredentials(username, password)
    if (!valid) return loginRedirect(request, 'invalid', next)
    await resetCrmLoginAttempts(ip)

    const response = NextResponse.redirect(new URL(next ?? '/crm', request.url), 303)
    response.cookies.set(crmSessionCookieName(), issueCrmSession(), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: CRM_SESSION_MAX_AGE,
      priority: 'high',
    })
    response.headers.set('Cache-Control', 'no-store')
    response.headers.set('X-Robots-Tag', 'noindex, nofollow')
    return response
  } catch {
    // Database errors must fail closed, without reporting connection details.
    return loginRedirect(request, 'unavailable', next)
  }
}
