import type { PoolClient } from 'pg'
import {
  INVOICE_STATUS, STATE_LABEL, addMonths, categoryLabel, competenceMonths, csvCell, csvMoney, dueDateFor, entryState,
  firstDay, lastDay, monthDiff, monthOf, monthlyEquivalentCents, type Direction, type EntryState, type InvoiceStatus, type Periodicity,
  type SourceStatus,
} from './model'
import type { ClientInput, Filters, InvoiceInput, SettlementInput, SourceInput } from './validation'

/**
 * Persistência do Financeiro (migração 0011). Consultas sempre parametrizadas; toda alteração em transação, com
 * registro na trilha de auditoria (finance_audit_log) na MESMA transação. Nada é apagado: cobranças são canceladas
 * com motivo, movimentos são estornados com motivo.
 */

export type FinancePool = { connect(): Promise<PoolClient> }
export class FinanceMigrationPendingError extends Error {
  constructor() { super('MIGRATION_PENDING'); this.name = 'FinanceMigrationPendingError' }
}
export class FinanceRuleError extends Error {
  constructor(readonly code: string, readonly status = 409) { super(code); this.name = 'FinanceRuleError' }
}
const UNDEFINED_TABLE = '42P01'
const UNDEFINED_COLUMN = '42703'
export function isFinanceMigrationMissing(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === UNDEFINED_TABLE || code === UNDEFINED_COLUMN
}

/** Quantos meses à frente a previsão recorrente é materializada (mês atual + 2). */
export const FORECAST_MONTHS_AHEAD = 2
/** Teto para materializar meses futuros quando o administrador consulta um mês distante. */
export const MAX_FORECAST_MONTHS_AHEAD = 12

async function tx<T>(pool: FinancePool, fn: (c: PoolClient) => Promise<T>, readOnly = false): Promise<T> {
  const client = await pool.connect()
  let committed = false
  try {
    await client.query(readOnly ? 'BEGIN READ ONLY' : 'BEGIN')
    await client.query("SET LOCAL statement_timeout = '15s'")
    const result = await fn(client)
    await client.query('COMMIT')
    committed = true
    return result
  } catch (error) {
    if (isFinanceMigrationMissing(error)) throw new FinanceMigrationPendingError()
    throw error
  } finally {
    if (!committed) await client.query('ROLLBACK').catch(() => undefined)
    client.release(committed ? undefined : true)
  }
}

async function audit(c: PoolClient, entity: string, entityId: string, action: string, actor: string, details: Record<string, unknown> = {}) {
  await c.query('INSERT INTO crm.finance_audit_log (entity, entity_id, action, actor, details) VALUES ($1, $2, $3, $4, $5::jsonb)',
    [entity, entityId, action, actor, JSON.stringify(details)])
}

const num = (v: unknown): number => v === null || v === undefined ? 0 : Number(v)
const iso = (v: unknown): string | null => v === null || v === undefined ? null : v instanceof Date ? v.toISOString() : String(v)
/** Datas do tipo DATE chegam como texto (ver toDateText). */
const day = (v: unknown): string | null => v === null || v === undefined ? null : String(v).slice(0, 10)

// ───────────────────────── geração recorrente (idempotente) ─────────────────────────

/**
 * Materializa as cobranças/contas previstas até o horizonte. Idempotente: o índice único (origem, mês) faz a
 * repetição não criar nada. Cancelamentos ficam (a linha cancelada ocupa o mês e não é recriada).
 * Retorna quantos lançamentos novos foram criados.
 */
export async function syncRecurring(c: PoolClient, today: string, horizonMonth?: string, sourceId?: string): Promise<number> {
  const base = monthOf(today)
  let horizon = addMonths(base, FORECAST_MONTHS_AHEAD)
  if (horizonMonth && monthDiff(horizon, horizonMonth) > 0) {
    horizon = monthDiff(base, horizonMonth) > MAX_FORECAST_MONTHS_AHEAD ? addMonths(base, MAX_FORECAST_MONTHS_AHEAD) : horizonMonth
  }
  const { rows } = await c.query(
    `SELECT id, direction, client_id, category, description, amount_cents, periodicity, start_date::text AS start_date,
            end_date::text AS end_date, generate_from::text AS generate_from, status, due_day, invoice_required, client_ad_budget
       FROM crm.finance_sources WHERE status = 'active' AND ($1::uuid IS NULL OR id = $1)`, [sourceId ?? null])
  let created = 0
  for (const s of rows) {
    const months = competenceMonths({
      periodicity: s.periodicity, startDate: s.start_date, endDate: s.end_date, generateFrom: s.generate_from, status: s.status, dueDay: s.due_day,
    }, horizon)
    if (!months.length) continue
    const res = await c.query(
      `INSERT INTO crm.finance_entries (direction, source_id, client_id, category, description, competence_month, due_date,
                                        amount_cents, invoice_required, client_ad_budget)
       SELECT $1, $2, $3, $4, $5, m.month, m.due, $6, $7, $8
         FROM unnest($9::date[], $10::date[]) AS m(month, due)
       ON CONFLICT (source_id, competence_month) WHERE source_id IS NOT NULL DO NOTHING`,
      [s.direction, s.id, s.client_id, s.category, s.description, s.amount_cents, s.invoice_required, s.client_ad_budget,
        months.map(firstDay), months.map(m => dueDateFor(m, s.due_day))])
    created += res.rowCount ?? 0
  }
  return created
}

// ───────────────────────── clientes ─────────────────────────

