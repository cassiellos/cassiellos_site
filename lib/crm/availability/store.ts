import type { PoolClient } from 'pg'
import {
  AVAILABILITY_LIMITS, DEFAULT_AVAILABILITY_RULES, localDate, localInstant, validateSettings,
  type AvailabilityException, type AvailabilityRules, type ManualBlock, type ManualBlockCategory,
} from './engine'
import { addDays, isKnownHolidayKey, type BlockRule, type HolidayRuleOverride } from './holidays'
import {
  CAPACITY_LIMITS, DEFAULT_CAPACITY_SETTINGS, DISABLED_CAPACITY, capacityForDate, gridMinutes, validateCapacitySettings,
  type CapacityOverride, type CapacityOverrideAction, type CapacityRules,
} from './capacity'

/**
 * Persistência da disponibilidade (tabelas das migrações 0008 e 0009).
 * - Sem a 0008 aplicada (tabela inexistente, 42P01): usa o padrão do código — inclusive feriados e
 *   políticas comerciais — e as alterações administrativas respondem MIGRATION_PENDING.
 * - Sem a 0009 (capacidade diária): a capacidade fica DESLIGADA (nenhuma reserva interna) e as ações
 *   de capacidade respondem CAPACITY_MIGRATION_PENDING. A detecção usa to_regclass (sem erro SQL),
 *   para não abortar transações de quem chama.
 * - Qualquer outro erro de banco é propagado (o chamador falha fechado: nenhum horário é oferecido).
 * - Bloqueios e exceções não são apagados: são revogados (histórico preservado).
 * - Nenhuma função aqui toca reuniões, reservas ou o Google Calendar.
 */

type Queryable = Pick<PoolClient, 'query'>
const UNDEFINED_TABLE = '42P01'

export class AvailabilityMigrationPendingError extends Error {
  constructor() { super('MIGRATION_PENDING') }
}

function isUndefinedTable(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === UNDEFINED_TABLE)
}

function toBlockRule(type: string, minute: number | null): BlockRule {
  if ((type === 'until' || type === 'after') && typeof minute === 'number') return { type, minute }
  return type === 'full' ? { type: 'full' } : { type: 'none' }
}

export async function loadAvailabilityRules(db: Queryable, now: Date = new Date()): Promise<AvailabilityRules> {
  try {
    const settingsRow = await db.query<{
      working_days: number[]; open_minute: number; close_minute: number; slot_minutes: number
      min_notice_minutes: number; window_days: number
    }>(`SELECT working_days, open_minute, close_minute, slot_minutes, min_notice_minutes, window_days
          FROM crm.availability_settings WHERE id = 1`)
    let settings = DEFAULT_AVAILABILITY_RULES.settings
    const row = settingsRow.rows[0]
    if (row) {
      const checked = validateSettings({
        workingDays: row.working_days.map(Number), openMinute: Number(row.open_minute), closeMinute: Number(row.close_minute),
        slotMinutes: Number(row.slot_minutes), minNoticeMinutes: Number(row.min_notice_minutes), windowDays: Number(row.window_days),
      })
      if (!checked.ok) throw new Error('AVAILABILITY_SETTINGS_INVALID')
      settings = checked.settings
    }
    const since = new Date(now.getTime() - 2 * 86_400_000)
    const blocks = await db.query<{ id: string; starts_at: Date; ends_at: Date; category: ManualBlockCategory; reason: string }>(
      `SELECT id, starts_at, ends_at, category, reason FROM crm.availability_blocks
        WHERE revoked_at IS NULL AND ends_at > $1 ORDER BY starts_at`, [since])
    const exceptions = await db.query<{ id: string; starts_at: Date; ends_at: Date; reason: string }>(
      `SELECT id, starts_at, ends_at, reason FROM crm.availability_exceptions
        WHERE revoked_at IS NULL AND ends_at > $1 ORDER BY starts_at`, [since])
    const holidayRules = await db.query<{ rule_key: string; year: number | null; block_type: string; block_minute: number | null }>(
      'SELECT rule_key, year, block_type, block_minute FROM crm.holiday_rules')
    const capacity = await loadCapacityRules(db, now)
    return {
      settings,
      blocks: blocks.rows.map((b): ManualBlock => ({
        id: b.id, startsAt: new Date(b.starts_at).toISOString(), endsAt: new Date(b.ends_at).toISOString(),
        category: b.category, reason: b.reason,
      })),
      exceptions: exceptions.rows.map((e): AvailabilityException => ({
        id: e.id, startsAt: new Date(e.starts_at).toISOString(), endsAt: new Date(e.ends_at).toISOString(), reason: e.reason,
      })),
      holidayOverrides: holidayRules.rows.map((r): HolidayRuleOverride => ({
        key: r.rule_key, year: r.year === null ? null : Number(r.year), block: toBlockRule(r.block_type, r.block_minute === null ? null : Number(r.block_minute)),
      })),
      capacity,
      source: 'database',
    }
  } catch (error) {
    if (isUndefinedTable(error)) return { ...DEFAULT_AVAILABILITY_RULES }
    throw error
  }
}

