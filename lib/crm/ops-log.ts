/**
 * Registros operacionais MÍNIMOS do funil público (formulário, calendário e confirmação).
 *
 * Finalidade: saber quando e onde uma falha técnica impede o visitante de avançar (verificação de segurança,
 * carregamento do calendário, confirmação da reunião, banco de dados), sem qualquer dado do visitante.
 *
 * Regra de ouro: cada registro é montado SOMENTE a partir de listas fechadas e de padrões curtos. Qualquer outro
 * campo recebido é descartado. Nunca entram: endereço IP, user agent, token (Turnstile, sessão de agendamento),
 * nome, e-mail, telefone, respostas do formulário, identificador de lead/reserva/visitante, cookies, URL completa
 * nem a mensagem de erro original (que pode conter trechos de conexão ou de consulta).
 *
 * É um registro de execução (stdout da plataforma), não um sistema de analytics: não conta visitantes, não liga
 * eventos entre si e não depende de consentimento do visitante, porque não trata dado pessoal. A base legal e o
 * prazo de retenção (os da plataforma de hospedagem) dependem de validação jurídica: ver docs/tracking/operacao-logs-e-neon.md.
 */

export const OPS_LOG_TAG = 'cassiellos_ops'
export const OPS_LOG_VERSION = 1

export const OPS_STAGES = ['form_page', 'form_submit', 'booking_calendar', 'booking_availability', 'booking_confirm'] as const
export type OpsStage = typeof OPS_STAGES[number]

/** Códigos técnicos públicos já devolvidos pelas rotas (nenhum carrega dado do visitante). */
export const OPS_CODES = [
  // verificação de segurança e envio do formulário
  'SECURITY_CHECK_UNAVAILABLE', 'SECURITY_CHECK_FAILED', 'SECURITY_CHECK_REQUIRED', 'SECURITY_CHECK_EXPIRED',
  'TOO_MANY_REQUESTS', 'FORM_UPDATED', 'FORM_NOT_AVAILABLE', 'FORM_SUBMISSION_UNAVAILABLE', 'FORM_PAGE_UNAVAILABLE',
  // calendário e horários
  'AVAILABILITY_UNAVAILABLE',
  // confirmação da reunião
  'SLOT_UNAVAILABLE', 'BOOKING_REQUIRES_REVIEW', 'BOOKING_SESSION_EXPIRED', 'INVALID_SLOT', 'UNKNOWN_FORM',
  'BOOKING_ALREADY_PROCESSING', 'BOOKING_LIMIT_REACHED', 'CONTACT_HAS_ACTIVE_MEETING', 'TEST_EMAIL_NOT_ALLOWED',
  'INVALID_SUBMISSION', 'BOOKING_DISABLED', 'FORBIDDEN', 'INVALID_REQUEST',
  // qualquer outro código de erro conhecido que ainda não tenha nome próprio
  'OTHER',
] as const
export type OpsCode = typeof OPS_CODES[number]

const CODE_SET: ReadonlySet<string> = new Set(OPS_CODES)
const STAGE_SET: ReadonlySet<string> = new Set(OPS_STAGES)
// Motivo da verificação de segurança (TurnstileFailure) e códigos do Siteverify da Cloudflare: palavras curtas em minúsculas.
const REASON_PATTERN = /^[a-z][a-z0-9_]{2,31}$/
const CF_CODE_PATTERN = /^[a-z][a-z0-9-]{2,39}$/
const FORM_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/

export type DbErrorKind =
  | 'CONNECTION_TIMEOUT' | 'POOL_CONNECT_TIMEOUT' | 'CONNECTION_TERMINATED' | 'AUTH_FAILED' | 'QUERY_TIMEOUT'
  | 'STATEMENT_TIMEOUT' | 'NETWORK' | 'CONFIG' | 'SQLSTATE' | 'HTTP' | 'UNKNOWN'

/**
 * Classifica um erro de banco/rede em uma categoria fixa. A mensagem original NUNCA é devolvida:
 * ela só é lida para escolher a categoria.
 */
