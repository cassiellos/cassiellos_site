import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  FORMALIZATION_STATUS, SERVICE_STATUS, addMonths, competenceMonths, csvCell, dueDateFor, entryState, formatCents, formatChange, monthlyEquivalentCents, parseMoneyToCents,
  percentChange, todayInBrazil, type GenerationSource,
} from './model'
import { parseFilters, validateAdminStatus, validateClient, validateInvoice, validateSettlement, validateSource } from './validation'
import { handleFinanceAdmin, handleFinanceExport, type FinanceAdminRequest } from './admin-request'

// Somente dados fictícios.
const TODAY = '2026-10-31'
const KEY = '7d1c2f9e-3b4a-4c5d-8e6f-0a1b2c3d4e5f'
const ENTRY = '11111111-2222-4333-8444-555555555555'
const CLIENT = '99999999-8888-4777-8666-555555555555'

describe('dinheiro em centavos (sem float)', () => {
  it('aceita formatos pt-BR e converte exatamente', () => {
    const cases: [string, number][] = [['2.000', 200000], ['2.000,00', 200000], ['800', 80000], ['1.234,56', 123456], ['1234,56', 123456],
      ['1234.56', 123456], ['R$ 1.200,5', 120050], ['0,01', 1], ['0,10', 10], ['19,9', 1990], ['1.000.000,00', 100000000], [' 350 ', 35000]]
    for (const [raw, cents] of cases) assert.equal(parseMoneyToCents(raw), cents, raw)
  })
  it('recusa negativos, zero, ambíguos, mais de 2 casas, números crus e valores absurdos', () => {
    for (const raw of ['', '-10', '0', '0,00', '1,234,56', '1.23.4', '12,345', 'abc', '1e5', '10.5.1', '1.2345,00', '99999999999999', '2.00.000'])
      assert.equal(parseMoneyToCents(raw), null, raw)
    assert.equal(parseMoneyToCents(10.5), null)
    assert.equal(parseMoneyToCents(1000), null)
  })
  it('formata em reais', () => {
    assert.equal(formatCents(0), 'R$ 0,00')
    assert.equal(formatCents(120000), 'R$ 1.200,00')
    assert.equal(formatCents(-80050), '-R$ 800,50')
  })
  it('somas com centavos inteiros não acumulam erro (0,10 × 3 = 0,30)', () => {
    const c = parseMoneyToCents('0,10')! * 3
    assert.equal(c, 30)
  })
})

