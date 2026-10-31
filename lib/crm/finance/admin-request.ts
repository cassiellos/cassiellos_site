import type { HandlerResponse } from '../booking-intake-request'
import { isCategoryOf, isValidDate, isValidMonth, parseMoneyToCents, todayInBrazil } from './model'
import {
  FinanceMigrationPendingError, FinanceRuleError, cancelEntry, createClient, createSource, exportFinanceCsv, loadFinanceOverview,
  recordSettlement, reverseSettlement, setClientArchived, setInvoice, setSourceAdminStatus, setSourceStatus, updateClient, updateEntry, updateSource,
  type FinancePool,
} from './store'
import {
  isUuid, parseFilters, text, validateAdminStatus, validateClient, validateInvoice, validateSettlement, validateSource, validateSourceStatus,
} from './validation'

/**
 * API do FINANCEIRO (sem dependências de framework, testável). Mesmas regras das demais rotas administrativas do CRM:
 * somente Preview; sessão administrativa válida; alterações exigem origem do próprio CRM + JSON (CSRF) e corpo
 * pequeno. Não há rota pública: visitante sem sessão recebe 401 e nenhum dado. Valores e nomes financeiros nunca vão
 * para os logs — só o tipo do evento e identificadores.
 */

export type FinanceAdminRequest = {
  method: 'GET' | 'POST'
  vercelEnv: string | undefined
  sessionValid: boolean
  originAllowed: boolean
  contentType: string | null
  rawBody?: string
  searchParams?: URLSearchParams
  actorRef: string
}
export type FinanceAdminDeps = {
  pool: FinancePool
  now?: () => Date
  log?: (event: string, details: Record<string, unknown>) => void
}

const bad = (error: string, status = 400, extra: Record<string, unknown> = {}): HandlerResponse => ({ status, body: { error, ...extra } })
export const MAX_FINANCE_BODY = 8_000

function guard(req: FinanceAdminRequest): HandlerResponse | null {
  if (req.vercelEnv !== 'preview') return bad('NOT_FOUND', 404)
  if (!req.sessionValid) return bad('UNAUTHORIZED', 401)
  return null
}

