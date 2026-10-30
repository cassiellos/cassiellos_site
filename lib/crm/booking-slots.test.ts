import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_BOOKING_POLICY,
  isBookableDate,
  isValidBookingDate,
  listBookingSlots,
} from './booking-slots'

const monday = '2026-11-02'
// Sexta, 30/10/2026, 09:00 em São Paulo: segunda 02/11 = hoje + 3 (último dia da janela).
// Esta é a grade base, sem feriados; o feriado de 02/11 é aplicado pelo motor de disponibilidade.
const now = new Date('2026-10-30T12:00:00.000Z')

test('rejects non-existing and malformed calendar dates', () => {
  assert.equal(isValidBookingDate('2026-02-30'), false)
  assert.equal(isValidBookingDate('2026-11-02'), true)
  assert.equal(isValidBookingDate('02-11-2026'), false)
})

test('allows weekdays within the booking horizon, excludes weekends', () => {
  assert.equal(isBookableDate(monday, now), true)
  assert.equal(isBookableDate('2026-11-01', now), false)
  assert.equal(isBookableDate('2026-12-30', now), false)
  assert.equal(isBookableDate('2026-11-03', now), false, 'hoje + 4 fora da janela de 3 dias')
})

test('política base = regras comerciais de 30/10/2026 (3 h, 3 dias, seg–sex 09h–18h, 30 min)', () => {
  assert.deepEqual(DEFAULT_BOOKING_POLICY, {
    openHour: 9, closeHour: 18, slotMinutes: 30, minimumNoticeMinutes: 180, maximumDaysAhead: 3, workingDays: [1, 2, 3, 4, 5],
  })
})

test('generates 30-minute slots excluding overlapping busy intervals', () => {
  const busy = [
    { start: '2026-11-02T13:15:00.000Z', end: '2026-11-02T13:45:00.000Z' },
  ]
  const slots = listBookingSlots(monday, busy, now)
  assert.equal(slots[0]?.localTime, '09:00')
  assert.equal(slots.some(slot => slot.localTime === '10:00'), false)
  assert.equal(slots.some(slot => slot.localTime === '10:30'), false)
  assert.equal(slots.some(slot => slot.localTime === '11:00'), true)
  assert.equal(slots.length, ((DEFAULT_BOOKING_POLICY.closeHour -
    DEFAULT_BOOKING_POLICY.openHour) * 60 /
    DEFAULT_BOOKING_POLICY.slotMinutes) - 2)
})

test('enforces notice and rejects fully elapsed dates', () => {
  // 14h10 + 3 h = 17h10 → só 17h30; 15h10 + 3 h passa do expediente → nenhum.
  assert.deepEqual(listBookingSlots(monday, [], new Date('2026-11-02T17:10:00.000Z')).map(s => s.localTime), ['17:30'])
  assert.equal(listBookingSlots(monday, [], new Date('2026-11-02T18:10:00.000Z')).length, 0)
})

test('returns UTC timestamps for accurate calendar creation', () => {
  const first = listBookingSlots(monday, [], now)[0]
  assert.deepEqual(first, {
    startAt: '2026-11-02T12:00:00.000Z',
    endAt: '2026-11-02T12:30:00.000Z',
    localTime: '09:00',
  })
})

// --- Fase 3 / item 3: limites de horário e fuso (America/Sao_Paulo, UTC-03:00) ---

test('busy interval touching slot edges does not block; 1 minute overlap does', () => {
  const touching = [
    { start: '2026-11-02T12:30:00.000Z', end: '2026-11-02T13:00:00.000Z' }, // 09:30–10:00
  ]
  const times = listBookingSlots(monday, touching, now).map(slot => slot.localTime)
  assert.equal(times.includes('09:00'), true, 'termina exatamente quando o ocupado começa')
  assert.equal(times.includes('09:30'), false)
  assert.equal(times.includes('10:00'), true, 'começa exatamente quando o ocupado termina')
  const overlap = [{ start: '2026-11-02T12:29:00.000Z', end: '2026-11-02T12:31:00.000Z' }]
  const blocked = listBookingSlots(monday, overlap, now).map(slot => slot.localTime)
  assert.equal(blocked.includes('09:00'), false)
  assert.equal(blocked.includes('09:30'), false)
})

test('busy interval given with -03:00 offset blocks the same instant as UTC', () => {
  const local = [{ start: '2026-11-02T14:00:00-03:00', end: '2026-11-02T14:30:00-03:00' }]
  const utc = [{ start: '2026-11-02T17:00:00.000Z', end: '2026-11-02T17:30:00.000Z' }]
  assert.deepEqual(listBookingSlots(monday, local, now), listBookingSlots(monday, utc, now))
  assert.equal(listBookingSlots(monday, local, now).some(slot => slot.localTime === '14:00'), false)
})

test('minimum notice boundary is exact (3 h)', () => {
  const firstStart = Date.parse('2026-11-02T12:00:00.000Z') // 09:00 local
  const exactly = new Date(firstStart - DEFAULT_BOOKING_POLICY.minimumNoticeMinutes * 60_000)
  assert.equal(listBookingSlots(monday, [], exactly)[0]?.localTime, '09:00')
  const oneMsLater = new Date(exactly.getTime() + 1)
  assert.equal(listBookingSlots(monday, [], oneMsLater)[0]?.localTime, '09:30')
})

test('last slot ends exactly at closing time (17:30–18:00 local = 20:30–21:00 UTC)', () => {
  const slots = listBookingSlots(monday, [], now)
  assert.deepEqual(slots[slots.length - 1], {
    startAt: '2026-11-02T20:30:00.000Z', endAt: '2026-11-02T21:00:00.000Z', localTime: '17:30',
  })
})

test('booking horizon follows the São Paulo calendar day, not the UTC day', () => {
  // 2026-10-26 23:59:59.999 em Brasília já é 2026-10-27 em UTC.
  const beforeLocalMidnight = new Date('2026-10-27T02:59:59.999Z')
  const atLocalMidnight = new Date('2026-10-27T03:00:00.000Z')
  assert.equal(isBookableDate('2026-10-30', beforeLocalMidnight), false, 'hoje+4 ainda fora do limite')
  assert.equal(isBookableDate('2026-10-30', atLocalMidnight), true, 'vira hoje+3 à meia-noite local')
  assert.equal(isBookableDate('2026-10-26', beforeLocalMidnight), true, 'ainda é o dia local de hoje')
  assert.equal(isBookableDate('2026-10-26', atLocalMidnight), false, 'dia local já passou')
})