describe('recorrência e competência', () => {
  const base: GenerationSource = { periodicity: 'monthly', startDate: '2026-08-15', endDate: null, generateFrom: '2026-08-01', status: 'active', dueDay: 10 }
  it('mensal: um lançamento por mês até o horizonte', () => {
    assert.deepEqual(competenceMonths(base, '2026-12'), ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12'])
  })
  it('gerar a partir do mês atual não cria cobranças retroativas', () => {
    assert.deepEqual(competenceMonths({ ...base, startDate: '2025-01-05', generateFrom: '2026-10-01' }, '2026-12'), ['2026-10', '2026-11', '2026-12'])
  })
  it('anual, semestral e trimestral alinhados ao mês de início', () => {
    assert.deepEqual(competenceMonths({ ...base, periodicity: 'annual', startDate: '2025-03-01', generateFrom: '2025-03-01' }, '2027-06'), ['2025-03', '2026-03', '2027-03'])
    assert.deepEqual(competenceMonths({ ...base, periodicity: 'annual', startDate: '2025-03-01', generateFrom: '2026-10-01' }, '2027-06'), ['2027-03'])
    assert.deepEqual(competenceMonths({ ...base, periodicity: 'quarterly', startDate: '2026-01-10', generateFrom: '2026-05-01' }, '2026-12'), ['2026-07', '2026-10'])
    assert.deepEqual(competenceMonths({ ...base, periodicity: 'semiannual', startDate: '2026-02-10', generateFrom: '2026-02-01' }, '2027-02'), ['2026-02', '2026-08', '2027-02'])
  })
  it('avulsa: exatamente um lançamento, no mês de início', () => {
    assert.deepEqual(competenceMonths({ ...base, periodicity: 'one_time', startDate: '2026-11-20', generateFrom: '2026-11-01' }, '2026-12'), ['2026-11'])
    assert.deepEqual(competenceMonths({ ...base, periodicity: 'one_time', startDate: '2027-03-20', generateFrom: '2027-03-01' }, '2026-12'), [])
  })
  it('término, pausa e encerramento interrompem a geração', () => {
    assert.deepEqual(competenceMonths({ ...base, endDate: '2026-09-30' }, '2026-12'), ['2026-08', '2026-09'])
    assert.deepEqual(competenceMonths({ ...base, status: 'paused' }, '2026-12'), [])
    assert.deepEqual(competenceMonths({ ...base, status: 'ended' }, '2026-12'), [])
  })
  it('vencimento limitado ao último dia do mês', () => {
    assert.equal(dueDateFor('2026-02', 31), '2026-02-28')
    assert.equal(dueDateFor('2028-02', 30), '2028-02-29')
    assert.equal(dueDateFor('2026-04', 31), '2026-04-30')
    assert.equal(dueDateFor('2026-10', 5), '2026-10-05')
  })
  it('meses: virada de ano', () => {
    assert.equal(addMonths('2026-11', 2), '2027-01')
    assert.equal(addMonths('2026-01', -1), '2025-12')
    assert.equal(addMonths('2026-03', -14), '2025-01')
  })
  it('valor mensal equivalente para recorrência', () => {
    assert.equal(monthlyEquivalentCents(120000, 'annual'), 10000)
    assert.equal(monthlyEquivalentCents(30000, 'quarterly'), 10000)
    assert.equal(monthlyEquivalentCents(50000, 'one_time'), 0)
  })
  it('data de hoje em Brasília (não UTC)', () => {
    assert.equal(todayInBrazil(new Date('2026-11-01T02:30:00Z')), '2026-10-31')
    assert.equal(todayInBrazil(new Date('2026-11-01T03:30:00Z')), '2026-11-01')
  })
})

describe('estado derivado dos movimentos (não é "Pago: sim/não")', () => {
  const e = { status: 'open' as const, amountCents: 200000, settledCents: 0, dueDate: '2026-10-10', competenceMonth: '2026-10' }
  it('R$ 2.000 com R$ 800 recebidos = parcial, saldo R$ 1.200', () => {
    assert.equal(entryState({ ...e, settledCents: 80000 }, TODAY), 'partial')
    assert.equal(200000 - 80000, 120000)
  })
  it('atrasado, previsto, a receber, recebido e cancelado', () => {
    assert.equal(entryState(e, TODAY), 'overdue')
    assert.equal(entryState({ ...e, dueDate: '2026-10-31' }, TODAY), 'open')
    assert.equal(entryState({ ...e, dueDate: '2026-11-10', competenceMonth: '2026-11' }, TODAY), 'forecast')
    assert.equal(entryState({ ...e, settledCents: 200000 }, TODAY), 'settled')
    assert.equal(entryState({ ...e, status: 'cancelled' }, TODAY), 'cancelled')
  })
})

describe('comparações', () => {
  it('evolução percentual e base zero "não comparável"', () => {
    assert.deepEqual(percentChange(150, 100), { comparable: true, percent: 50 })
    assert.deepEqual(percentChange(50, 100), { comparable: true, percent: -50 })
    assert.deepEqual(percentChange(100, 0), { comparable: false })
    assert.deepEqual(percentChange(100, -20), { comparable: false })
    assert.equal(formatChange(100, 0), 'não comparável')
    assert.equal(formatChange(125, 100), '+25,0%')
  })
})

describe('CSV seguro', () => {
  it('neutraliza fórmulas e escapa separadores', () => {
    assert.equal(csvCell('=HYPERLINK("x")'), '"\'=HYPERLINK(""x"")"')
    assert.equal(csvCell('+5511'), "'+5511")
    assert.equal(csvCell('a;b'), '"a;b"')
    assert.equal(csvCell(12), '12')
  })
})

describe('validação no servidor', () => {
  it('cliente', () => {
    assert.equal(validateClient({ name: 'A' }).ok, false)
    assert.deepEqual(validateClient({ name: '  Cliente  Fictício ', company: '', notes: undefined }), { ok: true, value: { name: 'Cliente Fictício', company: null, notes: '' } })
  })
  const contract = { direction: 'in', clientId: CLIENT, category: 'hosting', description: 'Hospedagem fictícia', amount: '150,00', periodicity: 'monthly',
    startDate: '2026-01-10', dueDay: 10 }
  it('contrato exige cliente e categoria de receita; gera a partir do mês atual por padrão', () => {
    const v = validateSource(contract, TODAY)
    assert.ok(v.ok)
    assert.equal(v.ok && v.value.generateFrom, '2026-10-01')
    assert.equal(v.ok && v.value.amountCents, 15000)
    assert.equal(validateSource({ ...contract, clientId: undefined }, TODAY).ok, false)
    assert.equal(validateSource({ ...contract, category: 'software' }, TODAY).ok, false)
    assert.equal(validateSource({ ...contract, generateFrom: '2025-12' }, TODAY).ok, false)
    assert.equal(validateSource({ ...contract, amount: 150 }, TODAY).ok, false)
    assert.equal(validateSource({ ...contract, dueDay: 32 }, TODAY).ok, false)
    assert.equal(validateSource({ ...contract, endDate: '2025-12-31' }, TODAY).ok, false)
  })
  it('despesa: categoria própria, fixa/variável, verba de cliente opcionalmente ligada a um cliente', () => {
    const exp = { direction: 'out', category: 'software', description: 'Assinatura fictícia', amount: '99,90', periodicity: 'monthly', startDate: '2026-10-05', dueDay: 5, costKind: 'fixed' }
    assert.ok(validateSource(exp, TODAY).ok)
    assert.equal(validateSource({ ...exp, costKind: undefined }, TODAY).ok, false)
    assert.equal(validateSource({ ...exp, category: 'hosting' }, TODAY).ok, false)
    const ad = validateSource({ ...exp, category: 'other_expense', clientAdBudget: true, clientId: CLIENT }, TODAY)
    assert.equal(ad.ok && ad.value.clientId, CLIENT)
    const own = validateSource({ ...exp, clientId: CLIENT }, TODAY)
    assert.equal(own.ok && own.value.clientId, null)
  })
  it('recebimento: valor e data reais, nunca futura, chave de idempotência obrigatória', () => {
    assert.ok(validateSettlement({ entryId: ENTRY, amount: '800', settledOn: TODAY, idempotencyKey: KEY }, TODAY).ok)
    assert.equal(validateSettlement({ entryId: ENTRY, amount: '800', settledOn: '2026-11-01', idempotencyKey: KEY }, TODAY).ok, false)
    assert.equal(validateSettlement({ entryId: ENTRY, amount: '800', settledOn: TODAY }, TODAY).ok, false)
    assert.equal(validateSettlement({ entryId: ENTRY, amount: '-1', settledOn: TODAY, idempotencyKey: KEY }, TODAY).ok, false)
  })
  it('nota fiscal: "Emitida" exige número e data; sem cálculo de imposto', () => {
    assert.equal(validateInvoice({ entryId: ENTRY, status: 'issued' }, TODAY).ok, false)
    assert.ok(validateInvoice({ entryId: ENTRY, status: 'issued', number: 'NF-FICT-1', issuedOn: TODAY }, TODAY).ok)
    assert.ok(validateInvoice({ entryId: ENTRY, status: 'not_applicable' }, TODAY).ok)
    assert.equal(validateInvoice({ entryId: ENTRY, status: 'auto' }, TODAY).ok, false)
  })
  it('filtros: mês inválido vira o mês atual; ids e categorias desconhecidas são ignorados', () => {
    assert.deepEqual(parseFilters(new URLSearchParams('month=2026-13&client=x&category=drop'), TODAY), { month: '2026-10', clientId: null, category: null, sourceId: null })
    assert.deepEqual(parseFilters(new URLSearchParams('month=2025-02&category=hosting&client=' + CLIENT), TODAY), { month: '2025-02', clientId: CLIENT, category: 'hosting', sourceId: null })
  })
})

describe('API do Financeiro — segurança (sem banco)', () => {
  const noPool = { connect: async () => { throw new Error('não deveria acessar o banco') } }
  const deps = { pool: noPool, log: () => undefined, now: () => new Date('2026-10-31T15:00:00Z') }
  const base: FinanceAdminRequest = { method: 'GET', vercelEnv: 'preview', sessionValid: true, originAllowed: true, contentType: 'application/json', actorRef: 'ref' }
  it('fora do Preview: 404', async () => {
    assert.equal((await handleFinanceAdmin(deps, { ...base, vercelEnv: 'production' })).status, 404)
    assert.equal((await handleFinanceExport(deps, { ...base, vercelEnv: undefined })).status, 404)
  })
  it('visitante sem sessão: 401 e nenhum dado (leitura, escrita e CSV)', async () => {
    for (const r of [await handleFinanceAdmin(deps, { ...base, sessionValid: false }),
      await handleFinanceAdmin(deps, { ...base, method: 'POST', sessionValid: false, rawBody: '{"action":"client_create","name":"X Y"}' }),
      await handleFinanceExport(deps, { ...base, sessionValid: false })]) {
      assert.equal(r.status, 401)
      assert.deepEqual(Object.keys('body' in r ? r.body : {}), ['error'])
    }
  })
  it('escrita exige origem do CRM (CSRF), JSON e corpo pequeno', async () => {
    const post = { ...base, method: 'POST' as const, rawBody: '{"action":"client_create","name":"Cliente Fictício"}' }
    assert.equal((await handleFinanceAdmin(deps, { ...post, originAllowed: false })).status, 403)
    assert.equal((await handleFinanceAdmin(deps, { ...post, contentType: 'text/plain' })).status, 400)
    assert.equal((await handleFinanceAdmin(deps, { ...post, rawBody: 'x'.repeat(9000) })).status, 413)
    assert.equal((await handleFinanceAdmin(deps, { ...post, rawBody: '[1]' })).status, 400)
    assert.equal((await handleFinanceAdmin(deps, { ...post, rawBody: '{"action":"drop_all"}' })).body.error, 'UNKNOWN_ACTION')
  })
  it('validação recusa antes de tocar no banco', async () => {
    const post = { ...base, method: 'POST' as const }
    const r = await handleFinanceAdmin(deps, { ...post, rawBody: JSON.stringify({ action: 'settle', entryId: ENTRY, amount: '10', settledOn: '2026-12-01', idempotencyKey: KEY }) })
    assert.deepEqual(r, { status: 400, body: { error: 'INVALID_SETTLED_ON', field: 'settledOn' } })
  })
  it('banco sem a migração 0011: leitura informa pendência; escrita devolve MIGRATION_PENDING', async () => {
    const pending = { connect: async () => ({ query: async (sql: string) => {
      if (/^(BEGIN|SET|ROLLBACK|COMMIT)/.test(sql)) return { rows: [] }
      throw Object.assign(new Error('relation does not exist'), { code: '42P01' })
    }, release: () => undefined }) } as never
    const g = await handleFinanceAdmin({ ...deps, pool: pending }, base)
    assert.equal(g.status, 200)
    assert.equal(g.body.migrationPending, true)
    const p = await handleFinanceAdmin({ ...deps, pool: pending }, { ...base, method: 'POST', rawBody: '{"action":"client_create","name":"Cliente Fictício"}' })
    assert.deepEqual(p, { status: 409, body: { error: 'MIGRATION_PENDING' } })
  })
  it('logs nunca recebem valores nem nomes', async () => {
    const logs: string[] = []
    const fake = { connect: async () => ({ query: async (sql: string) => {
      if (/INSERT INTO crm.finance_clients/.test(sql)) return { rows: [{ id: CLIENT }] }
      return { rows: [], rowCount: 1 }
    }, release: () => undefined }) } as never
    await handleFinanceAdmin({ ...deps, pool: fake, log: (e, d) => logs.push(e + JSON.stringify(d)) },
      { ...base, method: 'POST', rawBody: JSON.stringify({ action: 'client_create', name: 'Nome Secreto Fictício', notes: 'R$ 9.999' }) })
    assert.equal(logs.length, 1)
    assert.ok(!logs[0].includes('Secreto') && !logs[0].includes('9.999'))
  })
})

describe('0012 — situação do serviço e do contrato (somente controle administrativo)', () => {
  const contract = { direction: 'in', clientId: CLIENT, category: 'hosting', description: 'Hospedagem fictícia', amount: '150,00', periodicity: 'monthly', startDate: '2026-10-01', dueDay: 10 }
  it('padrão é "Não informado" (nunca "Assinado" automaticamente)', () => {
    const v = validateSource(contract, TODAY)
    assert.ok(v.ok)
    assert.deepEqual(v.ok && [v.value.serviceStatus, v.value.formalizationStatus], ['unknown', 'unknown'])
    assert.deepEqual(validateAdminStatus({}), { ok: true, value: { serviceStatus: 'unknown', formalizationStatus: 'unknown' } })
  })
  it('aceita todos os estados definidos e recusa valores desconhecidos', () => {
    for (const s of Object.keys(SERVICE_STATUS)) assert.ok(validateAdminStatus({ serviceStatus: s }).ok, s)
    for (const s of Object.keys(FORMALIZATION_STATUS)) assert.ok(validateAdminStatus({ formalizationStatus: s }).ok, s)
    assert.equal(validateAdminStatus({ serviceStatus: 'done' }).ok, false)
    assert.equal(validateAdminStatus({ formalizationStatus: 'assinado' }).ok, false)
    assert.equal(validateSource({ ...contract, formalizationStatus: 'x' }, TODAY).ok, false)
    assert.equal(Object.keys(SERVICE_STATUS).length, 5)
    assert.equal(Object.keys(FORMALIZATION_STATUS).length, 6)
  })
  it('contrato sem assinatura é cadastrável; despesa ignora os campos', () => {
    assert.ok(validateSource({ ...contract, formalizationStatus: 'not_sent', serviceStatus: 'in_progress' }, TODAY).ok)
    const exp = validateSource({ direction: 'out', category: 'software', description: 'Assinatura fictícia', amount: '10', periodicity: 'monthly', startDate: TODAY, dueDay: 5,
      costKind: 'fixed', formalizationStatus: 'signed' }, TODAY)
    assert.equal(exp.ok && exp.value.formalizationStatus, 'unknown')
  })
  it('API: mesma proteção (Preview, sessão, origem, JSON) e validação antes do banco', async () => {
    const noPool = { connect: async () => { throw new Error('não deveria acessar o banco') } }
    const deps = { pool: noPool, log: () => undefined, now: () => new Date('2026-10-31T15:00:00Z') }
    const req: FinanceAdminRequest = { method: 'POST', vercelEnv: 'preview', sessionValid: true, originAllowed: true, contentType: 'application/json', actorRef: 'ref',
      rawBody: JSON.stringify({ action: 'source_admin_status', id: ENTRY, formalizationStatus: 'signed' }) }
    assert.equal((await handleFinanceAdmin(deps, { ...req, sessionValid: false })).status, 401)
    assert.equal((await handleFinanceAdmin(deps, { ...req, originAllowed: false })).status, 403)
    assert.equal((await handleFinanceAdmin(deps, { ...req, vercelEnv: 'production' })).status, 404)
    assert.deepEqual(await handleFinanceAdmin(deps, { ...req, rawBody: JSON.stringify({ action: 'source_admin_status', id: ENTRY, serviceStatus: 'x' }) }),
      { status: 400, body: { error: 'INVALID_SERVICE_STATUS', field: 'serviceStatus' } })
    assert.equal((await handleFinanceAdmin(deps, { ...req, rawBody: JSON.stringify({ action: 'source_admin_status', id: 'x' }) })).status, 400)
  })
})
