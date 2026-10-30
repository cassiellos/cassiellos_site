import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_CAPACITY_SETTINGS, DISABLED_CAPACITY, capacityForDate, generatedHolds, gridMinutes, heldMinutes,
  validateCapacitySettings, type CapacityOverride, type CapacityRules,
} from './capacity'
import { DEFAULT_AVAILABILITY_RULES, closedDates, listAvailableSlots, type AvailabilityRules } from './engine'
import { capacityPlan } from './admin'
import { addDays } from './holidays'

const S = DEFAULT_AVAILABILITY_RULES.settings // seg–sex, 09:00–18:00 (término 18:30), 30 min
/** Capacidade ATIVADA (o padrão é desligado — decisão D1). */
const ON = { ...DEFAULT_CAPACITY_SETTINGS, enabled: true }
const CAP: CapacityRules = { settings: ON, overrides: [], source: 'database' }
const RULES: AvailabilityRules = { ...DEFAULT_AVAILABILITY_RULES, capacity: CAP }
const at = (local: string) => new Date(local + '-03:00')
const hhmm = (m: number) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
const weekday = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
const LUNCH = (m: number) => m >= 720 && m + 30 <= 810

/** Dias úteis (seg–sex) a partir de uma data. */
function workingDays(from: string, count: number): string[] {
  const out: string[] = []
  for (let d = from; out.length < count; d = addDays(d, 1)) if (S.workingDays.includes(weekday(d))) out.push(d)
  return out
}
const DAYS = workingDays('2026-11-03', 3 * 261) // ~3 anos de dias úteis

describe('capacidade diária — estado inicial (D1)', () => {
  it('padrão DESLIGADO: nenhuma reserva, oferta completa; a prévia mostra o que seria reservado sem aplicar', () => {
    assert.equal(DEFAULT_CAPACITY_SETTINGS.enabled, false)
    const off: AvailabilityRules = { ...DEFAULT_AVAILABILITY_RULES, capacity: { settings: DEFAULT_CAPACITY_SETTINGS, overrides: [], source: 'database' } }
    const day = '2026-11-10'
    assert.deepEqual(heldMinutes(day, S, off.capacity), [])
    assert.equal(listAvailableSlots(day, [], off, at('2026-11-09T09:00:00')).length, 19)
    const plan = capacityPlan(off, at('2026-11-09T08:00:00'))
    const target = plan.find(d => d.date === day)!
    assert.deepEqual(target.effective, [])
    assert.deepEqual(target.preview, generatedHolds(day, S, ON))
    // Ativada, a prévia some e as reservas passam a valer.
    const on = capacityPlan(RULES, at('2026-11-09T08:00:00')).find(d => d.date === day)!
    assert.deepEqual(on.preview, [])
    assert.deepEqual(on.effective, generatedHolds(day, S, ON))
  })
})

