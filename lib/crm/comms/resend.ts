import { createHmac, timingSafeEqual } from 'node:crypto'
import { RESEND_MAX_SCHEDULE_DAYS } from './config'

/**
 * Cliente da Resend por `fetch` — sem SDK. O projeto só tem `pg` como dependência de runtime e
 * a API é pequena: três chamadas (enviar, reagendar, cancelar) e a conferência da assinatura do
 * webhook. Uma dependência a menos é uma superfície a menos para auditar e atualizar.
 *
 * Documentação conferida em 18/11/2026 (https://resend.com/docs):
 * - POST /emails — campos `from`, `to`, `subject`, `html`, `text`, `scheduled_at`.
 *   `scheduled_at` aceita ISO 8601 e agenda até 30 DIAS à frente (não 72 h).
 * - Cabeçalho `Idempotency-Key` — único por requisição, expira em 24 h, até 256 caracteres.
 *   É a trava contra envio duplo quando a rota é chamada duas vezes ou a resposta se perde.
 * - PATCH /emails/{id} reagenda; POST /emails/{id}/cancel cancela. Cancelado NÃO volta a ser agendado.
 * - Webhooks assinados pelo padrão Svix (svix-id, svix-timestamp, svix-signature).
 *
 * Aceito pela API (`sent`/`scheduled`) NÃO é entregue: só o webhook `email.delivered` diz isso.
 */

const API = 'https://api.resend.com'
const TIMEOUT_MS = 10_000

export type SendEmailInput = {
  from: string
  to: string
  subject: string
  html: string
  text: string
  /** ISO 8601 UTC. Ausente = enviar agora. */
  scheduledAt?: string
  /** Chave de idempotência (usamos o dedupe_key da mensagem). */
  idempotencyKey: string
}

export type SendEmailResult =
  | { ok: true; id: string; scheduled: boolean }
  | { ok: false; error: string; retriable: boolean; status: number | null }

export type Fetcher = (url: string, init: RequestInit) => Promise<Response>

/** A reunião está dentro da janela de agendamento nativo? Fora dela, a varredura própria assume. */
export function withinNativeScheduleWindow(sendAt: Date, now: Date = new Date()): boolean {
  const ms = sendAt.getTime() - now.getTime()
  return ms > 0 && ms <= RESEND_MAX_SCHEDULE_DAYS * 24 * 60 * 60_000
}

/** 408/429 e 5xx valem nova tentativa; 4xx restante é erro de pedido e repetir não ajuda. */
function retriable(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

async function call(
  fetcher: Fetcher, apiKey: string, path: string, init: RequestInit,
): Promise<{ status: number; body: unknown } | { status: null; body: null }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await fetcher(API + path, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
      headers: { Authorization: 'Bearer ' + apiKey, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    })
    const raw = await response.text()
    let body: unknown = null
    try { body = raw ? JSON.parse(raw) : null } catch { body = null }
    return { status: response.status, body }
  } catch {
    // Tempo esgotado ou rede: ambíguo. Tratado como retriável; a idempotência evita o envio duplo.
    return { status: null, body: null }
  } finally {
    clearTimeout(timer)
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (body && typeof body === 'object') {
    const message = (body as { message?: unknown }).message
    if (typeof message === 'string' && message) return message.slice(0, 300)
  }
  return fallback
}

export async function sendEmail(
  fetcher: Fetcher, apiKey: string, input: SendEmailInput,
): Promise<SendEmailResult> {
  const payload: Record<string, unknown> = {
    from: input.from, to: input.to, subject: input.subject, html: input.html, text: input.text,
  }
  if (input.scheduledAt) payload.scheduled_at = input.scheduledAt
  const result = await call(fetcher, apiKey, '/emails', {
    method: 'POST',
    headers: { 'Idempotency-Key': input.idempotencyKey.slice(0, 256) },
    body: JSON.stringify(payload),
  })
  if (result.status === null) return { ok: false, error: 'NETWORK_OR_TIMEOUT', retriable: true, status: null }
  if (result.status >= 200 && result.status < 300) {
    const id = (result.body as { id?: unknown } | null)?.id
    if (typeof id !== 'string' || !id) {
      return { ok: false, error: 'MISSING_MESSAGE_ID', retriable: false, status: result.status }
    }
    return { ok: true, id, scheduled: Boolean(input.scheduledAt) }
  }
  return {
    ok: false,
    error: errorMessage(result.body, 'HTTP_' + result.status),
    retriable: retriable(result.status),
    status: result.status,
  }
}