/** Capacidade diária (0009). Tabela ausente = desligada; configuração inválida no banco = falha fechada. */
export async function loadCapacityRules(db: Queryable, now: Date = new Date()): Promise<CapacityRules> {
  const present = await db.query<{ settings: string | null; overrides: string | null }>(
    `SELECT to_regclass('crm.availability_capacity')::text AS settings,
            to_regclass('crm.availability_capacity_overrides')::text AS overrides`)
  if (!present.rows[0]?.settings || !present.rows[0]?.overrides) return DISABLED_CAPACITY
  const row = (await db.query<{
    enabled: boolean; min_per_day: number; max_per_day: number; lunch_start_minute: number; lunch_end_minute: number; seed: number
  }>(`SELECT enabled, min_per_day, max_per_day, lunch_start_minute, lunch_end_minute, seed
        FROM crm.availability_capacity WHERE id = 1`)).rows[0]
  let settings = { ...DEFAULT_CAPACITY_SETTINGS, enabled: false }
  if (row) {
    const checked = validateCapacitySettings({
      enabled: row.enabled, minPerDay: Number(row.min_per_day), maxPerDay: Number(row.max_per_day),
      lunchStartMinute: Number(row.lunch_start_minute), lunchEndMinute: Number(row.lunch_end_minute), seed: Number(row.seed),
    })
    if (!checked.ok) throw new Error('AVAILABILITY_SETTINGS_INVALID')
    settings = checked.settings
  }
  const overrides = await db.query<{ id: string; day: string; action: CapacityOverrideAction; minute: number | null; reason: string }>(
    `SELECT id, day::text AS day, action, minute, reason FROM crm.availability_capacity_overrides
      WHERE revoked_at IS NULL AND day >= $1::date ORDER BY day, minute`, [addDays(localDate(now), -2)])
  return {
    settings,
    overrides: overrides.rows.map((o): CapacityOverride => ({
      id: o.id, date: o.day, action: o.action, minute: o.minute === null ? null : Number(o.minute), reason: o.reason,
    })),
    source: 'database',
  }
}

// ── Entrada do painel: datas locais (YYYY-MM-DD) e horas (HH:MM) → instantes ──────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

export function parseLocalTime(value: unknown): number | null {
  if (typeof value !== 'string') return null
  const m = TIME_RE.exec(value)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

function cleanReason(value: unknown): string | null {
  if (value === undefined || value === null) return ''
  if (typeof value !== 'string') return null
  const text = value.trim().replace(/[\u0000-\u001f\u007f]/g, ' ')
  return text.length <= AVAILABILITY_LIMITS.maxReasonLength ? text : null
}

export type RangeInput = { date?: unknown; endDate?: unknown; startTime?: unknown; endTime?: unknown }

/** Dia inteiro (date…endDate) ou período dentro de um dia (date + startTime/endTime). */
export function buildRange(input: RangeInput): { startsAt: string; endsAt: string; partial: boolean } | null {
  if (typeof input.date !== 'string' || !DATE_RE.test(input.date)) return null
  const date = input.date
  const hasTimes = input.startTime !== undefined || input.endTime !== undefined
  if (hasTimes) {
    const start = parseLocalTime(input.startTime)
    const end = parseLocalTime(input.endTime)
    if (start === null || end === null || end <= start) return null
    const startsAt = localInstant(date, start)
    const endsAt = localInstant(date, end)
    if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) return null
    return { startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), partial: true }
  }
  const endDate = input.endDate === undefined || input.endDate === '' ? date : input.endDate
  if (typeof endDate !== 'string' || !DATE_RE.test(endDate) || endDate < date) return null
  const startsAt = localInstant(date, 0)
  const endsAt = localInstant(endDate, 1440)
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt)) return null
  if ((endsAt - startsAt) / 86_400_000 > AVAILABILITY_LIMITS.maxBlockDays) return null
  return { startsAt: new Date(startsAt).toISOString(), endsAt: new Date(endsAt).toISOString(), partial: false }
}

