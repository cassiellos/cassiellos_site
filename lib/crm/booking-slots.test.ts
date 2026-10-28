import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_BOOKING_POLICY,
  isBookableDate,
  isValidBookingDate,
  listBookingSlots,
} from './booking-slots'

const monday = '2026-11-02'
const now = new Date('2026-10-28T12:00:00.000Z')

test('rejects non-existing and malformed calendar dates', () => {
  assert.equal(isValidBookingDate('2026-02-30'), false)
  assert.equal(isValidBookingDate('2026-11-02'), true)
  assert.equal(isValidBookingDate('02-11-2026'), false)
})

test('allows weekdays within the booking horizon, excludes weekends', () => {
  assert.equal(isBookableDate(monday, now), true)
  assert.equal(isBookableDate('2026-11-01', now), false)
  assert.equal(isBookableDate('2026-12-30', now), false)
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
  const upcoming = new Date('2026-11-02T17:10:00.000Z')
  const slots = listBookingSlots(monday, [], upcoming)
  assert.equal(slots.length, 0)
})

test('returns UTC timestamps for accurate calendar creation', () => {
  const first = listBookingSlots(monday, [], now)[0]
  assert.deepEqual(first, {
    startAt: '2026-11-02T12:00:00.000Z',
    endAt: '2026-11-02T12:30:00.000Z',
    localTime: '09:00',
  })
})
