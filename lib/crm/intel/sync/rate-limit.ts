/**
 * Limites PERSISTENTES e DISTRIBUÍDOS (substituem o controle N2 em memória no modo real). Tabelas da migração 0019.
 * Cada operação é UMA instrução SQL atômica: duas instâncias concorrentes nunca passam ambas do limite.
 */
import type { Queryable } from '../vault/pg-vault'

export type Gate = { allowed: true } | { allowed: false; retryAt: string }

/** Intervalo mínimo por chave (ex.: `manual_sync:<assetId>` a cada 15 min). Reserva e consome numa só instrução. */
export async function reserveInterval(db: Queryable, key: string, now: Date, minIntervalMs: number): Promise<Gate> {
  const { rows } = await db.query(
    `INSERT INTO crm.mi_rate_marks (key, last_at) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET last_at = EXCLUDED.last_at WHERE crm.mi_rate_marks.last_at <= $2 - make_interval(secs => $3)
     RETURNING last_at`, [key, now, minIntervalMs / 1000])
  if (rows[0]) return { allowed: true }
  const cur = await db.query(`SELECT last_at FROM crm.mi_rate_marks WHERE key = $1`, [key])
  const last = cur.rows[0] ? new Date(cur.rows[0].last_at as string).getTime() : now.getTime()
  return { allowed: false, retryAt: new Date(last + minIntervalMs).toISOString() }
}

/** Último uso registrado para a chave (para a interface exibir "disponível às …"). */
export async function lastMark(db: Queryable, key: string): Promise<string | null> {
  const { rows } = await db.query(`SELECT last_at FROM crm.mi_rate_marks WHERE key = $1`, [key])
  return rows[0] ? new Date(rows[0].last_at as string).toISOString() : null
}

/** Teto por janela fixa (ex.: `manual_sync_global` 20 por minuto). */
export async function hitWindow(db: Queryable, bucket: string, now: Date, windowMs: number, limit: number): Promise<Gate> {
  const start = new Date(Math.floor(now.getTime() / windowMs) * windowMs)
  const { rows } = await db.query(
    `INSERT INTO crm.mi_rate_limits (bucket, window_start, hits) VALUES ($1, $2, 1)
     ON CONFLICT (bucket, window_start) DO UPDATE SET hits = crm.mi_rate_limits.hits + 1 WHERE crm.mi_rate_limits.hits < $3
     RETURNING hits`, [bucket, start, limit])
  if (Math.random() < 0.02) await db.query(`DELETE FROM crm.mi_rate_limits WHERE window_start < $1`, [new Date(now.getTime() - 86_400_000)])
  return rows[0] ? { allowed: true } : { allowed: false, retryAt: new Date(start.getTime() + windowMs).toISOString() }
}
