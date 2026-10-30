import { NextRequest, NextResponse } from 'next/server'
import { verifyBookingGrant } from '@/lib/crm/booking-grant'
import { handleMarketingConsentChange } from '@/lib/crm/booking-consent-request'
import { getCrmPool } from '@/lib/crm/db'
import { isCrmPreviewOrigin } from '@/lib/crm/preview-origins'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(data: unknown, status: number) {
  return NextResponse.json(data, {
    status, headers: {
      'Cache-Control': 'private, no-store',
      'X-Robots-Tag': 'noindex, nofollow',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

/**
 * PREVIEW ONLY. Registra no CRM a mudança de "Preferências de cookies" (marketing) feita
 * depois do envio do formulário, enquanto a página do agendamento está aberta.
 * Não ativa o Meta Pixel nem envia nada à Meta.
 */
export async function POST(request: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview') return json({ error: 'NOT_FOUND' }, 404)
  if (!isCrmPreviewOrigin(request.headers.get('origin'))) return json({ error: 'FORBIDDEN' }, 403)
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return json({ error: 'INVALID_REQUEST' }, 400)
  let data: { bookingToken?: unknown; marketing?: unknown }
  try {
    const raw = await request.text()
    if (raw.length > 2_000) return json({ error: 'INVALID_REQUEST' }, 400)
    data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return json({ error: 'INVALID_REQUEST' }, 400)
  } catch { return json({ error: 'INVALID_REQUEST' }, 400) }
  const result = await handleMarketingConsentChange(
    { pool: getCrmPool(), verifySession: verifyBookingGrant },
    { bookingToken: data.bookingToken, marketing: data.marketing },
  )
  return json(result.body, result.status)
}
