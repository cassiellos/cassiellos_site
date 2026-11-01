import type { Pool } from 'pg'

/**
 * Apoio EXCLUSIVO dos testes da integração Asaas (Fase 2.2A). Barreira dupla antes de qualquer gravação:
 *  1. a URL precisa apontar para um PostgreSQL LOCAL (127.0.0.1 / localhost / ::1) — nunca Neon nem host remoto;
 *  2. o banco precisa ter o marcador criado por scripts/crm-local-sandbox-db.sh (crm_local_test.marker), com o
 *     modo esperado. O Neon (Preview ou Production) nunca tem esse marcador.
 * Não é importado por nenhum código de aplicação.
 */
export function assertLocalDatabaseUrl(url: string): void {
  let u: URL
  try { u = new URL(url) } catch { throw new Error('URL de banco de teste inválida') }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new Error('URL de banco de teste inválida')
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) || /neon/i.test(url)) {
    throw new Error('teste recusado: o banco de teste precisa ser PostgreSQL local descartável')
  }
}

export async function assertDisposableDatabase(pool: Pool, url: string, mode: 'sandbox' | 'fresh16' | 'pre16'): Promise<void> {
  assertLocalDatabaseUrl(url)
  const r = await pool.query(`SELECT to_regclass('crm_local_test.marker') IS NOT NULL AS ok`)
  if (!r.rows[0].ok) throw new Error('teste recusado: banco sem marcador local descartável')
  const m = await pool.query(`SELECT mode FROM crm_local_test.marker WHERE kind = 'disposable-local'`)
  if (m.rows[0]?.mode !== mode) throw new Error(`teste recusado: banco local criado para '${m.rows[0]?.mode}', esperado '${mode}'`)
}
