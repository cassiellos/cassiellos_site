import { withinNativeScheduleWindow } from './resend'

/**
 * Quais mensagens uma reunião gera e quando. Função pura: a mesma decisão em teste e em produção.
 *
 * - confirmação: agora;
 * - lembrete de 24 h e de 1 h: contados a partir do início da reunião.
 *
 * Um lembrete cujo horário já passou NÃO é criado (reunião marcada para daqui a 40 minutos não
 * gera lembrete de 24 h, e nunca dispara uma mensagem retroativa). Dentro da janela de 30 dias da
 * Resend o lembrete vai com `scheduled_at`; fora dela fica `pending` no banco e a varredura envia
 * na hora certa — é o caso de reuniões marcadas com mais de 31 dias de antecedência.
 */

export const REMINDER_OFFSETS_MS = { reminder_24h: 24 * 60 * 60_000, reminder_1h: 60 * 60_000 } as const

export type PlannedKind = 'confirmation' | 'reminder_24h' | 'reminder_1h'

export type PlannedMessage = {
  kind: PlannedKind
  /** Quando a mensagem deve sair (UTC, ISO). */
  sendAt: string
  /** true = entregar ao provedor agora com `scheduled_at`; false = deixar para a varredura. */
  nativeSchedule: boolean
  dedupeKey: string
}

/** Margem para não agendar algo que sai praticamente junto com o envio imediato. */
export const MIN_SCHEDULE_LEAD_MS = 60_000

export function dedupeKey(channel: 'email' | 'whatsapp', kind: string, appointmentId: string): string {
  return channel + ':' + kind + ':' + appointmentId
}

export function planMeetingEmails(
  input: { appointmentId: string; startAt: string; confirmation: boolean; reminders: boolean },
  now: Date = new Date(),
): PlannedMessage[] {
  const start = Date.parse(input.startAt)
  if (!Number.isFinite(start)) return []
  const planned: PlannedMessage[] = []

  if (input.confirmation) {
    planned.push({
      kind: 'confirmation', sendAt: now.toISOString(), nativeSchedule: false,
      dedupeKey: dedupeKey('email', 'confirmation', input.appointmentId),
    })
  }

  if (input.reminders) {
    for (const kind of ['reminder_24h', 'reminder_1h'] as const) {
      const sendAtMs = start - REMINDER_OFFSETS_MS[kind]
      // Já passou (ou sai junto com a confirmação): não cria. Nunca envia lembrete retroativo.
      if (sendAtMs - now.getTime() < MIN_SCHEDULE_LEAD_MS) continue
      const sendAt = new Date(sendAtMs)
      planned.push({
        kind, sendAt: sendAt.toISOString(),
        nativeSchedule: withinNativeScheduleWindow(sendAt, now),
        dedupeKey: dedupeKey('email', kind, input.appointmentId),
      })
    }
  }
  return planned
}
