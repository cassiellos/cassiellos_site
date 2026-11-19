import { NextRequest, NextResponse } from 'next/server'
import { getCrmPool } from '@/lib/crm/db'
import { isCrmRuntimeEnabled } from '@/lib/crm/runtime-env'
import { readWhatsappConfig } from '@/lib/crm/comms/config'
import { parseIncomingMessages, verifyChallenge, verifyPayloadSignature } from '@/lib/crm/comms/whatsapp-cloud'
import { handleIncomingMessage } from '@/lib/crm/comms/whatsapp-reply'

/**
 * Webhook oficial da Meta (WhatsApp Cloud API) — Modo B. PREPARADO E DESLIGADO.
 *
 * Enquanto COMMS_WHATSAPP_CLOUD não for 'true' com as quatro credenciais, a rota responde 404:
 * não há endpoint exposto, não há resposta automática e o número comercial não é tocado.
 * Com a Cloud API ligada mas COMMS_WHATSAPP_AUTO_REPLY desligada, o webhook é recebido e
 * registrado, e NADA é respondido — é assim que se homologa a conexão sem falar com o lead.
 *
 * GET  = handshake de verificação (hub.mode / hub.verify_token / hub.challenge).
 * POST = eventos. Assinatura X-Hub-Signature-256 conferida sobre o corpo cru. Responde 200 sempre
 * que o evento foi recebido: a Meta reenvia por até 7 dias diante de resposta diferente de 200,
 * e os reenvios são tratados pela idempotência (uma resposta automática por reunião).
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const json = (data: unknown, status: number) =>
  NextResponse.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } })

export async function GET(request: NextRequest) {
  if (!isCrmRuntimeEnabled()) return json({ error: 'NOT_FOUND' }, 404)
  const config = readWhatsappConfig()
  if (!config.cloudReady || !config.verifyToken) return json({ error: 'NOT_FOUND' }, 404)
  const params = request.nextUrl.searchParams
  const challenge = verifyChallenge(config.verifyToken, {
    mode: params.get('hub.mode'),
    token: params.get('hub.verify_token'),
    challenge: params.get('hub.challenge'),
  })
  if (!challenge) return json({ error: 'FORBIDDEN' }, 403)
  // A Meta exige o challenge ecoado como texto puro, não como JSON.
  return new NextResponse(challenge, {
    status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

export async function POST(request: NextRequest) {
  if (!isCrmRuntimeEnabled()) return json({ error: 'NOT_FOUND' }, 404)
  const config = readWhatsappConfig()
  if (!config.cloudReady || !config.appSecret) return json({ error: 'NOT_FOUND' }, 404)

  const raw = await request.text()
  // A Meta documenta cargas de até 3 MB; acima disso não é evento de mensagem que nos interesse.
  if (raw.length > 3_000_000) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413)
  if (!verifyPayloadSignature(config.appSecret, request.headers.get('x-hub-signature-256'), raw)) {
    console.info(JSON.stringify({ scope: 'comms_whatsapp', event: 'webhook_rejected', reason: 'BAD_SIGNATURE' }))
    return json({ error: 'INVALID_SIGNATURE' }, 401)
  }

  let body: unknown = null
  try { body = JSON.parse(raw) } catch { return json({ ok: true, ignored: 'INVALID_JSON' }, 200) }
  const messages = parseIncomingMessages(body)
  if (!messages.length) return json({ ok: true, handled: 0 }, 200)

  const outcomes: string[] = []
  try {
    for (const message of messages.slice(0, 10)) {
      outcomes.push(await handleIncomingMessage({
        pool: getCrmPool(), config, fetch: (url, init) => fetch(url, init),
      }, message))
    }
  } catch {
    // Erro nosso: 200 mesmo assim. Reenvio da Meta não resolveria e o evento já foi registrado.
    console.info(JSON.stringify({ scope: 'comms_whatsapp', event: 'handler_error' }))
    return json({ ok: true, handled: outcomes.length }, 200)
  }
  return json({ ok: true, handled: outcomes.length, outcomes }, 200)
}