export async function createClient(pool: FinancePool, input: ClientInput, actor: string): Promise<string> {
  return tx(pool, async c => {
    const { rows } = await c.query('INSERT INTO crm.finance_clients (name, company, notes) VALUES ($1, $2, $3) RETURNING id',
      [input.name, input.company, input.notes])
    await audit(c, 'client', rows[0].id, 'created', actor)
    return rows[0].id as string
  })
}
export async function updateClient(pool: FinancePool, id: string, input: ClientInput, actor: string): Promise<void> {
  await tx(pool, async c => {
    const r = await c.query('UPDATE crm.finance_clients SET name = $2, company = $3, notes = $4, updated_at = now() WHERE id = $1',
      [id, input.name, input.company, input.notes])
    if (!r.rowCount) throw new FinanceRuleError('NOT_FOUND', 404)
    await audit(c, 'client', id, 'updated', actor)
  })
}
/** Arquivar não apaga nada: o cliente só some das listas de seleção; contratos e histórico ficam. */
export async function setClientArchived(pool: FinancePool, id: string, archived: boolean, actor: string): Promise<void> {
  await tx(pool, async c => {
    const r = await c.query('UPDATE crm.finance_clients SET archived_at = CASE WHEN $2 THEN now() ELSE NULL END, updated_at = now() WHERE id = $1',
      [id, archived])
    if (!r.rowCount) throw new FinanceRuleError('NOT_FOUND', 404)
    await audit(c, 'client', id, archived ? 'archived' : 'unarchived', actor)
  })
}

// ───────────────────────── contratos e despesas (origens) ─────────────────────────

export async function createSource(pool: FinancePool, input: SourceInput, actor: string, today: string): Promise<{ id: string; generated: number }> {
  return tx(pool, async c => {
    if (input.clientId) {
      const cl = await c.query('SELECT archived_at FROM crm.finance_clients WHERE id = $1', [input.clientId])
      if (!cl.rowCount) throw new FinanceRuleError('CLIENT_NOT_FOUND', 404)
      if (cl.rows[0].archived_at) throw new FinanceRuleError('CLIENT_ARCHIVED')
    }
    const { rows } = await c.query(
      `INSERT INTO crm.finance_sources (direction, client_id, category, description, supplier, amount_cents, periodicity, cost_kind,
                                        start_date, end_date, due_day, generate_from, invoice_required, client_ad_budget, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) RETURNING id`,
      [input.direction, input.clientId, input.category, input.description, input.supplier, input.amountCents, input.periodicity,
        input.costKind, input.startDate, input.endDate, input.dueDay, input.generateFrom, input.invoiceRequired, input.clientAdBudget, input.notes])
    const id = rows[0].id as string
    const generated = await syncRecurring(c, today, undefined, id)
    await audit(c, 'source', id, 'created', actor, { amountCents: input.amountCents, periodicity: input.periodicity, generated })
    return { id, generated }
  })
}

export type SourceUpdate = {
  description: string; category: string; supplier: string | null; amountCents: number; dueDay: number; endDate: string | null
  costKind: 'fixed' | 'variable' | null; invoiceRequired: boolean; notes: string; applyToOpenFuture: boolean
}
/**
 * Alterar um contrato NUNCA mexe em movimentos já registrados. O novo valor vale para os lançamentos gerados a
 * partir de agora; os já gerados só mudam se o administrador marcar "aplicar aos lançamentos futuros sem
 * movimento" — e mesmo assim só os de competência posterior ao mês atual e sem nenhum recebimento/pagamento.
 */
export async function updateSource(pool: FinancePool, id: string, u: SourceUpdate, actor: string, today: string): Promise<{ adjusted: number }> {
  return tx(pool, async c => {
    const cur = await c.query('SELECT direction, start_date::text AS start_date, generate_from::text AS generate_from FROM crm.finance_sources WHERE id = $1 FOR UPDATE', [id])
    if (!cur.rowCount) throw new FinanceRuleError('NOT_FOUND', 404)
    const s = cur.rows[0]
    if (u.endDate && (u.endDate < s.start_date || monthDiff(monthOf(s.generate_from), monthOf(u.endDate)) < 0)) throw new FinanceRuleError('INVALID_END_DATE', 400)
    await c.query(
      `UPDATE crm.finance_sources SET description = $2, category = $3, supplier = $4, amount_cents = $5, due_day = $6, end_date = $7,
              cost_kind = $8, invoice_required = $9, notes = $10, updated_at = now() WHERE id = $1`,
      [id, u.description, u.category, s.direction === 'out' ? u.supplier : null, u.amountCents, u.dueDay, u.endDate,
        s.direction === 'out' ? u.costKind : null, s.direction === 'in' && u.invoiceRequired, u.notes])
    let adjusted = 0
    const nextMonth = firstDay(addMonths(monthOf(today), 1))
    if (u.applyToOpenFuture) {
      const r = await c.query(
        `UPDATE crm.finance_entries e SET amount_cents = $2, description = $3, category = $4, invoice_required = $5, updated_at = now(),
                due_date = (date_trunc('month', e.competence_month) + make_interval(days => LEAST($6::int, extract(day FROM (date_trunc('month', e.competence_month) + interval '1 month - 1 day'))::int) - 1))::date
          WHERE e.source_id = $1 AND e.status = 'open' AND e.competence_month >= $7::date
            AND NOT EXISTS (SELECT 1 FROM crm.finance_settlements s WHERE s.entry_id = e.id AND s.reversed_at IS NULL)`,
        [id, u.amountCents, u.description, u.category, s.direction === 'in' && u.invoiceRequired, u.dueDay, nextMonth])
      adjusted = r.rowCount ?? 0
    }
    // Novo término: previsões depois dele (sem movimento) deixam de valer — canceladas com motivo, não apagadas.
    if (u.endDate) adjusted += await cancelForecastsAfter(c, id, monthOf(u.endDate), 'Término do contrato alterado', actor)
    await audit(c, 'source', id, 'updated', actor, { amountCents: u.amountCents, applyToOpenFuture: u.applyToOpenFuture, adjusted })
    return { adjusted }
  })
}

