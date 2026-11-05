/**
 * Atribuição por lead contra PostgreSQL DESCARTÁVEL com as migrações do CRM (CRM_INTEGRATION_DATABASE_URL).
 * Confere que o SQL usado pela listagem e pelo Dashboard segue a MESMA regra de resolveLeadAttribution, com vários
 * envios do mesmo lead (com e sem UTM), e que a leitura não altera nenhum registro. Dados fictícios.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { Pool } from 'pg'
import { LEAD_ATTRIBUTION_COLUMNS, LEAD_ATTRIBUTION_JOINS, resolveLeadAttribution } from './lead-attribution'

const url = process.env.CRM_INTEGRATION_DATABASE_URL
const skip = !url ? 'CRM_INTEGRATION_DATABASE_URL não definida' : false

describe('atribuição por lead — SQL da listagem/Dashboard (banco descartável)', { skip }, () => {
  let pool: Pool
  before(() => { pool = new Pool({ connectionString: url, max: 4 }) })
  after(async () => { await pool?.end() })

  async function lead(subs: { at: string; attribution: Record<string, unknown> | null }[]) {
    const id = (await pool.query(`INSERT INTO crm.leads (full_name, email, is_test) VALUES ($1, $2, true) RETURNING id`,
      ['Lead Fictício', randomUUID() + '@example.invalid'])).rows[0].id as string
    for (const s of subs) {
      await pool.query(`INSERT INTO crm.form_submissions (lead_id, form_version, answers, idempotency_key, submitted_at)
        VALUES ($1, 'geral-v1', $2::jsonb, $3, $4)`, [id, JSON.stringify(s.attribution === null ? {} : { attribution: s.attribution }), randomUUID(), s.at])
    }
    return id
  }
  const read = async (id: string) => (await pool.query(`SELECT ${LEAD_ATTRIBUTION_COLUMNS} FROM crm.leads l ${LEAD_ATTRIBUTION_JOINS} WHERE l.id = $1`, [id])).rows[0]
  const snapshot = async (id: string) => JSON.stringify((await pool.query(
    `SELECT id, answers, submitted_at FROM crm.form_submissions WHERE lead_id = $1 ORDER BY id`, [id])).rows)

  const cases: { name: string; subs: { at: string; attribution: Record<string, unknown> | null }[]; primary: string | null; latest: string | null }[] = [
    { name: 'campanha e depois formulário sem UTM', primary: 'meta', latest: 'meta', subs: [
      { at: '2026-11-01T10:00:00Z', attribution: { utm_source: 'meta', utm_medium: 'paid_social', utm_campaign: 'c1' } },
      { at: '2026-11-03T10:00:00Z', attribution: {} }, { at: '2026-11-04T10:00:00Z', attribution: null }] },
    { name: 'sem UTM e depois campanha', primary: 'google', latest: 'google', subs: [
      { at: '2026-11-01T10:00:00Z', attribution: { utm_source: '  ' } },
      { at: '2026-11-02T10:00:00Z', attribution: { utm_source: 'google', utm_medium: 'cpc' } }] },
    { name: 'duas campanhas + envio sem UTM', primary: 'meta', latest: 'google', subs: [
      { at: '2026-11-05T10:00:00Z', attribution: {} },
      { at: '2026-11-03T10:00:00Z', attribution: { utm_source: 'google', utm_medium: 'cpc' } },
      { at: '2026-11-01T10:00:00Z', attribution: { utm_source: 'meta', utm_medium: 'paid_social' } }] },
    { name: 'nenhuma origem válida', primary: null, latest: null, subs: [
      { at: '2026-11-01T10:00:00Z', attribution: { utm_content: 'x', fbclid: 'y' } }, { at: '2026-11-02T10:00:00Z', attribution: {} }] },
  ]

  for (const c of cases) {
    it(c.name + ': SQL = regra em TypeScript; leitura não altera registros', async () => {
      const id = await lead(c.subs)
      const before = await snapshot(id)
      const row = await read(id)
      assert.equal(row.utm_source, c.primary)
      assert.equal(row.latest_utm_source, c.latest)
      const ts = resolveLeadAttribution(c.subs.map((s, i) => ({ id: String(i), submittedAt: s.at, attribution: s.attribution })))
      assert.equal(row.utm_source, ts.primary?.source ?? null)
      assert.equal(row.latest_utm_source, ts.latest?.source ?? null)
      assert.equal(row.attribution_at ? new Date(row.attribution_at).toISOString() : null, ts.primary?.at ?? null)
      assert.equal(await snapshot(id), before)
    })
  }
})