const CATEGORIES: readonly ManualBlockCategory[] = ['day', 'partial', 'vacation', 'recess', 'other']

async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn() } catch (error) {
    if (isUndefinedTable(error)) throw new AvailabilityMigrationPendingError()
    throw error
  }
}

export class CapacityMigrationPendingError extends Error {
  constructor() { super('CAPACITY_MIGRATION_PENDING') }
}

async function capacityGuard<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn() } catch (error) {
    if (isUndefinedTable(error)) throw new CapacityMigrationPendingError()
    throw error
  }
}

export type AdminResult<T = Record<string, unknown>> = { ok: true } & T | { ok: false; error: string }

export async function saveSettings(db: Queryable, input: unknown, actor: string): Promise<AdminResult> {
  const checked = validateSettings(input)
  if (!checked.ok) return { ok: false, error: 'INVALID_SETTINGS' }
  const s = checked.settings
  return guard(async () => {
    await db.query(
      `INSERT INTO crm.availability_settings
         (id, working_days, open_minute, close_minute, slot_minutes, min_notice_minutes, window_days, updated_at, updated_by)
       VALUES (1, $1::smallint[], $2, $3, 30, $4, $5, now(), $6)
       ON CONFLICT (id) DO UPDATE SET working_days = EXCLUDED.working_days, open_minute = EXCLUDED.open_minute,
         close_minute = EXCLUDED.close_minute, min_notice_minutes = EXCLUDED.min_notice_minutes,
         window_days = EXCLUDED.window_days, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [s.workingDays, s.openMinute, s.closeMinute, s.minNoticeMinutes, s.windowDays, actor])
    return { ok: true as const }
  })
}

/** Bloqueio manual. Reuniões já confirmadas no período NÃO são alteradas — apenas contadas para aviso. */
export async function addBlock(
  db: Queryable, input: RangeInput & { category?: unknown; reason?: unknown }, actor: string,
): Promise<AdminResult<{ id: string; overlappingMeetings: number }>> {
  const range = buildRange(input)
  const reason = cleanReason(input.reason)
  const category = (input.category ?? (range?.partial ? 'partial' : 'day')) as ManualBlockCategory
  if (!range || reason === null || !CATEGORIES.includes(category)) return { ok: false, error: 'INVALID_BLOCK' }
  return guard(async () => {
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO crm.availability_blocks (starts_at, ends_at, category, reason, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`, [range.startsAt, range.endsAt, category, reason, actor])
    const meetings = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM crm.booking_requests
        WHERE status IN ('processing', 'confirmed') AND starts_at < $2 AND ends_at > $1`, [range.startsAt, range.endsAt])
    return { ok: true as const, id: inserted.rows[0].id, overlappingMeetings: meetings.rows[0]?.n ?? 0 }
  })
}

export async function addException(
  db: Queryable, input: RangeInput & { reason?: unknown }, actor: string,
): Promise<AdminResult<{ id: string }>> {
  const range = buildRange({ date: input.date, startTime: input.startTime, endTime: input.endTime })
  const reason = cleanReason(input.reason)
  if (!range || !range.partial || reason === null) return { ok: false, error: 'INVALID_EXCEPTION' }
  return guard(async () => {
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO crm.availability_exceptions (starts_at, ends_at, reason, created_by)
       VALUES ($1, $2, $3, $4) RETURNING id`, [range.startsAt, range.endsAt, reason, actor])
    return { ok: true as const, id: inserted.rows[0].id }
  })
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function revokeEntry(db: Queryable, table: 'blocks' | 'exceptions', id: unknown, actor: string): Promise<AdminResult> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return { ok: false, error: 'INVALID_ID' }
  return guard(async () => {
    const result = await db.query(
      `UPDATE crm.${table === 'blocks' ? 'availability_blocks' : 'availability_exceptions'}
          SET revoked_at = now(), revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL`, [id, actor])
    return result.rowCount ? { ok: true as const } : { ok: false as const, error: 'NOT_FOUND' }
  })
}

