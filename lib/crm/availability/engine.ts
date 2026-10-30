import { CRM_BOOKING_TIME_ZONE, DEFAULT_BOOKING_POLICY, isValidBookingDate, type BookingSlot, type BusyInterval } from '../booking-slots'
import { addDays, holidaysForYear, type BlockRule, type HolidayOccurrence, type HolidayRuleOverride } from './holidays'
import { DISABLED_CAPACITY, capacityForDate, heldMinutes, type CapacityRules, type DayCapacity } from './capacity'

/**
 * Motor de disponibilidade (sem Google e sem banco): decide quais horários podem ser oferecidos.
 *
 * Ordem de decisão para cada horário candidato:
 *   1. janela de agendamento (hoje … hoje + windowDays) e antecedência mínima;
 *   2. grade comercial (dias da semana + início/fim) OU uma exceção administrativa que libere o horário;
 *   3. feriados/políticas comerciais, bloqueios manuais e a capacidade diária reservada para atividades
 *      internas (capacity.ts) removem o horário, salvo se ele estiver INTEIRAMENTE dentro de uma exceção
 *      administrativa;
 *   4. ocupação real (Google Calendar + reservas no CRM) sempre remove — exceção nunca libera.
 * O servidor usa as MESMAS funções para listar e para validar a confirmação (chamada direta à API).
 * Nada aqui altera ou cancela reuniões já confirmadas.
 */

export type AvailabilitySettings = {
  workingDays: number[] // 0 = domingo … 6 = sábado
  openMinute: number // primeiro início, em minutos desde 00:00 (09:00 = 540)
  /** Término da última reunião (18:30 = 1110). Último início = closeMinute - slotMinutes (18:00). */
  closeMinute: number
  slotMinutes: 30 // fixo (decisão D3)
  minNoticeMinutes: number
  windowDays: number
}

// Derivado da política comercial base (fonte única em booking-slots.ts): 2 h de antecedência, inícios das
// 09h00 às 18h00 (término 18h30) e 3 dias corridos.
export const DEFAULT_AVAILABILITY_SETTINGS: AvailabilitySettings = {
  workingDays: [...DEFAULT_BOOKING_POLICY.workingDays],
  openMinute: DEFAULT_BOOKING_POLICY.openMinute,
  closeMinute: DEFAULT_BOOKING_POLICY.lastStartMinute + DEFAULT_BOOKING_POLICY.slotMinutes,
  slotMinutes: 30,
  minNoticeMinutes: DEFAULT_BOOKING_POLICY.minimumNoticeMinutes,
  windowDays: DEFAULT_BOOKING_POLICY.maximumDaysAhead,
}

/** Limites seguros para o que o administrador pode configurar. */
export const AVAILABILITY_LIMITS = {
  earliestOpenMinute: 6 * 60, latestCloseMinute: 22 * 60,
  maxNoticeMinutes: 7 * 24 * 60, minWindowDays: 1, maxWindowDays: 90,
  maxBlockDays: 366, maxReasonLength: 200,
} as const

export type ManualBlockCategory = 'day' | 'partial' | 'vacation' | 'recess' | 'other'
export type ManualBlock = { id: string; startsAt: string; endsAt: string; category: ManualBlockCategory; reason: string }
export type AvailabilityException = { id: string; startsAt: string; endsAt: string; reason: string }

export type AvailabilityRules = {
  settings: AvailabilitySettings
  blocks: ManualBlock[]
  exceptions: AvailabilityException[]
  holidayOverrides: HolidayRuleOverride[]
  /** Capacidade diária reservada para atividades internas (0009). Sem a 0009: desligada. */
  capacity: CapacityRules
  /** 'database' = regras do banco; 'defaults' = padrão do código (migração 0008 ainda não aplicada). */
  source: 'database' | 'defaults'
}

export const DEFAULT_AVAILABILITY_RULES: AvailabilityRules = {
  settings: DEFAULT_AVAILABILITY_SETTINGS, blocks: [], exceptions: [], holidayOverrides: [], capacity: DISABLED_CAPACITY,
  source: 'defaults',
}

/** Último início do dia (18:00 com o padrão): a reunião de 30 min termina em closeMinute. */
export function lastStartMinute(settings: AvailabilitySettings): number {
  return settings.closeMinute - settings.slotMinutes
}