export async function handleFinanceAdmin(deps: FinanceAdminDeps, req: FinanceAdminRequest): Promise<HandlerResponse> {
  const denied = guard(req)
  if (denied) return denied
  const today = todayInBrazil(deps.now?.() ?? new Date())
  const log = deps.log ?? ((event: string, details: Record<string, unknown>) => console.info(JSON.stringify({ scope: 'finance_admin', event, ...details })))

  if (req.method === 'GET') {
    try {
      const data = await loadFinanceOverview(deps.pool, parseFilters(req.searchParams ?? new URLSearchParams(), today), today)
      return { status: 200, body: { ok: true, migrationPending: false, ...data } }
    } catch (error) {
      if (error instanceof FinanceMigrationPendingError) return { status: 200, body: { ok: true, migrationPending: true, today } }
      log('read_failed', { code: (error as { code?: string }).code ?? 'UNKNOWN' })
      return bad('FINANCE_UNAVAILABLE', 503)
    }
  }

  if (!req.originAllowed) return bad('FORBIDDEN', 403)
  if (!req.contentType?.startsWith('application/json')) return bad('INVALID_REQUEST')
  let d: Record<string, unknown>
  try {
    const raw = req.rawBody ?? ''
    if (raw.length > MAX_FINANCE_BODY) return bad('INVALID_REQUEST', 413)
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return bad('INVALID_REQUEST')
    d = parsed as Record<string, unknown>
  } catch { return bad('INVALID_REQUEST') }
  const actor = req.actorRef

  try {
    switch (d.action) {
      case 'client_create': {
        const v = validateClient(d)
        if (!v.ok) return bad(v.error, 400, { field: v.field })
        const id = await createClient(deps.pool, v.value, actor)
        log('client_created', { id })
        return { status: 200, body: { ok: true, id } }
      }
      case 'client_update': {
        if (!isUuid(d.id)) return bad('INVALID_ID')
        const v = validateClient(d)
        if (!v.ok) return bad(v.error, 400, { field: v.field })
        await updateClient(deps.pool, d.id, v.value, actor)
        log('client_updated', { id: d.id })
        return { status: 200, body: { ok: true } }
      }
      case 'client_archive': {
        if (!isUuid(d.id) || typeof d.archived !== 'boolean') return bad('INVALID_REQUEST')
        await setClientArchived(deps.pool, d.id, d.archived, actor)
        log('client_archived', { id: d.id, archived: d.archived })
        return { status: 200, body: { ok: true } }
      }
      case 'source_create': {
        const v = validateSource(d, today)
        if (!v.ok) return bad(v.error, 400, { field: v.field })
        const r = await createSource(deps.pool, v.value, actor, today)
        log('source_created', { id: r.id, direction: v.value.direction, generated: r.generated })
        return { status: 200, body: { ok: true, ...r } }
      }
      case 'source_update': {
        if (!isUuid(d.id) || (d.direction !== 'in' && d.direction !== 'out')) return bad('INVALID_REQUEST')
        // Reaproveita a validação do cadastro só para os campos editáveis (cliente, periodicidade e início não mudam
        // depois do cadastro: os valores fixos abaixo apenas satisfazem o validador; o store usa os gravados).
        const v = validateSource({ ...d, clientId: d.direction === 'in' ? '00000000-0000-4000-8000-000000000000' : null, clientAdBudget: false,
          periodicity: 'monthly', startDate: '2000-01-01', generateFrom: '2000-01' }, today)
        if (!v.ok) return bad(v.error, 400, { field: v.field })
        if (!isCategoryOf(d.direction, d.category)) return bad('INVALID_CATEGORY', 400, { field: 'category' })
        if (d.startDate !== undefined && d.startDate !== null && d.startDate !== '' && !isValidDate(d.startDate)) return bad('INVALID_START_DATE', 400, { field: 'startDate' })
        const r = await updateSource(deps.pool, d.id, {
          startDate: d.direction === 'in' && isValidDate(d.startDate) ? d.startDate : null,
          description: v.value.description, category: v.value.category, supplier: v.value.supplier, amountCents: v.value.amountCents,
          dueDay: v.value.dueDay, endDate: v.value.endDate, costKind: v.value.costKind, invoiceRequired: v.value.invoiceRequired,
          notes: v.value.notes, applyToOpenFuture: d.applyToOpenFuture === true,
        }, actor, today)
        log('source_updated', { id: d.id, adjusted: r.adjusted })
        return { status: 200, body: { ok: true, ...r } }
      }
      case 'source_admin_status': {
        // Somente situação do serviço e da formalização: não mexe em valores nem em lançamentos.
        if (!isUuid(d.id)) return bad('INVALID_REQUEST')
        const v = validateAdminStatus(d)
        if (!v.ok) return bad(v.error, 400, { field: v.field })
        const r = await setSourceAdminStatus(deps.pool, d.id, v.value, actor)
        log('source_admin_status', { id: d.id, changed: r.changed })
        return { status: 200, body: { ok: true, ...r } }
      }
      case 'source_status': {
        const status = validateSourceStatus(d.status)
        if (!isUuid(d.id) || !status) return bad('INVALID_REQUEST')
        if (d.endDate !== undefined && d.endDate !== null && d.endDate !== '' && !isValidDate(d.endDate)) return bad('INVALID_END_DATE', 400, { field: 'endDate' })
        const r = await setSourceStatus(deps.pool, d.id, status, actor, today, (d.endDate as string) || null)
        log('source_status', { id: d.id, status, ...r })
        return { status: 200, body: { ok: true, ...r } }
      }
      case 'settle': {
        const v = validateSettlement(d, today)
        if (!v.ok) return bad(v.error, 400, { field: v.field })
        const r = await recordSettlement(deps.pool, v.value, actor)
        log(r.duplicate ? 'settlement_duplicate_ignored' : 'settlement_recorded', { id: r.id, entryId: v.value.entryId })
        return { status: 200, body: { ok: true, ...r } }
      }
      case 'settlement_reverse': {
        const reason = text(d.reason, 300)
        if (!isUuid(d.id)) return bad('INVALID_REQUEST')
        if (!reason || reason.length < 3) return bad('REASON_REQUIRED', 400, { field: 'reason' })
        await reverseSettlement(deps.pool, d.id, reason, actor)
        log('settlement_reversed', { id: d.id })
        return { status: 200, body: { ok: true } }
      }
      case 'entry_cancel': {
        const reason = text(d.reason, 300)
        if (!isUuid(d.id)) return bad('INVALID_REQUEST')
        if (!reason || reason.length < 3) return bad('REASON_REQUIRED', 400, { field: 'reason' })
        await cancelEntry(deps.pool, d.id, reason, actor)
        log('entry_cancelled', { id: d.id })
        return { status: 200, body: { ok: true } }
      }
      case 'entry_update': {
        if (!isUuid(d.id)) return bad('INVALID_REQUEST')
        const amountCents = parseMoneyToCents(d.amount)
        if (amountCents === null) return bad('INVALID_AMOUNT', 400, { field: 'amount' })
        if (!isValidDate(d.dueDate)) return bad('INVALID_DUE_DATE', 400, { field: 'dueDate' })
        await updateEntry(deps.pool, d.id, amountCents, d.dueDate, actor)
        log('entry_adjusted', { id: d.id })
        return { status: 200, body: { ok: true } }
      }
      case 'invoice_set': {
        const v = validateInvoice(d, today)
        if (!v.ok) return bad(v.error, 400, { field: v.field })
        await setInvoice(deps.pool, v.value, actor)
        log('invoice_set', { entryId: v.value.entryId, status: v.value.status })
        return { status: 200, body: { ok: true } }
      }
      default:
        return bad('UNKNOWN_ACTION')
    }
  } catch (error) {
    if (error instanceof FinanceMigrationPendingError) return bad('MIGRATION_PENDING', 409)
    if (error instanceof FinanceRuleError) return bad(error.code, error.status)
    const code = (error as { code?: string }).code
    // Violação de constraint (dado fora das regras): resposta genérica, sem detalhes do banco.
    if (code && /^23/.test(code)) return bad('INVALID_DATA', 400)
    if (code === '22P02' || code === '22007' || code === '22008') return bad('INVALID_DATA', 400)
    log('write_failed', { action: String(d.action).slice(0, 40), code: code ?? 'UNKNOWN' })
    return bad('FINANCE_UNAVAILABLE', 503)
  }
}

