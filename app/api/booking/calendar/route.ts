import { NextRequest, NextResponse } from 'next/server'
import { getCrmPool } from '@/lib/crm/db'
import { getBookingForm } from '@/lib/crm/booking-forms'
import { addDays } from '@/lib/crm/availability/holidays'
import { closedDates, localDate } from '@/lib/crm/availability/engine'
import { loadAvailabilityRules } from '@/lib/crm/availability/store'
import { isCrmRuntimeEnabled } from '@/lib/crm/runtime-env'

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
 * Exibe apenas datas públicas, sem dados privados nem criação de sessão.
 */
export async function GET(request: NextRequest) {
  if (!isCrmRuntimeEnabled()) return json({ error: 'NOT_FOUND' }, 404)
  const form = request.nextUrl.searchParams.get('form') ?? ''
  if (!getBookingForm(form)) return json({ error: 'INVALID_REQUEST' }, 400)
  try {
    const rules = await loadAvailabilityRules(getCrmPool())
    const now = new Date()
    const today = localDate(now)
    return json({ today, lastDate: addDays(today, rules.settings.windowDays), closedDates: closedDates(rules, now) }, 200)
  } catch {
    return json({ error: 'AVAILABILITY_UNAVAILABLE' }, 503)
  }
}