// São Paulo não adota horário de verão desde 2019: deslocamento fixo de -03:00.
const LOCAL_OFFSET = '-03:00'
const MINUTE = 60_000

function two(n: number): string { return String(n).padStart(2, '0') }

export function localInstant(date: string, minute: number): number {
  const day = minute >= 1440 ? addDays(date, Math.floor(minute / 1440)) : date
  const m = minute % 1440
  return Date.parse(day + 'T' + two(Math.floor(m / 60)) + ':' + two(m % 60) + ':00' + LOCAL_OFFSET)
}

export function localDate(instant: Date | number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: CRM_BOOKING_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(instant))
  const v = (name: string) => parts.find(p => p.type === name)?.value ?? ''
  return v('year') + '-' + v('month') + '-' + v('day')
}

export function weekdayOf(date: string): number {
  return new Date(date + 'T12:00:00Z').getUTCDay()
}

export function validateSettings(input: unknown): { ok: true; settings: AvailabilitySettings } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const v = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const days = Array.isArray(v.workingDays) ? [...new Set(v.workingDays)] : null
  if (!days || !days.length || days.some(d => !Number.isInteger(d) || (d as number) < 0 || (d as number) > 6)) errors.push('workingDays')
  const int = (x: unknown) => typeof x === 'number' && Number.isInteger(x)
  const L = AVAILABILITY_LIMITS
  if (!int(v.openMinute) || (v.openMinute as number) < L.earliestOpenMinute || (v.openMinute as number) % 30 !== 0) errors.push('openMinute')
  if (!int(v.closeMinute) || (v.closeMinute as number) > L.latestCloseMinute || (v.closeMinute as number) % 30 !== 0) errors.push('closeMinute')
  if (int(v.openMinute) && int(v.closeMinute) && (v.closeMinute as number) - (v.openMinute as number) < 30) errors.push('openBeforeClose')
  if (v.slotMinutes !== undefined && v.slotMinutes !== 30) errors.push('slotMinutes')
  if (!int(v.minNoticeMinutes) || (v.minNoticeMinutes as number) < 0 || (v.minNoticeMinutes as number) > L.maxNoticeMinutes) errors.push('minNoticeMinutes')
  if (!int(v.windowDays) || (v.windowDays as number) < L.minWindowDays || (v.windowDays as number) > L.maxWindowDays) errors.push('windowDays')
  if (errors.length) return { ok: false, errors }
  return { ok: true, settings: {
    workingDays: (days as number[]).sort((a, b) => a - b), openMinute: v.openMinute as number, closeMinute: v.closeMinute as number,
    slotMinutes: 30, minNoticeMinutes: v.minNoticeMinutes as number, windowDays: v.windowDays as number,
  } }
}

type Interval = { start: number; end: number }

/** Intervalo (instantes) bloqueado por um feriado/política no seu dia local. */
export function blockInterval(date: string, rule: BlockRule): Interval | null {
  switch (rule.type) {
    case 'full': return { start: localInstant(date, 0), end: localInstant(date, 1440) }
    case 'until': return { start: localInstant(date, 0), end: localInstant(date, rule.minute) }
    case 'after': return { start: localInstant(date, rule.minute), end: localInstant(date, 1440) }
    default: return null
  }
}

export function holidaysOn(date: string, rules: AvailabilityRules): HolidayOccurrence[] {
  return holidaysForYear(Number(date.slice(0, 4)), rules.holidayOverrides).filter(h => h.date === date)
}

function toInterval(item: { startsAt: string; endsAt: string } | BusyInterval): Interval | null {
  const start = Date.parse('startsAt' in item ? item.startsAt : item.start)
  const end = Date.parse('endsAt' in item ? item.endsAt : item.end)
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null
}

const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end
const inside = (a: Interval, b: Interval) => a.start >= b.start && a.end <= b.end

