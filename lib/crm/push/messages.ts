import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Mensagens compactas para PWA (aprovadas em 02/11/2026).
 * A notificação mostra APENAS o primeiro nome e, na reunião, o dia/horário.
 * Não envia ao push telefone, e-mail, nome completo, respostas, orçamento,
 * link do Meet, dados financeiros ou modelo do WhatsApp. A tela bloqueada
 * pode exibir o primeiro nome; o painel administrativo avisa sobre isso.
 */
export type NotificationKind = 'lead_created' | 'meeting_confirmed' | 'meeting_whatsapp_ready' | 'test'
/** Only fixed, fictitious samples; no lead/appointment is created for a preview push. */
export type PushDemoVariant = 'generic' | 'meeting' | 'whatsapp'
export function isPushDemoVariant(value: unknown): value is PushDemoVariant {
  return value === 'generic' || value === 'meeting' || value === 'whatsapp'
}

export const NOTIFICATION_TEXT: Readonly<Record<NotificationKind, { title: string; body: string }>> = {
  lead_created: {
    title: '👤 Novo lead',
    body: 'Novo formulário preenchido.',
  },
  meeting_confirmed: {
    title: '📅 Novo agendamento',
    body: 'Uma reunião foi marcada.',
  },
  meeting_whatsapp_ready: {
    title: '💬 Enviar WhatsApp',
    body: 'Enviar confirmação da reunião.',
  },
  test: {
    title: '✅ Teste de notificações',
    body: 'Notificações funcionando.',
  },
}

/** Dados consultados apenas no momento do envio; nunca persistidos no histórico do push. */
export type PushDisplayDetails = {
  fullName?: string | null
  startsAt?: Date | string | null
}

const BRAZIL_TZ = 'America/Sao_Paulo'
const weekday = new Intl.DateTimeFormat('pt-BR', { timeZone: BRAZIL_TZ, weekday: 'long' })
const timeParts = new Intl.DateTimeFormat('en-GB', {
  timeZone: BRAZIL_TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})

/** First-name only. Rejects e-mail, phone, markup and overlong/unusual tokens. */
export function safePushFirstName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const first = value.trim().split(/\s+/u)[0] || ''
  return /^[\p{L}][\p{L}\p{M}'’-]{0,27}$/u.test(first) ? first : null
}

export function safePushMeetingTime(value: unknown): string | null {
  if (!(value instanceof Date) && typeof value !== 'string') return null
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return null
  const parts = timeParts.formatToParts(date)
  const hour = parts.find(part => part.type === 'hour')?.value
  const minute = parts.find(part => part.type === 'minute')?.value
  if (!hour || !minute) return null
  return weekday.format(date) + ', às ' + Number(hour) + 'h' + (minute === '00' ? '' : minute)
}

/** The preview alerts deliberately reuse the actual formatting functions. */
export function demoNotificationText(variant: PushDemoVariant): { title: string; body: string } {
  const details: PushDisplayDetails = { fullName: 'Márcio Exemplo', startsAt: '2026-11-04T12:30:00.000Z' }
  if (variant === 'meeting') return notificationText('meeting_confirmed', details)
  if (variant === 'whatsapp') return notificationText('meeting_whatsapp_ready', details)
  return NOTIFICATION_TEXT.test
}

export function notificationText(kind: NotificationKind, details?: PushDisplayDetails): { title: string; body: string } {
  const fallback = NOTIFICATION_TEXT[kind]
  const name = safePushFirstName(details?.fullName)
  if (kind === 'lead_created') {
    return { title: fallback.title, body: name ? name + ' preencheu o formulário' : fallback.body }
  }
  if (kind === 'meeting_confirmed') {
    const dateTime = safePushMeetingTime(details?.startsAt)
    return {
      title: fallback.title,
      body: name && dateTime ? name + ' marcou ' + dateTime.replace(', às ', ' às ') : name ? name + ' marcou uma reunião'
        : dateTime ? 'Reunião marcada para ' + dateTime : fallback.body,
    }
  }
  if (kind === 'meeting_whatsapp_ready') {
    return { title: fallback.title, body: name ? 'Enviar confirmação para ' + name : fallback.body }
  }
  return fallback
}

/** Envelope mínimo cifrado em Web Push. Apenas t/b podem conter primeiro nome e horário. */
export type PushPayload = {
  v: 1
  k: NotificationKind
  t: string
  b: string
  /** Caminho interno opaco; autenticado antes de abrir o CRM ou WhatsApp. */
  u: string
  g: string
  d: string
  r: string
}

export function openPath(notificationId: string): string {
  return '/crm/notificacoes/abrir/' + encodeURIComponent(notificationId)
}

export function buildPushPayload(input: {
  kind: NotificationKind; notificationId: string; deliveryId: string; secret: string; details?: PushDisplayDetails; demoVariant?: PushDemoVariant
}): PushPayload {
  const text = input.kind === 'test' && input.demoVariant
    ? demoNotificationText(input.demoVariant)
    : notificationText(input.kind, input.details)
  return {
    v: 1, k: input.kind, t: text.title, b: text.body,
    u: openPath(input.notificationId), g: input.notificationId,
    d: input.deliveryId, r: receiptToken(input.secret, input.deliveryId),
  }
}

/** Recibo sem sessão: HMAC do ID da entrega com o segredo do CRM (não guardado no banco). */
export function receiptToken(secret: string, deliveryId: string): string {
  return createHmac('sha256', secret).update('push-receipt:v1:' + deliveryId).digest('base64url').slice(0, 32)
}

export function validReceipt(secret: string | undefined, deliveryId: unknown, token: unknown): deliveryId is string {
  if (!secret || typeof deliveryId !== 'string' || typeof token !== 'string') return false
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(deliveryId)) return false
  const expected = Buffer.from(receiptToken(secret, deliveryId))
  const given = Buffer.from(token)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

export { safeCrmReturnPath } from '../return-path'