describe('capacidade diária — distribuição determinística por data', () => {
  it('3 ou 4 horários por dia útil, sempre na grade 09:00–18:00; os dois tamanhos ocorrem', () => {
    const grid = new Set(gridMinutes(S))
    const sizes = new Set<number>()
    for (const d of DAYS) {
      const holds = generatedHolds(d, S, CAP.settings)
      assert.ok(holds.length === 3 || holds.length === 4, d + ' ' + holds)
      assert.ok(holds.every(m => grid.has(m)), d)
      sizes.add(holds.length)
    }
    assert.deepEqual([...sizes].sort(), [3, 4])
  })

  it('almoço priorizado (12:00–13:30): 1 ou 2 horários seguidos, e ao menos 1 reserva fora do almoço', () => {
    for (const d of DAYS) {
      const holds = generatedHolds(d, S, CAP.settings)
      const lunch = holds.filter(LUNCH)
      assert.ok(lunch.length >= 1 && lunch.length <= 2, d + ' ' + holds.map(hhmm))
      if (lunch.length === 2) assert.equal(lunch[1] - lunch[0], 30, d)
      assert.ok(holds.some(m => !LUNCH(m)), d)
    }
  })

  it('distribuída ao longo do expediente: manhã e tarde aparecem; sem vizinhos fora do almoço quando há espaço', () => {
    let morning = 0, afternoon = 0
    for (const d of DAYS) {
      const others = generatedHolds(d, S, CAP.settings).filter(m => !LUNCH(m))
      if (others.some(m => m < 720)) morning++
      if (others.some(m => m >= 810)) afternoon++
      for (let i = 1; i < others.length; i++) assert.ok(others[i] - others[i - 1] > 30, d + ' ' + others.map(hhmm))
    }
    assert.ok(morning > DAYS.length * 0.5 && afternoon > DAYS.length * 0.5, `manhã ${morning} · tarde ${afternoon}`)
  })

  it('varia conforme o dia: um dia útil nunca repete exatamente o dia útil anterior (inclui sexta → segunda)', () => {
    for (let i = 1; i < DAYS.length; i++) {
      assert.notDeepEqual(generatedHolds(DAYS[i], S, CAP.settings), generatedHolds(DAYS[i - 1], S, CAP.settings), DAYS[i])
    }
    const distinct = new Set(DAYS.slice(0, 120).map(d => generatedHolds(d, S, CAP.settings).join(',')))
    assert.ok(distinct.size >= 90, 'padrões distintos em 120 dias úteis: ' + distinct.size)
    // Nenhum horário fora do almoço aparece em mais de 30% dos dias.
    const freq = new Map<number, number>()
    for (const d of DAYS) for (const m of generatedHolds(d, S, CAP.settings).filter(x => !LUNCH(x))) freq.set(m, (freq.get(m) ?? 0) + 1)
    for (const [m, n] of freq) assert.ok(n / DAYS.length < 0.3, hhmm(m) + ' em ' + n + ' dias')
  })

  it('consistente entre acessos: mesma resposta a cada consulta, a qualquer hora e com qualquer ocupação', () => {
    const day = '2026-11-10'
    const first = generatedHolds(day, S, CAP.settings)
    for (let i = 0; i < 50; i++) assert.deepEqual(generatedHolds(day, S, CAP.settings), first)
    // A disponibilidade pública da data não muda com o horário da consulta (antes da antecedência valer).
    const a = listAvailableSlots(day, [], RULES, at('2026-11-07T08:00:00'))
    const b = listAvailableSlots(day, [], RULES, at('2026-11-09T06:45:00'))
    assert.deepEqual(a, b)
    // Uma reunião marcada em outro horário não desloca as reservas internas.
    const free = a.find(s => !first.includes(Number(s.localTime.slice(0, 2)) * 60 + Number(s.localTime.slice(3))))!
    const busy = [{ start: free.startAt, end: free.endAt }]
    const after = listAvailableSlots(day, busy, RULES, at('2026-11-07T08:00:00'))
    assert.deepEqual(after.map(s => s.localTime), a.filter(s => s.startAt !== free.startAt).map(s => s.localTime))
  })

  it('o público não recebe os horários reservados; os demais continuam oferecidos (19 − reservas)', () => {
    const day = '2026-11-10'
    const holds = generatedHolds(day, S, CAP.settings)
    const offered = listAvailableSlots(day, [], RULES, at('2026-11-09T09:00:00')).map(s => s.localTime)
    assert.equal(offered.length, 19 - holds.length)
    for (const m of holds) assert.ok(!offered.includes(hhmm(m)), hhmm(m))
    assert.ok(offered.length > 0)
  })

  it('fins de semana e feriados: nenhuma reserva gerada em sábado/domingo; feriado prevalece (dia fechado)', () => {
    assert.deepEqual(generatedHolds('2026-11-07', S, CAP.settings), [])
    assert.deepEqual(generatedHolds('2026-11-08', S, CAP.settings), [])
    assert.deepEqual(listAvailableSlots('2026-11-02', [], RULES, at('2026-10-30T09:00:00')), [])
    const plan = capacityPlan(RULES, at('2026-10-30T09:00:00'))
    assert.ok(plan.every(d => S.workingDays.includes(weekday(d.date))))
    const finados = plan.find(d => d.date === '2026-11-02')!
    assert.deepEqual(finados.holidays, ['Finados'])
    assert.equal(finados.closedByHoliday, true, 'painel não oferece liberar/reservar em dia fechado')
    assert.equal(plan.find(d => d.date === '2026-11-03')!.closedByHoliday, false)
    // Antes das 16h00 de sexta, ainda há horário hoje; as reservas internas não fecham o dia sozinhas.
    assert.ok(!closedDates(RULES, at('2026-10-30T09:00:00')).includes('2026-10-30'))
  })

  it('nova distribuição (semente) muda os horários; configuração desligada não reserva nada', () => {
    const day = '2026-11-11'
    const other = generatedHolds(day, S, { ...CAP.settings, seed: 2 })
    assert.notDeepEqual(other, generatedHolds(day, S, CAP.settings))
    assert.deepEqual(generatedHolds(day, S, { ...CAP.settings, enabled: false }), [])
    assert.deepEqual(heldMinutes(day, S, DISABLED_CAPACITY), [])
    assert.equal(listAvailableSlots(day, [], DEFAULT_AVAILABILITY_RULES, at('2026-11-09T09:00:00')).length, 19)
  })

  it('dia curto: nunca reserva mais de 1/3 da grade (08:00–12:00 → no máximo 2)', () => {
    const short = { ...S, openMinute: 480, closeMinute: 720 }
    for (const d of workingDays('2026-11-03', 40)) assert.ok(generatedHolds(d, short, CAP.settings).length <= 2, d)
  })
})

