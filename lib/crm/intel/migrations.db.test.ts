/**
 * Migrações 0017 + 0018 em PostgreSQL LOCAL e DESCARTÁVEL (CRM_MI_DATABASE_URL: banco com 0001–0016, criado por
 * scripts/crm-local-sandbox-db.sh create crm_local_mi fresh16). Nunca Neon. Dados sintéticos.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { Pool } from 'pg'
import { CLIENT_ADS_ROWS_SQL, START_SYNC_JOB_SQL, UPSERT_ADS_DAILY_SQL } from './sql'

const url = process.env.CRM_MI_DATABASE_URL
const skip = !url ? 'CRM_MI_DATABASE_URL não definida' : false
const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8')
const M17 = read('db/migrations/0017_marketing_intel_foundation.sql')
const M18 = read('db/migrations/0018_marketing_intel_metrics.sql')
const ROLLBACK = read('db/ops/0017_0018_marketing_intel_rollback.sql')

describe('Central — migrações 0017/0018 (banco descartável)', { skip }, () => {
  let pool: Pool
  before(async () => {
    pool = new Pool({ connectionString: url, max: 4 })
    const { rows } = await pool.query(`SELECT current_database() AS db, host(inet_server_addr()) AS host`)
    assert.match(rows[0].db, /^crm_local_/, 'somente bancos locais crm_local_*')
    assert.ok(rows[0].host === null || rows[0].host === '127.0.0.1' || rows[0].host === '::1', 'somente servidor local')
    await pool.query(ROLLBACK)
  })
  after(async () => { await pool?.query(ROLLBACK).catch(() => undefined); await pool?.end() })
  const q = (sql: string, params: unknown[] = []) => pool.query(sql, params)
  const code = async (sql: string, params: unknown[] = []) => { try { await q(sql, params); return 'ok' } catch (e) { return (e as { code?: string }).code ?? 'erro' } }

  it('aplica 0017 e 0018, é reexecutável e cria exatamente as 12 tabelas mi_*', async () => {
    const before = (await q(`SELECT pg_get_constraintdef(c.oid) AS d FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = 'crm' AND t.relname = 'integration_credentials' ORDER BY 1`)).rows
    const tablesBefore = (await q(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'crm' AND table_name NOT LIKE 'mi\\_%'`)).rows[0].n
    await q(M17); await q(M18); await q(M17); await q(M18)
    const mi = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'crm' AND table_name LIKE 'mi\\_%' ORDER BY 1`)).rows.map(r => r.table_name)
    assert.deepEqual(mi, ['mi_ads_daily', 'mi_alerts', 'mi_asset_access', 'mi_assets', 'mi_audit_log', 'mi_campaigns', 'mi_client_assets', 'mi_clients', 'mi_connections', 'mi_ga4_daily', 'mi_gtm_snapshot', 'mi_sync_jobs'])
    const after = (await q(`SELECT pg_get_constraintdef(c.oid) AS d FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
      JOIN pg_namespace n ON n.oid = t.relnamespace WHERE n.nspname = 'crm' AND t.relname = 'integration_credentials' ORDER BY 1`)).rows
    assert.deepEqual(after, before, 'crm.integration_credentials (Google Calendar) intacta')
    assert.equal((await q(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'crm' AND table_name NOT LIKE 'mi\\_%'`)).rows[0].n, tablesBefore)
    const secret = (await q(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'crm' AND table_name LIKE 'mi\\_%' AND column_name ~ '(token|secret|password|refresh|api_key)'`)).rows
    assert.deepEqual(secret, [], 'nenhuma coluna de segredo')
  })

  it('clientes monitorados separados do Financeiro; vínculo opcional e único; uma só agência', async () => {
    const fin = (await q(`INSERT INTO crm.finance_clients (name) VALUES ('Financeiro Fictício') RETURNING id`)).rows[0].id
    const agency = (await q(`INSERT INTO crm.mi_clients (name, kind) VALUES ('Cassiellos Demo', 'agency') RETURNING id`)).rows[0].id
    assert.ok(agency)
    assert.equal(await code(`INSERT INTO crm.mi_clients (name, kind) VALUES ('Outra agência', 'agency')`), '23505')
    await q(`INSERT INTO crm.mi_clients (name, finance_client_id) VALUES ('Cliente Vinculado', $1)`, [fin])
    assert.equal(await code(`INSERT INTO crm.mi_clients (name, finance_client_id) VALUES ('Duplicado', $1)`, [fin]), '23505')
    await q(`INSERT INTO crm.mi_clients (name) VALUES ('Cliente sem Financeiro')`)
    assert.equal(await code(`DELETE FROM crm.finance_clients WHERE id = $1`, [fin]), '23503', 'Financeiro não pode ser apagado sob vínculo')
  })

  it('credenciais: só referência opaca; conexão ativa exige referência; formato validado', async () => {
    assert.equal(await code(`INSERT INTO crm.mi_connections (provider, auth_kind, label, status) VALUES ('google', 'oauth_user', 'Teste', 'active')`), '23514')
    assert.equal(await code(`INSERT INTO crm.mi_connections (provider, auth_kind, label, status, credential_ref) VALUES ('google', 'oauth_user', 'Teste', 'active', 'ya29.token-em-claro')`), '23514')
    assert.equal(await code(`INSERT INTO crm.mi_connections (provider, auth_kind, label, status, credential_ref) VALUES ('google', 'oauth_user', 'Teste', 'active', 'vault:google:abcdefghij0123456789')`), 'ok')
    assert.equal(await code(`INSERT INTO crm.mi_connections (provider, auth_kind, label) VALUES ('tiktok', 'oauth_user', 'Teste')`), '23514')
  })

  it('identidade externa normalizada e única por plataforma + contexto', async () => {
    assert.equal(await code(`INSERT INTO crm.mi_assets (platform, external_id, name) VALUES ('google_ads', '415-813-9811', 'x')`), '23514', 'com hífens é recusado')
    await q(`INSERT INTO crm.mi_assets (platform, external_id, name, currency_code, time_zone) VALUES ('google_ads', '9000000201', 'Conta A', 'BRL', 'America/Sao_Paulo')`)
    assert.equal(await code(`INSERT INTO crm.mi_assets (platform, external_id, name) VALUES ('google_ads', '9000000201', 'Duplicada')`), '23505')
    assert.equal(await code(`INSERT INTO crm.mi_assets (platform, external_id, name) VALUES ('meta_ads', 'act_123456', 'x')`), '23514')
    assert.equal(await code(`INSERT INTO crm.mi_assets (platform, external_id, external_context, name) VALUES ('gtm', 'GTM-DEMOA01', '9000201', 'Contêiner')`), 'ok')
    assert.equal(await code(`INSERT INTO crm.mi_assets (platform, external_id, external_context, name) VALUES ('gtm', 'GTM-DEMOA01', '9000202', 'Mesmo ID em outra conta')`), 'ok')
    assert.equal(await code(`INSERT INTO crm.mi_assets (platform, external_id, name, currency_code) VALUES ('meta_ads', '900000000000401', 'x', 'usd')`), '23514')
  })

  it('vínculos: confirmado exige validação; um dono confirmado por ativo; prováveis fora das métricas; MCC exige login-customer-id', async () => {
    const [a, b] = (await q(`INSERT INTO crm.mi_clients (name) VALUES ('Cliente Exemplo A'), ('Cliente Exemplo B') RETURNING id`)).rows.map(r => r.id)
    const asset = (await q(`SELECT id FROM crm.mi_assets WHERE external_id = '9000000201'`)).rows[0].id
    assert.equal(await code(`INSERT INTO crm.mi_client_assets (client_id, asset_id, status) VALUES ($1, $2, 'confirmed')`, [a, asset]), '23514')
    await q(`INSERT INTO crm.mi_client_assets (client_id, asset_id, status, validated_by, validated_at) VALUES ($1, $2, 'confirmed', 'admin', now())`, [a, asset])
    assert.equal(await code(`INSERT INTO crm.mi_client_assets (client_id, asset_id, status, validated_by, validated_at) VALUES ($1, $2, 'confirmed', 'admin', now())`, [b, asset]), '23505', 'mesma conta confirmada para dois clientes')
    assert.equal(await code(`INSERT INTO crm.mi_client_assets (client_id, asset_id, status, validated_by, validated_at, shared_justification) VALUES ($1, $2, 'confirmed', 'admin', now(), 'Conta compartilhada pela franquia, validada pelo titular')`, [b, asset]), 'ok')
    const conn = (await q(`SELECT id FROM crm.mi_connections LIMIT 1`)).rows[0].id
    assert.equal(await code(`INSERT INTO crm.mi_asset_access (asset_id, connection_id, access_path) VALUES ($1, $2, 'manager')`, [asset, conn]), '23514')
    assert.equal(await code(`INSERT INTO crm.mi_asset_access (asset_id, connection_id, access_path, login_customer_id) VALUES ($1, $2, 'manager', '9000000001')`, [asset, conn]), 'ok')
    assert.equal(await code(`INSERT INTO crm.mi_asset_access (asset_id, connection_id, access_path) VALUES ($1, $2, 'direct')`, [asset, conn]), 'ok')
    // encerramento lógico preserva histórico
    assert.equal(await code(`UPDATE crm.mi_client_assets SET status = 'ended' WHERE client_id = $1`, [b]), '23514', 'ended exige valid_to')
    await q(`UPDATE crm.mi_client_assets SET status = 'ended', valid_to = now() WHERE client_id = $1`, [b])
  })

  it('métricas diárias: upsert idempotente; só vínculos confirmados alimentam a consulta do cliente', async () => {
    const asset = (await q(`SELECT id FROM crm.mi_assets WHERE external_id = '9000000201'`)).rows[0].id
    const camp = (await q(`INSERT INTO crm.mi_campaigns (asset_id, external_id, name, status) VALUES ($1, '82001', 'Institucional · Marca', 'active') RETURNING id`, [asset])).rows[0].id
    const row = [asset, camp, '2026-12-31', 'google:conversions', 'BRL', 1000, 50, 125_000_000, '3.5', null, 'google:modelo-da-conta', null]
    assert.equal((await q(UPSERT_ADS_DAILY_SQL, row)).rows[0].inserted, true)
    assert.equal((await q(UPSERT_ADS_DAILY_SQL, row)).rowCount, 0, 'repetida: nada gravado')
    const changed = [...row]; changed[7] = 126_000_000
    assert.equal((await q(UPSERT_ADS_DAILY_SQL, changed)).rows[0].inserted, false, 'recontabilização: atualiza')
    assert.equal((await q(`SELECT count(*)::int AS n FROM crm.mi_ads_daily`)).rows[0].n, 1)
    await q(UPSERT_ADS_DAILY_SQL, [asset, camp, '2027-01-01', 'google:conversions', 'BRL', 0, 0, 0, null, null, 'google:modelo-da-conta', null])
    assert.equal(await code(UPSERT_ADS_DAILY_SQL, [asset, camp, '2027-01-02', 'google:conversions', 'BRL', -1, 0, 0, null, null, 'x-y', null]), '23514')
    const a = (await q(`SELECT id FROM crm.mi_clients WHERE name = 'Cliente Exemplo A'`)).rows[0].id
    const rows = (await q(CLIENT_ADS_ROWS_SQL, [a, '2026-12-01', '2027-01-31'])).rows
    assert.deepEqual(rows.map(r => [r.day, r.conversions === null ? null : Number(r.conversions)]), [['2026-12-31', 3.5], ['2027-01-01', null]], 'data civil preservada; NULL ≠ 0')
    // vínculo apenas PROVÁVEL não alimenta
    const c = (await q(`INSERT INTO crm.mi_clients (name) VALUES ('Cliente Exemplo C') RETURNING id`)).rows[0].id
    await q(`INSERT INTO crm.mi_client_assets (client_id, asset_id, status) VALUES ($1, $2, 'probable')`, [c, asset])
    assert.equal((await q(CLIENT_ADS_ROWS_SQL, [c, '2026-12-01', '2027-01-31'])).rowCount, 0)
    const b = (await q(`SELECT id FROM crm.mi_clients WHERE name = 'Cliente Exemplo B'`)).rows[0].id
    assert.equal((await q(CLIENT_ADS_ROWS_SQL, [b, '2026-12-01', '2027-01-31'])).rowCount, 0, 'vínculo encerrado não alimenta')
  })

  it('fila: uma execução em andamento por ativo; registro de erro sanitizado; alertas deduplicados', async () => {
    const asset = (await q(`SELECT id FROM crm.mi_assets WHERE external_id = '9000000201'`)).rows[0].id
    const first = await q(START_SYNC_JOB_SQL, [asset, 'ads_daily', 'schedule', '2026-11-06', '2026-11-12', 'w1', 300])
    assert.equal(first.rowCount, 1)
    const second = await q(START_SYNC_JOB_SQL, [asset, 'ads_daily', 'manual', '2026-11-06', '2026-11-12', 'w2', 300])
    assert.equal(second.rowCount, 0, 'concorrente recusada pelo índice único')
    await q(`UPDATE crm.mi_sync_jobs SET status = 'partial', lease_owner = NULL, lease_until = NULL, attempts = 4, error_kind = 'transient', error_message = 'falha temporária', finished_at = now() WHERE id = $1`, [first.rows[0].id])
    assert.equal((await q(START_SYNC_JOB_SQL, [asset, 'ads_daily', 'manual', '2026-11-06', '2026-11-12', 'w2', 300])).rowCount, 1, 'retomada após liberar')
    assert.equal(await code(`INSERT INTO crm.mi_sync_jobs (asset_id, kind, trigger, range_start, range_end, status, error_message) VALUES ($1, 'ads_daily', 'manual', '2026-11-12', '2026-11-06', 'failed', 'x')`, [asset]), '23514', 'janela invertida')
    await q(`INSERT INTO crm.mi_alerts (scope, asset_id, kind, message) VALUES ('asset', $1, 'auth_expired', 'expirada')`, [asset])
    assert.equal(await code(`INSERT INTO crm.mi_alerts (scope, asset_id, kind, message) VALUES ('asset', $1, 'auth_expired', 'de novo')`, [asset]), '23505')
    assert.equal(await code(`INSERT INTO crm.mi_alerts (scope, kind) VALUES ('asset', 'auth_expired')`), '23514')
    assert.equal(await code(`INSERT INTO crm.mi_audit_log (actor, action, entity, entity_id, details) VALUES ('admin', 'link_confirmed', 'client_asset', 'x', '[]')`), '23514')
  })

  it('reversão remove só as tabelas mi_* e é reexecutável', async () => {
    await q(ROLLBACK); await q(ROLLBACK)
    assert.equal((await q(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'crm' AND table_name LIKE 'mi\\_%'`)).rows[0].n, 0)
    assert.equal((await q(`SELECT to_regclass('crm.finance_clients') IS NOT NULL AS ok, to_regclass('crm.integration_credentials') IS NOT NULL AS cal`)).rows[0].ok, true)
  })
})
