import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { addDays, civilDateInZone, daysInMonth, diffDays, eachDay, firstOfMonth, isCivilDate, isTimeZone, lastOfMonth, monthOf, periodRange, syncWindow } from './dates'

describe('Central — datas civis', () => {
  it('valida datas civis reais (inclui bissexto) e recusa formatos com hora/fuso', () => {
    assert.equal(isCivilDate('2028-02-29'), true)
    assert.equal(isCivilDate('2027-02-29'), false)
    assert.equal(isCivilDate('2026-04-31'), false)
    assert.equal(isCivilDate('2026-12-01T00:00:00Z'), false)
    assert.equal(daysInMonth(2026, 2), 28)
    assert.equal(daysInMonth(2028, 2), 29)
  })
  it('mudança de mês e de ano por aritmética de calendário', () => {
    assert.equal(addDays('2026-01-31', 1), '2026-02-01')
    assert.equal(addDays('2026-03-01', -1), '2026-02-28')
    assert.equal(addDays('2026-12-31', 1), '2027-01-01')
    assert.equal(addDays('2027-01-01', -1), '2026-12-31')
    assert.equal(diffDays('2026-12-25', '2027-01-05'), 11)
    assert.deepEqual(eachDay('2026-12-30', '2027-01-02'), ['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02'])
    assert.deepEqual(eachDay('2026-12-02', '2026-12-01'), [])
    assert.equal(monthOf('2026-12-31'), '2026-12')
    assert.equal(firstOfMonth('2028-02-17'), '2028-02-01')
    assert.equal(lastOfMonth('2028-02-17'), '2028-02-29')
  })
  it('períodos: dias completos até ontem; mês anterior atravessa a virada de ano', () => {
    assert.deepEqual(periodRange('7d', '2027-01-03'), { start: '2026-12-27', end: '2027-01-02' })
    assert.deepEqual(periodRange('last_month', '2027-01-03'), { start: '2026-12-01', end: '2026-12-31' })
    assert.deepEqual(periodRange('last_month', '2026-03-15'), { start: '2026-02-01', end: '2026-02-28' })
    assert.deepEqual(periodRange('this_month', '2026-11-13'), { start: '2026-11-01', end: '2026-11-13' })
    assert.deepEqual(syncWindow('2026-11-13', 7), { start: '2026-11-06', end: '2026-11-12' })
    assert.deepEqual(syncWindow('2027-01-02', 30), { start: '2026-12-03', end: '2027-01-01' })
    assert.throws(() => syncWindow('2026-11-13', 0))
  })
  it('virada de dia em fusos diferentes: o mesmo instante cai em datas civis distintas por conta', () => {
    // 02:30 UTC de 01/12 = 23:30 de 30/11 em São Paulo (UTC−3) e 22:30 em Manaus (UTC−4); já é 01/12 em Lisboa.
    const instant = new Date('2026-12-01T02:30:00Z')
    assert.equal(civilDateInZone(instant, 'America/Sao_Paulo'), '2026-11-30')
    assert.equal(civilDateInZone(instant, 'America/Manaus'), '2026-11-30')
    assert.equal(civilDateInZone(instant, 'Europe/Lisbon'), '2026-12-01')
    // 03:30 UTC: já é 01/12 em São Paulo, ainda 30/11 em Manaus
    const later = new Date('2026-12-01T03:30:00Z')
    assert.equal(civilDateInZone(later, 'America/Sao_Paulo'), '2026-12-01')
    assert.equal(civilDateInZone(later, 'America/Manaus'), '2026-11-30')
    // Réveillon: Nova York ainda em 2026 quando São Paulo já está em 2027
    const ny = new Date('2027-01-01T03:30:00Z')
    assert.equal(civilDateInZone(ny, 'America/Sao_Paulo'), '2027-01-01')
    assert.equal(civilDateInZone(ny, 'America/New_York'), '2026-12-31')
  })
  it('fuso inválido é recusado', () => {
    assert.equal(isTimeZone('America/Sao_Paulo'), true)
    assert.equal(isTimeZone('Mars/Base'), false)
    assert.equal(isTimeZone('../etc'), false)
    assert.throws(() => civilDateInZone(new Date(), 'Nope/Zone'))
  })
})
