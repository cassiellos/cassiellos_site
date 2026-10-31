import {
  INVOICE_STATUS, PERIODICITIES, SOURCE_STATUS, isCategoryOf, isFormalizationStatus, isServiceStatus, type FormalizationStatus, type ServiceStatus, isValidDate, isValidMonth, monthDiff, monthOf, parseMoneyToCents,
  type Direction, type InvoiceStatus, type Periodicity, type SourceStatus,
} from './model'

/** Validação no SERVIDOR de tudo o que chega do painel (o navegador aplica as mesmas regras só para conforto). */

export type Valid<T> = { ok: true; value: T } | { ok: false; error: string; field?: string }
const fail = (error: string, field?: string): { ok: false; error: string; field?: string } => ({ ok: false, error, field })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v)

/** Texto limpo: sem caracteres de controle, espaços normalizados, dentro do limite. null quando vazio. */
export function text(value: unknown, max: number): string | null | undefined {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return undefined
  const s = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/[ \t]+/g, ' ').trim()
  if (!s) return null
  return s.length > max ? undefined : s
}

export type ClientInput = { name: string; company: string | null; notes: string }
export function validateClient(d: Record<string, unknown>): Valid<ClientInput> {
  const name = text(d.name, 160)
  if (!name || name.length < 2) return fail('INVALID_NAME', 'name')
  const company = text(d.company, 160)
  if (company === undefined) return fail('INVALID_COMPANY', 'company')
  const notes = text(d.notes, 2000)
  if (notes === undefined) return fail('INVALID_NOTES', 'notes')
  return { ok: true, value: { name, company, notes: notes ?? '' } }
}

export type SourceInput = {
  direction: Direction
  clientId: string | null
  category: string
  description: string
  supplier: string | null
  amountCents: number
  periodicity: Periodicity
  costKind: 'fixed' | 'variable' | null
  startDate: string
  endDate: string | null
  dueDay: number
  generateFrom: string
  invoiceRequired: boolean
  clientAdBudget: boolean
  notes: string
  /** 0012 — somente contratos (direction 'in'); despesas ficam sempre "Não informado". */
  serviceStatus: ServiceStatus
  formalizationStatus: FormalizationStatus
}

export type AdminStatusInput = { serviceStatus: ServiceStatus; formalizationStatus: FormalizationStatus }
/** Ausente → "Não informado". Valor desconhecido → recusado (nunca vira "Assinado" por engano). */
export function validateAdminStatus(d: Record<string, unknown>): Valid<AdminStatusInput> {
  const service = d.serviceStatus === undefined || d.serviceStatus === null || d.serviceStatus === '' ? 'unknown' : d.serviceStatus
  const formal = d.formalizationStatus === undefined || d.formalizationStatus === null || d.formalizationStatus === '' ? 'unknown' : d.formalizationStatus
  if (!isServiceStatus(service)) return fail('INVALID_SERVICE_STATUS', 'serviceStatus')
  if (!isFormalizationStatus(formal)) return fail('INVALID_FORMALIZATION_STATUS', 'formalizationStatus')
  return { ok: true, value: { serviceStatus: service, formalizationStatus: formal } }
}

/**
 * Contrato (direction 'in') ou despesa (direction 'out'). `generateFrom` (AAAA-MM) define o primeiro mês de
 * competência a gerar: por padrão o mês atual, para não criar cobranças retroativas de contratos antigos sem o
 * administrador pedir.
 */
export function validateSource(d: Record<string, unknown>, today: string): Valid<SourceInput> {
  const direction = d.direction === 'in' || d.direction === 'out' ? d.direction : null
  if (!direction) return fail('INVALID_DIRECTION')
  const clientAdBudget = direction === 'out' && d.clientAdBudget === true
  let clientId: string | null = null
  if (direction === 'in' || clientAdBudget) {
    if (d.clientId !== undefined && d.clientId !== null && d.clientId !== '') {
      if (!isUuid(d.clientId)) return fail('INVALID_CLIENT', 'clientId')
      clientId = d.clientId
    }
    if (direction === 'in' && !clientId) return fail('CLIENT_REQUIRED', 'clientId')
  }
  if (!isCategoryOf(direction, d.category)) return fail('INVALID_CATEGORY', 'category')
  const description = text(d.description, 200)
  if (!description || description.length < 2) return fail('INVALID_DESCRIPTION', 'description')
  const supplier = direction === 'out' ? text(d.supplier, 160) : null
  if (supplier === undefined) return fail('INVALID_SUPPLIER', 'supplier')
  const amountCents = parseMoneyToCents(d.amount)
  if (amountCents === null) return fail('INVALID_AMOUNT', 'amount')
  if (typeof d.periodicity !== 'string' || !Object.prototype.hasOwnProperty.call(PERIODICITIES, d.periodicity)) return fail('INVALID_PERIODICITY', 'periodicity')
  const periodicity = d.periodicity as Periodicity
  const costKind = direction === 'out' ? (d.costKind === 'fixed' || d.costKind === 'variable' ? d.costKind : null) : null
  if (direction === 'out' && !costKind) return fail('INVALID_COST_KIND', 'costKind')
  if (!isValidDate(d.startDate)) return fail('INVALID_START_DATE', 'startDate')
  const startDate = d.startDate
  let endDate: string | null = null
  if (d.endDate !== undefined && d.endDate !== null && d.endDate !== '') {
    if (!isValidDate(d.endDate) || d.endDate < startDate) return fail('INVALID_END_DATE', 'endDate')
    endDate = d.endDate
  }
  const dueDay = typeof d.dueDay === 'number' ? d.dueDay : typeof d.dueDay === 'string' && /^\d{1,2}$/.test(d.dueDay) ? Number(d.dueDay) : NaN
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return fail('INVALID_DUE_DAY', 'dueDay')
  const startMonth = monthOf(startDate)
  let generateFrom: string
  if (periodicity === 'one_time') generateFrom = startMonth
  else if (d.generateFrom === undefined || d.generateFrom === null || d.generateFrom === '') {
    generateFrom = monthDiff(startMonth, monthOf(today)) > 0 ? monthOf(today) : startMonth
  } else {
    if (!isValidMonth(d.generateFrom) || monthDiff(startMonth, d.generateFrom) < 0) return fail('INVALID_GENERATE_FROM', 'generateFrom')
    generateFrom = d.generateFrom
  }
  if (endDate && monthDiff(generateFrom, monthOf(endDate)) < 0) return fail('INVALID_GENERATE_FROM', 'generateFrom')
  const notes = text(d.notes, 2000)
  if (notes === undefined) return fail('INVALID_NOTES', 'notes')
  const admin = direction === 'in' ? validateAdminStatus(d) : { ok: true as const, value: { serviceStatus: 'unknown' as const, formalizationStatus: 'unknown' as const } }
  if (!admin.ok) return admin
  return {
    ok: true,
    value: {
      ...admin.value,
      direction, clientId, category: d.category as string, description, supplier, amountCents, periodicity, costKind,
      startDate, endDate, dueDay, generateFrom: generateFrom + '-01', invoiceRequired: direction === 'in' && d.invoiceRequired === true,
      clientAdBudget, notes: notes ?? '',
    },
  }
}