export async function rescheduleEmail(
  fetcher: Fetcher, apiKey: string, id: string, scheduledAt: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await call(fetcher, apiKey, '/emails/' + encodeURIComponent(id), {
    method: 'PATCH', body: JSON.stringify({ scheduled_at: scheduledAt }),
  })
  if (result.status === null) return { ok: false, error: 'NETWORK_OR_TIMEOUT' }
  if (result.status >= 200 && result.status < 300) return { ok: true }
  return { ok: false, error: errorMessage(result.body, 'HTTP_' + result.status) }
}

export async function cancelEmail(
  fetcher: Fetcher, apiKey: string, id: string,
): Promise<{ ok: boolean; error?: string }> {
  const result = await call(fetcher, apiKey, '/emails/' + encodeURIComponent(id) + '/cancel', { method: 'POST' })
  if (result.status === null) return { ok: false, error: 'NETWORK_OR_TIMEOUT' }
  // 404 = já saiu ou nunca existiu: para o nosso fim (não enviar), o resultado é o mesmo.
  if ((result.status >= 200 && result.status < 300) || result.status === 404) return { ok: true }
  return { ok: false, error: errorMessage(result.body, 'HTTP_' + result.status) }
}

/* ------------------------------------------------------------------ webhook */

/** Tolerância de relógio do Svix: 5 minutos para cada lado (protege contra reenvio antigo). */
export const WEBHOOK_TOLERANCE_SECONDS = 300

export type WebhookHeaders = { id: string | null; timestamp: string | null; signature: string | null }

export type WebhookCheck =
  | { ok: true; eventId: string }
  | { ok: false; reason: 'MISSING_HEADERS' | 'BAD_TIMESTAMP' | 'STALE' | 'BAD_SECRET' | 'BAD_SIGNATURE' }

/**
 * Confere a assinatura Svix do webhook sobre o corpo CRU.
 * Conteúdo assinado = `<svix-id>.<svix-timestamp>.<corpo>`; segredo em base64 após `whsec_`.
 * O cabeçalho pode trazer várias assinaturas separadas por espaço (rotação de segredo): basta uma bater.
 * Comparação em tempo constante, para a verificação não vazar o segredo pelo tempo de resposta.
 */
export function verifyWebhookSignature(
  secret: string, headers: WebhookHeaders, rawBody: string, now: Date = new Date(),
): WebhookCheck {
  if (!headers.id || !headers.timestamp || !headers.signature) return { ok: false, reason: 'MISSING_HEADERS' }
  const seconds = Number(headers.timestamp)
  if (!Number.isFinite(seconds)) return { ok: false, reason: 'BAD_TIMESTAMP' }
  if (Math.abs(Math.floor(now.getTime() / 1000) - seconds) > WEBHOOK_TOLERANCE_SECONDS) {
    return { ok: false, reason: 'STALE' }
  }
  let key: Buffer
  try {
    key = Buffer.from(secret.startsWith('whsec_') ? secret.slice(6) : secret, 'base64')
    if (!key.length) return { ok: false, reason: 'BAD_SECRET' }
  } catch { return { ok: false, reason: 'BAD_SECRET' } }

  const expected = createHmac('sha256', key)
    .update(headers.id + '.' + headers.timestamp + '.' + rawBody).digest()
  for (const part of headers.signature.split(' ')) {
    const [version, value] = part.split(',')
    if (version !== 'v1' || !value) continue
    let candidate: Buffer
    try { candidate = Buffer.from(value, 'base64') } catch { continue }
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      return { ok: true, eventId: headers.id }
    }
  }
  return { ok: false, reason: 'BAD_SIGNATURE' }
}

/** Tipos de evento da Resend que mudam o estado de uma mensagem nossa. Os demais são ignorados. */
export const WEBHOOK_STATUS: Record<string, 'sent' | 'scheduled' | 'delivered' | 'failed'> = {
  'email.sent': 'sent',
  'email.scheduled': 'scheduled',
  'email.delivered': 'delivered',
  'email.bounced': 'failed',
  'email.failed': 'failed',
  'email.complained': 'failed',
  'email.suppressed': 'failed',
}

export type WebhookEvent = { type: string; emailId: string; status: 'sent' | 'scheduled' | 'delivered' | 'failed' }

export function parseWebhookEvent(body: unknown): WebhookEvent | null {
  if (!body || typeof body !== 'object') return null
  const type = (body as { type?: unknown }).type
  if (typeof type !== 'string') return null
  const status = WEBHOOK_STATUS[type]
  if (!status) return null
  const data = (body as { data?: unknown }).data
  const emailId = data && typeof data === 'object' ? (data as { email_id?: unknown }).email_id : null
  if (typeof emailId !== 'string' || !emailId) return null
  return { type, emailId, status }
}
