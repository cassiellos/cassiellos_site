/**
 * Motor de horários da Cassiellos. Nenhuma dependência do Google ou do Neon.
 * Horários são provisórios e podem ser substituídos por configurações por calendário.
 * São Paulo não adota horário de verão desde 2019; usar fuso IANA nos relatórios.
 */
export const CRM_BOOKING_TIME_ZONE = 'America/Sao_Paulo'

export type BusyInterval = { start: string; end: string }
export type BookingSlot = { startAt: string; endAt: string; localTime: string }

export type BookingPolicy = {
  openHour: number
  closeHour: number
  slotMinutes: number
  minimumNoticeMinutes: number
  maximumDaysAhead: number
  workingDays: readonly number[]
}

export const DEFAULT_BOOKING_POLICY: BookingPolicy = {
  openHour: 9,
  closeHour: 18,
  slotMinutes: 30,
  minimumNoticeMinutes: 12 * 60,
  maximumDaysAhead: 30,
  workingDays: [1, 2, 3, 4, 5],
}

function two(n: number): string { return String(n).padStart(2, '0') }

function localToday(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CRM_BOOKING_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now)
  const value = (name: string) => parts.find(part => part.type === name)?.value ?? ''
  return value('year') + '-' + value('month') + '-' + value('day')
}

function addDays(date: string, days: number): string {
  const result = new Date(date + 'T12:00:00Z')
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

export function isValidBookingDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const parsed = new Date(date + 'T12:00:00Z')
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
}

export function isBookableDate(
  date: string, now: Date = new Date(), policy: BookingPolicy = DEFAULT_BOOKING_POLICY
): boolean {
  if (!isValidBookingDate(date)) return false
  const today = localToday(now)
  if (date < today || date > addDays(today, policy.maximumDaysAhead)) return false
  const weekday = new Date(date + 'T12:00:00-03:00').getUTCDay()
  return policy.workingDays.includes(weekday)
}

export function listBookingSlots(
  date: string,
  busy: readonly BusyInterval[],
  now: Date = new Date(),
  policy: BookingPolicy = DEFAULT_BOOKING_POLICY,
): BookingSlot[] {
  if (!isBookableDate(date, now, policy)) return []
  if (policy.slotMinutes <= 0 || policy.slotMinutes > 240 || policy.openHour < 0 ||
      policy.closeHour > 24 || policy.openHour >= policy.closeHour) return []

  const minStart = now.getTime() + policy.minimumNoticeMinutes * 60_000
  const intervals = busy.map(item => ({
    start: Date.parse(item.start),
    end: Date.parse(item.end),
  })).filter(item => Number.isFinite(item.start) && Number.isFinite(item.end) && item.end > item.start)

  const slots: BookingSlot[] = []
  for (let minute = policy.openHour * 60;
    minute + policy.slotMinutes <= policy.closeHour * 60;
    minute += policy.slotMinutes) {
    const hh = Math.floor(minute / 60)
    const mm = minute % 60
    const start = Date.parse(date + 'T' + two(hh) + ':' + two(mm) + ':00-03:00')
    const end = start + policy.slotMinutes * 60_000
    if (start < minStart || intervals.some(item => start < item.end && item.start < end)) continue
    slots.push({
      startAt: new Date(start).toISOString(),
      endAt: new Date(end).toISOString(),
      localTime: two(hh) + ':' + two(mm),
    })
  }
  return slots
}