/** Exportação CSV — também só Preview + sessão administrativa. GET sem efeito colateral. */
export async function handleFinanceExport(deps: FinanceAdminDeps, req: FinanceAdminRequest): Promise<
  { status: number; body: Record<string, unknown> } | { status: 200; csv: string; filename: string }> {
  const denied = guard(req)
  if (denied) return denied
  if (req.method !== 'GET') return bad('METHOD_NOT_ALLOWED', 405)
  const today = todayInBrazil(deps.now?.() ?? new Date())
  const params = req.searchParams ?? new URLSearchParams()
  const yearRaw = params.get('year') ?? today.slice(0, 4)
  if (!/^\d{4}$/.test(yearRaw) || !isValidMonth(yearRaw + '-01')) return bad('INVALID_YEAR')
  const kind = params.get('kind') === 'movements' ? 'movements' : 'entries'
  try {
    const csv = await exportFinanceCsv(deps.pool, Number(yearRaw), kind, today)
    ;(deps.log ?? ((event: string, details: Record<string, unknown>) => console.info(JSON.stringify({ scope: 'finance_admin', event, ...details }))))(
      'csv_exported', { kind, year: Number(yearRaw), actorRef: req.actorRef })
    return { status: 200, csv, filename: `financeiro-${kind === 'entries' ? 'lancamentos' : 'movimentos'}-${yearRaw}.csv` }
  } catch (error) {
    if (error instanceof FinanceMigrationPendingError) return bad('MIGRATION_PENDING', 409)
    return bad('FINANCE_UNAVAILABLE', 503)
  }
}
