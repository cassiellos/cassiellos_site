/**
 * 0012 — caminho REAL de atualização, contra um PostgreSQL DESCARTÁVEL que tenha só as migrações 0001–0011:
 * (1) o Financeiro funciona sem a 0012 (controles indisponíveis, nada quebra); (2) dados financeiros são criados;
 * (3) a 0012 é aplicada; (4) tudo é preservado e os contratos existentes ficam "Não informado".
 * Executado só quando CRM_FINANCE_PRE0012_DATABASE_URL aponta para esse banco descartável (fica fora da suíte padrão).
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { Pool } from 'pg'
import { handleFinanceAdmin, type FinanceAdminRequest } from './admin-request'
import { resetAdminStatusCache } from './store'

const url = process.env.CRM_FINANCE_PRE0012_DATABASE_URL
const skip = !url ? 'CRM_FINANCE_PRE0012_DATABASE_URL não definida (banco descartável só com 0001–0011)' : false
type Body = Record<string, any>

describe('0012 — atualização de banco com dados existentes', { skip }, () => {
  let pool: Pool
  before(async () => { pool = new Pool({ connectionString: url, max: 4 }); resetAdminStatusCache() })
  after(async () => { await pool?.end() })
  const deps = () => ({ pool, now: () => new Date('2026-10-31T15:00:00Z'), log: () => undefined })
  const base: FinanceAdminRequest = { method: 'GET', vercelEnv: 'preview', sessionValid: true, originAllowed: true, contentType: 'application/json', actorRef: 'sessao-teste' }
  const post = async (action: string, payload: Body = {}) => handleFinanceAdmin(deps(), { ...base, method: 'POST', rawBody: JSON.stringify({ action, ...payload }) })
  const view = async () => (await handleFinanceAdmin(deps(), { ...base, searchParams: new URLSearchParams('month=2026-10') })).body
  const snapshot = async () => (await pool.query(`SELECT
      (SELECT json_agg(t ORDER BY id) FROM (SELECT id, amount_cents, status, end_date, generate_from, updated_at FROM crm.finance_sources) t) AS sources,
      (SELECT json_agg(t ORDER BY id) FROM (SELECT id, amount_cents, status, competence_month, due_date FROM crm.finance_entries) t) AS entries,
      (SELECT json_agg(t ORDER BY id) FROM (SELECT id, amount_cents, settled_on, reversed_at FROM crm.finance_settlements) t) AS settlements`)).rows[0]

  it('sem a 0012: Financeiro funciona; controles novos indisponíveis; nada quebra', async () => {
    const cols = await pool.query("SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'crm' AND table_name = 'finance_sources' AND column_name = 'service_status'")
    assert.equal(cols.rows[0].n, 0, 'este teste exige um banco SEM a 0012')
    const c = await post('client_create', { name: 'Cliente Fictício Upgrade ' + randomUUID().slice(0, 6) })
    assert.equal(c.status, 200)
    const s = await post('source_create', { direction: 'in', clientId: c.body.id, category: 'hosting', description: 'Contrato anterior à 0012', amount: '300', periodicity: 'monthly', startDate: '2026-10-01', dueDay: 31 })
    assert.equal(s.status, 200)
    const v = await view()
    assert.equal(v.migrationPending, false)
    assert.equal(v.adminStatusAvailable, false)
    const src = (v.sources as Body[]).find(x => x.id === s.body.id)!
    assert.deepEqual([src.serviceStatus, src.formalizationStatus], ['unknown', 'unknown'])
    const e = (v.entries as Body[]).find(x => x.sourceId === s.body.id)!
    assert.equal((await post('settle', { entryId: e.id, amount: '100', settledOn: '2026-10-10', idempotencyKey: randomUUID() })).status, 200)
    assert.deepEqual((await post('source_admin_status', { id: s.body.id, formalizationStatus: 'signed' })).body, { error: 'ADMIN_STATUS_MIGRATION_PENDING' })
    assert.equal((await post('source_create', { direction: 'in', clientId: c.body.id, category: 'hosting', description: 'Com estado', amount: '1', periodicity: 'one_time',
      startDate: '2026-10-01', dueDay: 1, formalizationStatus: 'sent' })).body.error, 'ADMIN_STATUS_MIGRATION_PENDING')
  })

  it('aplica a 0012 (duas vezes) e preserva todos os dados; existentes = "Não informado"', async () => {
    const before = await snapshot()
    const sql = readFileSync(join(process.cwd(), 'db/migrations/0012_finance_admin_status.sql'), 'utf8')
    await pool.query(sql)
    await pool.query(sql) // reexecutável
    assert.deepEqual(await snapshot(), before, 'nenhum valor, status, lançamento ou movimento mudou')
    const dist = await pool.query('SELECT service_status, formalization_status, count(*)::int AS n FROM crm.finance_sources GROUP BY 1, 2')
    assert.ok(dist.rows.every(r => r.service_status === 'unknown' && r.formalization_status === 'unknown'), JSON.stringify(dist.rows))
    const v = await view()
    assert.equal(v.adminStatusAvailable, true)
    const src = (v.sources as Body[]).find(x => x.description === 'Contrato anterior à 0012')!
    assert.equal((await post('source_admin_status', { id: src.id, serviceStatus: 'in_progress', formalizationStatus: 'awaiting_signature' })).status, 200)
    assert.deepEqual(await snapshot(), before, 'atualizar os estados não altera dados financeiros')
  })
})