describe('capacidade diária — ajustes do administrador por data', () => {
  const day = '2026-11-12'
  const holds = generatedHolds(day, S, CAP.settings)
  const ov = (o: Partial<CapacityOverride>): CapacityOverride => ({ id: 'o' + Math.random(), date: day, action: 'hold', minute: null, reason: '', ...o })
  const freeMinute = gridMinutes(S).find(m => !holds.includes(m) && m < 720)!

  it('liberar uma reserva automática devolve o horário ao público', () => {
    const rules: AvailabilityRules = { ...RULES, capacity: { ...CAP, overrides: [ov({ action: 'release', minute: holds[0] })] } }
    const c = capacityForDate(day, S, rules.capacity)
    assert.deepEqual(c.effective, holds.slice(1))
    assert.equal(c.released[0].minute, holds[0])
    const offered = listAvailableSlots(day, [], rules, at('2026-11-10T09:00:00')).map(s => s.localTime)
    assert.ok(offered.includes(hhmm(holds[0])))
  })

  it('reserva manual remove o horário escolhido; fora da grade é ignorada', () => {
    const rules: AvailabilityRules = { ...RULES, capacity: { ...CAP, overrides: [ov({ minute: freeMinute }), ov({ minute: 1110 })] } }
    const c = capacityForDate(day, S, rules.capacity)
    assert.deepEqual(c.manual.map(m => m.minute), [freeMinute])
    assert.ok(c.effective.includes(freeMinute) && !c.effective.includes(1110))
    assert.ok(!listAvailableSlots(day, [], rules, at('2026-11-10T09:00:00')).some(s => s.localTime === hhmm(freeMinute)))
  })

  it('desligar o dia remove as reservas automáticas e mantém as manuais; capacidade desligada mantém só as manuais', () => {
    const overrides = [ov({ action: 'day_off' }), ov({ minute: freeMinute })]
    const c = capacityForDate(day, S, { ...CAP, overrides })
    assert.deepEqual(c.effective, [freeMinute])
    assert.ok(c.dayOff)
    const off = { ...CAP, settings: { ...CAP.settings, enabled: false }, overrides: [ov({ minute: freeMinute })] }
    assert.deepEqual(heldMinutes(day, S, off), [freeMinute])
  })

  it('exceção administrativa que cobre o horário inteiro prevalece sobre a reserva interna', () => {
    const m = holds[0]
    const start = new Date(at(day + 'T' + hhmm(m) + ':00')).toISOString()
    const end = new Date(at(day + 'T' + hhmm(m) + ':00').getTime() + 30 * 60_000).toISOString()
    const rules: AvailabilityRules = { ...RULES, exceptions: [{ id: 'e', startsAt: start, endsAt: end, reason: '' }] }
    assert.ok(listAvailableSlots(day, [], rules, at('2026-11-10T09:00:00')).some(s => s.localTime === hhmm(m)))
  })

  it('validação da configuração (limites seguros)', () => {
    const base = { enabled: true, minPerDay: 3, maxPerDay: 4, lunchStartMinute: 720, lunchEndMinute: 810 }
    assert.equal(validateCapacitySettings(base).ok, true)
    for (const bad of [
      { ...base, enabled: 'sim' }, { ...base, minPerDay: -1 }, { ...base, maxPerDay: 7 }, { ...base, minPerDay: 5, maxPerDay: 4 },
      { ...base, lunchStartMinute: 725 }, { ...base, lunchEndMinute: 720 }, { ...base, lunchStartMinute: 300 }, { ...base, seed: 0 }, null,
    ]) assert.equal(validateCapacitySettings(bad).ok, false, JSON.stringify(bad))
  })
})
