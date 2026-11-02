import { type NextRequest, NextResponse } from 'next/server'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import { withCrmReadOnlyTransaction } from '@/lib/crm/db'
import { getBookingForm } from '@/lib/crm/booking-forms'
import { isGoogleMeetUrl } from '@/lib/crm/booking-event'
import { pushRuntimeDeps } from '@/lib/crm/push/runtime'
import { loadPushSettings } from '@/lib/crm/push/store'
import { DEFAULT_WHATSAPP_TEMPLATE, renderWhatsappMessage, whatsappSendLink } from '@/lib/crm/whatsapp-message'
import { safeCrmReturnPath } from '@/lib/crm/return-path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const headers = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
}

/**
 * Destino do SEGUNDO aviso da reunião. Autentica a sessão ANTES de consultar
 * nome/telefone/link e só redireciona para wa.me com mensagem preenchida.
 * O WhatsApp jamais envia sozinho: o administrador ainda toca em Enviar.
 * Com telefone inválido, reunião inativa ou link pendente, abre a ficha.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (process.env.VERCEL_ENV !== 'preview') {
    return new NextResponse(null, { status: 404, headers })
  }

  const { id } = await params
  const fallback = UUID.test(id) ? '/crm/reuniao/' + id + '?whatsapp=1' : '/crm'
  const destination = UUID.test(id) ? '/crm/reuniao/' + id + '/whatsapp' : '/crm'
  const session = request.cookies.get(crmSessionCookieName())?.value
  if (!verifyCrmSession(session)) {
    const back = safeCrmReturnPath(destination) ?? '/crm'
    return NextResponse.redirect(new URL('/crm/login?next=' + encodeURIComponent(back), request.url), { status: 302, headers })
  }
  if (!UUID.test(id)) return NextResponse.redirect(new URL('/crm', request.url), { status: 302, headers })

  type Row = {
    status: string; ends_at: Date; starts_at: Date
    meeting_url: string | null; full_name: string | null
    company: string | null; whatsapp: string | null; form_slug: string | null
  }
  try {
    const row = await withCrmReadOnlyTransaction(async client => (await client.query<Row>(
      'SELECT a.status, a.ends_at, a.starts_at, a.meeting_url, l.full_name, l.company, l.whatsapp, ' +
      "s.answers ->> 'formSlug' AS form_slug " +
      'FROM crm.appointments a JOIN crm.leads l ON l.id = a.lead_id ' +
      'LEFT JOIN crm.booking_requests b ON b.appointment_id = a.id ' +
      'LEFT JOIN crm.form_submissions s ON s.id = b.submission_id ' +
      'WHERE a.id = $1 LIMIT 1', [id])).rows[0] ?? null)
    if (!row || !['confirmed', 'pending'].includes(row.status) || new Date(row.ends_at).getTime() <= Date.now() ||
      !isGoogleMeetUrl(row.meeting_url)) {
      return NextResponse.redirect(new URL(fallback, request.url), { status: 302, headers })
    }
    const settings = await loadPushSettings(pushRuntimeDeps().pool).catch(() => null)
    const meetingName = (row.form_slug && getBookingForm(row.form_slug)?.meetingName) || 'Reunião Cassiellos'
    const message = renderWhatsappMessage(settings?.whatsappTemplate ?? DEFAULT_WHATSAPP_TEMPLATE, {
      name: row.full_name, company: row.company, startsAt: row.starts_at, endsAt: row.ends_at,
      meetingUrl: row.meeting_url, meetingName,
    })
    const link = whatsappSendLink(row.whatsapp, message)
    if (!link.ok) return NextResponse.redirect(new URL(fallback, request.url), { status: 302, headers })
    return NextResponse.redirect(link.url, { status: 302, headers })
  } catch {
    return NextResponse.redirect(new URL(fallback, request.url), { status: 302, headers })
  }
}
