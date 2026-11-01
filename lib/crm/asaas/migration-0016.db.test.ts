/**
 * Fase 2.2A — migração 0016 em PostgreSQL LOCAL descartável com 0001–0015 (CRM_ASAAS_MIGRATION_DATABASE_URL, criado
 * por `scripts/crm-local-sandbox-db.sh create crm_local_asaas_migration pre16`). Aplica, reaplica (idempotência),
 * confere estrutura, ligação Sandbox, recusas a Production e reversão. CONSOME o banco (fica com a 0016 aplicada e
 * ligado a sandbox): recrie-o a cada execução. Nunca aplicar em Neon.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { Pool, type PoolClient } from 'pg'
import { handleFinanceAdmin, type FinanceAdminRequest } from '../finance/admin-request'
import { linkSubscription, bindAsaasEnvironment } from './store'
import { subscriptionFixture } from './fixtures'
import { assertDisposableDatabase } from './test-support'

const url = process.env.CRM_ASAAS_MIGRATION_DATABASE_URL
const skip = !url ? 'CRM_ASAAS_MIGRATION_DATABASE_URL não definida (banco local descartável só com 0001–0015)' : false
const root = join(__dirname, '..', '..', '..')
const sql = (p: string) => readFileSync(join(root, p), 'utf8')
const MIGRATION = 'db/migrations/0016_finance_asaas_foundation.sql'
const ROLLBACK = 'db/ops/0016_rollback.sql'
const CHECKS = 'db/ops/0016_pre_post_checks.sql'
const TABLES = ['finance_asaas_binding', 'finance_asaas_customers', 'finance_asaas_events', 'finance_asaas_payment_settlements',
  'finance_asaas_payments', 'finance_asaas_subscriptions', 'finance_integration_log']
const INDEXES = ['uq_finance_asaas_customers_external', 'uq_finance_asaas_customers_client', 'uq_finance_asaas_subscriptions_external',
  'uq_finance_asaas_subscriptions_source_any_env', 'uq_finance_asaas_payments_external', 'uq_finance_asaas_payments_entry_primary',
  'idx_finance_asaas_payments_subscription', 'idx_finance_asaas_payments_review', 'uq_finance_asaas_payment_settlements_settlement',
  'uq_finance_asaas_events', 'idx_finance_asaas_events_pending', 'idx_finance_integration_log_ref']
const ENV_FKS = ['finance_asaas_customers_env', 'finance_asaas_subscriptions_env', 'finance_asaas_payments_env', 'finance_asaas_events_env',
  'finance_integration_log_env']

describe('Fase 2.2A — migração 0016 em banco local descartável', { skip }, () => {
  let pool: Pool
  before(async () => {
    pool = new Pool({ connectionString: url, max: 4 })
    await assertDisposableDatabase(pool, url!, 'pre16')
  })
  after(async () => { await pool?.end() })

  /** Executa um arquivo SQL com BEGIN/COMMIT numa conexão dedicada; em erro, desfaz e devolve a conexão limpa. */
  async function runFile(path: string): Promise<void> {
    const c: PoolClient = await pool.connect()
    try { await c.query(sql(path)) } catch (e) { await c.query('ROLLBACK').catch(() => undefined); throw e } finally { c.release() }
  }
  const tables = async () => (await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'crm'
    AND table_name = ANY($1) ORDER BY 1`, [TABLES])).rows.map(r => r.table_name)
  const snapshot = async () => (await pool.query(`SELECT 'sources' t, count(*)::int n, coalesce(sum(amount_cents), 0)::bigint s FROM crm.finance_sources
    UNION ALL SELECT 'entries', count(*)::int, coalesce(sum(amount_cents), 0)::bigint FROM crm.finance_entries
    UNION ALL SELECT 'settlements', count(*)::int, coalesce(sum(amount_cents), 0)::bigint FROM crm.finance_settlements
    UNION ALL SELECT 'clients', count(*)::int, 0 FROM crm.finance_clients ORDER BY 1`)).rows
  const base: FinanceAdminRequest = { method: 'POST', vercelEnv: 'preview', sessionValid: true, originAllowed: true, contentType: 'application/json', actorRef: 'mig' }
  const fin = async (action: string, b: Record<string, unknown>) => (await handleFinanceAdmin({ pool, now: () => new Date('2026-10-31T15:00:00Z'), log: () => undefined },
    { ...base, rawBody: JSON.stringify({ action, ...b }) })).body as Record<string, string>
  let sourceId = ''
  let before0016: unknown

  it('pré-requisitos: 0011 e 0015 presentes, 0016 ausente; dados financeiros sintéticos existentes', async () => {
    const pre = (await pool.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema = 'crm' AND
      ((table_name = 'finance_sources' AND column_name = 'installment_plan') OR (table_name = 'finance_entries' AND column_name = 'project_source_id'))`)).rows[0].n
    assert.equal(pre, 2)
    assert.deepEqual(await tables(), [], 'o banco deve estar SEM a 0016')
    const clientId = (await fin('client_create', { name: 'Cliente Fictício Migração' })).id
    sourceId = (await fin('source_create', { direction: 'in', clientId, category: 'hosting', description: 'Hospedagem fictícia', amount: '69,90',
      periodicity: 'monthly', startDate: '2026-10-01', dueDay: 30 })).id
    assert.ok(sourceId)
    before0016 = await snapshot()
  })

  it('aplicação e reaplicação (idempotente): estrutura completa, dados existentes intactos, todos "manual"', async () => {
    await runFile(MIGRATION)
    await runFile(MIGRATION)
    assert.deepEqual(await tables(), TABLES)
    const idx = (await pool.query(`SELECT indexname FROM pg_indexes WHERE schemaname = 'crm' AND indexname = ANY($1)`, [INDEXES])).rows.map(r => r.indexname)
    assert.deepEqual(idx.sort(), [...INDEXES].sort())
    const fks = (await pool.query(`SELECT conname FROM pg_constraint WHERE contype = 'f' AND conname = ANY($1)`, [ENV_FKS])).rows.map(r => r.conname)
    assert.deepEqual(fks.sort(), [...ENV_FKS].sort())
    assert.equal((await pool.query(`SELECT count(*)::int n FROM pg_constraint WHERE conname = 'finance_sources_billing_provider'`)).rows[0].n, 1, 'sem duplicar constraint')
    assert.equal((await pool.query(`SELECT count(*)::int n FROM pg_trigger WHERE tgname = 'trg_finance_asaas_payment_settlement_check'`)).rows[0].n, 1, 'sem duplicar gatilho')
    assert.deepEqual(await snapshot(), before0016)
    assert.deepEqual((await pool.query('SELECT DISTINCT billing_provider FROM crm.finance_sources')).rows, [{ billing_provider: 'manual' }])
    assert.equal((await pool.query('SELECT count(*)::int n FROM crm.finance_asaas_binding')).rows[0].n, 0, 'a migração não liga ambiente')
    // as conferências pré/pós (somente leitura) rodam sem erro
    await runFile(CHECKS)
  })

  it('reversão em banco sem dados da integração: remove só a 0016; dados financeiros preservados; reaplicável', async () => {
    await runFile(ROLLBACK)
    assert.deepEqual(await tables(), [])
    assert.equal((await pool.query(`SELECT count(*)::int n FROM information_schema.columns WHERE table_schema = 'crm'
      AND table_name = 'finance_sources' AND column_name = 'billing_provider'`)).rows[0].n, 0)
    assert.deepEqual(await snapshot(), before0016)
    await runFile(MIGRATION)
    assert.deepEqual(await tables(), TABLES)
  })

  it('ligação Sandbox; tentativas de Production recusadas; constraints de valor/formato ativas', async () => {
    await bindAsaasEnvironment(pool, 'sandbox', 'mig')
    await assert.rejects(bindAsaasEnvironment(pool, 'production', 'mig'), (e: { code?: string }) => e.code === 'ENVIRONMENT_ALREADY_BOUND')
    await assert.rejects(linkSubscription(pool, { environment: 'production', sourceId, subscription: subscriptionFixture('sub_mig000001') }, 'mig'),
      (e: { code?: string }) => e.code === 'ENVIRONMENT_MISMATCH')
    await assert.rejects(pool.query(`INSERT INTO crm.finance_asaas_subscriptions (environment, source_id, asaas_subscription_id, value_cents, cycle, created_by)
      VALUES ('production', $1, 'sub_mig000002', 6990, 'MONTHLY', 'x')`, [sourceId]), (e: { code?: string }) => e.code === '23503')
    for (const [col, val] of [['asaas_subscription_id', "'assinatura'"], ['value_cents', '0'], ['cycle', "'DAILY'"]]) {
      const cols = { asaas_subscription_id: "'sub_mig000003'", value_cents: '6990', cycle: "'MONTHLY'", [col]: val }
      await assert.rejects(pool.query(`INSERT INTO crm.finance_asaas_subscriptions (environment, source_id, asaas_subscription_id, value_cents, cycle, created_by)
        VALUES ('sandbox', $1, ${cols.asaas_subscription_id}, ${cols.value_cents}, ${cols.cycle}, 'x')`, [sourceId]), (e: { code?: string }) => e.code === '23514', col)
    }
    await assert.rejects(pool.query(`UPDATE crm.finance_sources SET billing_provider = 'outro' WHERE id = $1`, [sourceId]), (e: { code?: string }) => e.code === '23514')
  })

  it('reversão RECUSADA quando há dados da integração; nada é apagado', async () => {
    await linkSubscription(pool, { environment: 'sandbox', sourceId, subscription: subscriptionFixture('sub_mig000009') }, 'mig')
    await assert.rejects(runFile(ROLLBACK), /há dados de integração/)
    assert.deepEqual(await tables(), TABLES)
    assert.equal((await pool.query('SELECT count(*)::int n FROM crm.finance_asaas_subscriptions')).rows[0].n, 1)
    assert.equal((await pool.query('SELECT billing_provider FROM crm.finance_sources WHERE id = $1', [sourceId])).rows[0].billing_provider, 'asaas_subscription')
  })
})
