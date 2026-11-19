import { RESEND_MAX_SCHEDULE_DAYS, type EmailConfig } from './config'
import { maskEmail } from './mask'
import { planMeetingEmails, type PlannedMessage } from './plan'
import { renderMeetingEmail, type EmailKind } from './templates'
import { cancelEmail, sendEmail, withinNativeScheduleWindow, type Fetcher } from './resend'
import {
  cancelPending, claimForSend, dueMessages, enqueueMessages, loadMeeting, markFailure, markSent,
  markSkipped, usageSince, type CommsMessage, type Queryable,
} from './store'

/**
 * Orquestração dos envios de e-mail.
 *
 * Garantias que importam mais que o envio em si:
 * - a reunião nunca depende disto. Falha, indisponibilidade ou demora da Resend não desfazem o
 *   agendamento, não alteram o evento do Google e não mudam a resposta ao visitante;
 * - nada retroativo: só reunião futura e ativa gera mensagem;
 * - nada duplicado: `dedupe_key` no banco + `Idempotency-Key` na Resend;
 * - as travas do plano gratuito valem ANTES de chamar a API: estourado o limite, a linha fica
 *   'skipped' com o motivo, e não vira cobrança silenciosa.
 */

export type SendDeps = {
  pool: Queryable
  config: EmailConfig
  fetch: Fetcher
  now?: () => Date
  log?: (event: string, details: Record<string, unknown>) => void
}

const defaultLog = (event: string, details: Record<string, unknown>) =>
  console.info(JSON.stringify({ scope: 'comms_email', event, ...details }))

/** Estados da reunião que ainda merecem comunicação. */
const LIVE_STATUSES = new Set(['pending', 'confirmed'])

const KINDS: ReadonlySet<string> = new Set(['confirmation', 'reminder_morning', 'reminder_1h'])

function startOfDayUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
}

export type CapCheck = { allowed: true } | { allowed: false; reason: 'DAILY_CAP' | 'MONTHLY_CAP' }

/** Travas do plano Free conferidas no banco (o que já foi aceito pela Resend), não em memória. */
export async function checkCaps(deps: SendDeps, now: Date): Promise<CapCheck> {
  const daily = await usageSince(deps.pool, 'email', startOfDayUtc(now))
  if (daily >= deps.config.dailyCap) return { allowed: false, reason: 'DAILY_CAP' }
  const monthly = await usageSince(deps.pool, 'email', startOfMonthUtc(now))
  if (monthly >= deps.config.monthlyCap) return { allowed: false, reason: 'MONTHLY_CAP' }
  return { allowed: true }
}

/**
 * Entrega UMA mensagem já reservada. `nativeSchedule` decide entre sair agora e ir com
 * `scheduled_at` para a Resend segurar (até 30 dias).
 */
export async function deliverMessage(deps: SendDeps, message: CommsMessage): Promise<boolean> {
  const log = deps.log ?? defaultLog
  const now = (deps.now ?? (() => new Date()))()
  if (!deps.config.ready || !deps.config.apiKey) {
    await markSkipped(deps.pool, message.id, 'EMAIL_DISABLED')
    return false
  }
  if (!KINDS.has(message.kind)) {
    await markSkipped(deps.pool, message.id, 'UNKNOWN_KIND')
    return false
  }

  const meeting = await loadMeeting(deps.pool, message.appointmentId)
  if (!meeting) {
    await markSkipped(deps.pool, message.id, 'MEETING_NOT_FOUND')
    return false
  }
  // Cancelada, remarcada ou já realizada: nada sai. Protege contra lembrete de reunião desmarcada.
  if (!LIVE_STATUSES.has(meeting.status)) {
    await markSkipped(deps.pool, message.id, 'MEETING_NOT_ACTIVE:' + meeting.status)
    return false
  }
  // Nunca enviar lembrete depois da hora da reunião.
  if (message.kind !== 'confirmation' && Date.parse(meeting.startAt) <= now.getTime()) {
    await markSkipped(deps.pool, message.id, 'MEETING_ALREADY_STARTED')
    return false
  }
  const to = meeting.email?.trim()
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    await markSkipped(deps.pool, message.id, 'INVALID_RECIPIENT')
    return false
  }

  const caps = await checkCaps(deps, now)
  if (!caps.allowed) {
    await markSkipped(deps.pool, message.id, caps.reason)
    log('cap_reached', { messageId: message.id, reason: caps.reason })
    return false
  }

  const rendered = renderMeetingEmail(message.kind as EmailKind, {
    name: meeting.name, startAt: meeting.startAt, endAt: meeting.endAt,
    meetUrl: meeting.meetingUrl, meetingTitle: 'Diagnóstico estratégico · Cassiellos',
  })
  const sendAt = message.scheduledFor ? new Date(message.scheduledFor) : now
  const useNative = message.kind !== 'confirmation' && withinNativeScheduleWindow(sendAt, now)

  const result = await sendEmail(deps.fetch, deps.config.apiKey, {
    from: deps.config.from, to, subject: rendered.subject, html: rendered.html, text: rendered.text,
    scheduledAt: useNative ? sendAt.toISOString() : undefined,
    idempotencyKey: message.dedupeKey,
  })

  if (result.ok) {
    await markSent(deps.pool, message.id, { providerMessageId: result.id, scheduled: result.scheduled })
    log('accepted', { messageId: message.id, kind: message.kind, scheduled: result.scheduled })
    return true
  }
  await markFailure(deps.pool, message.id, { error: result.error, retriable: result.retriable })
  log('rejected', { messageId: message.id, kind: message.kind, status: result.status, retriable: result.retriable })
  return false
}

