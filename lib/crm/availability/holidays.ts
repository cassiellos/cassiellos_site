/**
 * Catálogo de feriados e políticas comerciais do agendamento (Belo Horizonte / MG).
 *
 * Princípios (decisões D1/D2 de 29/10/2026):
 * - Feriado legal ≠ ponto facultativo ≠ bloqueio comercial voluntário. Cada entrada diz o que é.
 * - Ponto facultativo federal NÃO bloqueia por si só (vale para órgãos públicos federais).
 * - Pontes NÃO são bloqueadas automaticamente.
 * - Bloqueios comerciais (Carnaval, Cinzas até 14h, Corpus Christi, 24/12 e 31/12 após 13h)
 *   são padrões editáveis pelo administrador (crm.holiday_rules), nunca regra fixa no código.
 * - Datas móveis derivam da Páscoa (algoritmo gregoriano anônimo / Meeus-Jones-Butcher).
 * - Portaria anual do MGI (ex.: 11.460/2025 para 2026) é FONTE de conferência, não regra permanente.
 *
 * Fontes conferidas em 30/10/2026: Portaria MGI nº 11.460/2025 (DOU 30/12/2025), Portaria Conjunta
 * TJMG nº 1.798/PR/2026 (cita a Lei municipal de BH nº 11.397/2022 e o art. 256 da Constituição de MG),
 * Leis federais 662/1949, 6.802/1980, 9.093/1995 e 14.759/2023.
 */

export type HolidayKind =
  | 'national_holiday' // feriado nacional (lei federal)
  | 'state_holiday' // feriado estadual (MG)
  | 'municipal_holiday' // feriado municipal (Belo Horizonte)
  | 'federal_optional' // ponto facultativo federal (não bloqueia sozinho)
  | 'commercial_policy' // bloqueio comercial voluntário da Cassiellos (editável)
  | 'observance' // data comemorativa sem efeito no agendamento

/** Bloqueio padrão: dia inteiro, até um horário, a partir de um horário, ou nenhum. */
export type BlockRule =
  | { type: 'none' }
  | { type: 'full' }
  | { type: 'until'; minute: number } // bloqueia de 00:00 até o minuto (ex.: 14:00 = 840)
  | { type: 'after'; minute: number } // bloqueia do minuto até 24:00 (ex.: 13:00 = 780)

type DateRule = { fixed: string } | { easterOffset: number }

export type HolidayDefinition = {
  key: string
  name: string
  kinds: HolidayKind[]
  rule: DateRule
  defaultBlock: BlockRule
  source: string
  note?: string
}

