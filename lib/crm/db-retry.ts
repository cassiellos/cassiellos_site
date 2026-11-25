import { classifyDbError } from './ops-log'

/**
 * Nova tentativa para falhas TRANSITÓRIAS de conexão com o Neon (início a frio, conexão encerrada, rede).
 *
 * Só para LEITURAS idempotentes (página do formulário, regras de disponibilidade). Nunca envolva gravações com
 * efeito externo (envio de lead, reserva, evento do Google): elas têm chave de idempotência própria e política própria.
 *
 * Por que existe: o plano gratuito do Neon suspende a computação após 5 minutos sem uso e a primeira conexão depois
 * disso pode demorar; a documentação do Neon recomenda tempo limite de conexão maior (10 s) e nova tentativa com
 * espera crescente. Antes, uma única falha de conexão derrubava a página do formulário (erro 500 para o visitante).
 *
 * Limites deliberados: poucas tentativas e um orçamento de tempo total. Uma tentativa lenta (timeout) NÃO dispara outra
 * se o orçamento acabou: o visitante não espera indefinidamente e a função não estoura o tempo da plataforma.
 */

export const DB_RETRY_DEFAULTS = {
  attempts: 3,
  baseDelayMs: 300,
  factor: 3,
  /** Não inicia nova tentativa depois deste tempo total (ms). */
  budgetMs: 9_000,
} as const

const TRANSIENT_KINDS: ReadonlySet<string> = new Set([
  'CONNECTION_TIMEOUT', 'POOL_CONNECT_TIMEOUT', 'CONNECTION_TERMINATED', 'NETWORK',
])
// SQLSTATE transitórios: classe 08 (falha de conexão), 57P01 (admin_shutdown), 57P02 (crash_shutdown), 57P03 (cannot_connect_now).
const TRANSIENT_SQLSTATE = /^(08[0-9A-Z]{3}|57P01|57P02|57P03)$/

/** Verdadeiro só para erros de conexão que valem uma nova tentativa. Autenticação, configuração e SQL inválido NÃO. */
export function isTransientDbError(error: unknown): boolean {
  const { kind, detail } = classifyDbError(error)
  if (TRANSIENT_KINDS.has(kind)) return true
  return kind === 'SQLSTATE' && detail !== null && TRANSIENT_SQLSTATE.test(detail)
}

export type RetryOptions = {
  attempts?: number
  baseDelayMs?: number
  factor?: number
  budgetMs?: number
  /** Injetáveis para teste. */
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  onRetry?: (info: { attempt: number; nextDelayMs: number; error: unknown }) => void
}

export async function retryTransient<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? DB_RETRY_DEFAULTS.attempts)
  const baseDelayMs = options.baseDelayMs ?? DB_RETRY_DEFAULTS.baseDelayMs
  const factor = options.factor ?? DB_RETRY_DEFAULTS.factor
  const budgetMs = options.budgetMs ?? DB_RETRY_DEFAULTS.budgetMs
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const now = options.now ?? Date.now
  const startedAt = now()
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      if (attempt >= attempts || !isTransientDbError(error)) throw error
      const nextDelayMs = Math.round(baseDelayMs * factor ** (attempt - 1))
      if (now() - startedAt + nextDelayMs > budgetMs) throw error
      options.onRetry?.({ attempt, nextDelayMs, error })
      await sleep(nextDelayMs)
    }
  }
}
