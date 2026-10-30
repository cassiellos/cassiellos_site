import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_AVAILABILITY_RULES, closedDates, describeDate, isOpenDate, isWithinWindow, listAvailableSlots, localDate,
  localInstant, validateSettings, type AvailabilityRules,
} from './engine'

// Sexta-feira, 30/10/2026, 10:30 em São Paulo.
const NOW = new Date('2026-10-30T10:30:00-03:00')
// Testes de lógica (feriados, bloqueios, exceções) com a configuração anterior fixada (12 h / 30 dias),
// para não dependerem do padrão comercial vigente. O padrão novo (3 h / 3 dias) tem testes próprios abaixo.
const R: AvailabilityRules = { ...DEFAULT_AVAILABILITY_RULES, settings: { ...DEFAULT_AVAILABILITY_RULES.settings, minNoticeMinutes: 720, windowDays: 30 } }
const times = (date: string, rules: AvailabilityRules = R, now = NOW, busy: { start: string; end: string }[] = []) =>
  listAvailableSlots(date, busy, rules, now).map(s => s.localTime)
const withRules = (patch: Partial<AvailabilityRules>): AvailabilityRules => ({ ...R, ...patch })
const iso = (local: string) => new Date(local + '-03:00').toISOString()
const GRID = Array.from({ length: 18 }, (_, i) => String(9 + Math.floor(i / 2)).padStart(2, '0') + (i % 2 ? ':30' : ':00'))

