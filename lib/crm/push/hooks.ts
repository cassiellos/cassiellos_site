import type { HandlerResponse } from '../booking-intake-request'

/**
 * Pontos de extensão mínimos nas rotas públicas (cadastro e confirmação). Os handlers de Etapa 3/4
 * NÃO foram alterados: a decisão usa só a resposta HTTP que eles já devolvem.
 *
 * - Lead novo: HTTP 201 com reused=false (reenvio com a mesma chave = 200, reused=true → nada).
 * - Reunião nova: HTTP 201 (só existe depois do evento criado no Google e da reunião gravada no banco).
 *   Reenvio idempotente (200 / alreadyConfirmed), horário indisponível, bloqueios e falhas → nada.
 *
 * Com PWA_PUSH_ENABLED desligada não há nenhuma consulta extra ao banco. Ligada: a fila é gravada ANTES da
 * resposta (no máximo ~1,5 s; erro ou demora nunca afetam o visitante) e o envio roda depois, com after().
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function newLeadFrom(result: HandlerResponse): { leadId: string } | null {
  if (result.status !== 201) return null
  const b = result.body
  if (b.ok !== true || b.reused !== false || typeof b.leadId !== 'string' || !UUID.test(b.leadId)) return null
  return { leadId: b.leadId }
}

export function confirmedMeetingFrom(result: HandlerResponse): { appointmentId: string; bookingRequestId: string } | null {
  if (result.status !== 201) return null
  const b = result.body
  if (b.ok !== true || b.alreadyConfirmed === true) return null
  if (typeof b.appointmentId !== 'string' || !UUID.test(b.appointmentId)) return null
  if (typeof b.bookingRequestId !== 'string' || !UUID.test(b.bookingRequestId)) return null
  return { appointmentId: b.appointmentId, bookingRequestId: b.bookingRequestId }
}

export const ENQUEUE_BUDGET_MS = 1_500

/** Grava a fila (com prazo) e agenda o envio para depois da resposta. Nunca lança. */
export async function queueThenDeliver<T>(
  target: T | null,
  deps: {
    switchReady: () => boolean
    enqueue: (target: T) => Promise<string[]>
    schedule: (task: () => Promise<void>) => void
    deliver: (ids: string[]) => Promise<void>
    budgetMs?: number
  },
): Promise<boolean> {
  try {
    if (!target || !deps.switchReady()) return false
    const pending = deps.enqueue(target).catch(() => [] as string[])
    let timer: ReturnType<typeof setTimeout> | undefined
    await Promise.race([pending, new Promise(resolve => { timer = setTimeout(resolve, deps.budgetMs ?? ENQUEUE_BUDGET_MS) })])
    clearTimeout(timer)
    deps.schedule(async () => {
      try {
        const ids = await pending
        if (ids.length) await deps.deliver(ids)
      } catch { /* nunca afeta o lead nem a reunião */ }
    })
    return true
  } catch {
    return false
  }
}
