import { NextResponse } from 'next/server'
import { SERVICE_WORKER_SOURCE } from '@/lib/crm/push/service-worker'

export const dynamic = 'force-static'

/** Service worker do PWA SHARK SCALE (escopo /crm). Sem cache: atualização verificada a cada abertura. */
export function GET() {
  if (process.env.VERCEL_ENV !== 'preview' && process.env.NODE_ENV === 'production') return new NextResponse(null, { status: 404 })
  return new NextResponse(SERVICE_WORKER_SOURCE, {
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'no-cache, max-age=0',
      'Service-Worker-Allowed': '/crm',
      'X-Robots-Tag': 'noindex',
    },
  })
}