describe('motor de disponibilidade', () => {
  it('horário comercial padrão: seg–sex, 09:00–17:30 (término 18:00), 30 min', () => {
    assert.deepEqual(times('2026-11-03'), GRID)
    const [first] = listAvailableSlots('2026-11-03', [], R, NOW)
    assert.deepEqual(first, { startAt: '2026-11-03T12:00:00.000Z', endAt: '2026-11-03T12:30:00.000Z', localTime: '09:00' })
  })

  it('fim de semana fechado', () => {
    assert.deepEqual(times('2026-10-31'), [])
    assert.deepEqual(times('2026-11-01'), [])
  })

  it('feriados fixos: Finados (02/11) e Consciência Negra (20/11) não oferecem horários', () => {
    assert.deepEqual(times('2026-11-02'), [])
    assert.deepEqual(times('2026-11-20'), [])
    assert.equal(isOpenDate('2026-11-02', R, NOW), false)
  })

  it('feriados móveis e políticas: Carnaval 2027 fechado; Cinzas só a partir de 14:00', () => {
    const now = new Date('2027-02-01T10:00:00-03:00')
    assert.deepEqual(times('2027-02-08', R, now), [])
    assert.deepEqual(times('2027-02-09', R, now), [])
    assert.deepEqual(times('2027-02-10', R, now), ['14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30'])
  })

  it('24/12 e 31/12 até 12:30 (bloqueio a partir de 13:00)', () => {
    const now = new Date('2026-12-01T10:00:00-03:00')
    const morning = ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30']
    assert.deepEqual(times('2026-12-24', R, now), morning)
    const lateNow = new Date('2026-12-20T10:00:00-03:00')
    assert.deepEqual(times('2026-12-31', R, lateNow), morning)
  })

  it('ponto facultativo sem política (05/06/2026) permanece aberto; Corpus Christi (04/06/2026) fechado', () => {
    const now = new Date('2026-05-20T10:00:00-03:00')
    assert.deepEqual(times('2026-06-05', R, now), GRID)
    assert.deepEqual(times('2026-06-04', R, now), [])
  })

  it('P5: 28/10/2026 e 30/10/2026 abertos (atendimento mantido por política comercial)', () => {
    const now = new Date('2026-10-20T10:00:00-03:00')
    assert.deepEqual(times('2026-10-28', R, now), GRID)
    assert.deepEqual(times('2026-10-30', R, now), GRID)
  })

  it('antecedência mínima de 12 h', () => {
    assert.deepEqual(times('2026-11-03', R, new Date('2026-11-02T20:00:00-03:00')), GRID)
    assert.deepEqual(times('2026-11-03', R, new Date('2026-11-03T00:00:00-03:00')), GRID.slice(6)) // a partir de 12:00
    assert.deepEqual(times('2026-10-30'), []) // hoje 10:30 + 12 h = 22:30
  })

  it('janela de 30 dias (inclusive) e datas passadas', () => {
    assert.equal(isWithinWindow('2026-11-29', R, NOW), true)
    assert.equal(isWithinWindow('2026-11-30', R, NOW), false)
    assert.deepEqual(times('2026-11-27'), GRID)
    assert.deepEqual(times('2026-11-30'), [])
    assert.deepEqual(times('2026-10-29'), [])
    assert.deepEqual(times('2026-02-30'), [])
  })

  it('bloqueio manual de dia inteiro e parcial', () => {
    const rules = withRules({ blocks: [
      { id: 'b1', startsAt: iso('2026-11-04T00:00:00'), endsAt: iso('2026-11-05T00:00:00'), category: 'day', reason: '' },
      { id: 'b2', startsAt: iso('2026-11-05T12:00:00'), endsAt: iso('2026-11-05T14:00:00'), category: 'partial', reason: '' },
    ] })
    assert.deepEqual(times('2026-11-04', rules), [])
    const partial = times('2026-11-05', rules)
    assert.equal(partial.length, 14)
    assert.ok(!partial.some(t => t >= '12:00' && t < '14:00'))
    assert.ok(partial.includes('11:30') && partial.includes('14:00'))
  })

  it('férias / recesso em intervalo de datas', () => {
    const rules = withRules({ blocks: [
      { id: 'v', startsAt: iso('2026-11-09T00:00:00'), endsAt: iso('2026-11-14T00:00:00'), category: 'vacation', reason: 'Férias' },
    ] })
    for (const d of ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13']) assert.deepEqual(times(d, rules), [], d)
    assert.deepEqual(times('2026-11-16', rules), GRID)
    assert.deepEqual(times('2026-11-06', rules), GRID)
  })

  it('exceção autorizada abre sábado e feriado, mas nunca libera ocupação, antecedência ou janela', () => {
    const rules = withRules({ exceptions: [
      { id: 'e1', startsAt: iso('2026-11-07T09:00:00'), endsAt: iso('2026-11-07T12:00:00'), reason: 'Sábado' },
      { id: 'e2', startsAt: iso('2026-11-02T10:00:00'), endsAt: iso('2026-11-02T11:00:00'), reason: 'Finados' },
      { id: 'e3', startsAt: iso('2026-12-05T09:00:00'), endsAt: iso('2026-12-05T10:00:00'), reason: 'Fora da janela' },
    ] })
    assert.deepEqual(times('2026-11-07', rules), ['09:00', '09:30', '10:00', '10:30', '11:00', '11:30'])
    assert.deepEqual(times('2026-11-02', rules), ['10:00', '10:30'])
    // Ocupado no Google: a exceção não libera.
    assert.deepEqual(times('2026-11-02', rules, NOW, [{ start: iso('2026-11-02T10:00:00'), end: iso('2026-11-02T10:30:00') }]), ['10:30'])
    // Antecedência: sexta 23:00 → sábado a partir de 11:00.
    assert.deepEqual(times('2026-11-07', rules, new Date('2026-11-06T23:00:00-03:00')), ['11:00', '11:30'])
    // Janela: 05/12 está além de 30 dias.
    assert.deepEqual(times('2026-12-05', rules), [])
  })

  it('exceção só libera horário inteiramente coberto; bloqueio parcial continua valendo fora dela', () => {
    const rules = withRules({
      blocks: [{ id: 'b', startsAt: iso('2026-11-05T09:00:00'), endsAt: iso('2026-11-05T18:00:00'), category: 'day', reason: '' }],
      exceptions: [{ id: 'e', startsAt: iso('2026-11-05T15:00:00'), endsAt: iso('2026-11-05T16:15:00'), reason: '' }],
    })
    assert.deepEqual(times('2026-11-05', rules), ['15:00', '15:30'])
  })

  it('ocupação do Google e reservas internas removem horários (sobreposição parcial incluída)', () => {
    const busy = [
      { start: iso('2026-11-03T09:10:00'), end: iso('2026-11-03T09:20:00') },
      { start: iso('2026-11-03T15:00:00'), end: iso('2026-11-03T16:00:00') },
    ]
    const result = times('2026-11-03', R, NOW, busy)
    assert.ok(!result.includes('09:00') && !result.includes('15:00') && !result.includes('15:30'))
    assert.ok(result.includes('09:30') && result.includes('16:00'))
    assert.equal(result.length, 15)
  })

  it('ajustes de feriado do administrador (sem bloqueio / parcial)', () => {
    const now = new Date('2027-05-10T10:00:00-03:00')
    const off = withRules({ holidayOverrides: [{ key: 'corpus_christi', year: 2027, block: { type: 'none' } }] })
    assert.deepEqual(times('2027-05-27', R, now), [])
    assert.deepEqual(times('2027-05-27', off, now), GRID)
    const cinzas = withRules({ holidayOverrides: [{ key: 'cinzas', year: null, block: { type: 'until', minute: 720 } }] })
    assert.equal(times('2027-02-10', cinzas, new Date('2027-02-01T10:00:00-03:00'))[0], '12:00')
  })

  it('fuso America/Sao_Paulo fixo em -03:00 (sem horário de verão) e virada de dia local', () => {
    assert.equal(new Date(localInstant('2027-01-12', 540)).toISOString(), '2027-01-12T12:00:00.000Z')
    assert.equal(new Date(localInstant('2026-07-14', 540)).toISOString(), '2026-07-14T12:00:00.000Z')
    assert.equal(localDate(new Date('2026-11-04T02:30:00Z')), '2026-11-03')
    assert.equal(localDate(new Date('2026-11-04T03:00:00Z')), '2026-11-04')
  })

  it('configuração personalizada: seg–sáb, 08:00–12:00', () => {
    const rules = withRules({ settings: { ...R.settings, workingDays: [1, 2, 3, 4, 5, 6], openMinute: 480, closeMinute: 720 } })
    assert.deepEqual(times('2026-11-07', rules), ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30'])
  })

  it('validação da configuração (limites seguros)', () => {
    const base = { workingDays: [1, 2, 3, 4, 5], openMinute: 540, closeMinute: 1080, minNoticeMinutes: 720, windowDays: 30 }
    assert.equal(validateSettings(base).ok, true)
    for (const bad of [
      { ...base, workingDays: [] }, { ...base, workingDays: [7] }, { ...base, workingDays: [1.5] },
      { ...base, openMinute: 300 }, { ...base, closeMinute: 1350 }, { ...base, openMinute: 545 },
      { ...base, closeMinute: 540 }, { ...base, minNoticeMinutes: -1 }, { ...base, minNoticeMinutes: 10081 },
      { ...base, windowDays: 0 }, { ...base, windowDays: 91 }, { ...base, slotMinutes: 60 }, null, 'x',
    ]) assert.equal(validateSettings(bad).ok, false, JSON.stringify(bad))
    const ok = validateSettings({ ...base, workingDays: [5, 1, 1] })
    assert.ok(ok.ok && JSON.stringify(ok.settings.workingDays) === '[1,5]')
  })

  it('dias fechados da janela e descrição administrativa', () => {
    const closed = closedDates(R, NOW)
    for (const d of ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-20', '2026-11-29']) assert.ok(closed.includes(d), d)
    for (const d of ['2026-11-03', '2026-11-27']) assert.ok(!closed.includes(d), d)
    const finados = describeDate('2026-11-02', R)
    assert.equal(finados.workingDay, true)
    assert.equal(finados.holidays[0].key, 'finados')
    assert.equal(finados.candidates, 0)
  })
})

describe('regras comerciais 30/10/2026 — antecedência 3 h e janela de 3 dias (padrão)', () => {
  const D = DEFAULT_AVAILABILITY_RULES
  const at = (local: string) => new Date(local + '-03:00')
  const t = (date: string, now: Date, rules: AvailabilityRules = D) => listAvailableSlots(date, [], rules, now).map(s => s.localTime)

  it('padrão: 180 min de antecedência e 3 dias de janela', () => {
    assert.equal(D.settings.minNoticeMinutes, 180)
    assert.equal(D.settings.windowDays, 3)
  })
  it('1. exatamente 3 h depois: 09h00 → primeiro horário 12h00', () => {
    assert.equal(t('2026-11-09', at('2026-11-09T09:00:00'))[0], '12:00')
  })
  it('2. menos de 3 h não é oferecido (11h30 com relógio às 09h00)', () => {
    assert.ok(!t('2026-11-09', at('2026-11-09T09:00:00')).includes('11:30'))
  })
  it('3. arredondamento para o próximo slot: 09h10 → 12h30; 13h00 → 16h00', () => {
    assert.equal(t('2026-11-09', at('2026-11-09T09:10:00'))[0], '12:30')
    assert.equal(t('2026-11-09', at('2026-11-09T13:00:00'))[0], '16:00')
  })
  it('4. mesmo dia: 15h00 → nenhum horário (18h00 terminaria após o expediente)', () => {
    assert.deepEqual(t('2026-11-09', at('2026-11-09T15:00:00')), [])
    assert.deepEqual(t('2026-11-09', at('2026-11-09T14:30:00')), ['17:30'])
  })
  it('5 e 6. segunda: hoje + 3 (quinta) permitido; hoje + 4 (sexta) recusado', () => {
    const now = at('2026-11-09T09:00:00')
    assert.equal(t('2026-11-12', now).length, 18)
    assert.deepEqual(t('2026-11-13', now), [])
    assert.equal(isWithinWindow('2026-11-12', D, now), true)
    assert.equal(isWithinWindow('2026-11-13', D, now), false)
  })
  it('7 e 8. sexta: sábado e domingo fechados; segunda disponível; terça fora da janela', () => {
    const now = at('2026-11-06T10:00:00')
    assert.deepEqual(t('2026-11-07', now), [])
    assert.deepEqual(t('2026-11-08', now), [])
    assert.equal(t('2026-11-09', now).length, 18)
    assert.deepEqual(t('2026-11-10', now), [])
  })
  it('9. feriado e recesso dentro da janela; sem compensação de dias', () => {
    const now = at('2026-10-30T10:00:00') // sexta antes de Finados (02/11)
    assert.deepEqual(t('2026-11-02', now), [])
    assert.deepEqual(t('2026-11-03', now), []) // hoje + 4: não compensa o feriado
    const recess: AvailabilityRules = { ...D, blocks: [{ id: 'r', startsAt: at('2026-11-11T00:00:00').toISOString(), endsAt: at('2026-11-12T00:00:00').toISOString(), category: 'recess', reason: '' }] }
    assert.deepEqual(t('2026-11-11', at('2026-11-09T09:00:00'), recess), [])
  })
  it('R-2: janela inteira sem horários (sexta 15h00 antes de segunda feriado)', () => {
    const now = at('2026-10-30T15:00:00')
    assert.deepEqual(closedDates(D, now), ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'])
  })
  it('10. virada de data à meia-noite', () => {
    assert.equal(isWithinWindow('2026-11-13', D, at('2026-11-09T23:59:00')), false)
    assert.equal(isWithinWindow('2026-11-13', D, at('2026-11-10T00:00:00')), true)
    assert.equal(t('2026-11-10', at('2026-11-09T23:00:00'))[0], '09:00')
  })
  it('11. fuso America/Sao_Paulo: 02h30 UTC ainda é o dia anterior em São Paulo', () => {
    const now = new Date('2026-11-10T02:30:00Z') // 09/11 23h30 local
    assert.equal(localDate(now), '2026-11-09')
    assert.equal(isWithinWindow('2026-11-12', D, now), true)
    assert.equal(isWithinWindow('2026-11-13', D, now), false)
  })
  it('exceção administrativa não ultrapassa janela nem antecedência', () => {
    const ex: AvailabilityRules = { ...D, exceptions: [
      { id: 'e1', startsAt: at('2026-11-14T09:00:00').toISOString(), endsAt: at('2026-11-14T12:00:00').toISOString(), reason: '' },
      { id: 'e2', startsAt: at('2026-11-09T09:00:00').toISOString(), endsAt: at('2026-11-09T12:00:00').toISOString(), reason: '' },
    ] }
    assert.deepEqual(t('2026-11-14', at('2026-11-09T09:00:00'), ex), []) // hoje + 5
    assert.deepEqual(t('2026-11-09', at('2026-11-09T09:00:00'), ex), t('2026-11-09', at('2026-11-09T09:00:00')))
  })
  it('13. configuração administrativa dentro dos limites continua possível', () => {
    assert.equal(validateSettings({ ...D.settings, minNoticeMinutes: 180, windowDays: 3 }).ok, true)
    assert.equal(validateSettings({ ...D.settings, minNoticeMinutes: 0, windowDays: 1 }).ok, true)
    assert.equal(validateSettings({ ...D.settings, windowDays: 91 }).ok, false)
  })
})

