/**
 * Recorte mensal das Receitas por Vencimento ou Competência — dados fictícios que reproduzem o caso Creative Minds
 * (competência 11/2026 com vencimento 01/12/2026 e competência 12/2026 com vencimento 10/12/2026).
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { civilMonthOf, entriesForMonth, monthListTotals } from './month-filter'

type E = { id: string; competenceMonth: string; dueDate: string; state: string; clientAdBudget: boolean; amountCents: number; settledCents: number; remainingCents: number }
const entry = (id: string, competenceMonth: string, dueDate: string, o: Partial<E> = {}): E =>
  ({ id, competenceMonth, dueDate, state: 'open', clientAdBudget: false, amountCents: 139700, settledCents: 0, remainingCents: 139700, ...o })

const NOV_DUE_DEC_01 = entry('c4ac7c76', '2026-11', '2026-12-01')
const DEC_DUE_DEC_10 = entry('96f29bd0', '2026-12', '2026-12-10')
const OTHER_NOV = entry('a0000001', '2026-11', '2026-11-30', { amountCents: 6990, remainingCents: 6990 })
const LIST = [DEC_DUE_DEC_10, NOV_DUE_DEC_01, OTHER_NOV]
const ids = (l: { id: string }[]) => l.map(e => e.id)

describe('Receitas — recorte mensal por Vencimento × Competência', () => {
  it('Novembro/2026 por vencimento: NÃO exibe a cobrança de competência 11 que vence em 01/12/2026', () => {
    assert.deepEqual(ids(entriesForMonth(LIST, '2026-11', 'due')), ['a0000001'])
  })
  it('Dezembro/2026 por vencimento: exibe 01/12 e a cobrança distinta de 10/12, em ordem cronológica', () => {
    assert.deepEqual(ids(entriesForMonth(LIST, '2026-12', 'due')), ['c4ac7c76', '96f29bd0'])
  })
  it('Novembro/2026 por competência: mantém a cobrança da competência de novembro (vencimento 01/12)', () => {
    assert.deepEqual(ids(entriesForMonth(LIST, '2026-11', 'competence')).sort(), ['a0000001', 'c4ac7c76'])
    assert.deepEqual(ids(entriesForMonth(LIST, '2026-12', 'competence')), ['96f29bd0'])
  })
  it('nenhuma cobrança é duplicada ou perdida: cada lançamento aparece em exatamente um mês de vencimento', () => {
    const months = ['2026-10', '2026-11', '2026-12', '2027-01']
    const seen = months.flatMap(m => ids(entriesForMonth(LIST, m, 'due')))
    assert.deepEqual(seen.slice().sort(), ids(LIST).sort())
    assert.equal(new Set(seen).size, seen.length)
    // a lista original não é alterada
    assert.deepEqual(ids(LIST), ['96f29bd0', 'c4ac7c76', 'a0000001'])
  })
  it('virada de ano e meses de tamanhos diferentes, sem conversão de fuso', () => {
    const l = [entry('y1', '2026-12', '2026-12-31'), entry('y2', '2026-12', '2027-01-01'), entry('f1', '2027-02', '2027-02-28'),
      entry('f2', '2028-02', '2028-02-29'), entry('a1', '2027-04', '2027-04-30'), entry('m1', '2027-03', '2027-03-31')]
    assert.deepEqual(ids(entriesForMonth(l, '2026-12', 'due')), ['y1'])
    assert.deepEqual(ids(entriesForMonth(l, '2027-01', 'due')), ['y2'])
    assert.deepEqual(ids(entriesForMonth(l, '2027-02', 'due')), ['f1'])
    assert.deepEqual(ids(entriesForMonth(l, '2028-02', 'due')), ['f2'])
    assert.deepEqual(ids(entriesForMonth(l, '2027-04', 'due')), ['a1'])
    assert.deepEqual(ids(entriesForMonth(l, '2027-03', 'due')), ['m1'])
    // 01/12 à meia-noite: em UTC−3 um Date "voltaria" para 30/11 — o filtro por texto não sofre isso
    assert.equal(civilMonthOf('2026-12-01'), '2026-12')
    assert.equal(civilMonthOf('2026-13-01'), null)
    assert.equal(civilMonthOf('2026-12-01T00:00:00Z'), null)
    assert.deepEqual(entriesForMonth(l, '2026-13', 'due'), [])
  })
  it('totais seguem a lista exibida: parcial, integral, cancelado e verba de cliente', () => {
    const l = [
      entry('p', '2026-12', '2026-12-05', { amountCents: 100000, settledCents: 40000, remainingCents: 60000 }),
      entry('i', '2026-12', '2026-12-06', { amountCents: 50000, settledCents: 50000, remainingCents: 0, state: 'settled' }),
      entry('c', '2026-12', '2026-12-07', { amountCents: 30000, state: 'cancelled' }),
      entry('v', '2026-12', '2026-12-08', { amountCents: 20000, clientAdBudget: true }),
    ]
    const shown = entriesForMonth(l, '2026-12', 'due')
    assert.deepEqual(ids(shown), ['p', 'i', 'c', 'v'], 'cancelados e histórico continuam visíveis na lista')
    assert.deepEqual(monthListTotals(shown), { expectedCents: 150000, receivedCents: 90000, openCents: 60000 })
  })
})
