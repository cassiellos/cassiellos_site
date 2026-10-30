import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { HOLIDAY_CATALOG, addDays, easterSunday, holidaysForYear, isKnownHolidayKey } from './holidays'

const effect = (year: number) => Object.fromEntries(holidaysForYear(year).map(h => [h.date + ' ' + h.key, h.block]))

describe('feriados e políticas comerciais — catálogo', () => {
  it('Páscoa (gregoriano): 2024, 2025, 2026, 2027, 2028', () => {
    assert.equal(easterSunday(2024), '2024-03-31')
    assert.equal(easterSunday(2025), '2025-04-20')
    assert.equal(easterSunday(2026), '2026-04-05')
    assert.equal(easterSunday(2027), '2027-03-28')
    assert.equal(easterSunday(2028), '2028-04-16')
  })

  it('addDays atravessa meses e anos', () => {
    assert.equal(addDays('2026-12-31', 1), '2027-01-01')
    assert.equal(addDays('2027-03-28', -48), '2027-02-08')
    assert.equal(addDays('2026-04-05', 60), '2026-06-04')
  })

  it('2026 confere com a Portaria MGI 11.460/2025 e com o calendário de BH', () => {
    assert.deepEqual(effect(2026), {
      '2026-01-01 confraternizacao': { type: 'full' },
      '2026-02-16 carnaval_segunda': { type: 'full' },
      '2026-02-17 carnaval_terca': { type: 'full' },
      '2026-02-18 cinzas': { type: 'until', minute: 840 },
      '2026-04-03 paixao': { type: 'full' },
      '2026-04-21 tiradentes': { type: 'full' },
      '2026-05-01 trabalho': { type: 'full' },
      '2026-06-04 corpus_christi': { type: 'full' },
      '2026-08-15 assuncao': { type: 'full' },
      '2026-09-07 independencia': { type: 'full' },
      '2026-10-12 aparecida': { type: 'full' },
      '2026-10-28 servidor_publico': { type: 'none' },
      '2026-10-30 funcionario_publico_mg': { type: 'none' },
      '2026-11-02 finados': { type: 'full' },
      '2026-11-15 republica': { type: 'full' },
      '2026-11-20 consciencia_negra': { type: 'full' },
      '2026-12-08 imaculada_conceicao': { type: 'full' },
      '2026-12-24 vespera_natal': { type: 'after', minute: 780 },
      '2026-12-25 natal': { type: 'full' },
      '2026-12-31 vespera_ano_novo': { type: 'after', minute: 780 },
    })
  })

  it('2027: datas móveis derivadas da Páscoa (28/03/2027)', () => {
    const e = effect(2027)
    assert.deepEqual(e['2027-02-08 carnaval_segunda'], { type: 'full' })
    assert.deepEqual(e['2027-02-09 carnaval_terca'], { type: 'full' })
    assert.deepEqual(e['2027-02-10 cinzas'], { type: 'until', minute: 840 })
    assert.deepEqual(e['2027-03-26 paixao'], { type: 'full' })
    assert.deepEqual(e['2027-05-27 corpus_christi'], { type: 'full' })
    assert.equal(Object.keys(e).length, HOLIDAY_CATALOG.length)
  })

  it('ponto facultativo NÃO bloqueia sozinho; sem pontes automáticas', () => {
    const y2026 = holidaysForYear(2026)
    const servidor = y2026.find(h => h.key === 'servidor_publico')!
    assert.deepEqual(servidor.kinds, ['federal_optional'])
    assert.deepEqual(servidor.block, { type: 'none' })
    // 05/06/2026 (sexta após Corpus Christi) e 20/04/2026 (segunda antes de Tiradentes): pontos facultativos federais, sem bloqueio.
    assert.equal(y2026.some(h => h.date === '2026-06-05' || h.date === '2026-04-20'), false)
    // Todo bloqueio integral ou parcial é feriado legal OU política comercial declarada.
    for (const h of y2026.filter(x => x.block.type !== 'none')) {
      assert.ok(h.kinds.some(k => k.endsWith('_holiday') || k === 'commercial_policy'), h.key)
    }
  })

  it('natureza: Corpus Christi é feriado municipal em BH e ponto facultativo federal', () => {
    const cc = holidaysForYear(2026).find(h => h.key === 'corpus_christi')!
    assert.deepEqual(cc.kinds, ['municipal_holiday', 'federal_optional', 'commercial_policy'])
    const tiradentes = holidaysForYear(2026).find(h => h.key === 'tiradentes')!
    assert.ok(tiradentes.kinds.includes('state_holiday'))
  })

  it('ajuste do administrador: ano específico prevalece sobre "todos os anos"; padrão preservado', () => {
    const overrides = [
      { key: 'corpus_christi', year: null, block: { type: 'none' as const } },
      { key: 'corpus_christi', year: 2027, block: { type: 'until' as const, minute: 720 } },
    ]
    const y2026 = holidaysForYear(2026, overrides).find(h => h.key === 'corpus_christi')!
    const y2027 = holidaysForYear(2027, overrides).find(h => h.key === 'corpus_christi')!
    assert.deepEqual(y2026.block, { type: 'none' })
    assert.deepEqual(y2027.block, { type: 'until', minute: 720 })
    assert.equal(y2026.overridden, true)
    assert.deepEqual(y2026.defaultBlock, { type: 'full' })
    assert.equal(holidaysForYear(2026).find(h => h.key === 'corpus_christi')!.overridden, false)
  })

  it('chaves conhecidas e anos inválidos', () => {
    assert.equal(isKnownHolidayKey('finados'), true)
    assert.equal(isKnownHolidayKey('ponte_inventada'), false)
    assert.equal(isKnownHolidayKey(42), false)
    assert.deepEqual(holidaysForYear(1999), [])
    assert.deepEqual(holidaysForYear(2026.5), [])
  })
})