async function cancelForecastsAfter(c: PoolClient, sourceId: string, afterMonth: string, reason: string, actor: string): Promise<number> {
  const r = await c.query(
    `UPDATE crm.finance_entries e SET status = 'cancelled', cancelled_at = now(), cancel_reason = $3, updated_at = now()
      WHERE e.source_id = $1 AND e.status = 'open' AND e.competence_month > $2::date
        AND NOT EXISTS (SELECT 1 FROM crm.finance_settlements s WHERE s.entry_id = e.id AND s.reversed_at IS NULL)
      RETURNING e.id`, [sourceId, firstDay(afterMonth), reason])
  for (const row of r.rows) await audit(c, 'entry', row.id, 'cancelled', actor, { reason })
  return r.rowCount ?? 0
}

/**
 * Pausar/encerrar/reativar sem apagar histórico. Pausa e encerramento cancelam (com motivo) apenas as PREVISÕES
 * futuras sem movimento; o mês atual e tudo que já teve movimento ficam como estão. Reativar recomeça a geração no
 * mês atual — os meses da pausa não viram cobrança.
 */
export async function setSourceStatus(pool: FinancePool, id: string, status: SourceStatus, actor: string, today: string, endDate?: string | null) {
  return tx(pool, async c => {
    const cur = await c.query('SELECT status, start_date::text AS start_date, end_date::text AS end_date, periodicity FROM crm.finance_sources WHERE id = $1 FOR UPDATE', [id])
    if (!cur.rowCount) throw new FinanceRuleError('NOT_FOUND', 404)
    const s = cur.rows[0]
    if (s.status === status) return { cancelled: 0, generated: 0 }
    if (s.status === 'ended' && status !== 'ended') throw new FinanceRuleError('SOURCE_ENDED')
    let cancelled = 0
    let generated = 0
    const current = monthOf(today)
    if (status === 'paused') {
      await c.query("UPDATE crm.finance_sources SET status = 'paused', updated_at = now() WHERE id = $1", [id])
      cancelled = await cancelForecastsAfter(c, id, current, 'Contrato pausado', actor)
    } else if (status === 'ended') {
      const end = endDate && endDate >= s.start_date ? endDate : (today >= s.start_date ? today : s.start_date)
      await c.query("UPDATE crm.finance_sources SET status = 'ended', end_date = $2, updated_at = now() WHERE id = $1", [id, end])
      cancelled = await cancelForecastsAfter(c, id, monthOf(end), 'Contrato encerrado', actor)
    } else {
      const from = monthDiff(monthOf(s.start_date), current) > 0 ? current : monthOf(s.start_date)
      if (s.end_date && monthDiff(from, monthOf(s.end_date)) < 0) throw new FinanceRuleError('SOURCE_ENDED')
      await c.query("UPDATE crm.finance_sources SET status = 'active', generate_from = GREATEST(generate_from, $2::date), updated_at = now() WHERE id = $1",
        [id, firstDay(from)])
      generated = await syncRecurring(c, today, undefined, id)
    }
    await audit(c, 'source', id, 'status_' + status, actor, { from: s.status, cancelled, generated })
    return { cancelled, generated }
  })
}

// ───────────────────────── lançamentos ─────────────────────────

async function activeSettled(c: PoolClient, entryId: string): Promise<number> {
  const r = await c.query('SELECT COALESCE(sum(amount_cents), 0) AS total FROM crm.finance_settlements WHERE entry_id = $1 AND reversed_at IS NULL', [entryId])
  return num(r.rows[0].total)
}

/** Só cancela cobrança/conta sem movimento ativo (estorne antes). Fica registrada com motivo. */
export async function cancelEntry(pool: FinancePool, entryId: string, reason: string, actor: string): Promise<void> {
  await tx(pool, async c => {
    const e = await c.query('SELECT status FROM crm.finance_entries WHERE id = $1 FOR UPDATE', [entryId])
    if (!e.rowCount) throw new FinanceRuleError('NOT_FOUND', 404)
    if (e.rows[0].status === 'cancelled') return
    if (await activeSettled(c, entryId) > 0) throw new FinanceRuleError('ENTRY_HAS_SETTLEMENTS')
    await c.query("UPDATE crm.finance_entries SET status = 'cancelled', cancelled_at = now(), cancel_reason = $2, updated_at = now() WHERE id = $1", [entryId, reason])
    await audit(c, 'entry', entryId, 'cancelled', actor, { reason })
  })
}

/** Ajuste de valor/vencimento de UMA cobrança/conta: somente sem movimento ativo; fica na auditoria (antes/depois). */
export async function updateEntry(pool: FinancePool, entryId: string, amountCents: number, dueDate: string, actor: string): Promise<void> {
  await tx(pool, async c => {
    const e = await c.query('SELECT status, amount_cents, due_date::text AS due_date FROM crm.finance_entries WHERE id = $1 FOR UPDATE', [entryId])
    if (!e.rowCount) throw new FinanceRuleError('NOT_FOUND', 404)
    if (e.rows[0].status === 'cancelled') throw new FinanceRuleError('ENTRY_CANCELLED')
    if (await activeSettled(c, entryId) > 0) throw new FinanceRuleError('ENTRY_HAS_SETTLEMENTS')
    await c.query('UPDATE crm.finance_entries SET amount_cents = $2, due_date = $3, updated_at = now() WHERE id = $1', [entryId, amountCents, dueDate])
    await audit(c, 'entry', entryId, 'adjusted', actor, { before: { amountCents: num(e.rows[0].amount_cents), dueDate: e.rows[0].due_date }, after: { amountCents, dueDate } })
  })
}

