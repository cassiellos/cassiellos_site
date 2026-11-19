import { createHmac, timingSafeEqual } from 'node:crypto'
import { parseBrazilianWhatsapp } from '../whatsapp'

/**
 * Modo B — WhatsApp Cloud API (oficial da Meta). PREPARADO E DESLIGADO.
 *
 * Nada aqui roda sem COMMS_WHATSAPP_CLOUD=true e as quatro credenciais. Nenhuma função deste
 * arquivo é chamada pelo Modo A: o botão wa.me continua funcionando com a Cloud API desligada.
 *
 * O número comercial da Cassiellos permanece no aplicativo WhatsApp Business.
 * O modo B usa um segundo número exclusivo da Cloud API: este código não registra nem migra
 * números, apenas recebe webhooks e responde dentro da janela de atendimento.
 *
 * Referência conferida em 18/11/2026: a Meta assina o corpo com X-Hub-Signature-256 (HMAC-SHA256 do
 * corpo cru com o App Secret) e verifica o endpoint com hub.mode/hub.verify_token/hub.challenge.
 * Webhooks podem chegar repetidos ("This can result in duplicate webhook notifications"), por isso
 * toda ação derivada daqui precisa ser idempotente.
 */

export const GRAPH_VERSION = 'v27.0'
/** Janela de atendimento: 24 h a contar da última mensagem do usuário. Fora dela, só template (pago). */
export const SERVICE_WINDOW_MS = 24 * 60 * 60_000

/* ------------------------------------------------------- verificação do endpoint */

export type VerifyQuery = { mode: string | null; token: string | null; challenge: string | null }

/** Handshake do webhook. Devolve o challenge a ecoar, ou null (o chamador responde 403). */
export function verifyChallenge(expectedToken: string, query: VerifyQuery): string | null {
  if (query.mode !== 'subscribe' || !query.token || !query.challenge) return null
  const a = Buffer.from(query.token)
  const b = Buffer.from(expectedToken)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  return /^[0-9]{1,40}$/.test(query.challenge) ? query.challenge : null
}

/* ------------------------------------------------------------- assinatura */

/** X-Hub-Signature-256: `sha256=<hex>` sobre o corpo CRU. Comparação em tempo constante. */
export function verifyPayloadSignature(appSecret: string, header: string | null, rawBody: string): boolean {
  if (!header?.startsWith('sha256=')) return false
  const expected = createHmac('sha256', appSecret).update(rawBody, 'utf8').digest()
  let offered: Buffer
  try { offered = Buffer.from(header.slice(7), 'hex') } catch { return false }
  return offered.length === expected.length && timingSafeEqual(offered, expected)
}

/* ------------------------------------------------------- leitura do webhook */

