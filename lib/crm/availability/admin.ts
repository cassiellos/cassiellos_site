import { closedDates, describeDate, localDate, type AvailabilityRules } from './engine'
import { holidaysForYear, type BlockRule } from './holidays'
import {
  AvailabilityMigrationPendingError, addBlock, addException, revokeEntry, saveSettings, setHolidayRule,
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

/** Visão para o painel: configuração, feriados do ano atual e do seguinte, bloqueios, exceções e dias fechados. */
export function availabilityOverview(rules: AvailabilityRules, now: Date = new Date()) {
  const year = Number(localDate(now).slice(0, 4))
  const holidays = [year, year + 1].flatMap(y => holidaysForYear(y, rules.holidayOverrides).map(h => ({
    ...h, effect: blockLabel(h.block), defaultEffect: blockLabel(h.defaultBlock),
  })))
  const closed = closedDates(rules, now)
  return {
    source: rules.source,
    migrationPending: rules.source === 'defaults',
    settings: rules.settings,
    holidays,
    blocks: rules.blocks,
    exceptions: rules.exceptions,
    window: { today: localDate(now), closedDates: closed.map(date => describeDate(date, rules)) },
  }
}

const ACTIONS = ['save_settings', 'add_block', 'revoke_block', 'add_exception', 'revoke_exception', 'set_holiday_rule'] as const
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
    }
    if (result.ok) return { status: 200, body: { ...result } }
    return { status: result.error === 'NOT_FOUND' ? 404 : 400, body: { error: result.error } }
  } catch (error) {
    if (error instanceof AvailabilityMigrationPendingError) return { status: 409, body: { error: 'MIGRATION_PENDING' } }
    return { status: 503, body: { error: 'ACTION_FAILED' } }
  }
}