/**
 * Gancho da confirmação da reunião. Planeja, grava a fila e entrega agora o que já venceu
 * (confirmação, e lembretes que cabem no agendamento nativo). Nunca lança.
 */
export async function scheduleMeetingEmails(
  deps: SendDeps, appointmentId: string,
): Promise<{ created: number; delivered: number }> {
  try {
    const now = (deps.now ?? (() => new Date()))()
    if (!deps.config.confirmation && !deps.config.reminders) return { created: 0, delivered: 0 }
    const meeting = await loadMeeting(deps.pool, appointmentId)
    if (!meeting || !LIVE_STATUSES.has(meeting.status)) return { created: 0, delivered: 0 }
    // NADA RETROATIVO. Esta função só é chamada quando a confirmação devolve 201 (reunião nova), mas a
    // trava fica aqui também: uma reunião que já começou nunca gera comunicação, qualquer que seja o
    // chamador. É o que impede um disparo em massa para as reuniões já registradas no banco.
    if (Date.parse(meeting.startAt) <= now.getTime()) return { created: 0, delivered: 0 }

    const planned: PlannedMessage[] = planMeetingEmails({
      appointmentId, startAt: meeting.startAt,
      confirmation: deps.config.confirmation, reminders: deps.config.reminders,
    }, now)
    const created = await enqueueMessages(deps.pool, {
      appointmentId, planned, recipientMasked: maskEmail(meeting.email),
    })

    let delivered = 0
    for (const message of created) {
      const sendAt = message.scheduledFor ? Date.parse(message.scheduledFor) : now.getTime()
      // Fora da janela nativa fica para a varredura: a Resend não aceita além de 30 dias.
      if (sendAt > now.getTime() && !withinNativeScheduleWindow(new Date(sendAt), now)) continue
      const claimed = await claimForSend(deps.pool, message.id)
      if (claimed && await deliverMessage(deps, claimed)) delivered++
    }
    return { created: created.length, delivered }
  } catch {
    // Comunicação é acessória: qualquer erro aqui some sem afetar a reunião.
    return { created: 0, delivered: 0 }
  }
}

/**
 * Varredura periódica. Pega o que venceu E o que já cabe na janela de 30 dias da Resend, para a
 * Resend segurar o envio. Por isso uma execução diária basta, mesmo com reuniões marcadas com
 * muita antecedência (ver dueMessages em store.ts).
 */
export async function sweepDueMessages(deps: SendDeps, limit = 25): Promise<{ processed: number; delivered: number }> {
  const now = (deps.now ?? (() => new Date()))()
  const horizon = new Date(now.getTime() + RESEND_MAX_SCHEDULE_DAYS * 24 * 60 * 60_000)
  const due = await dueMessages(deps.pool, limit, now, horizon)
  let delivered = 0
  for (const message of due) {
    const claimed = await claimForSend(deps.pool, message.id)
    if (claimed && await deliverMessage(deps, claimed)) delivered++
  }
  return { processed: due.length, delivered }
}

/**
 * Reunião cancelada: cancela a fila local E o que já estava agendado na Resend.
 * Cancelado na Resend não volta, por isso a remarcação não reaproveita: ela cria mensagens novas,
 * com outro dedupe_key (que inclui o horário da reunião).
 */
export async function cancelMeetingEmails(deps: SendDeps, appointmentId: string): Promise<number> {
  try {
    const providerIds = await cancelPending(deps.pool, appointmentId)
    if (!deps.config.apiKey) return providerIds.length
    for (const id of providerIds) await cancelEmail(deps.fetch, deps.config.apiKey, id)
    return providerIds.length
  } catch {
    return 0
  }
}

/**
 * Remarcação: cancela a sequência antiga (local e na Resend) e recalcula a nova a partir do
 * horário atual da reunião. É idempotente: rodar duas vezes com o mesmo horário não duplica nada,
 * porque as chaves do e-mail incluem o horário.
 *
 * Hoje o CRM não tem fluxo de remarcação — remarcar é cancelar e o lead agendar de novo, o que já
 * cria outra reunião com sua própria sequência. Esta função existe para que, quando o fluxo for
 * criado, ele tenha um único ponto a chamar, em vez de nascer uma segunda automação ao lado desta.
 */
export async function rescheduleMeetingEmails(
  deps: SendDeps, appointmentId: string,
): Promise<{ cancelled: number; created: number; delivered: number }> {
  const cancelled = await cancelMeetingEmails(deps, appointmentId)
  const { created, delivered } = await scheduleMeetingEmails(deps, appointmentId)
  return { cancelled, created, delivered }
}
