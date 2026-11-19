import { NextRequest, NextResponse } from 'next/server'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import { adminActorFromSession } from '@/lib/crm/admin-actions'
import { getCrmPool } from '@/lib/crm/db'
import { isCrmPreviewOrigin } from '@/lib/crm/preview-origins'
import { isCrmRuntimeEnabled } from '@/lib/crm/runtime-env'
import { publicCommsStatus, readEmailConfig } from '@/lib/crm/comms/config'
import { claimForSend, listForAppointment, requeueForResend } from '@/lib/crm/comms/store'
import { deliverMessage } from '@/lib/crm/comms/send'

/**
 * Histórico de comunicações de UMA reunião, para a ficha em /crm/reuniao/[id].
 *
 * GET  ?appointmentId=… → estado das mensagens + situação das chaves gerais (sem segredo nenhum).
 * POST { action: 'resend', messageId } → recoloca na fila UMA mensagem de e-mail que falhou,
 *        foi pulada ou cancelada, e tenta entregar na hora.
 *
 * O reenvio continua idempotente do lado da Resend? Não: por isso ele zera o provider_message_id e
 * conta como um envio novo para as travas do plano gratuito. Só é permitido a partir de um estado
 * final que NÃO foi entregue, nunca para duplicar algo que saiu. Mensagem de WhatsApp não é
 * reenviável por aqui: responder de novo incomoda o lead e pode custar.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const headers = { 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' }
const json = (data: unknown, status: number) => NextResponse.json(data, { status, headers })

function session(request: NextRequest): { ok: boolean; actorRef: string } {
  const cookie = request.cookies.get(crmSessionCookieName())?.value
  return { ok: verifyCrmSession(cookie), actorRef: adminActorFromSession(cookie || '').sessionRef }
}

export async function GET(request: NextRequest) {
  if (!isCrmRuntimeEnabled()) return json({ error: 'NOT_FOUND' }, 404)
  if (!session(request).ok) return json({ error: 'UNAUTHORIZED' }, 401)
  const appointmentId = request.nextUrl.searchParams.get('appointmentId') ?? ''
  if (!UUID.test(appointmentId)) return json({ error: 'INVALID_REQUEST' }, 400)
  try {
    return json({ ok: true, status: publicCommsStatus(), messages: await listForAppointment(getCrmPool(), appointmentId) }, 200)
  } catch {
    return json({ error: 'COMMS_UNAVAILABLE' }, 503)
  }
}

export async function POST(request: NextRequest) {
  if (!isCrmRuntimeEnabled()) return json({ error: 'NOT_FOUND' }, 404)
  const actor = session(request)
  if (!actor.ok) return json({ error: 'UNAUTHORIZED' }, 401)
  // Origem conferida só na escrita, como nas demais rotas administrativas.
  if (!isCrmPreviewOrigin(request.headers.get('origin'))) return json({ error: 'FORBIDDEN' }, 403)
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return json({ error: 'INVALID_REQUEST' }, 400)

  let data: { action?: unknown; messageId?: unknown }
  try {
    const raw = await request.text()
    if (raw.length > 1_000) return json({ error: 'INVALID_REQUEST' }, 400)
    data = JSON.parse(raw)
  } catch { return json({ error: 'INVALID_REQUEST' }, 400) }
  if (data?.action !== 'resend') return json({ error: 'UNKNOWN_ACTION' }, 400)
  const messageId = data.messageId
  if (typeof messageId !== 'string' || !UUID.test(messageId)) return json({ error: 'INVALID_REQUEST' }, 400)

  const config = readEmailConfig()
  if (!config.ready) return json({ error: 'EMAIL_DISABLED', issues: config.issues }, 409)

  try {
    const pool = getCrmPool()
    const requeued = await requeueForResend(pool, messageId)
    // Estado não reenviável (já entregue, ou em andamento) devolve 409 em vez de fingir sucesso.
    if (!requeued) return json({ error: 'NOT_RESENDABLE' }, 409)
    const claimed = await claimForSend(pool, requeued.id)
    const delivered = claimed
      ? await deliverMessage({ pool, config, fetch: (url, init) => fetch(url, init) }, claimed)
      : false
    console.info(JSON.stringify({
      scope: 'comms_email', event: 'admin_resend', messageId, delivered, actorRef: actor.actorRef,
    }))
    return json({ ok: true, delivered, messages: await listForAppointment(pool, requeued.appointmentId) }, 200)
  } catch {
    return json({ error: 'RESEND_FAILED' }, 503)
  }
}