export type SettlementInput = { entryId: string; amountCents: number; settledOn: string; method: string; notes: string; idempotencyKey: string }
/** Recebimento/pagamento REAL: valor e data efetivos; nunca no futuro; chave de idempotência obrigatória. */
export function validateSettlement(d: Record<string, unknown>, today: string): Valid<SettlementInput> {
  if (!isUuid(d.entryId)) return fail('INVALID_ENTRY')
  if (!isUuid(d.idempotencyKey)) return fail('INVALID_IDEMPOTENCY_KEY')
  const amountCents = parseMoneyToCents(d.amount)
  if (amountCents === null) return fail('INVALID_AMOUNT', 'amount')
  if (!isValidDate(d.settledOn) || d.settledOn > today) return fail('INVALID_SETTLED_ON', 'settledOn')
  const method = text(d.method, 60)
  const notes = text(d.notes, 500)
  if (method === undefined) return fail('INVALID_METHOD', 'method')
  if (notes === undefined) return fail('INVALID_NOTES', 'notes')
  return { ok: true, value: { entryId: d.entryId, amountCents, settledOn: d.settledOn, method: method ?? '', notes: notes ?? '', idempotencyKey: d.idempotencyKey.toLowerCase() } }
}

export type InvoiceInput = { entryId: string; status: InvoiceStatus; number: string | null; issuedOn: string | null; externalRef: string | null; notes: string }
/** Controle administrativo de NF: nenhuma emissão automática, nenhum cálculo de imposto. */
export function validateInvoice(d: Record<string, unknown>, today: string): Valid<InvoiceInput> {
  if (!isUuid(d.entryId)) return fail('INVALID_ENTRY')
  if (typeof d.status !== 'string' || !Object.prototype.hasOwnProperty.call(INVOICE_STATUS, d.status)) return fail('INVALID_INVOICE_STATUS', 'status')
  const status = d.status as InvoiceStatus
  const number = text(d.number, 60)
  const externalRef = text(d.externalRef, 200)
  const notes = text(d.notes, 1000)
  if (number === undefined) return fail('INVALID_INVOICE_NUMBER', 'number')
  if (externalRef === undefined) return fail('INVALID_EXTERNAL_REF', 'externalRef')
  if (notes === undefined) return fail('INVALID_NOTES', 'notes')
  let issuedOn: string | null = null
  if (d.issuedOn !== undefined && d.issuedOn !== null && d.issuedOn !== '') {
    if (!isValidDate(d.issuedOn) || d.issuedOn > today) return fail('INVALID_ISSUED_ON', 'issuedOn')
    issuedOn = d.issuedOn
  }
  if (status === 'issued' && (!number || !issuedOn)) return fail('INVOICE_NUMBER_AND_DATE_REQUIRED', !number ? 'number' : 'issuedOn')
  return { ok: true, value: { entryId: d.entryId, status, number, issuedOn, externalRef, notes: notes ?? '' } }
}

export function validateSourceStatus(value: unknown): SourceStatus | null {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SOURCE_STATUS, value) ? value as SourceStatus : null
}

export type Filters = { month: string; clientId: string | null; category: string | null; sourceId: string | null }
/** Filtros da Visão Geral/Relatórios. Mês inválido ou ausente → mês atual. */
export function parseFilters(params: URLSearchParams, today: string): Filters {
  const month = params.get('month')
  const client = params.get('client')
  const category = params.get('category')
  const source = params.get('source')
  return {
    month: isValidMonth(month) ? month : monthOf(today),
    clientId: isUuid(client) ? client : null,
    category: category && (isCategoryOf('in', category) || isCategoryOf('out', category)) ? category : null,
    sourceId: isUuid(source) ? source : null,
  }
}
