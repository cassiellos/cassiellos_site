import { NextRequest, NextResponse } from 'next/server'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import { CRM_BOOKING_TIME_ZONE, isValidBookingDate } from '@/lib/crm/booking-slots'
import { getCrmPool } from '@/lib/crm/db'
import { isOpenDate, listAvailableSlots, type AvailabilityRules } from '@/lib/crm/availability/engine'
import { loadAvailabilityRules } from '@/lib/crm/availability/store'
import { isGoogleCalendarConfigured, readGoogleBusyIntervals } from '@/lib/crm/google-calendar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 20

function json(body: unknown, status: number) {
  return NextResponse.json(body, {
    status,
    headers: { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' },
  })
}

/**
 * Leitura de disponibilidade apenas no painel autenticado em Preview.
 * Uma rota pública com proteção anti-abuso será criada quando a landing page
 * de captação estiver pronta. Nenhum dado privado do Google é retornado.
 */
export async function GET(request: NextRequest) {
  if (process.env.VERCEL_ENV !== 'preview' && process.env.NODE_ENV === 'production') {
    return json({ error: 'NOT_FOUND' }, 404)
  }
  const session = request.cookies.get(crmSessionCookieName())?.value
  if (!verifyCrmSession(session)) return json({ error: 'UNAUTHORIZED' }, 401)

  const date = request.nextUrl.searchParams.get('date') ?? ''
  if (!isValidBookingDate(date)) return json({ error: 'INVALID_DATE' }, 400)
  try {
    if (!(await isGoogleCalendarConfigured())) return json({ error: 'GOOGLE_CALENDAR_NOT_CONNECTED' }, 503)
  } catch {
    return json({ error: 'GOOGLE_CALENDAR_UNAVAILABLE' }, 502)
  }

  let rules: AvailabilityRules
  try {
    rules = await loadAvailabilityRules(getCrmPool())
  } catch {
    return json({ error: 'AVAILABILITY_UNAVAILABLE' }, 503)
  }
  const metadata = {
    date, timeZone: CRM_BOOKING_TIME_ZONE,
    slotMinutes: rules.settings.slotMinutes,
    rulesSource: rules.source,
  }
  if (!isOpenDate(date, rules)) return json({ ...metadata, slots: [], closed: true }, 200)

  try {
    const busy = await readGoogleBusyIntervals(date)
    return json({ ...metadata, slots: listAvailableSlots(date, busy, rules) }, 200)
  } catch {
    // Não revelar informações privadas, tokens ou detalhes de disponibilidade.
    return json({ error: 'GOOGLE_CALENDAR_UNAVAILABLE' }, 502)
  }
}
