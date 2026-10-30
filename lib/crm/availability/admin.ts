import { capacityOf, closedDates, describeDate, lastStartMinute, localDate, localInstant, weekdayOf, type AvailabilityRules } from './engine'
import { addDays, holidaysForYear, type BlockRule } from './holidays'
import { previewHolds } from './capacity'
import {
  AvailabilityMigrationPendingError, CapacityMigrationPendingError, addBlock, addCapacityOverride, addException,
  loadAvailabilityRules, parseCapacityOverride, redistributeCapacity, revokeCapacityOverride, revokeEntry, saveCapacitySettings, saveSettings,
  setHolidayRule,
} from './store'
import type { PoolClient } from 'pg'

/**
 * Seção DISPONIBILIDADE do painel: leitura consolidada e ações administrativas.
 * Toda ação exige confirmed:true e grava o autor (referência não reversível da sessão).
 * Nenhuma ação altera, cancela ou move reuniões já confirmadas: um bloqueio sobre uma
 * reunião existente apenas impede NOVOS agendamentos e devolve um aviso com a contagem.
 */

type Queryable = Pick<PoolClient, 'query'>
export type HandlerResult = { status: number; body: Record<string, unknown> }

function blockLabel(block: BlockRule): string {
  const hh = (m: number) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')
  switch (block.type) {
    case 'full': return 'Dia inteiro bloqueado'
    case 'until': return 'Bloqueado até ' + hh(block.minute)
    case 'after': return 'Bloqueado a partir de ' + hh(block.minute)
    default: return 'Sem bloqueio'
  }
}

/** Reunião confirmada/em processamento (somente início e fim), para avisos no painel. */
export type MeetingInterval = { startsAt: string; endsAt: string }

/** Quantos dias úteis à frente o painel mostra a capacidade diária (inclui a janela pública). */
export const CAPACITY_PLAN_DAYS = 10

/**
 * Capacidade diária dos próximos dias úteis: reservas automáticas, liberadas, manuais e as que
 * coincidem com reunião já confirmada (a reunião é mantida; só informa).
 */
export function capacityPlan(rules: AvailabilityRules, now: Date = new Date(), meetings: MeetingInterval[] = []) {
  const today = localDate(now)
  const days = []
  for (let i = 0; days.length < CAPACITY_PLAN_DAYS && i < 31; i++) {
    const date = addDays(today, i)
    if (!rules.settings.workingDays.includes(weekdayOf(date))) continue
    const capacity = capacityOf(date, rules)
    const slot = rules.settings.slotMinutes * 60_000
    const withMeeting = capacity.effective.filter(m => {
      const start = localInstant(date, m)
      return meetings.some(x => Date.parse(x.startsAt) < start + slot && Date.parse(x.endsAt) > start)
    })
    const dayHolidays = holidaysForYear(Number(date.slice(0, 4)), rules.holidayOverrides)
      .filter(h => h.date === date && h.block.type !== 'none')
    days.push({
      ...capacity, withMeeting, holidays: dayHolidays.map(h => h.name),
      /** Capacidade desligada: o que seria reservado se fosse ativada (apenas exibição; nada é aplicado). */
      preview: previewHolds(date, rules.settings, rules.capacity.settings),
      /** Feriado/política de dia inteiro: o dia já está fechado e as reservas internas não têm efeito. */
      closedByHoliday: dayHolidays.some(h => h.block.type === 'full'),
      inWindow: date <= addDays(today, rules.settings.windowDays),
    })
  }
  return days
}

