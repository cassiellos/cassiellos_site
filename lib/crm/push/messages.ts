import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Conteúdo das notificações. PRIORIDADE: nada pessoal na tela bloqueada.
 * O aviso leva só tipo, título e texto genéricos, um ID interno opaco (da notificação, não do lead)
 * e um recibo. Nome, telefone, e-mail, respostas, link do Meet e tokens NUNCA entram no push:
 * os detalhes só aparecem depois que o CRM autenticado é aberto.
 */

export type NotificationKind = 'lead_created' | 'meeting_confirmed' | 'meeting_whatsapp_ready' | 'test'

export const NOTIFICATION_TEXT: Readonly<Record<NotificationKind, { title: string; body: string }>> = {
  lead_created: {
    title: 'Novo lead | CRM | Cassiellos',
    body: 'Um novo contato chegou pelo formulário. Toque para visualizar e atender no CRM.',
  },
  meeting_confirmed: {
    title: 'Reunião confirmada | CRM | Cassiellos',
    body: 'Uma reunião foi agendada. Toque para visualizar os detalhes no CRM.',
  },
  meeting_whatsapp_ready: {
    title: 'Confirmação pronta | CRM | Cassiellos',
    body: 'A mensagem de confirmação para o cliente já está preparada. Toque para revisar e abrir o WhatsApp.',
  },
  test: {
    title: 'CRM | Cassiellos',
    body: 'Notificações funcionando. Toque para abrir o CRM.',
  },
}

/** Formato EXATO do payload (v1). Qualquer campo novo precisa passar pelo teste de privacidade. */
export type PushPayload = {
  v: 1
  /** tipo */
  k: NotificationKind
  /** título e texto genéricos */
  t: string
  b: string
  /** destino relativo no CRM (resolvido só com sessão administrativa) */
  u: string
  /** tag = ID opaco da notificação (o aparelho substitui em vez de duplicar) */
  g: string
  /** entrega + recibo (exibida/aberta), sem sessão */
  d: string
  r: string
}

export function openPath(notificationId: string): string {
  return '/crm/notificacoes/abrir/' + encodeURIComponent(notificationId)
}

export function buildPushPayload(input: { kind: NotificationKind; notificationId: string; deliveryId: string; secret: string }): PushPayload {
  const text = NOTIFICATION_TEXT[input.kind]
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
