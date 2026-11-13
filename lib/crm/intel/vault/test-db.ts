/**
 * Somente testes: conexão ao PostgreSQL LOCAL e DESCARTÁVEL com as migrações 0001–0019
 * (scripts/crm-local-sandbox-db.sh create crm_local_mi_real fresh19). Recusa qualquer banco que não seja local crm_local_*.
 */
import assert from 'node:assert/strict'
import { Pool } from 'pg'

export const REAL_DB_URL = process.env.CRM_MI_REAL_DATABASE_URL
export const REAL_DB_SKIP = !REAL_DB_URL ? 'CRM_MI_REAL_DATABASE_URL não definida' : false

export async function openLocalPool(): Promise<Pool> {
  const pool = new Pool({ connectionString: REAL_DB_URL, max: 6 })
  const { rows } = await pool.query(`SELECT current_database() AS db, host(inet_server_addr()) AS host`)
  assert.match(rows[0].db, /^crm_local_/, 'somente bancos locais crm_local_*')
  assert.ok(rows[0].host === null || rows[0].host === '127.0.0.1' || rows[0].host === '::1', 'somente servidor local')
  return pool
}

/** Limpa os dados da Central (nunca as tabelas do CRM). */
export async function resetIntelTables(pool: Pool): Promise<void> {
  await pool.query(`TRUNCATE crm.mi_alerts, crm.mi_ads_daily, crm.mi_ga4_daily, crm.mi_gtm_snapshot, crm.mi_sync_jobs, crm.mi_campaigns,
    crm.mi_audit_log, crm.mi_client_assets, crm.mi_asset_access, crm.mi_assets, crm.mi_connections, crm.mi_clients,
    crm.mi_credentials, crm.mi_oauth_states, crm.mi_rate_marks, crm.mi_rate_limits RESTART IDENTITY CASCADE`)
}

export const testKey = (n: number) => Buffer.alloc(32, n).toString('base64')
