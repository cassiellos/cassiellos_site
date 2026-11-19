import { NextRequest, NextResponse } from 'next/server'
import { verifyBookingGrant } from '@/lib/crm/booking-grant'
import { getCrmPool } from '@/lib/crm/db'
import { isCrmPreviewOrigin } from '@/lib/crm/preview-origins'
import { isCrmRuntimeEnabled } from '@/lib/crm/runtime-env'
import { readWhatsappConfig } from '@/lib/crm/comms/config'
import { buildLeadWhatsappLink } from '@/lib/crm/comms/whatsapp-lead'
import { appointmentForSession, ensureWhatsappReference } from '@/lib/crm/comms/store'

/**
 * Modo A — link do WhatsApp da reunião recém-confirmada (o LEAD abre conversa com a Cassiellos).
 *
 * Rota separada de propósito: a confirmação da reunião (/api/booking/confirm) não ganha nenhuma
 * consulta nova no caminho crítico. A referência pública só é criada quando o navegador realmente
 * pede o botão, e só para quem tem a sessão assinada daquela inscrição.
 *
 * Com COMMS_WHATSAPP_BUTTON desligada ou sem número comercial válido: 404, e a interface
 * simplesmente não mostra o botão. Nada aqui envia mensagem: devolve uma URL wa.me.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

export async function POST(request: NextRequest) {
  if (!isCrmRuntimeEnabled()) return json({ error: 'NOT_FOUND' }, 404)
  const config = readWhatsappConfig()
  if (!config.buttonReady) return json({ error: 'WHATSAPP_BUTTON_DISABLED' }, 404)
  if (!isCrmPreviewOrigin(request.headers.get('origin'))) return json({ error: 'FORBIDDEN' }, 403)
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return json({ error: 'INVALID_REQUEST' }, 400)

  let data: { bookingToken?: unknown; bookingRequestId?: unknown }
  try {
    const raw = await request.text()
    if (raw.length > 2_000) return json({ error: 'INVALID_REQUEST' }, 400)
    data = JSON.parse(raw)
    if (!data || typeof data !== 'object') return json({ error: 'INVALID_REQUEST' }, 400)
  } catch { return json({ error: 'INVALID_REQUEST' }, 400) }

  const session = verifyBookingGrant(data.bookingToken)
  if (!session) return json({ error: 'BOOKING_SESSION_EXPIRED' }, 401)
  const bookingRequestId = data.bookingRequestId
  if (typeof bookingRequestId !== 'string' || !UUID.test(bookingRequestId))
    return json({ error: 'INVALID_REQUEST' }, 400)

  try {
    const pool = getCrmPool()
    const appointment = await appointmentForSession(pool, {
      bookingRequestId, leadId: session.leadId, submissionId: session.submissionId,
    })
    if (!appointment) return json({ error: 'MEETING_NOT_FOUND' }, 404)

    const reference = await ensureWhatsappReference(pool, appointment.appointmentId)
    if (!reference) return json({ error: 'REFERENCE_UNAVAILABLE' }, 503)

    const link = buildLeadWhatsappLink(config.businessPhone, reference, appointment.startAt)
    if (!link.ok) return json({ error: link.reason }, 503)
    // `status` é sempre "aguardando o lead": clicar não é enviar, e só o webhook oficial do Modo B
    // poderá dizer que a mensagem chegou.
    return json({ ok: true, url: link.url, reference, status: 'awaiting_lead' }, 200)
  } catch {
    return json({ error: 'WHATSAPP_LINK_UNAVAILABLE' }, 503)
  }
}