// ───────────────────────── recebimentos e pagamentos ─────────────────────────

/**
 * Registra um recebimento/pagamento REAL (parcial ou total). Idempotente pela chave: repetir a mesma requisição
 * devolve o movimento já gravado, sem duplicar. Nunca aceita valor acima do saldo em aberto.
 */
export async function recordSettlement(pool: FinancePool, input: SettlementInput, actor: string): Promise<{ id: string; duplicate: boolean; remainingCents: number }> {
  return tx(pool, async c => {
    const e = await c.query('SELECT status, amount_cents FROM crm.finance_entries WHERE id = $1 FOR UPDATE', [input.entryId])
    if (!e.rowCount) throw new FinanceRuleError('NOT_FOUND', 404)
    const existing = await c.query('SELECT id, entry_id, amount_cents FROM crm.finance_settlements WHERE idempotency_key = $1', [input.idempotencyKey])
    const settled = await activeSettled(c, input.entryId)
    const amount = num(e.rows[0].amount_cents)
    if (existing.rowCount) {
      const x = existing.rows[0]
      if (x.entry_id !== input.entryId || num(x.amount_cents) !== input.amountCents) throw new FinanceRuleError('IDEMPOTENCY_KEY_REUSED')
      return { id: x.id, duplicate: true, remainingCents: Math.max(0, amount - settled) }
    }
    if (e.rows[0].status === 'cancelled') throw new FinanceRuleError('ENTRY_CANCELLED')
    const remaining = amount - settled
    if (remaining <= 0) throw new FinanceRuleError('ENTRY_ALREADY_SETTLED')
    if (input.amountCents > remaining) throw new FinanceRuleError('AMOUNT_EXCEEDS_BALANCE')
    const ins = await c.query(
      `INSERT INTO crm.finance_settlements (entry_id, amount_cents, settled_on, method, notes, idempotency_key, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [input.entryId, input.amountCents, input.settledOn, input.method, input.notes, input.idempotencyKey, actor])
    if (!ins.rowCount) throw new FinanceRuleError('IDEMPOTENCY_KEY_REUSED')
    const id = ins.rows[0].id as string
    await audit(c, 'settlement', id, 'recorded', actor, { entryId: input.entryId, amountCents: input.amountCents, settledOn: input.settledOn })
    return { id, duplicate: false, remainingCents: remaining - input.amountCents }
  })
}

/** Estorno: o movimento continua no histórico, marcado como estornado (quem, quando, motivo). */
export async function reverseSettlement(pool: FinancePool, settlementId: string, reason: string, actor: string): Promise<void> {
  await tx(pool, async c => {
    const s = await c.query('SELECT entry_id, reversed_at FROM crm.finance_settlements WHERE id = $1', [settlementId])
    if (!s.rowCount) throw new FinanceRuleError('NOT_FOUND', 404)
    await c.query('SELECT 1 FROM crm.finance_entries WHERE id = $1 FOR UPDATE', [s.rows[0].entry_id])
    if (s.rows[0].reversed_at) return
    await c.query('UPDATE crm.finance_settlements SET reversed_at = now(), reversed_by = $2, reversal_reason = $3 WHERE id = $1 AND reversed_at IS NULL',
      [settlementId, actor, reason])
    await audit(c, 'settlement', settlementId, 'reversed', actor, { entryId: s.rows[0].entry_id, reason })
  })
}

// ───────────────────────── notas fiscais (controle manual) ─────────────────────────

export async function setInvoice(pool: FinancePool, input: InvoiceInput, actor: string): Promise<void> {
  await tx(pool, async c => {
    const e = await c.query('SELECT direction FROM crm.finance_entries WHERE id = $1', [input.entryId])
    if (!e.rowCount) throw new FinanceRuleError('NOT_FOUND', 404)
    if (e.rows[0].direction !== 'in') throw new FinanceRuleError('INVOICE_ONLY_FOR_RECEIVABLES', 400)
    await c.query(
      `INSERT INTO crm.finance_invoices (entry_id, status, number, issued_on, external_ref, notes, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (entry_id) DO UPDATE SET status = EXCLUDED.status, number = EXCLUDED.number, issued_on = EXCLUDED.issued_on,
         external_ref = EXCLUDED.external_ref, notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [input.entryId, input.status, input.number, input.issuedOn, input.externalRef, input.notes, actor])
    await audit(c, 'invoice', input.entryId, 'set_' + input.status, actor, { number: input.number, issuedOn: input.issuedOn })
  })
}

// ───────────────────────── leitura: visão geral, listas e relatórios ─────────────────────────

export type MonthTotals = { month: string; competenceIn: number; competenceOut: number; cashIn: number; cashOut: number }
export type EntryView = {
  id: string; direction: Direction; sourceId: string | null; clientId: string | null; clientName: string | null; company: string | null
  category: string; categoryLabel: string; description: string; periodicity: Periodicity | null; competenceMonth: string; dueDate: string
  amountCents: number; settledCents: number; remainingCents: number; lastSettledOn: string | null; state: EntryState; stateLabel: string
  overdue: boolean; clientAdBudget: boolean; cancelReason: string | null
  invoice: { status: InvoiceStatus; label: string; number: string | null; issuedOn: string | null; externalRef: string | null; notes: string; recorded: boolean } | null
  settlements: { id: string; amountCents: number; settledOn: string; method: string; notes: string; createdAt: string | null; reversedAt: string | null; reversalReason: string | null }[]
}

const FILTER_SQL = `($1::uuid IS NULL OR e.client_id = $1) AND ($2::text IS NULL OR e.category = $2) AND ($3::uuid IS NULL OR e.source_id = $3)`
const filterParams = (f: Filters) => [f.clientId, f.category, f.sourceId]

/** Totais mensais por COMPETÊNCIA e por CAIXA (verbas de anúncio de clientes ficam de fora: não passam pelo caixa). */
async function monthlyTotals(c: PoolClient, f: Filters, fromMonth: string, toMonth: string): Promise<Map<string, MonthTotals>> {
  const p = [...filterParams(f), firstDay(fromMonth), lastDay(toMonth)]
  const comp = await c.query(
    `SELECT e.direction, to_char(e.competence_month, 'YYYY-MM') AS month, sum(e.amount_cents) AS total
       FROM crm.finance_entries e
      WHERE ${FILTER_SQL} AND e.status = 'open' AND NOT e.client_ad_budget AND e.competence_month BETWEEN $4::date AND $5::date
      GROUP BY 1, 2`, p)
  const cash = await c.query(
    `SELECT e.direction, to_char(s.settled_on, 'YYYY-MM') AS month, sum(s.amount_cents) AS total
       FROM crm.finance_settlements s JOIN crm.finance_entries e ON e.id = s.entry_id
      WHERE ${FILTER_SQL} AND s.reversed_at IS NULL AND NOT e.client_ad_budget AND s.settled_on BETWEEN $4::date AND $5::date
      GROUP BY 1, 2`, p)
  const map = new Map<string, MonthTotals>()
  for (let m = fromMonth; monthDiff(m, toMonth) >= 0; m = addMonths(m, 1)) map.set(m, { month: m, competenceIn: 0, competenceOut: 0, cashIn: 0, cashOut: 0 })
  for (const r of comp.rows) { const t = map.get(r.month); if (t) t[r.direction === 'in' ? 'competenceIn' : 'competenceOut'] = num(r.total) }
  for (const r of cash.rows) { const t = map.get(r.month); if (t) t[r.direction === 'in' ? 'cashIn' : 'cashOut'] = num(r.total) }
  return map
}

async function categoryTotals(c: PoolClient, f: Filters, month: string) {
  const p = [...filterParams(f), firstDay(month), lastDay(month)]
  const comp = await c.query(
    `SELECT e.direction, e.category, sum(e.amount_cents) AS total FROM crm.finance_entries e
      WHERE ${FILTER_SQL} AND e.status = 'open' AND NOT e.client_ad_budget AND e.competence_month = $4::date GROUP BY 1, 2`, p.slice(0, 4))
  const cash = await c.query(
    `SELECT e.direction, e.category, sum(s.amount_cents) AS total FROM crm.finance_settlements s JOIN crm.finance_entries e ON e.id = s.entry_id
      WHERE ${FILTER_SQL} AND s.reversed_at IS NULL AND NOT e.client_ad_budget AND s.settled_on BETWEEN $4::date AND $5::date GROUP BY 1, 2`, p)
  const out: Record<Direction, { category: string; label: string; competenceCents: number; cashCents: number }[]> = { in: [], out: [] }
  const find = (d: Direction, cat: string) => {
    let row = out[d].find(x => x.category === cat)
    if (!row) { row = { category: cat, label: categoryLabel(cat), competenceCents: 0, cashCents: 0 }; out[d].push(row) }
    return row
  }
  for (const r of comp.rows) find(r.direction, r.category).competenceCents = num(r.total)
  for (const r of cash.rows) find(r.direction, r.category).cashCents = num(r.total)
  for (const d of ['in', 'out'] as Direction[]) out[d].sort((a, b) => b.competenceCents - a.competenceCents || b.cashCents - a.cashCents)
  return out
}

function invoiceView(direction: Direction, invoiceRequired: boolean, r: Record<string, unknown>): EntryView['invoice'] {
  if (direction !== 'in') return null
  const status = (r.inv_status as InvoiceStatus | null) ?? (invoiceRequired ? 'pending' : 'not_applicable')
  return { status, label: INVOICE_STATUS[status], number: (r.inv_number as string) ?? null, issuedOn: day(r.inv_issued_on), externalRef: (r.inv_external_ref as string) ?? null,
    notes: (r.inv_notes as string) ?? '', recorded: r.inv_status !== null && r.inv_status !== undefined }
}

async function loadEntries(c: PoolClient, f: Filters, today: string, where: string, extra: unknown[] = [], limit = 1500): Promise<EntryView[]> {
  const { rows } = await c.query(
    `SELECT e.id, e.direction, e.source_id, e.client_id, cl.name AS client_name, cl.company, e.category, e.description, so.periodicity,
            to_char(e.competence_month, 'YYYY-MM') AS competence_month, e.due_date::text AS due_date, e.amount_cents, e.status,
            e.cancel_reason, e.invoice_required, e.client_ad_budget, COALESCE(st.total, 0) AS settled, st.last_on::text AS last_on,
            i.status AS inv_status, i.number AS inv_number, i.issued_on::text AS inv_issued_on, i.external_ref AS inv_external_ref, i.notes AS inv_notes
       FROM crm.finance_entries e
       LEFT JOIN crm.finance_clients cl ON cl.id = e.client_id
       LEFT JOIN crm.finance_sources so ON so.id = e.source_id
       LEFT JOIN LATERAL (SELECT sum(s.amount_cents) AS total, max(s.settled_on) AS last_on FROM crm.finance_settlements s
                           WHERE s.entry_id = e.id AND s.reversed_at IS NULL) st ON true
       LEFT JOIN crm.finance_invoices i ON i.entry_id = e.id
      WHERE ${FILTER_SQL} AND (${where})
      ORDER BY e.due_date, e.created_at LIMIT ${limit}`, [...filterParams(f), ...extra])
  const ids = rows.map(r => r.id)
  const settlements = ids.length ? (await c.query(
    `SELECT id, entry_id, amount_cents, settled_on::text AS settled_on, method, notes, created_at, reversed_at, reversal_reason
       FROM crm.finance_settlements WHERE entry_id = ANY($1::uuid[]) ORDER BY settled_on, created_at`, [ids])).rows : []
  return rows.map(r => {
    const amountCents = num(r.amount_cents)
    const settledCents = num(r.settled)
    const state = entryState({ status: r.status, amountCents, settledCents, dueDate: r.due_date, competenceMonth: r.competence_month }, today)
    return {
      id: r.id, direction: r.direction, sourceId: r.source_id, clientId: r.client_id, clientName: r.client_name, company: r.company,
      category: r.category, categoryLabel: categoryLabel(r.category), description: r.description, periodicity: r.periodicity ?? null,
      competenceMonth: r.competence_month, dueDate: r.due_date, amountCents, settledCents,
      remainingCents: r.status === 'cancelled' ? 0 : Math.max(0, amountCents - settledCents), lastSettledOn: r.last_on ?? null,
      state, stateLabel: STATE_LABEL[r.direction as Direction][state],
      overdue: r.status === 'open' && settledCents < amountCents && r.due_date < today,
      clientAdBudget: r.client_ad_budget, cancelReason: r.cancel_reason ?? null,
      invoice: invoiceView(r.direction, r.invoice_required, r),
      settlements: settlements.filter(s => s.entry_id === r.id).map(s => ({
        id: s.id, amountCents: num(s.amount_cents), settledOn: s.settled_on, method: s.method, notes: s.notes,
        createdAt: iso(s.created_at), reversedAt: iso(s.reversed_at), reversalReason: s.reversal_reason ?? null,
      })),
    }
  })
}

export type Comparison = { label: string; currentLabel: string; previousLabel: string
  rows: { key: string; label: string; current: number; previous: number }[] }

/**
 * Tudo que o painel precisa para um mês (com filtros). Gera antes as previsões recorrentes pendentes (idempotente)
 * e lê o resto. Sem dados → zeros (o painel mostra R$ 0,00 e o estado vazio); nada é inventado.
 */
export async function loadFinanceOverview(pool: FinancePool, f: Filters, today: string) {
  return tx(pool, async c => {
    const generated = await syncRecurring(c, today, f.month)
    const M = f.month
    const Y = Number(M.slice(0, 4))
    const range = await monthlyTotals(c, f, (Y - 1) + '-01', Y + '-12')
    const last12From = addMonths(M, -11)
    const extraRange = monthDiff(last12From, (Y - 1) + '-01') > 0 ? await monthlyTotals(c, f, last12From, addMonths((Y - 1) + '-01', -1)) : new Map()
    const t = (m: string): MonthTotals => range.get(m) ?? extraRange.get(m) ?? { month: m, competenceIn: 0, competenceOut: 0, cashIn: 0, cashOut: 0 }
    const cur = t(M)
    const p = filterParams(f)

    const monthBalances = await c.query(
      `SELECT e.direction, sum(GREATEST(e.amount_cents - COALESCE(st.total, 0), 0)) AS remaining,
              sum(COALESCE(st.total, 0)) AS settled
         FROM crm.finance_entries e
         LEFT JOIN LATERAL (SELECT sum(amount_cents) AS total FROM crm.finance_settlements s WHERE s.entry_id = e.id AND s.reversed_at IS NULL) st ON true
        WHERE ${FILTER_SQL} AND e.status = 'open' AND NOT e.client_ad_budget AND e.competence_month = $4::date GROUP BY 1`, [...p, firstDay(M)])
    const overdue = await c.query(
      `SELECT e.direction, count(*) AS n, sum(e.amount_cents - COALESCE(st.total, 0)) AS remaining
         FROM crm.finance_entries e
         LEFT JOIN LATERAL (SELECT sum(amount_cents) AS total FROM crm.finance_settlements s WHERE s.entry_id = e.id AND s.reversed_at IS NULL) st ON true
        WHERE ${FILTER_SQL} AND e.status = 'open' AND NOT e.client_ad_budget AND e.due_date < $4::date AND COALESCE(st.total, 0) < e.amount_cents
        GROUP BY 1`, [...p, today])
    const openAll = await c.query(
      `SELECT e.direction, sum(e.amount_cents - COALESCE(st.total, 0)) AS remaining
         FROM crm.finance_entries e
         LEFT JOIN LATERAL (SELECT sum(amount_cents) AS total FROM crm.finance_settlements s WHERE s.entry_id = e.id AND s.reversed_at IS NULL) st ON true
        WHERE ${FILTER_SQL} AND e.status = 'open' AND NOT e.client_ad_budget AND e.competence_month <= $4::date AND COALESCE(st.total, 0) < e.amount_cents
        GROUP BY 1`, [...p, firstDay(M)])
    const adBudget = await c.query(
      `SELECT COALESCE(sum(e.amount_cents), 0) AS total FROM crm.finance_entries e
        WHERE ${FILTER_SQL} AND e.status = 'open' AND e.client_ad_budget AND e.competence_month = $4::date`, [...p, firstDay(M)])
    const pick = (res: { rows: Record<string, unknown>[] }, d: Direction, k: string) => num(res.rows.find(r => r.direction === d)?.[k])

    const clients = (await c.query(
      `SELECT cl.id, cl.name, cl.company, cl.notes, cl.archived_at, cl.created_at,
              (SELECT count(*) FROM crm.finance_sources s WHERE s.client_id = cl.id AND s.direction = 'in') AS contracts,
              (SELECT count(*) FROM crm.finance_sources s WHERE s.client_id = cl.id AND s.direction = 'in' AND s.status = 'active') AS active_contracts
         FROM crm.finance_clients cl ORDER BY cl.archived_at NULLS FIRST, lower(cl.name) LIMIT 2000`)).rows.map(r => ({
      id: r.id, name: r.name, company: r.company, notes: r.notes, archived: !!r.archived_at, createdAt: iso(r.created_at),
      contracts: num(r.contracts), activeContracts: num(r.active_contracts),
    }))
    const sources = (await c.query(
      `SELECT s.id, s.direction, s.client_id, cl.name AS client_name, s.category, s.description, s.supplier, s.amount_cents, s.periodicity,
              s.cost_kind, s.start_date::text AS start_date, s.end_date::text AS end_date, s.due_day, to_char(s.generate_from, 'YYYY-MM') AS generate_from,
              s.status, s.invoice_required, s.client_ad_budget, s.notes, s.updated_at
         FROM crm.finance_sources s LEFT JOIN crm.finance_clients cl ON cl.id = s.client_id
        ORDER BY s.direction, CASE s.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END, lower(s.description) LIMIT 3000`)).rows.map(r => ({
      id: r.id, direction: r.direction as Direction, clientId: r.client_id, clientName: r.client_name, category: r.category, categoryLabel: categoryLabel(r.category),
      description: r.description, supplier: r.supplier, amountCents: num(r.amount_cents), periodicity: r.periodicity as Periodicity, costKind: r.cost_kind,
      startDate: r.start_date, endDate: r.end_date, dueDay: r.due_day, generateFrom: r.generate_from, status: r.status as SourceStatus,
      invoiceRequired: r.invoice_required, clientAdBudget: r.client_ad_budget, notes: r.notes, updatedAt: iso(r.updated_at),
      monthlyEquivalentCents: monthlyEquivalentCents(num(r.amount_cents), r.periodicity),
    }))
    const recurring = sources.filter(s => s.direction === 'in' && s.status === 'active' && s.periodicity !== 'one_time'
      && (!f.clientId || s.clientId === f.clientId) && (!f.category || s.category === f.category) && (!f.sourceId || s.id === f.sourceId))

    // Lançamentos relevantes para o mês: competência do mês, tudo com saldo em aberto até o horizonte, movimentos de
    // caixa no mês e recebidos com nota pendente.
    const entries = await loadEntries(c, f, today, `e.competence_month = $4::date
        OR (e.status = 'open' AND e.competence_month <= $5::date AND COALESCE(st.total, 0) < e.amount_cents)
        OR EXISTS (SELECT 1 FROM crm.finance_settlements s2 WHERE s2.entry_id = e.id AND s2.settled_on BETWEEN $4::date AND $6::date)
        OR (e.direction = 'in' AND e.status = 'open' AND COALESCE(st.total, 0) > 0 AND COALESCE(i.status, CASE WHEN e.invoice_required THEN 'pending' ELSE 'not_applicable' END) = 'pending')`,
    [firstDay(M), firstDay(addMonths(M, FORECAST_MONTHS_AHEAD)), lastDay(M)])

    const auditRows = (await c.query(
      `SELECT entity, entity_id, action, actor, details, created_at FROM crm.finance_audit_log ORDER BY id DESC LIMIT 60`)).rows.map(r => ({
      entity: r.entity, entityId: r.entity_id, action: r.action, actorRef: String(r.actor).slice(0, 12), details: r.details, createdAt: iso(r.created_at),
    }))

    const months = (from: string, n: number) => Array.from({ length: n }, (_, i) => t(addMonths(from, i)))
    const sumRange = (list: MonthTotals[]) => list.reduce((a, x) => ({
      competenceIn: a.competenceIn + x.competenceIn, competenceOut: a.competenceOut + x.competenceOut, cashIn: a.cashIn + x.cashIn, cashOut: a.cashOut + x.cashOut,
    }), { competenceIn: 0, competenceOut: 0, cashIn: 0, cashOut: 0 })
    const mi = Number(M.slice(5, 7))
    const ytd = sumRange(months(Y + '-01', mi))
    const ytdPrev = sumRange(months((Y - 1) + '-01', mi))
    const prev = t(addMonths(M, -1))
    const yearPrevMonth = t(addMonths(M, -12))
    const cmp = (a: Omit<MonthTotals, 'month'>, b: Omit<MonthTotals, 'month'>) => [
      { key: 'cash_in', label: 'Receita recebida (caixa)', current: a.cashIn, previous: b.cashIn },
      { key: 'cash_out', label: 'Despesas pagas (caixa)', current: a.cashOut, previous: b.cashOut },
      { key: 'cash_result', label: 'Resultado de caixa', current: a.cashIn - a.cashOut, previous: b.cashIn - b.cashOut },
      { key: 'comp_in', label: 'Receita prevista (competência)', current: a.competenceIn, previous: b.competenceIn },
      { key: 'comp_out', label: 'Despesas previstas (competência)', current: a.competenceOut, previous: b.competenceOut },
      { key: 'comp_result', label: 'Resultado por competência', current: a.competenceIn - a.competenceOut, previous: b.competenceIn - b.competenceOut },
    ]

    return {
      generated,
      month: M, today,
      kpis: {
        revenueForecastCents: cur.competenceIn,
        revenueReceivedCashCents: cur.cashIn,
        revenueReceivedOfCompetenceCents: pick(monthBalances, 'in', 'settled'),
        expensesForecastCents: cur.competenceOut,
        expensesPaidCashCents: cur.cashOut,
        resultCashCents: cur.cashIn - cur.cashOut,
        resultCompetenceCents: cur.competenceIn - cur.competenceOut,
        receivableMonthCents: pick(monthBalances, 'in', 'remaining'),
        payableMonthCents: pick(monthBalances, 'out', 'remaining'),
        receivableOpenTotalCents: pick(openAll, 'in', 'remaining'),
        payableOpenTotalCents: pick(openAll, 'out', 'remaining'),
        overdueReceivableCents: pick(overdue, 'in', 'remaining'), overdueReceivableCount: pick(overdue, 'in', 'n'),
        overduePayableCents: pick(overdue, 'out', 'remaining'), overduePayableCount: pick(overdue, 'out', 'n'),
        activeRecurringContracts: recurring.length,
        recurringMonthlyCents: recurring.reduce((a, s) => a + s.monthlyEquivalentCents, 0),
        clientAdBudgetCents: num(adBudget.rows[0].total),
      },
      charts: {
        year: Y,
        yearMonths: months(Y + '-01', 12),
        previousYearMonths: months((Y - 1) + '-01', 12),
        last12: months(last12From, 12),
        categories: await categoryTotals(c, f, M),
      },
      reports: {
        monthVsPrevious: { label: 'Mês × mês anterior', currentLabel: M, previousLabel: addMonths(M, -1), rows: cmp(cur, prev) },
        monthVsSameMonthLastYear: { label: 'Mês × mesmo mês do ano anterior', currentLabel: M, previousLabel: addMonths(M, -12), rows: cmp(cur, yearPrevMonth) },
        ytdVsPreviousYtd: { label: 'Acumulado do ano × mesmo período do ano anterior', currentLabel: Y + '-01→' + M, previousLabel: (Y - 1) + '-01→' + addMonths(M, -12), rows: cmp(ytd, ytdPrev) },
        yearVsPreviousYear: { label: 'Ano × ano anterior (anos completos)', currentLabel: String(Y), previousLabel: String(Y - 1),
          rows: cmp(sumRange(months(Y + '-01', 12)), sumRange(months((Y - 1) + '-01', 12))) },
      } satisfies Record<string, Comparison>,
      clients, sources, entries, audit: auditRows,
    }
  })
}

// ───────────────────────── exportação CSV ─────────────────────────

/** CSV (separador ";", padrão de planilhas brasileiras) de um ano — lançamentos por competência ou movimentos de caixa. */
export async function exportFinanceCsv(pool: FinancePool, year: number, kind: 'entries' | 'movements', today: string): Promise<string> {
  return tx(pool, async c => {
    const f: Filters = { month: year + '-01', clientId: null, category: null, sourceId: null }
    if (kind === 'entries') {
      const list = await loadEntries(c, f, today, `e.competence_month BETWEEN $4::date AND $5::date`, [year + '-01-01', year + '-12-31'], 20000)
      const head = ['Tipo', 'Competência', 'Vencimento', 'Cliente', 'Empresa', 'Categoria', 'Descrição', 'Valor (R$)', 'Recebido/Pago (R$)', 'Saldo (R$)', 'Situação', 'Nota fiscal', 'Número NF', 'Verba de cliente (fora do caixa)']
      const lines = list.map(e => [e.direction === 'in' ? 'Receita' : 'Despesa', e.competenceMonth, e.dueDate, e.clientName ?? '', e.company ?? '', e.categoryLabel,
        e.description, csvMoney(e.amountCents), csvMoney(e.settledCents), csvMoney(e.remainingCents), e.stateLabel, e.invoice?.label ?? '', e.invoice?.number ?? '',
        e.clientAdBudget ? 'Sim' : 'Não'].map(csvCell).join(';'))
      return '﻿' + [head.map(csvCell).join(';'), ...lines].join('\r\n') + '\r\n'
    }
    const { rows } = await c.query(
      `SELECT s.settled_on::text AS settled_on, e.direction, to_char(e.competence_month, 'YYYY-MM') AS competence, cl.name AS client_name,
              e.category, e.description, s.amount_cents, s.method, s.notes, s.reversed_at IS NOT NULL AS reversed, s.reversal_reason, e.client_ad_budget
         FROM crm.finance_settlements s JOIN crm.finance_entries e ON e.id = s.entry_id LEFT JOIN crm.finance_clients cl ON cl.id = e.client_id
        WHERE s.settled_on BETWEEN $1::date AND $2::date ORDER BY s.settled_on, s.created_at LIMIT 50000`, [year + '-01-01', year + '-12-31'])
    const head = ['Data do movimento (caixa)', 'Tipo', 'Competência', 'Cliente', 'Categoria', 'Descrição', 'Valor (R$)', 'Forma', 'Observações', 'Estornado', 'Motivo do estorno', 'Verba de cliente (fora do caixa)']
    const lines = rows.map(r => [r.settled_on, r.direction === 'in' ? 'Recebimento' : 'Pagamento', r.competence, r.client_name ?? '', categoryLabel(r.category),
      r.description, csvMoney(num(r.amount_cents)), r.method, r.notes, r.reversed ? 'Sim' : 'Não', r.reversal_reason ?? '', r.client_ad_budget ? 'Sim' : 'Não'].map(csvCell).join(';'))
    return '﻿' + [head.map(csvCell).join(';'), ...lines].join('\r\n') + '\r\n'
  }, true)
}

