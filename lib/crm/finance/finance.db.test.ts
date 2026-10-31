/**
 * FINANCEIRO — integração contra PostgreSQL DESCARTÁVEL (migrações 0001–0011), pela mesma API usada pelo painel.
 * Somente dados fictícios ("Cliente Fictício ..."); nada real da Cassiellos. Cada cenário isola seus números com os
 * filtros (cliente/origem), então os testes não dependem da ordem.
 */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { after, before, describe, it } from 'node:test'
import { Pool } from 'pg'
import { handleFinanceAdmin, handleFinanceExport, type FinanceAdminRequest } from './admin-request'

const url = process.env.CRM_INTEGRATION_DATABASE_URL
const skip = !url ? 'CRM_INTEGRATION_DATABASE_URL não definida' : false
const NOW = new Date('2026-10-31T15:00:00Z') // "hoje" = 31/10/2026 em Brasília

type Body = Record<string, any>

describe('Financeiro — banco real descartável', { skip }, () => {
  let pool: Pool
  let deps: Parameters<typeof handleFinanceAdmin>[0]
  const logs: string[] = []
  before(async () => {
    pool = new Pool({ connectionString: url, max: 8 })
    deps = { pool, now: () => NOW, log: (e, d) => logs.push(e + ' ' + JSON.stringify(d)) }
  })
  after(async () => { await pool?.end() })
  const base: FinanceAdminRequest = { method: 'GET', vercelEnv: 'preview', sessionValid: true, originAllowed: true, contentType: 'application/json', actorRef: 'sessao-teste' }
  async function post(action: string, payload: Body = {}, expect = 200): Promise<Body> {
    const r = await handleFinanceAdmin(deps, { ...base, method: 'POST', rawBody: JSON.stringify({ action, ...payload }) })
    assert.equal(r.status, expect, action + ' → ' + JSON.stringify(r.body))
    return r.body
  }
  async function view(params: Record<string, string>): Promise<Body> {
    const r = await handleFinanceAdmin(deps, { ...base, searchParams: new URLSearchParams(params) })
    assert.equal(r.status, 200, JSON.stringify(r.body))
    assert.equal(r.body.migrationPending, false)
    return r.body
  }
  const client = async (name: string) => (await post('client_create', { name: 'Cliente Fictício ' + name + ' ' + randomUUID().slice(0, 6), company: 'Empresa Fictícia ' + name })).id as string
  const contract = async (clientId: string, extra: Body) => (await post('source_create', { direction: 'in', clientId, dueDay: 10, ...extra })).id as string
  const expense = async (extra: Body) => (await post('source_create', { direction: 'out', dueDay: 5, costKind: 'fixed', ...extra })).id as string
  const entriesOf = (v: Body, sourceId: string) => (v.entries as Body[]).filter(e => e.sourceId === sourceId).sort((a, b) => a.competenceMonth.localeCompare(b.competenceMonth))
  const settle = (entryId: string, amount: string, settledOn: string, key = randomUUID()) => post('settle', { entryId, amount, settledOn, idempotencyKey: key, method: 'PIX' })

  it('banco começa sem nenhum cliente financeiro (nada cadastrado automaticamente)', async () => {
    const v = await view({ month: '2026-10' })
    assert.ok(Array.isArray(v.clients))
    const k = v.kpis as Body
    for (const key of Object.keys(k)) assert.equal(typeof k[key], 'number', key)
  })

  it('um cliente com vários contratos: mensal de marketing, Creative Minds, hospedagem recorrente e anual', async () => {
    const c = await client('Multi')
    const mkt = await contract(c, { category: 'marketing_monthly', description: 'Gestão de tráfego fictícia', amount: '2.000,00', periodicity: 'monthly', startDate: '2026-09-01' , generateFrom: '2026-09' })
    const cm = await contract(c, { category: 'creative_minds', description: 'Creative Minds fictício', amount: '497', periodicity: 'monthly', startDate: '2026-10-01', dueDay: 15 })
    const host = await contract(c, { category: 'hosting', description: 'Hospedagem fictícia', amount: '79,90', periodicity: 'monthly', startDate: '2026-10-01', dueDay: 31 })
    const annual = await contract(c, { category: 'site_maintenance', description: 'Manutenção anual fictícia', amount: '1.200,00', periodicity: 'annual', startDate: '2026-10-20', dueDay: 20 })
    const v = await view({ month: '2026-10', client: c })
    assert.deepEqual(entriesOf(v, mkt).map(e => e.competenceMonth), ['2026-09', '2026-10', '2026-11', '2026-12'])
    assert.deepEqual(entriesOf(v, cm).map(e => [e.competenceMonth, e.dueDate]), [['2026-10', '2026-10-15'], ['2026-11', '2026-11-15'], ['2026-12', '2026-12-15']])
    assert.deepEqual(entriesOf(v, host).map(e => e.dueDate), ['2026-10-31', '2026-11-30', '2026-12-31'])
    assert.deepEqual(entriesOf(v, annual).map(e => e.competenceMonth), ['2026-10'])
    assert.equal(v.kpis.revenueForecastCents, 200000 + 49700 + 7990 + 120000)
    assert.equal(v.kpis.revenueReceivedCashCents, 0, 'previsão NÃO é receita recebida')
    assert.equal(v.kpis.activeRecurringContracts, 4)
    assert.equal(v.kpis.recurringMonthlyCents, 200000 + 49700 + 7990 + 10000)
    const cl = (v.clients as Body[]).find(x => x.id === c)!
    assert.equal(cl.contracts, 4)
    // setembro venceu e não foi pago → atrasado
    assert.equal(entriesOf(v, mkt)[0].state, 'overdue')
    // em 31/10 também já venceram as de outubro com vencimento 10, 15 e 20 (a de dia 31 ainda não)
    assert.equal(v.kpis.overdueReceivableCents, 200000 + 200000 + 49700 + 120000)
  })

  it('geração sem duplicidade: consultas repetidas e simultâneas não criam lançamentos novos', async () => {
    const c = await client('Dup')
    const s = await contract(c, { category: 'hosting', description: 'Hospedagem dup', amount: '50', periodicity: 'monthly', startDate: '2026-10-01' })
    await Promise.all(Array.from({ length: 8 }, () => view({ month: '2026-10', client: c })))
    await view({ month: '2026-12', client: c })
    const { rows } = await pool.query('SELECT competence_month::text AS m, count(*)::int AS n FROM crm.finance_entries WHERE source_id = $1 GROUP BY 1 ORDER BY 1', [s])
    assert.deepEqual(rows, [{ m: '2026-10-01', n: 1 }, { m: '2026-11-01', n: 1 }, { m: '2026-12-01', n: 1 }])
    // consultar um mês distante materializa a previsão até ele (limite de 12 meses), ainda sem duplicar
    await view({ month: '2027-02', client: c })
    await view({ month: '2027-02', client: c })
    const n = await pool.query('SELECT count(*)::int AS n FROM crm.finance_entries WHERE source_id = $1', [s])
    assert.equal(n.rows[0].n, 5)
  })

  it('receita avulsa (projeto) gera exatamente uma cobrança', async () => {
    const c = await client('Avulso')
    const s = await contract(c, { category: 'site_creation', description: 'Landing page fictícia', amount: '3.500,00', periodicity: 'one_time', startDate: '2026-11-03', dueDay: 25 })
    const v = await view({ month: '2026-11', client: c })
    assert.deepEqual(entriesOf(v, s).map(e => [e.competenceMonth, e.dueDate, e.amountCents, e.state]), [['2026-11', '2026-11-25', 350000, 'forecast']])
    assert.equal(v.kpis.activeRecurringContracts, 0, 'avulsa não conta como recorrente')
  })

  it('recebimento parcial: R$ 2.000 com R$ 800 recebidos deixa R$ 1.200 em aberto; depois quitação', async () => {
    const c = await client('Parcial')
    const s = await contract(c, { category: 'marketing_monthly', description: 'Contrato parcial', amount: '2.000', periodicity: 'monthly', startDate: '2026-10-01', dueDay: 31 })
    let v = await view({ month: '2026-10', client: c })
    const oct = entriesOf(v, s)[0]
    const r1 = await settle(oct.id, '800', '2026-10-20')
    assert.equal(r1.remainingCents, 120000)
    v = await view({ month: '2026-10', client: c })
    let e = entriesOf(v, s)[0]
    assert.deepEqual([e.state, e.stateLabel, e.settledCents, e.remainingCents], ['partial', 'Parcialmente recebido', 80000, 120000])
    assert.equal(v.kpis.revenueReceivedCashCents, 80000)
    assert.equal(v.kpis.receivableMonthCents, 120000)
    // valor acima do saldo é recusado
    assert.equal((await post('settle', { entryId: oct.id, amount: '1.200,01', settledOn: '2026-10-30', idempotencyKey: randomUUID() }, 409)).error, 'AMOUNT_EXCEEDS_BALANCE')
    await settle(oct.id, '1.200,00', '2026-10-30')
    v = await view({ month: '2026-10', client: c })
    e = entriesOf(v, s)[0]
    assert.deepEqual([e.state, e.remainingCents, e.settlements.length], ['settled', 0, 2])
    assert.equal((await post('settle', { entryId: oct.id, amount: '1', settledOn: '2026-10-30', idempotencyKey: randomUUID() }, 409)).error, 'ENTRY_ALREADY_SETTLED')
  })

  it('idempotência: a mesma requisição repetida (inclusive simultânea) registra UM movimento', async () => {
    const c = await client('Idem')
    const s = await contract(c, { category: 'hosting', description: 'Hospedagem idem', amount: '300', periodicity: 'monthly', startDate: '2026-10-01' })
    const entry = entriesOf(await view({ month: '2026-10', client: c }), s)[0]
    const key = randomUUID()
    const results = await Promise.all(Array.from({ length: 6 }, () => handleFinanceAdmin(deps, { ...base, method: 'POST',
      rawBody: JSON.stringify({ action: 'settle', entryId: entry.id, amount: '100', settledOn: '2026-10-15', idempotencyKey: key }) })))
    assert.ok(results.every(r => r.status === 200))
    assert.equal(results.filter(r => r.body.duplicate === false).length, 1)
    const { rows } = await pool.query('SELECT count(*)::int AS n, sum(amount_cents)::int AS total FROM crm.finance_settlements WHERE entry_id = $1', [entry.id])
    assert.deepEqual(rows[0], { n: 1, total: 10000 })
    // mesma chave com outro valor = reutilização indevida
    assert.equal((await post('settle', { entryId: entry.id, amount: '150', settledOn: '2026-10-15', idempotencyKey: key }, 409)).error, 'IDEMPOTENCY_KEY_REUSED')
  })

  it('COMPETÊNCIA × CAIXA: cobrança de janeiro recebida em fevereiro', async () => {
    const c = await client('Caixa')
    const s = await contract(c, { category: 'project', description: 'Projeto de janeiro', amount: '1.000', periodicity: 'one_time', startDate: '2026-01-05', dueDay: 10 })
    const jan = entriesOf(await view({ month: '2026-01', client: c }), s)[0]
    assert.equal(jan.competenceMonth, '2026-01')
    await settle(jan.id, '1.000', '2026-02-12')
    const vJan = await view({ month: '2026-01', client: c })
    const vFeb = await view({ month: '2026-02', client: c })
    assert.equal(vJan.kpis.revenueForecastCents, 100000, 'janeiro: competência')
    assert.equal(vJan.kpis.revenueReceivedCashCents, 0, 'janeiro: nada entrou no caixa')
    assert.equal(vJan.kpis.revenueReceivedOfCompetenceCents, 100000, 'janeiro: a competência foi recebida (em outro mês)')
    assert.equal(vFeb.kpis.revenueForecastCents, 0, 'fevereiro: nenhuma competência')
    assert.equal(vFeb.kpis.revenueReceivedCashCents, 100000, 'fevereiro: caixa')
    const ym = vFeb.charts.yearMonths as Body[]
    assert.deepEqual([ym[0].competenceIn, ym[0].cashIn, ym[1].competenceIn, ym[1].cashIn], [100000, 0, 0, 100000])
  })

  it('despesas fixas e variáveis, pagamento parcial, atraso e verba de anúncio de cliente fora do caixa', async () => {
    const fixed = await expense({ category: 'software', description: 'Assinatura fictícia de software', amount: '99,90', periodicity: 'monthly', startDate: '2026-10-01', costKind: 'fixed' })
    const variable = await expense({ category: 'outsourced', description: 'Freelancer fictício', amount: '1.500', periodicity: 'one_time', startDate: '2026-10-02', dueDay: 20, costKind: 'variable', supplier: 'Fornecedor Fictício' })
    const c = await client('Ads')
    const ads = await expense({ category: 'other_expense', description: 'Verba Meta do cliente (fictícia)', amount: '5.000', periodicity: 'monthly', startDate: '2026-10-01', clientAdBudget: true, clientId: c, costKind: 'variable' })
    let v = await view({ month: '2026-10', source: variable })
    const ve = entriesOf(v, variable)[0]
    assert.equal(ve.state, 'overdue') // venceu em 20/10 sem pagamento
    await settle(ve.id, '500', '2026-10-25')
    v = await view({ month: '2026-10', source: variable })
    assert.deepEqual([entriesOf(v, variable)[0].stateLabel, v.kpis.expensesPaidCashCents, v.kpis.payableMonthCents], ['Parcialmente pago', 50000, 100000])
    v = await view({ month: '2026-10', source: fixed })
    assert.equal(v.kpis.expensesForecastCents, 9990)
    v = await view({ month: '2026-10', source: ads })
    assert.equal(v.kpis.expensesForecastCents, 0, 'verba do cliente não é despesa da agência')
    assert.equal(v.kpis.clientAdBudgetCents, 500000)
    const adsEntry = entriesOf(v, ads)[0]
    assert.equal(adsEntry.clientAdBudget, true)
  })

  it('pausar, reativar e encerrar: histórico preservado, previsões futuras canceladas com motivo, meses da pausa não cobrados', async () => {
    const c = await client('Ciclo')
    const s = await contract(c, { category: 'marketing_monthly', description: 'Contrato ciclo', amount: '1.000', periodicity: 'monthly', startDate: '2026-08-01', generateFrom: '2026-08', dueDay: 5 })
    let v = await view({ month: '2026-10', client: c })
    const [aug] = entriesOf(v, s)
    await settle(aug.id, '1.000', '2026-08-06')
    const paused = await post('source_status', { id: s, status: 'paused' })
    assert.equal(paused.cancelled, 2) // nov e dez (previsões futuras sem movimento)
    const all = async () => (await pool.query(`SELECT to_char(competence_month, 'YYYY-MM') AS m, status, cancel_reason FROM crm.finance_entries
      WHERE source_id = $1 ORDER BY competence_month`, [s])).rows.map(r => [r.m, r.status, r.cancel_reason])
    assert.deepEqual(await all(), [['2026-08', 'open', null], ['2026-09', 'open', null], ['2026-10', 'open', null],
      ['2026-11', 'cancelled', 'Contrato pausado'], ['2026-12', 'cancelled', 'Contrato pausado']])
    v = await view({ month: '2026-10', client: c })
    // a visão de outubro lista o mês, o que está em aberto e o que foi cancelado no horizonte; agosto (quitado em agosto) fica na visão de agosto
    assert.deepEqual(entriesOf(v, s).map(e => [e.competenceMonth, e.state]), [['2026-09', 'overdue'], ['2026-10', 'overdue']])
    assert.equal(entriesOf(await view({ month: '2026-08', client: c }), s)[0].state, 'settled')
    // reativar não "ressuscita" meses cancelados nem cria duplicatas
    await post('source_status', { id: s, status: 'active' })
    const { rows } = await pool.query("SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'open')::int AS open FROM crm.finance_entries WHERE source_id = $1", [s])
    assert.deepEqual(rows[0], { n: 5, open: 3 })
    // encerrar
    const ended = await post('source_status', { id: s, status: 'ended', endDate: '2026-10-31' })
    assert.equal(ended.cancelled, 0)
    assert.equal((await post('source_status', { id: s, status: 'active' }, 409)).error, 'SOURCE_ENDED')
    v = await view({ month: '2026-10', client: c })
    assert.equal(v.kpis.activeRecurringContracts, 0)
    assert.equal(entriesOf(await view({ month: '2026-08', client: c }), s)[0].settlements.length, 1, 'recebimento de agosto continua no histórico')
    await view({ month: '2027-03', client: c })
    const n = await pool.query('SELECT count(*)::int AS n FROM crm.finance_entries WHERE source_id = $1', [s])
    assert.equal(n.rows[0].n, 5, 'encerrado não gera mais nada')
  })

  it('alterar o valor do contrato nunca muda movimentos registrados', async () => {
    const c = await client('Reajuste')
    const s = await contract(c, { category: 'creative_minds', description: 'CM reajuste', amount: '400', periodicity: 'monthly', startDate: '2026-10-01', dueDay: 28 })
    let v = await view({ month: '2026-10', client: c })
    const oct = entriesOf(v, s)[0]
    await settle(oct.id, '400', '2026-10-28')
    await post('source_update', { id: s, direction: 'in', category: 'creative_minds', description: 'CM reajuste', amount: '450', dueDay: 28, applyToOpenFuture: true })
    v = await view({ month: '2026-10', client: c })
    const list = entriesOf(v, s)
    assert.deepEqual(list.map(e => e.amountCents), [40000, 45000, 45000])
    assert.equal(list[0].settledCents, 40000)
    const st = await pool.query('SELECT amount_cents::int AS a FROM crm.finance_settlements WHERE entry_id = $1', [oct.id])
    assert.deepEqual(st.rows, [{ a: 40000 }])
    // sem "aplicar aos futuros": lançamentos já gerados ficam como estão
    await post('source_update', { id: s, direction: 'in', category: 'creative_minds', description: 'CM reajuste', amount: '500', dueDay: 28, applyToOpenFuture: false })
    v = await view({ month: '2026-10', client: c })
    assert.deepEqual(entriesOf(v, s).map(e => e.amountCents), [40000, 45000, 45000])
    // cobrança com movimento não pode ser ajustada nem cancelada
    assert.equal((await post('entry_update', { id: oct.id, amount: '1', dueDate: '2026-10-28' }, 409)).error, 'ENTRY_HAS_SETTLEMENTS')
    assert.equal((await post('entry_cancel', { id: oct.id, reason: 'teste' }, 409)).error, 'ENTRY_HAS_SETTLEMENTS')
  })

  it('estorno fica no histórico e reabre o saldo; auditoria registra quem e quando', async () => {
    const c = await client('Estorno')
    const s = await contract(c, { category: 'hosting', description: 'Hosp estorno', amount: '200', periodicity: 'monthly', startDate: '2026-10-01', dueDay: 31 })
    const e = entriesOf(await view({ month: '2026-10', client: c }), s)[0]
    const r = await settle(e.id, '200', '2026-10-10')
    assert.equal((await post('settlement_reverse', { id: r.id, reason: '' }, 400)).error, 'REASON_REQUIRED')
    await post('settlement_reverse', { id: r.id, reason: 'Lançado no cliente errado' })
    const v = await view({ month: '2026-10', client: c })
    const after = entriesOf(v, s)[0]
    assert.deepEqual([after.state, after.remainingCents, after.settlements.length], ['open', 20000, 1])
    assert.equal(after.settlements[0].reversalReason, 'Lançado no cliente errado')
    assert.equal(v.kpis.revenueReceivedCashCents, 0)
    const audit = await pool.query("SELECT action, actor FROM crm.finance_audit_log WHERE entity = 'settlement' AND entity_id = $1 ORDER BY id", [r.id])
    assert.deepEqual(audit.rows, [{ action: 'recorded', actor: 'sessao-teste' }, { action: 'reversed', actor: 'sessao-teste' }])
  })

  it('notas fiscais: recebidas com nota pendente aparecem; emissão manual com número e data', async () => {
    const c = await client('NF')
    const s = await contract(c, { category: 'marketing_monthly', description: 'Contrato com NF', amount: '1.500', periodicity: 'monthly', startDate: '2026-10-01', invoiceRequired: true, dueDay: 31 })
    const e = entriesOf(await view({ month: '2026-10', client: c }), s)[0]
    assert.equal(e.invoice.status, 'pending')
    await settle(e.id, '1.500', '2026-10-30')
    let v = await view({ month: '2026-12', client: c })
    assert.ok((v.entries as Body[]).some(x => x.id === e.id && x.invoice.status === 'pending' && x.settledCents > 0), 'recebida com NF pendente aparece mesmo em outro mês')
    assert.equal((await post('invoice_set', { entryId: e.id, status: 'issued' }, 400)).error, 'INVOICE_NUMBER_AND_DATE_REQUIRED')
    await post('invoice_set', { entryId: e.id, status: 'issued', number: 'NF-FICT-0001', issuedOn: '2026-10-31', externalRef: 'portal-ficticio' })
    v = await view({ month: '2026-10', client: c })
    assert.deepEqual(entriesOf(v, s)[0].invoice, { status: 'issued', label: 'Emitida', number: 'NF-FICT-0001', issuedOn: '2026-10-31', externalRef: 'portal-ficticio', notes: '', recorded: true })
    const exp = await expense({ category: 'office', description: 'Aluguel fictício', amount: '900', periodicity: 'monthly', startDate: '2026-10-01' })
    const ee = entriesOf(await view({ month: '2026-10', source: exp }), exp)[0]
    assert.equal(ee.invoice, null)
    assert.equal((await post('invoice_set', { entryId: ee.id, status: 'not_applicable' }, 400)).error, 'INVOICE_ONLY_FOR_RECEIVABLES')
  })

  it('relatórios: mês × mês anterior e ano × ano anterior; base zero = não comparável', async () => {
    const c = await client('Relatorio')
    const s = await contract(c, { category: 'marketing_monthly', description: 'Contrato relatório', amount: '1.000', periodicity: 'monthly', startDate: '2025-09-01', generateFrom: '2025-09', dueDay: 1 })
    let v = await view({ month: '2026-10', client: c })
    const list = entriesOf(v, s)
    const sep = list.find(e => e.competenceMonth === '2026-09')!
    const oct = list.find(e => e.competenceMonth === '2026-10')!
    await settle(sep.id, '1.000', '2026-09-02')
    await settle(oct.id, '600', '2026-10-02')
    v = await view({ month: '2026-10', client: c })
    const mm = (v.reports.monthVsPrevious.rows as Body[]).find(r => r.key === 'cash_in')!
    assert.deepEqual([mm.current, mm.previous], [60000, 100000])
    const yy = (v.reports.ytdVsPreviousYtd.rows as Body[]).find(r => r.key === 'comp_in')!
    assert.deepEqual([yy.current, yy.previous], [1000000, 200000]) // jan–out/2026 (10 meses) vs jan–out/2025 (contrato começou em set/2025: 2 meses)
    assert.equal((v.reports.ytdVsPreviousYtd.rows as Body[]).find(r => r.key === 'cash_in')!.previous, 0)
    assert.equal(v.charts.last12.length, 12)
    assert.equal(v.charts.last12[11].month, '2026-10')
    assert.equal(v.charts.categories.in[0].category, 'marketing_monthly')
    // previsões por competência do ano anterior
    assert.equal(v.charts.previousYearMonths[8].competenceIn, 100000)
  })

  it('exportação CSV autenticada: lançamentos e movimentos do ano, com ";" e centavos', async () => {
    const r = await handleFinanceExport(deps, { ...base, searchParams: new URLSearchParams('year=2026&kind=entries') })
    assert.ok('csv' in r)
    const lines = ('csv' in r ? r.csv : '').split('\r\n')
    assert.ok(lines[0].startsWith('﻿Tipo;Competência;Vencimento'))
    assert.ok(lines.some(l => l.includes('Contrato parcial') && l.includes('2000,00') && l.includes('Recebido')))
    const m = await handleFinanceExport(deps, { ...base, searchParams: new URLSearchParams('year=2026&kind=movements') })
    assert.ok('csv' in m && m.csv.includes('Recebimento') && m.csv.includes('Lançado no cliente errado'))
    assert.equal((await handleFinanceExport(deps, { ...base, sessionValid: false, searchParams: new URLSearchParams('year=2026') })).status, 401)
  })

  it('logs só com tipo de evento e ids (sem valores nem nomes); tabelas existentes do CRM intactas', async () => {
    assert.ok(logs.length > 10)
    assert.ok(logs.every(l => !/Fictício|R\$|2\.000|amountCents/.test(l)), logs.find(l => /Fictício|R\$|amountCents/.test(l)))
    const t = await pool.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'crm' AND table_name LIKE 'finance\\_%'`)
    assert.equal(t.rows[0].n, 6)
    const leads = await pool.query('SELECT count(*)::int AS n FROM crm.leads')
    assert.equal(typeof leads.rows[0].n, 'number') // o módulo nunca escreve fora das tabelas finance_*
  })
})
