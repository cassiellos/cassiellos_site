import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { CrmDatabaseConfigError, withCrmReadOnlyTransaction } from './db'

/** As 10 tabelas do schema crm (db/migrations/0001_crm_initial_schema.sql). */
export const CRM_EXPECTED_TABLES = [
  'appointments',
  'consents',
  'deals',
  'form_submissions',
  'lead_activities',
  'leads',
  'meta_deliveries',
  'notification_deliveries',
  'tracking_events',
  'visitors',
] as const

export const CRM_SCHEMA = 'crm'

/** Tokens mais curtos que isso são tratados como configuração ausente. */
export const MIN_HEALTHCHECK_TOKEN_LENGTH = 32
const MAX_AUTHORIZATION_HEADER_LENGTH = 1024

export type CrmHealthDeps = {
  /** Valor de CRM_HEALTHCHECK_TOKEN no servidor. */
  healthcheckToken: string | undefined
  /** Se CRM_DATABASE_URL está definida (o valor em si nunca passa por aqui). */
  databaseConfigured: boolean
  /** Consulta somente leitura; devolve os nomes das tabelas encontradas. */
  checkTables: () => Promise<readonly string[]>
}

/**
 * Consulta exclusivamente de leitura no catálogo do PostgreSQL, dentro de uma
 * transação READ ONLY. Não lê nenhum dado das tabelas do CRM.
 */
export async function checkCrmTables(): Promise<readonly string[]> {
  return withCrmReadOnlyTransaction(async (client) => {
    const { rows } = await client.query<{ table_name: string }>(
      `SELECT c.relname AS table_name
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = $1
          AND c.relkind IN ('r', 'p')
          AND c.relname = ANY($2::text[])`,
      [CRM_SCHEMA, [...CRM_EXPECTED_TABLES]],
    )
    return rows.map((row) => row.table_name)
  })
}

function sha256(value: string) {
  return createHash('sha256').update(value, 'utf8').digest()
}

/** Compara o Bearer token em tempo constante. Nunca registra os valores. */
export function isAuthorizedBearer(authorization: string | null, expectedToken: string): boolean {
  if (!authorization || authorization.length > MAX_AUTHORIZATION_HEADER_LENGTH) return false
  const match = /^Bearer +(\S+) *$/i.exec(authorization)
  if (!match) return false
  return timingSafeEqual(sha256(match[1]), sha256(expectedToken))
}

function respond(status: number, body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'X-Robots-Tag': 'noindex, nofollow',
      ...extraHeaders,
    },
  })
}

/** Código técnico seguro para log (ex.: ECONNREFUSED, 28P01). Nunca a mensagem. */
function safeErrorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code
  return typeof code === 'string' && /^[A-Z0-9_]{2,40}$/.test(code) ? code : undefined
}

export async function handleCrmHealthRequest(request: Request, deps: CrmHealthDeps): Promise<Response> {
  const requestId = randomUUID()

  const expectedToken = deps.healthcheckToken?.trim() ?? ''
  if (expectedToken.length < MIN_HEALTHCHECK_TOKEN_LENGTH) {
    return respond(503, { ok: false, error: 'HEALTHCHECK_NOT_CONFIGURED', request_id: requestId })
  }

  if (!isAuthorizedBearer(request.headers.get('authorization'), expectedToken)) {
    return respond(401, { ok: false, error: 'UNAUTHORIZED', request_id: requestId }, {
      'WWW-Authenticate': 'Bearer',
    })
  }

  if (!deps.databaseConfigured) {
    return respond(503, { ok: false, error: 'DATABASE_NOT_CONFIGURED', request_id: requestId })
  }

  const startedAt = performance.now()
  try {
    const found = new Set(await deps.checkTables())
    const missing = CRM_EXPECTED_TABLES.filter((table) => !found.has(table))
    const body = {
      ok: missing.length === 0,
      database: 'reachable',
      schema: CRM_SCHEMA,
      tables: {
        expected: CRM_EXPECTED_TABLES.length,
        found: CRM_EXPECTED_TABLES.length - missing.length,
        missing,
      },
      latency_ms: Math.round(performance.now() - startedAt),
      checked_at: new Date().toISOString(),
      request_id: requestId,
    }
    return missing.length === 0
      ? respond(200, body)
      : respond(503, { ...body, error: 'SCHEMA_INCOMPLETE' })
  } catch (error) {
    const reason = error instanceof CrmDatabaseConfigError ? 'DATABASE_NOT_CONFIGURED' : 'DATABASE_UNAVAILABLE'
    console.error('[crm-health] check failed', JSON.stringify({ request_id: requestId, reason, code: safeErrorCode(error) }))
    return respond(503, { ok: false, error: reason, request_id: requestId })
  }
}