export type IncomingMessage = {
  /** id da mensagem na Meta (wamid…): chave de deduplicação dos reenvios. */
  messageId: string
  /** Número do remetente em dígitos (wa_id). */
  from: string
  text: string
  /** Momento em que o usuário enviou — início da janela de atendimento. */
  sentAt: Date
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

/** Extrai só as mensagens de TEXTO recebidas. Status de entrega e outros tipos são ignorados. */
/**
 * Mensagens de texto recebidas. Com `expectedPhoneNumberId`, só entram eventos cujo
 * `metadata.phone_number_id` é exatamente o número configurado (WHATSAPP_PHONE_NUMBER_ID):
 * eventos de qualquer outro número que chegue ao mesmo app são descartados sem processamento.
 */
export function parseIncomingMessages(body: unknown, expectedPhoneNumberId?: string | null): IncomingMessage[] {
  if (!body || typeof body !== 'object') return []
  if ((body as { object?: unknown }).object !== 'whatsapp_business_account') return []
  const out: IncomingMessage[] = []
  for (const entry of asArray((body as { entry?: unknown }).entry)) {
    for (const change of asArray((entry as { changes?: unknown })?.changes)) {
      const c = change as { field?: unknown; value?: unknown }
      if (c.field !== 'messages') continue
      if (expectedPhoneNumberId !== undefined) {
        const target = (c.value as { metadata?: { phone_number_id?: unknown } })?.metadata?.phone_number_id
        if (!expectedPhoneNumberId || target !== expectedPhoneNumberId) continue
      }
      for (const raw of asArray((c.value as { messages?: unknown })?.messages)) {
        const m = raw as { id?: unknown; from?: unknown; type?: unknown; timestamp?: unknown; text?: unknown }
        if (m.type !== 'text') continue
        const text = (m.text as { body?: unknown })?.body
        const seconds = Number(m.timestamp)
        if (typeof m.id !== 'string' || typeof m.from !== 'string' || typeof text !== 'string') continue
        if (!/^\d{8,20}$/.test(m.from) || !Number.isFinite(seconds)) continue
        out.push({ messageId: m.id.slice(0, 120), from: m.from, text: text.slice(0, 4_000), sentAt: new Date(seconds * 1_000) })
      }
    }
  }
  return out
}

/* ------------------------------------------------- validação do remetente */

export type SenderCheck = 'match' | 'mismatch' | 'unknown_contact'

/**
 * O remetente é mesmo o contato daquela reunião?
 *
 * A referência sozinha NÃO autoriza: ela aparece na tela do WhatsApp antes do envio e pode ser
 * repassada. Divergência = nenhum dado da reunião é devolvido (o link do Meet não sai daqui),
 * e o caso fica registrado para conferência manual.
 */
/**
 * O `from`/`wa_id` da Meta para celulares brasileiros costuma vir SEM o 9 adicional (55 + DDD + 8
 * dígitos, ex.: 553182988766). O parser do CRM recusa 8 dígitos iniciados por 6–9 (seriam celulares
 * sem o 9), então o titular era tratado como remetente divergente. Aqui o 9 é recolocado SOMENTE
 * nesse formato exato; qualquer outro valor segue para o parser sem alteração.
 */
export function normalizeWhatsappSender(from: string): string {
  const digits = typeof from === 'string' ? from.replace(/\D/g, '') : ''
  return /^55\d{2}[6-9]\d{7}$/.test(digits) ? digits.slice(0, 4) + '9' + digits.slice(4) : from
}

export function checkSender(leadWhatsapp: string | null, from: string): SenderCheck {
  const expected = parseBrazilianWhatsapp(leadWhatsapp)
  if (!expected) return 'unknown_contact'
  const sender = parseBrazilianWhatsapp(normalizeWhatsappSender(from))
  if (!sender) return 'mismatch'
  // Comparação EXATA do número completo (55 + DDD + assinante), depois de recolocar o 9 que a Meta
  // omite no wa_id. Nada de "últimos 8 dígitos": um fixo e um celular do mesmo DDD podem terminar igual.
  return expected.e164Digits === sender.e164Digits ? 'match' : 'mismatch'
}

export function withinServiceWindow(userSentAt: Date, now: Date = new Date()): boolean {
  const elapsed = now.getTime() - userSentAt.getTime()
  return elapsed >= 0 && elapsed < SERVICE_WINDOW_MS
}

/* ------------------------------------------------------------------ envio */

export type CloudSendResult =
  | { ok: true; messageId: string }
  | { ok: false; error: string; status: number | null }

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

/**
 * Mensagem de texto livre (não-template) — gratuita dentro da janela de atendimento segundo a
 * política vigente da Meta. Templates são pagos e NÃO são usados nesta etapa.
 */
export async function sendCloudTextMessage(
  fetcher: Fetcher,
  credentials: { phoneNumberId: string; accessToken: string },
  input: { to: string; body: string },
): Promise<CloudSendResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetcher(
      'https://graph.facebook.com/' + GRAPH_VERSION + '/' +
      encodeURIComponent(credentials.phoneNumberId) + '/messages', {
        method: 'POST', signal: controller.signal, cache: 'no-store',
        headers: { Authorization: 'Bearer ' + credentials.accessToken, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp', recipient_type: 'individual',
          to: input.to, type: 'text', text: { preview_url: false, body: input.body },
        }),
      })
    const raw = await response.text()
    let parsed: unknown = null
    try { parsed = raw ? JSON.parse(raw) : null } catch { parsed = null }
    if (!response.ok) {
      const message = (parsed as { error?: { message?: unknown } } | null)?.error?.message
      return { ok: false, error: typeof message === 'string' ? message.slice(0, 300) : 'HTTP_' + response.status, status: response.status }
    }
    const id = asArray((parsed as { messages?: unknown } | null)?.messages)[0] as { id?: unknown } | undefined
    return typeof id?.id === 'string'
      ? { ok: true, messageId: id.id }
      : { ok: false, error: 'MISSING_MESSAGE_ID', status: response.status }
  } catch {
    return { ok: false, error: 'NETWORK_OR_TIMEOUT', status: null }
  } finally {
    clearTimeout(timer)
  }
}