export function classifyDbError(error: unknown): { kind: DbErrorKind; detail: string | null } {
  const code = typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : ''
  const message = typeof (error as { message?: unknown })?.message === 'string' ? (error as { message: string }).message : ''
  const name = typeof (error as { name?: unknown })?.name === 'string' ? (error as { name: string }).name : ''
  if (name === 'CrmDatabaseConfigError') return { kind: 'CONFIG', detail: null }
  // Mensagens fixas do driver (pg / pg-pool). Ordem importa: a mais específica primeiro.
  if (/password authentication failed/i.test(message)) return { kind: 'AUTH_FAILED', detail: null }
  if (/timeout exceeded when trying to connect/i.test(message)) return { kind: 'POOL_CONNECT_TIMEOUT', detail: null }
  if (/connection terminated due to connection timeout/i.test(message)) return { kind: 'CONNECTION_TIMEOUT', detail: null }
  if (/connection terminated/i.test(message)) return { kind: 'CONNECTION_TERMINATED', detail: null }
  if (/query read timeout|query_timeout/i.test(message)) return { kind: 'QUERY_TIMEOUT', detail: null }
  if (code === '57014' || /statement timeout/i.test(message)) return { kind: 'STATEMENT_TIMEOUT', detail: null }
  if (/^E[A-Z]{3,15}$/.test(code)) return { kind: 'NETWORK', detail: code } // ECONNRESET, ETIMEDOUT, ENOTFOUND, EAI_AGAIN…
  if (/^[0-9A-Z]{5}$/.test(code)) return { kind: 'SQLSTATE', detail: code }  // código SQLSTATE do PostgreSQL
  const status = Number((error as { code?: unknown; status?: unknown })?.code ?? (error as { status?: unknown })?.status)
  if (Number.isInteger(status) && status >= 100 && status <= 599) return { kind: 'HTTP', detail: String(status) }
  return { kind: 'UNKNOWN', detail: null }
}

/** Texto curto e seguro da categoria do erro (ex.: "CONNECTION_TIMEOUT", "SQLSTATE:57P01"). */
export function dbErrorKind(error: unknown): string {
  const { kind, detail } = classifyDbError(error)
  return detail ? kind + ':' + detail : kind
}

export type OpsEventInput = {
  stage: OpsStage
  code: OpsCode
  /** Status HTTP devolvido ao visitante. */
  status?: number
  /** Motivo da verificação de segurança (TurnstileFailure). */
  reason?: string
  /** Códigos de erro do Siteverify da Cloudflare (no máximo 5). */
  cfCodes?: readonly string[]
  /** Categoria do erro de banco/rede (use dbErrorKind). */
  dbKind?: string
  /** Slug do formulário (identificador do formulário, não do visitante). */
  form?: string
}

export type OpsLogEntry = {
  log: typeof OPS_LOG_TAG
  v: typeof OPS_LOG_VERSION
  stage: OpsStage
  code: OpsCode
  status?: number
  reason?: string
  cf?: string[]
  db?: string
  form?: string
}

const DB_KIND_PATTERN = /^[A-Z_]{3,32}(:[0-9A-Za-z]{2,16})?$/

/** Monta o registro só com campos permitidos. Devolve null se estágio ou código não forem os da lista fechada. */
export function buildOpsLogEntry(input: unknown): OpsLogEntry | null {
  if (!input || typeof input !== 'object') return null
  const value = input as Record<string, unknown>
  if (typeof value.stage !== 'string' || !STAGE_SET.has(value.stage)) return null
  if (typeof value.code !== 'string' || !CODE_SET.has(value.code)) return null
  const entry: OpsLogEntry = { log: OPS_LOG_TAG, v: OPS_LOG_VERSION, stage: value.stage as OpsStage, code: value.code as OpsCode }
  if (Number.isInteger(value.status) && (value.status as number) >= 100 && (value.status as number) <= 599) {
    entry.status = value.status as number
  }
  if (typeof value.reason === 'string' && REASON_PATTERN.test(value.reason)) entry.reason = value.reason
  if (Array.isArray(value.cfCodes)) {
    const codes = value.cfCodes.filter((item): item is string => typeof item === 'string' && CF_CODE_PATTERN.test(item)).slice(0, 5)
    if (codes.length) entry.cf = codes
  }
  if (typeof value.dbKind === 'string' && DB_KIND_PATTERN.test(value.dbKind)) entry.db = value.dbKind
  if (typeof value.form === 'string' && FORM_PATTERN.test(value.form)) entry.form = value.form
  return entry
}

/** Mapeia um código de erro devolvido pela rota para a lista fechada (desconhecido vira OTHER). */
export function opsCodeFrom(value: unknown): OpsCode {
  return typeof value === 'string' && CODE_SET.has(value) ? (value as OpsCode) : 'OTHER'
}

/** Escreve uma linha JSON no log da plataforma. Nunca lança erro e nunca bloqueia a resposta ao visitante. */
export function opsLog(input: OpsEventInput, sink: (line: string) => void = line => console.warn(line)): void {
  try {
    const entry = buildOpsLogEntry(input)
    if (entry) sink(JSON.stringify(entry))
  } catch {
    // O registro é secundário: falha aqui não pode afetar o visitante.
  }
}