/** Ajuste de feriado/política: block = null restaura o padrão do catálogo. */
export async function setHolidayRule(
  db: Queryable, input: { key?: unknown; year?: unknown; block?: unknown }, actor: string,
): Promise<AdminResult> {
  if (!isKnownHolidayKey(input.key)) return { ok: false, error: 'INVALID_HOLIDAY' }
  const year = input.year === null || input.year === undefined ? null : input.year
  if (year !== null && (typeof year !== 'number' || !Number.isInteger(year) || year < 2024 || year > 2100)) {
    return { ok: false, error: 'INVALID_HOLIDAY' }
  }
  const block = input.block as { type?: unknown; minute?: unknown } | null | undefined
  if (block === null || block === undefined) {
    return guard(async () => {
      await db.query('DELETE FROM crm.holiday_rules WHERE rule_key = $1 AND COALESCE(year, 0) = COALESCE($2::smallint, 0)', [input.key, year])
      return { ok: true as const }
    })
  }
  const type = block.type
  const minute = block.minute
  const valid = (type === 'none' || type === 'full') ||
    ((type === 'until' || type === 'after') && typeof minute === 'number' && Number.isInteger(minute) &&
      minute >= 30 && minute <= 1410 && minute % 30 === 0)
  if (!valid) return { ok: false, error: 'INVALID_HOLIDAY' }
  return guard(async () => {
    await db.query(
      `INSERT INTO crm.holiday_rules (rule_key, year, block_type, block_minute, updated_by)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (rule_key, (COALESCE(year, 0))) DO UPDATE
         SET block_type = EXCLUDED.block_type, block_minute = EXCLUDED.block_minute, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [input.key, year, type, type === 'until' || type === 'after' ? minute : null, actor])
    return { ok: true as const }
  })
}

// ── Capacidade diária (0009) ───────────────────────────────────────────────────────────────────

/** Liga/desliga e ajusta quantidade e almoço. A semente não muda aqui (ver redistributeCapacity). */
export async function saveCapacitySettings(db: Queryable, input: unknown, actor: string): Promise<AdminResult> {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const checked = validateCapacitySettings({ ...raw, seed: undefined })
  if (!checked.ok) return { ok: false, error: 'INVALID_CAPACITY' }
  const c = checked.settings
  return capacityGuard(async () => {
    await db.query(
      `INSERT INTO crm.availability_capacity
         (id, enabled, min_per_day, max_per_day, lunch_start_minute, lunch_end_minute, updated_at, updated_by)
       VALUES (1, $1, $2, $3, $4, $5, now(), $6)
       ON CONFLICT (id) DO UPDATE SET enabled = EXCLUDED.enabled, min_per_day = EXCLUDED.min_per_day,
         max_per_day = EXCLUDED.max_per_day, lunch_start_minute = EXCLUDED.lunch_start_minute,
         lunch_end_minute = EXCLUDED.lunch_end_minute, updated_at = now(), updated_by = EXCLUDED.updated_by`,
      [c.enabled, c.minPerDay, c.maxPerDay, c.lunchStartMinute, c.lunchEndMinute, actor])
    return { ok: true as const }
  })
}

/**
 * Nova distribuição para TODAS as datas (incrementa a semente). Liberações feitas sobre a distribuição
 * anterior deixam de fazer sentido e são revogadas (histórico mantido); reservas manuais e dias
 * desligados continuam valendo.
 */
export async function redistributeCapacity(db: Queryable, actor: string, now: Date = new Date()): Promise<AdminResult<{ seed: number; releasesRevoked: number }>> {
  return capacityGuard(async () => {
    const updated = await db.query<{ seed: number }>(
      `UPDATE crm.availability_capacity SET seed = CASE WHEN seed >= $2 THEN 1 ELSE seed + 1 END,
              updated_at = now(), updated_by = $1 WHERE id = 1 RETURNING seed`, [actor, CAPACITY_LIMITS.maxSeed])
    if (!updated.rowCount) return { ok: false as const, error: 'NOT_FOUND' }
    const revoked = await db.query(
      `UPDATE crm.availability_capacity_overrides SET revoked_at = now(), revoked_by = $1
        WHERE revoked_at IS NULL AND action = 'release' AND day >= $2::date`, [actor, localDate(now)])
    return { ok: true as const, seed: Number(updated.rows[0].seed), releasesRevoked: revoked.rowCount ?? 0 }
  })
}

export type CapacityOverrideInput = { date?: unknown; time?: unknown; action?: unknown; reason?: unknown }
export type ParsedCapacityOverride = { date: string; action: CapacityOverrideAction; minute: number | null; reason: string }
const OVERRIDE_ACTIONS: readonly CapacityOverrideAction[] = ['release', 'hold', 'day_off']

/** Validação estrutural (sem banco): ação, data local entre hoje e +1 ano, horário HH:MM e motivo. */
export function parseCapacityOverride(input: CapacityOverrideInput, now: Date = new Date()): ParsedCapacityOverride | null {
  const action = input.action as CapacityOverrideAction
  const reason = cleanReason(input.reason)
  if (!OVERRIDE_ACTIONS.includes(action) || reason === null) return null
  if (typeof input.date !== 'string' || !DATE_RE.test(input.date)) return null
  const date = input.date
  const check = new Date(date + 'T12:00:00Z')
  if (!Number.isFinite(check.getTime()) || check.toISOString().slice(0, 10) !== date) return null
  const today = localDate(now)
  if (date < today || date > addDays(today, CAPACITY_LIMITS.maxDaysAhead)) return null
  if (action === 'day_off') return { date, action, minute: null, reason }
  const minute = parseLocalTime(input.time)
  if (minute === null || minute % 30 !== 0) return null
  return { date, action, minute, reason }
}

/**
 * Ajuste por data: liberar uma reserva automática, reservar um horário manualmente ou desligar as
 * reservas automáticas do dia. Valida contra as regras ATUAIS (mesma função do servidor). Uma reserva
 * manual sobre reunião confirmada NÃO altera a reunião: apenas devolve a contagem como aviso.
 */
export async function addCapacityOverride(
  db: Queryable, input: ParsedCapacityOverride, actor: string, rules: AvailabilityRules,
): Promise<AdminResult<{ id: string; overlappingMeetings: number }>> {
  if (rules.capacity.source !== 'database') throw new CapacityMigrationPendingError()
  const { date, action, minute, reason } = input
  if (!rules.settings.workingDays.includes(new Date(date + 'T12:00:00Z').getUTCDay())) return { ok: false, error: 'INVALID_CAPACITY' }
  if (minute !== null) {
    if (!gridMinutes(rules.settings).includes(minute)) return { ok: false, error: 'INVALID_CAPACITY' }
    const day = capacityForDate(date, rules.settings, rules.capacity)
    if (action === 'release' && !day.generated.includes(minute)) return { ok: false, error: 'NOT_A_HOLD' }
    if (action === 'hold' && day.effective.includes(minute)) return { ok: false, error: 'ALREADY_HELD' }
  }
  return capacityGuard(async () => {
    let inserted
    try {
      inserted = await db.query<{ id: string }>(
        `INSERT INTO crm.availability_capacity_overrides (day, action, minute, reason, created_by)
         VALUES ($1::date, $2, $3, $4, $5) RETURNING id`, [date, action, minute, reason, actor])
    } catch (error) {
      if (error && typeof error === 'object' && (error as { code?: string }).code === '23505') return { ok: false as const, error: 'ALREADY_SET' }
      throw error
    }
    let overlappingMeetings = 0
    if (action === 'hold' && minute !== null) {
      const start = new Date(localInstant(date, minute)).toISOString()
      const end = new Date(localInstant(date, minute) + rules.settings.slotMinutes * 60_000).toISOString()
      const meetings = await db.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM crm.booking_requests
          WHERE status IN ('processing', 'confirmed') AND starts_at < $2 AND ends_at > $1`, [start, end])
      overlappingMeetings = meetings.rows[0]?.n ?? 0
    }
    return { ok: true as const, id: inserted.rows[0].id, overlappingMeetings }
  })
}

/** Desfaz um ajuste por data (revoga; o histórico é mantido). */
export async function revokeCapacityOverride(db: Queryable, id: unknown, actor: string): Promise<AdminResult> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return { ok: false, error: 'INVALID_ID' }
  return capacityGuard(async () => {
    const result = await db.query(
      `UPDATE crm.availability_capacity_overrides SET revoked_at = now(), revoked_by = $2
        WHERE id = $1 AND revoked_at IS NULL`, [id, actor])
    return result.rowCount ? { ok: true as const } : { ok: false as const, error: 'NOT_FOUND' }
  })
}