/** Horários candidatos do dia (antes de janela, antecedência e ocupação). */
export function candidateSlots(date: string, rules: AvailabilityRules): Interval[] {
  if (!isValidBookingDate(date)) return []
  const { settings } = rules
  const step = settings.slotMinutes * MINUTE
  const dayStart = localInstant(date, 0)
  const dayEnd = localInstant(date, 1440)
  const exceptions = rules.exceptions.map(toInterval).filter((i): i is Interval => Boolean(i))
  const starts = new Set<number>()
  if (settings.workingDays.includes(weekdayOf(date))) {
    for (let m = settings.openMinute; m + settings.slotMinutes <= settings.closeMinute; m += settings.slotMinutes) {
      starts.add(localInstant(date, m))
    }
  }
  // Administrative exceptions may open slots on closed days or outside business hours.
  for (const ex of exceptions) {
    const from = Math.max(ex.start, dayStart)
    const to = Math.min(ex.end, dayEnd)
    for (let t = dayStart; t + step <= dayEnd; t += step) {
      if (t >= from && t + step <= to) starts.add(t)
    }
  }
  const closures = [
    ...holidaysOn(date, rules).map(h => blockInterval(date, h.block)),
    ...rules.blocks.map(toInterval),
    // Capacidade diária: horários reservados para atividades internas (determinísticos por data).
    ...heldMinutes(date, settings, rules.capacity ?? DISABLED_CAPACITY)
      .map(m => ({ start: localInstant(date, m), end: localInstant(date, m) + step })),
  ].filter((i): i is Interval => Boolean(i))
  return [...starts].sort((a, b) => a - b)
    .map(start => ({ start, end: start + step }))
    .filter(slot => !closures.some(c => overlaps(slot, c)) || exceptions.some(ex => inside(slot, ex)))
}

/** O dia está dentro da janela pública (hoje … hoje + windowDays, no fuso de São Paulo)? */
export function isWithinWindow(date: string, rules: AvailabilityRules, now: Date = new Date()): boolean {
  if (!isValidBookingDate(date)) return false
  const today = localDate(now)
  return date >= today && date <= addDays(today, rules.settings.windowDays)
}

export function listAvailableSlots(
  date: string, busy: readonly BusyInterval[], rules: AvailabilityRules, now: Date = new Date(),
): BookingSlot[] {
  if (!isWithinWindow(date, rules, now)) return []
  const minStart = now.getTime() + rules.settings.minNoticeMinutes * MINUTE
  const occupied = busy.map(toInterval).filter((i): i is Interval => Boolean(i))
  return candidateSlots(date, rules)
    .filter(slot => slot.start >= minStart && !occupied.some(o => overlaps(slot, o)))
    .map(slot => {
      const minute = Math.round((slot.start - localInstant(date, 0)) / MINUTE)
      return {
        startAt: new Date(slot.start).toISOString(), endAt: new Date(slot.end).toISOString(),
        localTime: two(Math.floor(minute / 60)) + ':' + two(minute % 60),
      }
    })
}

/** Há algum horário oferecível no dia (sem considerar a ocupação do Google)? */
export function isOpenDate(date: string, rules: AvailabilityRules, now: Date = new Date()): boolean {
  return listAvailableSlots(date, [], rules, now).length > 0
}

/** Dias da janela sem nenhum horário (feriado, bloqueio, fim de semana, antecedência). */
export function closedDates(rules: AvailabilityRules, now: Date = new Date()): string[] {
  const today = localDate(now)
  const result: string[] = []
  for (let i = 0; i <= rules.settings.windowDays; i++) {
    const date = addDays(today, i)
    if (!isOpenDate(date, rules, now)) result.push(date)
  }
  return result
}

/** Visão administrativa de um dia: o que se aplica e por quê. */
export function describeDate(date: string, rules: AvailabilityRules) {
  const day = { start: localInstant(date, 0), end: localInstant(date, 1440) }
  return {
    date,
    workingDay: rules.settings.workingDays.includes(weekdayOf(date)),
    holidays: holidaysOn(date, rules),
    blocks: rules.blocks.filter(b => { const i = toInterval(b); return Boolean(i && overlaps(i, day)) }),
    exceptions: rules.exceptions.filter(e => { const i = toInterval(e); return Boolean(i && overlaps(i, day)) }),
    capacity: capacityOf(date, rules),
    candidates: candidateSlots(date, rules).length,
  }
}

/** Reservas internas da data, para o painel (nunca exposto ao visitante). */
export function capacityOf(date: string, rules: AvailabilityRules): DayCapacity {
  return capacityForDate(date, rules.settings, rules.capacity ?? DISABLED_CAPACITY)
}
