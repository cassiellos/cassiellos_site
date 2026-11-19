import { withinNativeScheduleWindow } from './resend'
import { hourOfMeetingDay } from './sao-paulo'

/**
 * Quais mensagens uma reunião gera e quando. Função pura: a mesma decisão em teste e em produção.
 *
 * A campanha roda 24 horas por dia e o lead pode agendar com poucas horas de antecedência, então um
 * lembrete fixo "24 h antes" quase nunca caberia: para quem agenda às 23h30 uma reunião das 10h30,
 * ele já nasceria no passado. A sequência é esta:
 *
 *   1. CONFIRMAÇÃO, na hora — sempre, e é a prioridade absoluta;
 *   2. LEMBRETE DA MANHÃ, às 8h (horário de Brasília) do DIA da reunião;
 *   3. LEMBRETE DE 1 HORA, 60 minutos antes do início.
 *
 * Nenhum dos lembretes é obrigatório. Uma mensagem só entra se ainda estiver no futuro e se houver
 * pelo menos MIN_GAP_MS de respiro em relação à mensagem vizinha — é o que impede três e-mails em
 * sequência só para "completar a automação". Quando manhã e 1 hora brigam pelo mesmo espaço, quem
 * fica é o de 1 hora: perto da reunião ele é o mais útil.
 *
 * Exemplos (horário de Brasília), que viraram teste:
 *   23h30 → reunião 10h30 do dia seguinte .... 23h30, 8h, 9h30
 *   7h    → reunião 12h ...................... 7h, 8h, 11h
 *   9h    → reunião 12h ...................... 9h, 11h          (as 8h já passaram)
 *   10h   → reunião 10h30 .................... só a confirmação  (nada mais cabe)
 */

/** Hora do lembrete da manhã, no fuso de Brasília. */
export const MORNING_HOUR = 8
/** Antecedência do lembrete final. */
export const ONE_HOUR_MS = 60 * 60_000
/**
 * Respiro mínimo entre duas mensagens da sequência. 60 minutos: com menos que isso o lead recebe
 * dois e-mails quase juntos e o segundo vira ruído. O limite é inclusivo — exatamente 60 minutos
 * passa (é o caso do agendamento às 7h para a reunião das 12h, em que a confirmação e o lembrete
 * da manhã ficam a uma hora um do outro).
 */
export const MIN_GAP_MS = 60 * 60_000

export type PlannedKind = 'confirmation' | 'reminder_morning' | 'reminder_1h'

export type PlannedMessage = {
  kind: PlannedKind
  /** Quando a mensagem deve sair (UTC, ISO). */
  sendAt: string
  /** true = entregar ao provedor agora com `scheduled_at`; false = deixar para a varredura. */
  nativeSchedule: boolean
  dedupeKey: string
}

/**
 * Chave de idempotência. Para e-mail ela inclui o HORÁRIO da reunião, não só o id:
 * confirmar duas vezes a mesma reunião dá a mesma chave (nada duplica), mas se a reunião for
 * remarcada para outro horário a sequência nova tem chaves próprias e não colide com a antiga,
 * que fica cancelada no histórico. O WhatsApp não leva o horário: a resposta automática é uma só
 * por reunião, aconteça o que acontecer com o horário dela.
 */
export function dedupeKey(
  channel: 'email' | 'whatsapp', kind: string, appointmentId: string, startAt?: string,
): string {
  const base = channel + ':' + kind + ':' + appointmentId
  if (channel !== 'email' || !startAt) return base
  const stamp = startAt.slice(0, 16).replace(/[-:T]/g, '')
  return /^\d{12}$/.test(stamp) ? base + ':' + stamp : base
}

export type PlanInput = {
  appointmentId: string
  startAt: string
  confirmation: boolean
  reminders: boolean
}

/**
 * Decide a sequência. A ordem das checagens é a ordem de prioridade: a confirmação nunca é
 * descartada por causa de um lembrete, e o lembrete da manhã é o primeiro a cair quando o tempo
 * é curto.
 */
export function planMeetingEmails(input: PlanInput, now: Date = new Date()): PlannedMessage[] {
  const start = Date.parse(input.startAt)
  if (!Number.isFinite(start)) return []
  const nowMs = now.getTime()
  const planned: PlannedMessage[] = []

  // 1. Confirmação: imediata e incondicional (quando o canal está ligado).
  const confirmationAt = input.confirmation ? nowMs : null
  if (confirmationAt !== null) {
    planned.push(entry('confirmation', new Date(confirmationAt), false, input))
  }
  if (!input.reminders) return planned

  // 2. Lembrete de 1 hora. Precisa estar no futuro e ter respiro em relação à confirmação —
  //    confirmar às 10h uma reunião das 11h30 não justifica outro e-mail às 10h30.
  const oneHourAtMs = start - ONE_HOUR_MS
  const oneHourFits = oneHourAtMs > nowMs &&
    (confirmationAt === null || oneHourAtMs - confirmationAt >= MIN_GAP_MS)

  // 3. Lembrete da manhã: 8h do dia da reunião, no fuso de Brasília. Fora quando já passou
  //    (agendamento depois das 8h), quando atropelaria a confirmação, ou quando ficaria colado no
  //    lembrete de 1 hora — inclusive se a reunião for de manhã cedo e as 8h caírem DEPOIS dele,
  //    caso em que a diferença fica negativa e a checagem falha sozinha.
  const morningAtMs = hourOfMeetingDay(start, MORNING_HOUR).getTime()
  const morningFits = morningAtMs > nowMs &&
    (confirmationAt === null || morningAtMs - confirmationAt >= MIN_GAP_MS) &&
    oneHourAtMs - morningAtMs >= MIN_GAP_MS

  if (morningFits) {
    planned.push(entry('reminder_morning', new Date(morningAtMs), true, input, now))
  }
  if (oneHourFits) {
    planned.push(entry('reminder_1h', new Date(oneHourAtMs), true, input, now))
  }
  return planned
}

function entry(
  kind: PlannedKind, sendAt: Date, schedulable: boolean, input: PlanInput, now?: Date,
): PlannedMessage {
  return {
    kind, sendAt: sendAt.toISOString(),
    nativeSchedule: schedulable && withinNativeScheduleWindow(sendAt, now),
    dedupeKey: dedupeKey('email', kind, input.appointmentId, input.startAt),
  }
}
