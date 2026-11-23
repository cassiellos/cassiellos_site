import { replyAllowed, type WhatsappConfig } from './config'
import { maskPhone } from './mask'
import { dedupeKey } from './plan'
import { renderWhatsappAutoReply } from './templates'
import { referenceFromIncomingMessage } from './whatsapp-lead'
import {
  checkSender, sendCloudTextMessage, withinServiceWindow,
  type Fetcher, type IncomingMessage,
} from './whatsapp-cloud'
import {
  appointmentByReference, claimWhatsappReply, loadMeeting, markFailure, markSent, markSkipped,
  usageSince, type Queryable,
} from './store'

/**
 * Modo B — tratamento de uma mensagem recebida. DESLIGADO por padrão (config.autoReply).
 *
 * Ordem deliberada, do mais barato e menos arriscado para o mais:
 *   1. a mensagem traz uma referência nossa? Se não, ignora (é conversa comum — a equipe responde
 *      no aplicativo, como sempre fez). Nunca respondemos a quem só preencheu o formulário;
 *   2. a referência existe e está válida?
 *   3. o remetente é o contato DAQUELA reunião? Divergência não recebe dado nenhum;
 *   4. estamos na janela de atendimento de 24 h? Fora dela só caberia template, que é pago;
 *   5. a franquia do mês ainda permite? Estourada, nada sai;
 *   6. a resposta daquela reunião já foi dada? Então não repete.
 * Só depois disso o link do Meet sai daqui.
 */

export type ReplyDeps = {
  pool: Queryable
  config: WhatsappConfig
  fetch: Fetcher
  now?: () => Date
  log?: (event: string, details: Record<string, unknown>) => void
}

export type ReplyOutcome =
  | 'no_reference' | 'unknown_reference' | 'meeting_not_active' | 'sender_mismatch'
  | 'outside_service_window' | 'quota_reached' | 'already_replied' | 'auto_reply_off'
  | 'not_allowlisted' | 'sent' | 'failed'

const LIVE_STATUSES = new Set(['pending', 'confirmed'])

const defaultLog = (event: string, details: Record<string, unknown>) =>
  console.info(JSON.stringify({ scope: 'comms_whatsapp', event, ...details }))

function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

export async function handleIncomingMessage(
  deps: ReplyDeps, message: IncomingMessage,
): Promise<ReplyOutcome> {
  const log = deps.log ?? defaultLog
  const now = (deps.now ?? (() => new Date()))()

  const reference = referenceFromIncomingMessage(message.text)
  if (!reference) return 'no_reference'

  // Restringe a resposta antes de consultar o banco ou acessar a API.
  if (deps.config.autoReply && !replyAllowed(deps.config.replyAllowlist, message.from)) {
    log('not_allowlisted', { messageId: message.messageId })
    return 'not_allowlisted'
  }

  const appointmentId = await appointmentByReference(deps.pool, reference, now)
  if (!appointmentId) {
    log('unknown_reference', { messageId: message.messageId })
    return 'unknown_reference'
  }
  const meeting = await loadMeeting(deps.pool, appointmentId)
  if (!meeting || !LIVE_STATUSES.has(meeting.status)) return 'meeting_not_active'

  const sender = checkSender(meeting.whatsapp, message.from)
  if (sender !== 'match') {
    // Registro sem o número em claro: alguém com a referência, mas de outro aparelho.
    log('sender_mismatch', { appointmentId, result: sender })
    return 'sender_mismatch'
  }
  if (!withinServiceWindow(message.sentAt, now)) return 'outside_service_window'
  if (!deps.config.autoReply) {
    log('auto_reply_off', { appointmentId })
    return 'auto_reply_off'
  }

  const used = await usageSince(deps.pool, 'whatsapp', startOfMonthUtc(now))
  if (used >= deps.config.freeTier) {
    log('quota_reached', { appointmentId, used, freeTier: deps.config.freeTier })
    return 'quota_reached'
  }

  const claimed = await claimWhatsappReply(deps.pool, {
    appointmentId,
    dedupeKey: dedupeKey('whatsapp', 'whatsapp_auto_reply', appointmentId),
    recipientMasked: maskPhone(meeting.whatsapp),
  })
  if (!claimed) return 'already_replied'

  if (!deps.config.phoneNumberId || !deps.config.accessToken) {
    await markSkipped(deps.pool, claimed.id, 'CLOUD_CREDENTIALS_MISSING')
    return 'auto_reply_off'
  }

  const body = renderWhatsappAutoReply({
    name: meeting.name, startAt: meeting.startAt, endAt: meeting.endAt,
    meetUrl: meeting.meetingUrl, meetingTitle: 'Diagnóstico estratégico · Cassiellos',
  }, deps.config.humanContact)
  const result = await sendCloudTextMessage(deps.fetch, {
    phoneNumberId: deps.config.phoneNumberId, accessToken: deps.config.accessToken,
  }, { to: message.from, body })

  if (result.ok) {
    await markSent(deps.pool, claimed.id, { providerMessageId: result.messageId, scheduled: false })
    log('auto_reply_sent', { appointmentId })
    return 'sent'
  }
  // Sem retentativa automática: repetir mensagem de WhatsApp incomoda o lead e pode custar.
  await markFailure(deps.pool, claimed.id, { error: result.error, retriable: false })
  log('auto_reply_failed', { appointmentId, status: result.status })
  return 'failed'
}
