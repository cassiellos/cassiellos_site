import { addDays } from './holidays'

/**
 * Capacidade diária — horários reservados para atividades internas (bloqueios operacionais variáveis).
 *
 * Regras:
 *  - Em cada dia de atendimento, de 3 a 4 horários (configurável) deixam de ser oferecidos ao público
 *    porque ficam reservados para trabalho interno. Prioriza o almoço (12h00–13h30 por padrão) e
 *    distribui o restante ao longo do expediente, sem horários vizinhos quando possível.
 *  - DETERMINÍSTICO: a escolha depende só da data, da configuração e de uma semente administrativa.
 *    Não depende do horário da consulta, do visitante, do Google nem das reservas — todos os
 *    visitantes veem a mesma disponibilidade e nada muda a cada visita.
 *  - A distribuição varia de um dia para o outro: um dia útil nunca repete exatamente os horários
 *    do dia útil anterior.
 *  - O administrador pode liberar um horário, reservar outro manualmente ou desligar as reservas
 *    automáticas de uma data (ajustes por data, revogáveis, com histórico).
 *  - Nunca cria reunião, evento no Google ou registro falso, e nunca altera reuniões confirmadas:
 *    o horário apenas deixa de ser oferecido para NOVOS agendamentos.
 * Sem banco e sem Google: o servidor usa estas funções tanto para listar quanto para validar.
 */

/** Subconjunto da configuração do horário comercial usado aqui (evita dependência circular). */
export type CapacityGridSettings = { workingDays: number[]; openMinute: number; closeMinute: number; slotMinutes: number }

export type CapacitySettings = {
  enabled: boolean
  minPerDay: number
  maxPerDay: number
  /** Janela de almoço priorizada [início, fim), em minutos desde 00:00. */
  lunchStartMinute: number
  lunchEndMinute: number
  /** Semente da distribuição. "Redistribuir" no painel incrementa este número. */
  seed: number
}

export const DEFAULT_CAPACITY_SETTINGS: CapacitySettings = {
  enabled: true, minPerDay: 3, maxPerDay: 4, lunchStartMinute: 12 * 60, lunchEndMinute: 13 * 60 + 30, seed: 1,
}

export const CAPACITY_LIMITS = {
  /** Máximo configurável por dia. */
  maxPerDay: 6,
  /** Nunca reservar mais de 1/3 da grade do dia (proteção contra configuração exagerada). */
  maxShareOfDay: 1 / 3,
  maxSeed: 1_000_000,
  /** Ajustes por data: até 1 ano à frente. */
  maxDaysAhead: 366,
} as const

export type CapacityOverrideAction = 'release' | 'hold' | 'day_off'
export type CapacityOverride = { id: string; date: string; action: CapacityOverrideAction; minute: number | null; reason: string }

export type CapacityRules = {
  settings: CapacitySettings
  overrides: CapacityOverride[]
  /** 'database' = tabelas da 0009; 'defaults' = migração 0009 não aplicada (capacidade desligada). */
  source: 'database' | 'defaults'
}

/** Sem a migração 0009 não há como o administrador liberar horários: a capacidade fica DESLIGADA. */
export const DISABLED_CAPACITY: CapacityRules = {
  settings: { ...DEFAULT_CAPACITY_SETTINGS, enabled: false }, overrides: [], source: 'defaults',
}

const isInt = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x)

export function validateCapacitySettings(input: unknown): { ok: true; settings: CapacitySettings } | { ok: false; errors: string[] } {
  const v = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const errors: string[] = []
  if (typeof v.enabled !== 'boolean') errors.push('enabled')
  if (!isInt(v.minPerDay) || v.minPerDay < 0 || v.minPerDay > CAPACITY_LIMITS.maxPerDay) errors.push('minPerDay')
  if (!isInt(v.maxPerDay) || v.maxPerDay < 0 || v.maxPerDay > CAPACITY_LIMITS.maxPerDay) errors.push('maxPerDay')
  if (isInt(v.minPerDay) && isInt(v.maxPerDay) && v.maxPerDay < v.minPerDay) errors.push('minAboveMax')
  for (const key of ['lunchStartMinute', 'lunchEndMinute'] as const) {
    const m = v[key]
    if (!isInt(m) || m < 6 * 60 || m > 22 * 60 || m % 30 !== 0) errors.push(key)
  }
  if (isInt(v.lunchStartMinute) && isInt(v.lunchEndMinute) && v.lunchEndMinute <= v.lunchStartMinute) errors.push('lunchRange')
  const seed = v.seed === undefined ? DEFAULT_CAPACITY_SETTINGS.seed : v.seed
  if (!isInt(seed) || seed < 1 || seed > CAPACITY_LIMITS.maxSeed) errors.push('seed')
  if (errors.length) return { ok: false, errors }
  return { ok: true, settings: {
    enabled: v.enabled as boolean, minPerDay: v.minPerDay as number, maxPerDay: v.maxPerDay as number,
    lunchStartMinute: v.lunchStartMinute as number, lunchEndMinute: v.lunchEndMinute as number, seed: seed as number,
  } }
}

// ── Sorteio determinístico ─────────────────────────────────────────────────────────────────────

/** FNV-1a 32 bits. */
function hash32(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Mulberry32: gerador pseudoaleatório pequeno e reprodutível. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false
  const d = new Date(date + 'T12:00:00Z')
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === date
}
const weekday = (date: string) => new Date(date + 'T12:00:00Z').getUTCDay()

