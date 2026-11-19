import { NextResponse, type NextRequest } from 'next/server'
import { homologPathAllowed } from './lib/crm/homolog-webhook-only'

/**
 * Portão da homologação do webhook WhatsApp (lib/crm/homolog-webhook-only.ts).
 * Inerte fora do Preview da branch crm-homolog com CRM_HOMOLOG_WEBHOOK_ONLY=true.
 */
export function middleware(request: NextRequest) {
  const env = {
    CRM_HOMOLOG_WEBHOOK_ONLY: process.env.CRM_HOMOLOG_WEBHOOK_ONLY,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
  }
  if (homologPathAllowed(env, request.nextUrl.pathname)) return NextResponse.next()
  return new NextResponse('Not found', {
    status: 404,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Content-Type': 'text/plain; charset=utf-8' },
  })
}

export const config = { matcher: '/:path*' }
