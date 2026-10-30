import { NextRequest, NextResponse } from 'next/server'
import { getCrmPool } from '@/lib/crm/db'
import { getBookingForm } from '@/lib/crm/booking-forms'
import { verifyBookingGrant } from '@/lib/crm/booking-grant'
import { addDays } from '@/lib/crm/availability/holidays'
import { closedDates, localDate } from '@/lib/crm/availability/engine'
import { loadAvailabilityRules } from '@/lib/crm/availability/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' },
  })
}

/**
 * Dias fechados da janela pública (feriados, políticas, bloqueios, fim de semana, antecedência).
 * Só datas: nenhum motivo de bloqueio, nenhum dado do Google e nenhuma chamada ao Google.
 * Exige a sessão de agendamento (emitida após o Turnstile), como a consulta de horários.
 */
export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview') return json({ error: 'NOT_FOUND' }, 404)
  const form = request.nextUrl.searchParams.get('form') ?? ''
  if (!getBookingForm(form)) return json({ error: 'INVALID_REQUEST' }, 400)
  const session = verifyBookingGrant(request.headers.get('x-booking-session'))
  if (!session || session.formSlug !== form) return json({ error: 'BOOKING_SESSION_EXPIRED' }, 401)
  try {
    const rules = await loadAvailabilityRules(getCrmPool())
    const now = new Date()
    const today = localDate(now)
    return json({ today, lastDate: addDays(today, rules.settings.windowDays), closedDates: closedDates(rules, now) }, 200)
  } catch {
    return json({ error: 'AVAILABILITY_UNAVAILABLE' }, 503)
  }
}