/** Inícios da grade comercial do dia (sem exceções): 09:00 … último início. */
export function gridMinutes(s: CapacityGridSettings): number[] {
  const result: number[] = []
  for (let m = s.openMinute; m + s.slotMinutes <= s.closeMinute; m += s.slotMinutes) result.push(m)
  return result
}

function rawPattern(date: string, s: CapacityGridSettings, cap: CapacitySettings, salt: number): number[] {
  const grid = gridMinutes(s)
  if (!grid.length) return []
  const rng = mulberry32(hash32('cassiellos-capacidade|' + cap.seed + '|' + date + '|' + salt))
  const span = cap.maxPerDay - cap.minPerDay + 1
  let count = cap.minPerDay + Math.floor(rng() * span)
  count = Math.min(count, CAPACITY_LIMITS.maxPerDay, Math.floor(grid.length * CAPACITY_LIMITS.maxShareOfDay))
  if (count <= 0) return []

  const chosen = new Set<number>()
  const lunch = grid.filter(m => m >= cap.lunchStartMinute && m + s.slotMinutes <= cap.lunchEndMinute)
  if (lunch.length) {
    // Almoço priorizado: 1 horário, ou 2 seguidos quando há 3 ou mais reservas no dia.
    const lunchCount = Math.min(lunch.length, count >= 3 ? 1 + Math.floor(rng() * 2) : 1)
    const offset = Math.floor(rng() * (lunch.length - lunchCount + 1))
    for (let i = 0; i < lunchCount; i++) chosen.add(lunch[offset + i])
  }
  const others = grid.filter(m => !lunch.includes(m))
  const halves = [others.filter(m => m < cap.lunchStartMinute), others.filter(m => m >= cap.lunchStartMinute)]
  if (rng() < 0.5) halves.reverse()
  const pick = (pool: number[]): boolean => {
    const free = pool.filter(m => !chosen.has(m))
    const spaced = free.filter(m => !chosen.has(m - s.slotMinutes) && !chosen.has(m + s.slotMinutes))
    const options = spaced.length ? spaced : free
    if (!options.length) return false
    chosen.add(options[Math.floor(rng() * options.length)])
    return true
  }
  // Ao longo do expediente: alterna manhã e tarde; se uma metade esgotar, usa a outra e, por fim, a grade toda.
  for (let turn = 0; chosen.size < count && turn < count * 4; turn++) {
    if (!pick(halves[turn % 2]) && !pick(halves[(turn + 1) % 2]) && !pick(grid)) break
  }
  return [...chosen].sort((a, b) => a - b)
}

function previousWorkingDate(date: string, workingDays: readonly number[]): string | null {
  for (let i = 1; i <= 7; i++) {
    const d = addDays(date, -i)
    if (workingDays.includes(weekday(d))) return d
  }
  return null
}

const SALTS = 4

/** Reservas automáticas da data (antes dos ajustes do administrador). */
export function generatedHolds(date: string, s: CapacityGridSettings, cap: CapacitySettings): number[] {
  if (!cap.enabled || !isValidDate(date) || !s.workingDays.includes(weekday(date))) return []
  const key = (p: number[]) => p.join(',')
  const prev = previousWorkingDate(date, s.workingDays)
  // O dia útil anterior usa uma destas variantes; escolher uma diferente de todas garante a variação.
  const previous = new Set(prev ? Array.from({ length: SALTS }, (_, k) => key(rawPattern(prev, s, cap, k))) : [])
  for (let salt = 0; salt < SALTS; salt++) {
    const pattern = rawPattern(date, s, cap, salt)
    if (!pattern.length || !previous.has(key(pattern))) return pattern
  }
  return rawPattern(date, s, cap, SALTS)
}

export type DayCapacity = {
  date: string
  /** Reservas automáticas da data. */
  generated: number[]
  /** Reservas automáticas liberadas pelo administrador. */
  released: { minute: number; id: string; reason: string }[]
  /** Reservas manuais (horário escolhido pelo administrador). */
  manual: { minute: number; id: string; reason: string }[]
  /** Reservas automáticas desligadas nesta data. */
  dayOff: { id: string; reason: string } | null
  /** O que efetivamente fica indisponível ao público. */
  effective: number[]
}

export function capacityForDate(date: string, s: CapacityGridSettings, cap: CapacityRules): DayCapacity {
  const generated = generatedHolds(date, s, cap.settings)
  const mine = cap.overrides.filter(o => o.date === date)
  const day = mine.find(o => o.action === 'day_off') ?? null
  const released = mine.filter(o => o.action === 'release' && o.minute !== null && generated.includes(o.minute))
    .map(o => ({ minute: o.minute as number, id: o.id, reason: o.reason }))
  const grid = new Set(gridMinutes(s))
  const manual = mine.filter(o => o.action === 'hold' && o.minute !== null && grid.has(o.minute))
    .map(o => ({ minute: o.minute as number, id: o.id, reason: o.reason }))
  const automatic = day ? [] : generated.filter(m => !released.some(r => r.minute === m))
  const effective = [...new Set([...automatic, ...manual.map(m => m.minute)])].sort((a, b) => a - b)
  return { date, generated, released, manual, dayOff: day ? { id: day.id, reason: day.reason } : null, effective }
}

/** Minutos (início) reservados para atividades internas na data. */
export function heldMinutes(date: string, s: CapacityGridSettings, cap: CapacityRules): number[] {
  if (!cap.settings.enabled && !cap.overrides.some(o => o.date === date && o.action === 'hold')) return []
  return capacityForDate(date, s, cap).effective
}