export const HOLIDAY_CATALOG: readonly HolidayDefinition[] = [
  // ── Feriados nacionais (bloqueio integral) ─────────────────────────────────────
  { key: 'confraternizacao', name: 'Confraternização Universal', kinds: ['national_holiday'], rule: { fixed: '01-01' },
    defaultBlock: { type: 'full' }, source: 'Lei 662/1949' },
  { key: 'paixao', name: 'Paixão de Cristo (Sexta-feira Santa)', kinds: ['national_holiday', 'municipal_holiday'],
    rule: { easterOffset: -2 }, defaultBlock: { type: 'full' },
    source: 'Portaria MGI 11.460/2025 (feriado nacional); Lei 9.093/1995; Lei municipal BH 11.397/2022' },
  { key: 'tiradentes', name: 'Tiradentes / Data Magna de Minas Gerais', kinds: ['national_holiday', 'state_holiday'],
    rule: { fixed: '04-21' }, defaultBlock: { type: 'full' }, source: 'Lei 662/1949; Constituição de MG, art. 256' },
  { key: 'trabalho', name: 'Dia Mundial do Trabalho', kinds: ['national_holiday'], rule: { fixed: '05-01' },
    defaultBlock: { type: 'full' }, source: 'Lei 662/1949' },
  { key: 'independencia', name: 'Independência do Brasil', kinds: ['national_holiday'], rule: { fixed: '09-07' },
    defaultBlock: { type: 'full' }, source: 'Lei 662/1949' },
  { key: 'aparecida', name: 'Nossa Senhora Aparecida', kinds: ['national_holiday'], rule: { fixed: '10-12' },
    defaultBlock: { type: 'full' }, source: 'Lei 6.802/1980' },
  { key: 'finados', name: 'Finados', kinds: ['national_holiday'], rule: { fixed: '11-02' },
    defaultBlock: { type: 'full' }, source: 'Lei 662/1949' },
  { key: 'republica', name: 'Proclamação da República', kinds: ['national_holiday'], rule: { fixed: '11-15' },
    defaultBlock: { type: 'full' }, source: 'Lei 662/1949' },
  { key: 'consciencia_negra', name: 'Dia Nacional de Zumbi e da Consciência Negra', kinds: ['national_holiday'],
    rule: { fixed: '11-20' }, defaultBlock: { type: 'full' }, source: 'Lei 14.759/2023' },
  { key: 'natal', name: 'Natal', kinds: ['national_holiday'], rule: { fixed: '12-25' },
    defaultBlock: { type: 'full' }, source: 'Lei 662/1949' },

  // ── Feriados municipais de Belo Horizonte (Lei municipal 11.397/2022) ─────────
  { key: 'corpus_christi', name: 'Corpus Christi', kinds: ['municipal_holiday', 'federal_optional', 'commercial_policy'],
    rule: { easterOffset: 60 }, defaultBlock: { type: 'full' },
    source: 'Lei municipal BH 11.397/2022 (feriado); ponto facultativo federal; política comercial D1' },
  { key: 'assuncao', name: 'Assunção de Nossa Senhora', kinds: ['municipal_holiday'], rule: { fixed: '08-15' },
    defaultBlock: { type: 'full' }, source: 'Lei municipal BH 11.397/2022' },
  { key: 'imaculada_conceicao', name: 'Imaculada Conceição', kinds: ['municipal_holiday'], rule: { fixed: '12-08' },
    defaultBlock: { type: 'full' }, source: 'Lei municipal BH 11.397/2022' },

  // ── Políticas comerciais (D1) sobre pontos facultativos federais ──────────────
  { key: 'carnaval_segunda', name: 'Carnaval (segunda-feira)', kinds: ['federal_optional', 'commercial_policy'],
    rule: { easterOffset: -48 }, defaultBlock: { type: 'full' }, source: 'Ponto facultativo federal; política comercial D1' },
  { key: 'carnaval_terca', name: 'Carnaval (terça-feira)', kinds: ['federal_optional', 'commercial_policy'],
    rule: { easterOffset: -47 }, defaultBlock: { type: 'full' }, source: 'Ponto facultativo federal; política comercial D1' },
  { key: 'cinzas', name: 'Quarta-feira de Cinzas (até 14h)', kinds: ['federal_optional', 'commercial_policy'],
    rule: { easterOffset: -46 }, defaultBlock: { type: 'until', minute: 14 * 60 },
    source: 'Ponto facultativo federal até 14h; política comercial D1' },
  { key: 'vespera_natal', name: 'Véspera de Natal (após 13h)', kinds: ['federal_optional', 'commercial_policy'],
    rule: { fixed: '12-24' }, defaultBlock: { type: 'after', minute: 13 * 60 },
    source: 'Ponto facultativo federal após 13h (Portaria MGI 11.460/2025); política comercial D1' },
  { key: 'vespera_ano_novo', name: 'Véspera de Ano-Novo (após 13h)', kinds: ['federal_optional', 'commercial_policy'],
    rule: { fixed: '12-31' }, defaultBlock: { type: 'after', minute: 13 * 60 },
    source: 'Ponto facultativo federal após 13h (Portaria MGI 11.460/2025); política comercial D1' },

  // ── Sem bloqueio automático (informativo; o administrador pode bloquear) ─────
  { key: 'servidor_publico', name: 'Dia do Servidor Público (federal)', kinds: ['federal_optional'],
    rule: { fixed: '10-28' }, defaultBlock: { type: 'none' }, source: 'Ponto facultativo federal (Lei 8.112/1990, art. 236)',
    note: 'Vale para a administração pública federal; não bloqueia a agenda comercial.' },
  { key: 'funcionario_publico_mg', name: 'Dia do Funcionário Público (MG)', kinds: ['observance'],
    rule: { fixed: '10-30' }, defaultBlock: { type: 'none' }, source: 'Portaria Conjunta TJMG 1.798/2026, art. 1º, IX',
    note: 'Suspensão de expediente no serviço público estadual; não é feriado para empresas.' },
] as const

export type HolidayOccurrence = {
  key: string
  date: string // YYYY-MM-DD (local, America/Sao_Paulo)
  name: string
  kinds: HolidayKind[]
  block: BlockRule
  defaultBlock: BlockRule
  source: string
  note?: string
  /** true quando o administrador alterou o padrão (crm.holiday_rules). */
  overridden: boolean
}

/** Domingo de Páscoa (calendário gregoriano). */
export function easterSunday(year: number): string {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0')
}

export function addDays(date: string, days: number): string {
  const result = new Date(date + 'T12:00:00Z')
  result.setUTCDate(result.getUTCDate() + days)
  return result.toISOString().slice(0, 10)
}

/** Ajuste do administrador para uma entrada do catálogo (todas as datas ou um ano específico). */
export type HolidayRuleOverride = { key: string; year: number | null; block: BlockRule }

function resolveDate(rule: DateRule, year: number): string {
  return 'fixed' in rule ? year + '-' + rule.fixed : addDays(easterSunday(year), rule.easterOffset)
}

export function holidaysForYear(year: number, overrides: readonly HolidayRuleOverride[] = []): HolidayOccurrence[] {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return []
  return HOLIDAY_CATALOG.map(def => {
    const specific = overrides.find(o => o.key === def.key && o.year === year)
    const general = overrides.find(o => o.key === def.key && o.year === null)
    const override = specific ?? general
    return {
      key: def.key, date: resolveDate(def.rule, year), name: def.name, kinds: [...def.kinds],
      block: override ? override.block : def.defaultBlock, defaultBlock: def.defaultBlock,
      source: def.source, ...(def.note ? { note: def.note } : {}), overridden: Boolean(override),
    }
  }).sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.key.localeCompare(y.key)))
}

export function isKnownHolidayKey(key: unknown): key is string {
  return typeof key === 'string' && HOLIDAY_CATALOG.some(def => def.key === key)
}
