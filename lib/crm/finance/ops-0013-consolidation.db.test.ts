/**
 * db/ops/0013 — consolidação das despesas de outubro, executada com o psql contra um PostgreSQL DESCARTÁVEL com as
 * migrações 0001–0012. Reproduz o cenário verificado no Preview (valores reais da estrutura, dados de cliente
 * fictícios): 10 fontes recorrentes + 9 avulsas de out/2026 encerradas e quitadas, Contabilidade em aberto, receitas
 * recebidas em outubro e a dívida de setembro da Gira Motopeças.
 * Só roda quando CRM_FINANCE_OPS_DATABASE_URL aponta para um banco descartável (fica fora da suíte padrão).
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { Pool } from 'pg'
import { handleFinanceAdmin, type FinanceAdminRequest } from './admin-request'

const url = process.env.CRM_FINANCE_OPS_DATABASE_URL
const skip = !url ? 'CRM_FINANCE_OPS_DATABASE_URL não definida (banco descartável com 0001–0012)' : false
type Body = Record<string, any>
const OPS = (f: string) => join(process.cwd(), 'db/ops', f)

const RECURRING = [
  ['Adobe', '55,00', 'software', 10], ['Claude', '580,00', 'software', 10], ['Figma', '120,00', 'software', 10], ['GPT', '120,00', 'software', 10],
  ['Google', '49,99', 'software', 10], ['Vercel', '120,00', 'infrastructure', 10], ['Lorena', '500,00', 'team', 10],
  ['Sokani X100', '71,42', 'other_expense', 27], ['Octagonal X100', '25,12', 'other_expense', 27],
] as const

describe('0013 — consolidação de fontes de despesa (banco descartável)', { skip }, () => {
  let pool: Pool
  const deps = () => ({ pool, now: () => new Date('2026-10-31T15:00:00Z'), log: () => undefined })
  const base: FinanceAdminRequest = { method: 'GET', vercelEnv: 'preview', sessionValid: true, originAllowed: true, contentType: 'application/json', actorRef: 'sessao-teste' }
  async function post(action: string, payload: Body = {}): Promise<Body> {
    const r = await handleFinanceAdmin(deps(), { ...base, method: 'POST', rawBody: JSON.stringify({ action, ...payload }) })
    assert.equal(r.status, 200, action + ' ' + JSON.stringify(r.body))
    return r.body
  }
  const view = async (month: string): Promise<Body> => (await handleFinanceAdmin(deps(), { ...base, searchParams: new URLSearchParams({ month }) })).body
  const psql = (file: string, map?: unknown) => {
    const args = [url!, '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...(map ? ['-v', 'map=' + JSON.stringify(map)] : []), '-f', OPS(file)]
    const r = spawnSync('psql', args, { encoding: 'utf8' })
    return { ok: r.status === 0, out: (r.stdout ?? '') + (r.stderr ?? '') } // NOTICE/ERROR do psql saem em stderr
  }
  const one = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows[0]
  const state = async () => one(`SELECT
      (SELECT count(*)::int FROM crm.finance_sources WHERE direction = 'out') AS out_sources,
      (SELECT count(*)::int FROM crm.finance_entries) AS entries,
      (SELECT md5(string_agg(t::text, ',' ORDER BY t.id)) FROM crm.finance_settlements t) AS settlements,
      (SELECT count(*)::int FROM crm.finance_settlements) AS n_settlements`)
  const map: { old: string; new: string; label: string }[] = []
  let contabilidade = ''
  let giraEntry = ''

  before(async () => {
    pool = new Pool({ connectionString: url, max: 4 })
    // Receitas: Gira Motopeças (dívida de setembro em aberto) + recebimentos de outubro = R$ 13.896,00
    const gira = (await post('client_create', { name: 'Gira Motopeças (teste)' })).id
    const g = (await post('source_create', { direction: 'in', clientId: gira, category: 'marketing_monthly', description: 'Gira — contrato (teste)', amount: '2.000',
      periodicity: 'monthly', startDate: '2026-09-01', generateFrom: '2026-09', dueDay: 10 })).id
    const cli = (await post('client_create', { name: 'Cliente Fictício Receitas' })).id
    const r = (await post('source_create', { direction: 'in', clientId: cli, category: 'project', description: 'Receitas de outubro (teste)', amount: '13.896',
      periodicity: 'one_time', startDate: '2026-10-01', dueDay: 5 })).id
    let v = await view('2026-10')
    const rEntry = (v.entries as Body[]).find(e => e.sourceId === r)!
    await post('settle', { entryId: rEntry.id, amount: '13.896', settledOn: '2026-10-05', idempotencyKey: randomUUID() })
    giraEntry = (await one("SELECT id FROM crm.finance_entries WHERE source_id = $1 AND competence_month = '2026-09-01'", [g])).id
    // Despesas: 9 recorrentes a partir de novembro + Contabilidade recorrente desde outubro (em aberto)
    const recIds: Record<string, string> = {}
    for (const [name, amount, category, due] of RECURRING) {
      const eq = due === 27
      recIds[name] = (await post('source_create', { direction: 'out', category, description: name, amount, periodicity: 'monthly', costKind: eq ? 'variable' : 'fixed',
        startDate: eq ? '2026-11-27' : '2026-11-10', dueDay: due, ...(eq ? { endDate: '2027-05-27' } : {}) })).id
    }
    contabilidade = (await post('source_create', { direction: 'out', category: 'outsourced', description: 'Contabilidade', amount: '300,00', periodicity: 'monthly',
      costKind: 'fixed', startDate: '2026-10-10', dueDay: 10 })).id
    // 9 avulsas de outubro, quitadas e encerradas
    for (const [name, amount, category, due] of RECURRING) {
      const id = (await post('source_create', { direction: 'out', category, description: name + ' — outubro', amount, periodicity: 'one_time', costKind: 'fixed',
        startDate: '2026-10-' + String(due).padStart(2, '0'), dueDay: due })).id
      const e = (await one('SELECT id FROM crm.finance_entries WHERE source_id = $1', [id])).id
      await post('settle', { entryId: e, amount, settledOn: '2026-10-' + String(Math.min(due, 30)).padStart(2, '0'), idempotencyKey: randomUUID(), method: 'Cartão', notes: 'pago ' + name })
      await post('source_status', { id, status: 'ended', endDate: '2026-10-31' })
      // mapa por IDs (exatamente como o passo 1 entrega para conferência)
      map.push({ old: id, new: recIds[name], label: name })
    }
    v = await view('2026-11')
  })
  after(async () => { await pool?.end() })

  it('cenário de partida = o verificado no Preview (19 fontes; out 1.941,53; pago 1.641,53; nov 1.941,53)', async () => {
    assert.equal((await state()).out_sources, 19)
    const oct = (await view('2026-10')).kpis
    assert.deepEqual([oct.expensesForecastCents, oct.expensesPaidCashCents, oct.payableMonthCents, oct.revenueReceivedCashCents, oct.resultCashCents],
      [194153, 164153, 30000, 1389600, 1225447])
    assert.equal((await view('2026-11')).kpis.expensesForecastCents, 194153)
  })

  it('passo 1 (descoberta) é somente leitura e propõe os 9 pares sem ambiguidade', async () => {
    const before = await state()
    const r = psql('0013_consolidate_discover.sql')
    assert.ok(r.ok, r.out)
    assert.match(r.out, /\| *0\s*$/m) // pares_ambiguos = 0
    assert.deepEqual(await state(), before)
  })

  it('mapa errado ou incompleto aborta sem alterar NADA', async () => {
    const before = await state()
    for (const [bad, why] of [
      [map.slice(0, 8), /exatamente 9 pares/],
      [[...map.slice(0, 8), { ...map[8], new: contabilidade }], /já tem lançamento em out\/2026/],
      [[...map.slice(0, 8), { ...map[8], new: map[0].new }], /IDs repetidos/],
      [[...map.slice(0, 8), { old: map[8].new, new: map[8].old, label: 'invertido' }], /não é despesa avulsa encerrada/],
      [[...map.slice(0, 8), { ...map[8], old: randomUUID() }], /não existe e não consta como consolidada/],
    ] as const) {
      const r = psql('0013_consolidate_expenses.sql', bad)
      assert.equal(r.ok, false)
      assert.match(r.out, why)
      assert.deepEqual(await state(), before)
    }
    assert.equal(psql('0013_consolidate_expenses.sql').ok, false, 'sem mapa não executa')
    assert.deepEqual(await state(), before)
  })

  it('consolida: 19 → 10 fontes; lançamentos e pagamentos preservados (mesmos IDs); totais intactos', async () => {
    const before = await state()
    const entries9 = (await pool.query(`SELECT id, competence_month::text, due_date::text, amount_cents, status, description FROM crm.finance_entries
      WHERE source_id = ANY($1::uuid[]) ORDER BY id`, [map.map(m => m.old)])).rows
    assert.equal(entries9.length, 9)
    const r = psql('0013_consolidate_expenses.sql', map)
    assert.ok(r.ok, r.out)
    const after = await state()
    assert.equal(after.out_sources, 10)
    assert.equal(after.entries, before.entries)
    assert.equal(after.n_settlements, before.n_settlements)
    assert.equal(after.settlements, before.settlements, 'pagamentos idênticos (valores, datas, observações)')
    const moved = (await pool.query(`SELECT id, competence_month::text, due_date::text, amount_cents, status, description, source_id FROM crm.finance_entries
      WHERE id = ANY($1::uuid[]) ORDER BY id`, [entries9.map(e => e.id)])).rows
    assert.deepEqual(moved.map(({ source_id, ...x }) => x), entries9, 'mesmos 9 lançamentos, mesma competência/vencimento/valor/situação')
    for (const m of map) assert.equal(moved.find(x => x.id === (moved.find(y => y.source_id === m.new)?.id))?.source_id, m.new, m.label)
    assert.equal((await one('SELECT count(*)::int AS n FROM crm.finance_sources WHERE id = ANY($1::uuid[])', [map.map(m => m.old)])).n, 0, '9 avulsas excluídas')
    const oct = (await view('2026-10')).kpis
    assert.deepEqual([oct.expensesForecastCents, oct.expensesPaidCashCents, oct.payableMonthCents, oct.revenueReceivedCashCents, oct.resultCashCents],
      [194153, 164153, 30000, 1389600, 1225447])
    assert.equal((await view('2026-11')).kpis.expensesForecastCents, 194153)
    // backup + mapa + auditoria
    const b = await one(`SELECT (SELECT count(*)::int FROM crm.finance_ops_0013_backup_sources) s, (SELECT count(*)::int FROM crm.finance_ops_0013_backup_entries) e,
      (SELECT count(*)::int FROM crm.finance_ops_0013_backup_settlements) t, (SELECT count(*)::int FROM crm.finance_ops_0013_map) m,
      (SELECT count(*)::int FROM crm.finance_audit_log WHERE actor = 'ops-0013') a`)
    assert.deepEqual(b, { s: 18, e: 9, t: 9, m: 9, a: 27 })
  })

  it('depois: recorrência não regenera outubro, não duplica, equipamentos terminam em mai/2027, Gira intacta, nada novo pago', async () => {
    for (const m of ['2026-12', '2027-03', '2027-06', '2027-10']) await view(m)
    const dup = await one(`SELECT count(*)::int AS n FROM (SELECT source_id, competence_month FROM crm.finance_entries WHERE source_id IS NOT NULL
      GROUP BY 1, 2 HAVING count(*) > 1) d`)
    assert.equal(dup.n, 0)
    for (const m of map) {
      const months = (await pool.query("SELECT to_char(competence_month, 'YYYY-MM') AS m FROM crm.finance_entries WHERE source_id = $1 ORDER BY 1", [m.new])).rows.map(r => r.m)
      assert.equal(months[0], '2026-10', m.label + ': histórico de outubro na fonte principal')
      assert.equal(months.filter(x => x === '2026-10').length, 1)
      if (m.label.endsWith('X100')) assert.equal(months.at(-1), '2027-05', m.label + ': termina em 27/05/2027')
    }
    const paidLater = await one(`SELECT count(*)::int AS n FROM crm.finance_settlements st JOIN crm.finance_entries e ON e.id = st.entry_id
      WHERE e.direction = 'out' AND e.competence_month > '2026-10-01'`)
    assert.equal(paidLater.n, 0, 'nenhuma despesa futura marcada como paga')
    const gira = await one('SELECT amount_cents::int AS a, status, competence_month::text AS m FROM crm.finance_entries WHERE id = $1', [giraEntry])
    assert.deepEqual(gira, { a: 200000, status: 'open', m: '2026-09-01' })
    const nov = await view('2026-11')
    assert.equal((nov.sources as Body[]).filter(s => s.direction === 'out').length, 10, 'Despesas: 10 cadastros principais')
    const octView = await view('2026-10')
    const octOut = (octView.entries as Body[]).filter(e => e.direction === 'out' && e.competenceMonth === '2026-10')
    assert.equal(octOut.length, 10)
    assert.equal(octOut.filter(e => e.state === 'settled').length, 9, 'histórico de outubro consultável e quitado')
    assert.ok(octOut.every(e => e.sourceId && (octView.sources as Body[]).some(s => s.id === e.sourceId)), 'sem lançamento órfão na interface')
  })

  it('reexecução é segura (nada a fazer); reversão restaura 19 fontes sem perder nada; consolidar de novo funciona', async () => {
    const s1 = await state()
    const again = psql('0013_consolidate_expenses.sql', map)
    assert.ok(again.ok, again.out)
    assert.match(again.out, /já estavam consolidados/)
    assert.deepEqual(await state(), s1)
    const rb = psql('0013_consolidate_rollback.sql')
    assert.ok(rb.ok, rb.out)
    const s2 = await state()
    assert.equal(s2.out_sources, 19)
    assert.equal(s2.settlements, s1.settlements)
    assert.equal((await view('2026-10')).kpis.expensesPaidCashCents, 164153)
    const re = psql('0013_consolidate_expenses.sql', map)
    assert.ok(re.ok, re.out)
    assert.equal((await state()).out_sources, 10)
  })
})
