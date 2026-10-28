import { Pool, type PoolClient, type PoolConfig } from 'pg'

/**
 * Conexão PostgreSQL (Neon) do Mini CRM Cassiellos — uso exclusivo no servidor.
 *
 * - Lê a connection string de CRM_DATABASE_URL (nunca registrada nem retornada).
 * - TLS sempre com validação de certificado (rejectUnauthorized: true).
 *   Parâmetros SSL da URL (sslmode, uselibpqcompat, ...) são removidos porque,
 *   no driver "pg", eles sobrescrevem a opção `ssl` e poderiam desativar a validação.
 * - Pool pequeno e com timeouts curtos, adequado a funções serverless.
 */

export const CRM_DB_LIMITS = {
  /** Conexões simultâneas por instância da função. */
  maxConnections: 3,
  /** Tempo máximo para abrir uma conexão (inclui TLS e autenticação). */
  connectionTimeoutMs: 5_000,
  /** Conexões ociosas são encerradas após este tempo. */
  idleTimeoutMs: 10_000,
  /** Limite no cliente para cada consulta. */
  queryTimeoutMs: 8_000,
  /** Limite no servidor (SET LOCAL statement_timeout) dentro da transação. */
  statementTimeoutMs: 5_000,
} as const

const SSL_URL_PARAMS = [
  'ssl',
  'sslmode',
  'sslcert',
  'sslkey',
  'sslrootcert',
  'sslnegotiation',
  'uselibpqcompat',
] as const

export type CrmDatabaseConfigErrorReason = 'MISSING' | 'INVALID'

export class CrmDatabaseConfigError extends Error {
  readonly reason: CrmDatabaseConfigErrorReason

  constructor(reason: CrmDatabaseConfigErrorReason) {
    super(reason === 'MISSING' ? 'CRM database is not configured' : 'CRM database configuration is invalid')
    this.name = 'CrmDatabaseConfigError'
    this.reason = reason
  }
}

export function isCrmDatabaseConfigured(rawUrl: string | undefined = process.env.CRM_DATABASE_URL): boolean {
  return Boolean(rawUrl?.trim())
}

/** Monta a configuração do pool. Erros nunca incluem o valor recebido. */
export function buildCrmPoolConfig(rawUrl: string | undefined): PoolConfig {
  const value = rawUrl?.trim()
  if (!value) throw new CrmDatabaseConfigError('MISSING')

  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new CrmDatabaseConfigError('INVALID')
  }
  if ((url.protocol !== 'postgres:' && url.protocol !== 'postgresql:') || !url.hostname) {
    throw new CrmDatabaseConfigError('INVALID')
  }

  for (const key of SSL_URL_PARAMS) url.searchParams.delete(key)

  return {
    connectionString: url.toString(),
    ssl: { rejectUnauthorized: true },
    max: CRM_DB_LIMITS.maxConnections,
    connectionTimeoutMillis: CRM_DB_LIMITS.connectionTimeoutMs,
    idleTimeoutMillis: CRM_DB_LIMITS.idleTimeoutMs,
    query_timeout: CRM_DB_LIMITS.queryTimeoutMs,
    allowExitOnIdle: true,
    application_name: 'cassiellos-crm',
  }
}

const globalForCrm = globalThis as typeof globalThis & { __cassiellosCrmPool?: Pool }

/** Pool reutilizado entre invocações da mesma instância (criado sob demanda). */
export function getCrmPool(): Pool {
  if (!globalForCrm.__cassiellosCrmPool) {
    const pool = new Pool(buildCrmPoolConfig(process.env.CRM_DATABASE_URL))
    pool.on('error', () => {
      // Erro em conexão ociosa (ex.: encerrada pelo servidor). Não derruba a função
      // e não registra detalhes para não expor dados de conexão.
      console.warn('[crm-db] idle client error')
    })
    globalForCrm.__cassiellosCrmPool = pool
  }
  return globalForCrm.__cassiellosCrmPool
}

/**
 * Executa `fn` dentro de uma transação READ ONLY com statement_timeout local.
 * Qualquer tentativa de escrita dentro dela é rejeitada pelo PostgreSQL.
 */
export async function withCrmReadOnlyTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getCrmPool().connect()
  let committed = false
  try {
    await client.query('BEGIN READ ONLY')
    await client.query(`SET LOCAL statement_timeout = ${CRM_DB_LIMITS.statementTimeoutMs}`)
    const result = await fn(client)
    await client.query('COMMIT')
    committed = true
    return result
  } finally {
    if (!committed) await client.query('ROLLBACK').catch(() => undefined)
    // Em caso de falha, descarta a conexão em vez de devolvê-la ao pool.
    client.release(committed ? undefined : true)
  }
}