/** Visão para o painel: configuração, feriados do ano atual e do seguinte, bloqueios, exceções e dias fechados. */
export function availabilityOverview(rules: AvailabilityRules, now: Date = new Date(), meetings: MeetingInterval[] = []) {
  const year = Number(localDate(now).slice(0, 4))
  const holidays = [year, year + 1].flatMap(y => holidaysForYear(y, rules.holidayOverrides).map(h => ({
    ...h, effect: blockLabel(h.block), defaultEffect: blockLabel(h.defaultBlock),
  })))
  const closed = closedDates(rules, now)
  return {
    source: rules.source,
    migrationPending: rules.source === 'defaults',
    settings: rules.settings,
    lastStartMinute: lastStartMinute(rules.settings),
    holidays,
    blocks: rules.blocks,
    exceptions: rules.exceptions,
    window: { today: localDate(now), closedDates: closed.map(date => describeDate(date, rules)) },
    capacity: {
      source: rules.capacity.source,
      migrationPending: rules.capacity.source !== 'database',
      settings: rules.capacity.settings,
      days: capacityPlan(rules, now, meetings),
    },
  }
}

const ACTIONS = [
  'save_settings', 'add_block', 'revoke_block', 'add_exception', 'revoke_exception', 'set_holiday_rule',
  'save_capacity', 'redistribute_capacity', 'capacity_release', 'capacity_hold', 'capacity_day_off', 'revoke_capacity_override',
] as const
export type AvailabilityAction = typeof ACTIONS[number]

export async function handleAvailabilityAction(db: Queryable, data: Record<string, unknown>, actor: string): Promise<HandlerResult> {
  const action = data.action
  if (typeof action !== 'string' || !(ACTIONS as readonly string[]).includes(action)) {
    return { status: 400, body: { error: 'INVALID_ACTION' } }
  }
  if (data.confirmed !== true) return { status: 400, body: { error: 'CONFIRMATION_REQUIRED' } }
  try {
    let result: { ok: boolean; error?: string } & Record<string, unknown>
    switch (action as AvailabilityAction) {
      case 'save_settings': result = await saveSettings(db, data.settings, actor); break
      case 'add_block': result = await addBlock(db, {
        date: data.date, endDate: data.endDate, startTime: data.startTime, endTime: data.endTime,
        category: data.category, reason: data.reason,
      }, actor); break
      case 'add_exception': result = await addException(db, {
        date: data.date, startTime: data.startTime, endTime: data.endTime, reason: data.reason,
      }, actor); break
      case 'revoke_block': result = await revokeEntry(db, 'blocks', data.id, actor); break
      case 'revoke_exception': result = await revokeEntry(db, 'exceptions', data.id, actor); break
      case 'set_holiday_rule': result = await setHolidayRule(db, { key: data.key, year: data.year, block: data.block }, actor); break
      case 'save_capacity': result = await saveCapacitySettings(db, data.capacity, actor); break
      case 'redistribute_capacity': result = await redistributeCapacity(db, actor); break
      case 'capacity_release':
      case 'capacity_hold':
      case 'capacity_day_off': {
        const kind = action === 'capacity_release' ? 'release' : action === 'capacity_hold' ? 'hold' : 'day_off'
        const parsed = parseCapacityOverride({ date: data.date, time: data.time, action: kind, reason: data.reason })
        if (!parsed) { result = { ok: false, error: 'INVALID_CAPACITY' }; break }
        // Validação contra as regras atuais (as mesmas usadas pelo servidor para oferecer horários).
        result = await addCapacityOverride(db, parsed, actor, await loadAvailabilityRules(db))
        break
      }
      case 'revoke_capacity_override': result = await revokeCapacityOverride(db, data.id, actor); break
    }
    if (result.ok) return { status: 200, body: { ...result } }
    const conflict = result.error === 'ALREADY_SET' || result.error === 'ALREADY_HELD' || result.error === 'NOT_A_HOLD'
    return { status: result.error === 'NOT_FOUND' ? 404 : conflict ? 409 : 400, body: { error: result.error } }
  } catch (error) {
    if (error instanceof AvailabilityMigrationPendingError) return { status: 409, body: { error: 'MIGRATION_PENDING' } }
    if (error instanceof CapacityMigrationPendingError) return { status: 409, body: { error: 'CAPACITY_MIGRATION_PENDING' } }
    return { status: 503, body: { error: 'ACTION_FAILED' } }
  }
}
