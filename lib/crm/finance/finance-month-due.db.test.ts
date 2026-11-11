/**
 * Receitas por Vencimento × Competência — PostgreSQL DESCARTÁVEL (CRM_INTEGRATION_DATABASE_URL), pela mesma API do
 * painel. Reproduz o caso Creative Minds com dados FICTÍCIOS: cobrança de competência 11/2026 com vencimento
 * ajustado para 01/12/2026 e a cobrança distinta de 12/2026 (10/12/2026). Confere que a leitura não altera dados.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { Pool } from 'pg'
import { handleFinanceAdmin, type FinanceAdminRequest } from './admin-request'
import { entriesForMonth, monthListTotals } from './month-filter'

const url = process.env.CRM_INTEGRATION_DATABASE_URL
const skip = !url ? 'CRM_INTEGRATION_DATABASE_URL não definida' : false
const NOW = new Date('2026-10-31T15:00:00Z') // "hoje" = 31/10/2026 em Brasília
type Body = Record<string, any>
type Row = { id: string; direction: string; sourceId: string | null; competenceMonth: string; dueDate: string; state: string
  clientAdBudget: boolean; amountCents: number; settledCents: number; remainingCents: number }

describe('Financeiro — Receitas por vencimento (banco descartável)', { skip }, () => {
  let pool: Pool
  let deps: Parameters<typeof handleFinanceAdmin>[0]
  before(() => { pool = new Pool({ connectionString: url, max: 4 }); deps = { pool, now: () => NOW, log: () => undefined } })
  after(async () => { await pool?.end() })
  const base: FinanceAdminRequest = { method: 'GET', vercelEnv: 'preview', sessionValid: true, originAllowed: true, contentType: 'application/json', actorRef: 'sessao-teste' }
  const post = async (action: string, payload: Body): Promise<Body> => {
    const r = await handleFinanceAdmin(deps, { ...base, method: 'POST', rawBody: JSON.stringify({ action, ...payload }) })
    assert.equal(r.status, 200, action + ' → ' + JSON.stringify(r.body))
    return r.body
  }
  const view = async (month: string, client: string): Promise<Row[]> => {
    const r = await handleFinanceAdmin(deps, { ...base, searchParams: new URLSearchParams({ month, client }) })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    return (r.body.entries as Row[]).filter(e => e.direction === 'in')
  }
  const snapshot = async (clientId: string) => JSON.stringify((await pool.query(
    `SELECT e.id, e.competence_month::text, e.due_date::text, e.amount_cents, e.status,
            (SELECT json_agg(json_build_object('a', s.amount_cents, 'd', s.settled_on::text, 'r', s.reversed_at IS NOT NULL) ORDER BY s.id)
               FROM crm.finance_settlements s WHERE s.entry_id = e.id) AS st
       FROM crm.finance_entries e WHERE e.client_id = $1 ORDER BY e.id`, [clientId])).rows)
  const ids = (l: { id: string }[]) => l.map(e => e.id)

  it('caso Creative Minds: novembro por vencimento não traz 01/12; dezembro traz 01/12 e 10/12; competência preservada', async () => {
    const client = (await post('client_create', { name: 'Cliente Fictício Minds ' + randomUUID().slice(0, 6) })).id as string
    const source = (await post('source_create', { direction: 'in', clientId: client, category: 'creative_minds', description: 'Creative Minds fictício',
      amount: '1.397,00', periodicity: 'monthly', startDate: '2026-10-01', dueDay: 10 })).id as string
    const generated = (await view('2026-11', client)).filter(e => e.sourceId === source)
    const nov = generated.find(e => e.competenceMonth === '2026-11')!
    const dec = generated.find(e => e.competenceMonth === '2026-12')!
    assert.ok(nov && dec)
    // mesmo ajuste feito no CRM real: vencimento da competência 11 passa para 01/12 (competência não muda)
    await post('entry_update', { id: nov.id, amount: '1.397,00', dueDate: '2026-12-01' })
    const before = await snapshot(client)

    const vNov = await view('2026-11', client)
    assert.equal(vNov.find(e => e.id === nov.id)!.competenceMonth, '2026-11')
    assert.equal(vNov.find(e => e.id === nov.id)!.dueDate, '2026-12-01')
    assert.equal(entriesForMonth(vNov, '2026-11', 'due').some(e => e.id === nov.id), false, 'novembro por vencimento')
    assert.equal(entriesForMonth(vNov, '2026-11', 'competence').some(e => e.id === nov.id), true, 'novembro por competência')

    const vDec = await view('2026-12', client)
    assert.deepEqual(ids(entriesForMonth(vDec, '2026-12', 'due').filter(e => e.sourceId === source)), [nov.id, dec.id], '01/12 e 10/12, em ordem')
    assert.deepEqual(ids(entriesForMonth(vDec, '2026-12', 'competence').filter(e => e.sourceId === source)), [dec.id])
    assert.equal(new Set(ids(vDec)).size, vDec.length, 'nenhum lançamento duplicado no payload')

    // recebimento parcial e integral continuam corretos e os totais seguem o critério
    await post('settle', { entryId: dec.id, amount: '500,00', settledOn: '2026-10-31', idempotencyKey: randomUUID(), method: 'PIX' })
    await post('settle', { entryId: nov.id, amount: '1.397,00', settledOn: '2026-10-31', idempotencyKey: randomUUID(), method: 'PIX' })
    const shown = entriesForMonth(await view('2026-12', client), '2026-12', 'due').filter(e => e.sourceId === source)
    assert.deepEqual(monthListTotals(shown), { expectedCents: 279400, receivedCents: 189700, openCents: 89700 })
    // a leitura não altera nada além dos recebimentos registrados acima
    const after = JSON.parse(await snapshot(client)) as Body[]
    const beforeRows = JSON.parse(before) as Body[]
    assert.deepEqual(after.map(r => [r.id, r.competence_month, r.due_date, r.amount_cents, r.status]),
      beforeRows.map(r => [r.id, r.competence_month, r.due_date, r.amount_cents, r.status]))
  })

  it('cobrança quitada de competência antiga que vence no mês é carregada (antes ficava fora da janela)', async () => {
    const client = (await post('client_create', { name: 'Cliente Fictício Antigo ' + randomUUID().slice(0, 6) })).id as string
    const source = (await post('source_create', { direction: 'in', clientId: client, category: 'marketing_monthly', description: 'Mensal fictício',
      amount: '2.000,00', periodicity: 'monthly', startDate: '2026-09-01', generateFrom: '2026-09', dueDay: 5 })).id as string
    const sep = (await view('2026-10', client)).find(e => e.sourceId === source && e.competenceMonth === '2026-09')!
    await post('entry_update', { id: sep.id, amount: '2.000,00', dueDate: '2027-01-05' })
    await post('settle', { entryId: sep.id, amount: '2.000,00', settledOn: '2026-10-05', idempotencyKey: randomUUID(), method: 'PIX' })
    const jan = await view('2027-01', client)
    assert.deepEqual(ids(entriesForMonth(jan, '2027-01', 'due').filter(e => e.id === sep.id)), [sep.id], 'vence em jan/2027 → aparece em jan')
    assert.equal(entriesForMonth(jan, '2027-01', 'competence').some(e => e.id === sep.id), false)
    // cancelados continuam no histórico e fora dos totais
    const dec = (await view('2026-12', client)).find(e => e.sourceId === source && e.competenceMonth === '2026-12')!
    await post('entry_cancel', { id: dec.id, reason: 'Teste fictício de cancelamento' })
    const decShown = entriesForMonth(await view('2026-12', client), '2026-12', 'due').filter(e => e.sourceId === source)
    assert.equal(decShown.find(e => e.id === dec.id)!.state, 'cancelled')
    assert.equal(monthListTotals(decShown).expectedCents, 0)
  })
})
