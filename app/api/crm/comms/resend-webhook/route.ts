import { NextRequest, NextResponse } from 'next/server'
import { getCrmPool } from '@/lib/crm/db'
import { isCrmRuntimeEnabled } from '@/lib/crm/runtime-env'
import { readEmailConfig } from '@/lib/crm/comms/config'
import { parseWebhookEvent, verifyWebhookSignature } from '@/lib/crm/comms/resend'
import { applyProviderStatus } from '@/lib/crm/comms/store'

/**
 * Webhook de status da Resend (entregue, devolvido, marcado como spam, falhou).
 *
 * É o ÚNICO lugar que pode marcar uma mensagem como 'delivered': a aceitação pela API só diz
 * que a Resend assumiu o envio. Sem RESEND_WEBHOOK_SECRET a rota responde 404 e os estados
 * param em 'sent'/'scheduled' — honesto, e não quebra nada.
 *
 * Assinatura Svix conferida sobre o corpo CRU (lib/crm/comms/resend.ts). Reenvios repetem o
 * mesmo svix-id; o UPDATE é idempotente e não rebaixa estado final, então repetir não causa dano.
 * Responde 200 mesmo para evento desconhecido: 4xx faria a Resend reenviar por dias à toa.
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const json = (data: unknown, status: number) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } })

export async function POST(request: NextRequest) {
  if (!isCrmRuntimeEnabled()) return json({ error: 'NOT_FOUND' }, 404)
  const config = readEmailConfig()
  if (!config.webhookSecret) return json({ error: 'NOT_FOUND' }, 404)

  const raw = await request.text()
  if (raw.length > 100_000) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413)

  const check = verifyWebhookSignature(config.webhookSecret, {
    id: request.headers.get('svix-id'),
    timestamp: request.headers.get('svix-timestamp'),
    signature: request.headers.get('svix-signature'),
  }, raw)
  if (!check.ok) {
    console.info(JSON.stringify({ scope: 'comms_email', event: 'webhook_rejected', reason: check.reason }))
    return json({ error: 'INVALID_SIGNATURE' }, 401)
  }

  let body: unknown = null
  try { body = JSON.parse(raw) } catch { return json({ ok: true, ignored: 'INVALID_JSON' }, 200) }
  const parsed = parseWebhookEvent(body)
  if (!parsed) return json({ ok: true, ignored: 'UNSUPPORTED_EVENT' }, 200)

  try {
    const updated = await applyProviderStatus(
      getCrmPool(), parsed.emailId, parsed.status,
      parsed.status === 'failed' ? parsed.type : undefined)
    console.info(JSON.stringify({
      scope: 'comms_email', event: 'webhook_applied', type: parsed.type, matched: updated,
    }))
    return json({ ok: true, matched: updated }, 200)
  } catch {
    // 5xx faz a Resend tentar de novo, que é o certo para falha nossa de banco.
    return json({ error: 'TEMPORARILY_UNAVAILABLE' }, 503)
  }
}
