import { createHmac } from 'node:crypto'
import type { Pool } from 'pg'

/**
 * Limites por IP do agendamento público (comportamento preservado da Fase 2/3):
 * - cadastro do formulário: 10 envios por hora por IP;
 * - consulta de horários: 50 consultas a cada 15 minutos por IP.
 * O IP nunca é gravado: só um HMAC (CRM_SESSION_SECRET) por escopo.
 */
export type RequestLimit = {
  table: 'booking_intake_limits' | 'booking_availability_limits'
  scope: string
  windowSql: '1 hour' | '15 minutes'
  maxRequests: number
}

export const INTAKE_LIMIT: RequestLimit = {
  table: 'booking_intake_limits', scope: 'booking-lead-intake:', windowSql: '1 hour', maxRequests: 10,
}
export const AVAILABILITY_LIMIT: RequestLimit = {
  table: 'booking_availability_limits', scope: 'calendar-availability:', windowSql: '15 minutes', maxRequests: 50,
}

/** HMAC do IP por escopo; null quando o segredo não está configurado (falha fechada). */
export function requestFingerprint(limit: RequestLimit, forwardedFor: string | null,
  secret: string | undefined = process.env.CRM_SESSION_SECRET): string | null {
  if (!secret || !/^[0-9a-f]{64,}$/i.test(secret)) return null
  return createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(limit.scope + (forwardedFor || 'unknown').slice(0, 128))
    .digest('hex')
}

/** Registra a requisição e informa se ainda está dentro do limite. */
export async function consumeRequestQuota(db: Pick<Pool, 'query'>, limit: RequestLimit,
  fingerprint: string): Promise<boolean> {
  // Table and window come only from the fixed RequestLimit constants above.
  const t = 'crm.' + limit.table
  const result = await db.query<{ request_count: number }>(
    `INSERT INTO ${t} (fingerprint, window_started_at, request_count, last_request_at)
      VALUES ($1, now(), 1, now())
      ON CONFLICT (fingerprint) DO UPDATE SET
        request_count = CASE WHEN ${t}.window_started_at < now() - interval '${limit.windowSql}'
          THEN 1 ELSE ${t}.request_count + 1 END,
        window_started_at = CASE WHEN ${t}.window_started_at < now() - interval '${limit.windowSql}'
          THEN now() ELSE ${t}.window_started_at END,
        last_request_at = now()
      RETURNING request_count`,
    [fingerprint],
  )
  return (result.rows[0]?.request_count ?? Number.MAX_SAFE_INTEGER) <= limit.maxRequests
}
