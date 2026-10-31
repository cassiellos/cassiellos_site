'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  EXPENSE_CATEGORIES, FORMALIZATION_STATUS, INVOICE_STATUS, PERIODICITIES, REVENUE_CATEGORIES, SERVICE_STATUS, SOURCE_STATUS, addMonths, centsToInput, formatCents,
  formatChange, formatDate, monthLabel, parseMoneyToCents, percentChange, shortMonth, todayInBrazil,
} from '@/lib/crm/finance/model'
import './finance-panel.css'

/**
 * FINANCEIRO do CRM | Cassiellos. Somente administradores, somente Preview. Todos os números vêm do Neon (API
 * /api/crm/finance); sem dados → R$ 0,00 e um aviso explicativo. Nada financeiro é guardado no navegador
 * (sem localStorage): o estado vive só na memória desta aba.
 */

type Dir = 'in' | 'out'
type MonthTotals = { month: string; competenceIn: number; competenceOut: number; cashIn: number; cashOut: number }
type Settlement = { id: string; amountCents: number; settledOn: string; method: string; notes: string; createdAt: string | null; reversedAt: string | null; reversalReason: string | null }
type Entry = {
  id: string; direction: Dir; sourceId: string | null; clientId: string | null; clientName: string | null; company: string | null; category: string
  categoryLabel: string; description: string; periodicity: string | null; competenceMonth: string; dueDate: string; amountCents: number; settledCents: number
  remainingCents: number; lastSettledOn: string | null; state: string; stateLabel: string; overdue: boolean; clientAdBudget: boolean; cancelReason: string | null
  invoice: { status: keyof typeof INVOICE_STATUS; label: string; number: string | null; issuedOn: string | null; externalRef: string | null; notes: string; recorded: boolean } | null
  settlements: Settlement[]
}
type Client = { id: string; name: string; company: string | null; notes: string; archived: boolean; contracts: number; activeContracts: number }
type Source = {
  id: string; direction: Dir; clientId: string | null; clientName: string | null; category: string; categoryLabel: string; description: string
  supplier: string | null; amountCents: number; periodicity: keyof typeof PERIODICITIES; costKind: 'fixed' | 'variable' | null; startDate: string
  endDate: string | null; dueDay: number; generateFrom: string; status: keyof typeof SOURCE_STATUS; invoiceRequired: boolean; clientAdBudget: boolean
  notes: string; monthlyEquivalentCents: number
  serviceStatus: keyof typeof SERVICE_STATUS; formalizationStatus: keyof typeof FORMALIZATION_STATUS; adminStatusUpdatedAt: string | null
}
type Comparison = { label: string; currentLabel: string; previousLabel: string; rows: { key: string; label: string; current: number; previous: number }[] }
type Overview = {
  ok: true; migrationPending: false; month: string; today: string
  kpis: Record<string, number>
  charts: { year: number; yearMonths: MonthTotals[]; previousYearMonths: MonthTotals[]; last12: MonthTotals[]
    categories: Record<Dir, { category: string; label: string; competenceCents: number; cashCents: number }[]> }
  reports: Record<'monthVsPrevious' | 'monthVsSameMonthLastYear' | 'ytdVsPreviousYtd' | 'yearVsPreviousYear', Comparison>
  adminStatusAvailable: boolean; clients: Client[]; sources: Source[]; entries: Entry[]
  audit: { entity: string; entityId: string; action: string; actorRef: string; createdAt: string | null }[]
}
type Tab = 'geral' | 'contratos' | 'receitas' | 'despesas' | 'receber' | 'pagar' | 'notas' | 'relatorios'
const TABS: { id: Tab; label: string }[] = [
  { id: 'geral', label: 'Visão Geral' }, { id: 'contratos', label: 'Clientes e Contratos' }, { id: 'receitas', label: 'Receitas' },
  { id: 'despesas', label: 'Despesas' }, { id: 'receber', label: 'Contas a Receber' }, { id: 'pagar', label: 'Contas a Pagar' },
  { id: 'notas', label: 'Notas Fiscais' }, { id: 'relatorios', label: 'Relatórios' },
]

const ERRORS: Record<string, string> = {
  UNAUTHORIZED: 'Sua sessão administrativa expirou. Entre novamente.', FORBIDDEN: 'Origem não autorizada.', NOT_FOUND: 'Registro não encontrado.',
  MIGRATION_PENDING: 'A migração 0011 (Financeiro) ainda não foi aplicada neste banco.', FINANCE_UNAVAILABLE: 'Financeiro indisponível no momento. Tente de novo.',
  DATABASE_NOT_CONFIGURED: 'Banco do CRM não configurado neste ambiente.', INVALID_DATA: 'Dados fora das regras do Financeiro.', INVALID_REQUEST: 'Requisição inválida.',
  INVALID_NAME: 'Informe o nome (mínimo 2 caracteres).', INVALID_COMPANY: 'Empresa muito longa.', INVALID_NOTES: 'Observações muito longas.',
  CLIENT_REQUIRED: 'Selecione o cliente.', INVALID_CLIENT: 'Cliente inválido.', CLIENT_NOT_FOUND: 'Cliente não encontrado.', CLIENT_ARCHIVED: 'Cliente arquivado: reative antes.',
  INVALID_CATEGORY: 'Selecione a categoria.', INVALID_DESCRIPTION: 'Informe a descrição (mínimo 2 caracteres).', INVALID_SUPPLIER: 'Fornecedor muito longo.',
  INVALID_AMOUNT: 'Valor inválido. Use o formato 1.234,56 (maior que zero).', INVALID_PERIODICITY: 'Selecione a periodicidade.', INVALID_COST_KIND: 'Indique se a despesa é fixa ou variável.',
  INVALID_START_DATE: 'Data de início inválida.', INVALID_END_DATE: 'Data de término inválida (não pode ser antes do início).', INVALID_DUE_DAY: 'Dia de vencimento entre 1 e 31.',
  INVALID_GENERATE_FROM: 'O mês inicial de cobrança deve estar entre o início e o término.', INVALID_SETTLED_ON: 'Data inválida (não pode ser futura).',
  INVALID_IDEMPOTENCY_KEY: 'Abra o formulário de novo.', AMOUNT_EXCEEDS_BALANCE: 'O valor é maior que o saldo em aberto.', ENTRY_ALREADY_SETTLED: 'Este lançamento já está quitado.',
  ENTRY_CANCELLED: 'Lançamento cancelado.', ENTRY_HAS_SETTLEMENTS: 'Há movimentos registrados: estorne-os antes.', IDEMPOTENCY_KEY_REUSED: 'Movimento já registrado com outros dados. Abra o formulário de novo.',
  REASON_REQUIRED: 'Informe o motivo (mínimo 3 caracteres).', SOURCE_ENDED: 'Contrato encerrado não pode ser reativado.', INVALID_DUE_DATE: 'Vencimento inválido.',
  INVALID_INVOICE_STATUS: 'Situação da nota inválida.', INVOICE_NUMBER_AND_DATE_REQUIRED: 'Nota emitida exige número e data de emissão.', INVALID_ISSUED_ON: 'Data de emissão inválida.',
  INVALID_SERVICE_STATUS: 'Situação do serviço inválida.', INVALID_FORMALIZATION_STATUS: 'Situação do contrato inválida.',
  ADMIN_STATUS_MIGRATION_PENDING: 'Situação do serviço e do contrato ainda indisponível: aguardando a migração 0012 no banco.',
  ADMIN_STATUS_ONLY_FOR_CONTRACTS: 'Situação do serviço/contrato só se aplica a receitas.',
  INVALID_INVOICE_NUMBER: 'Número muito longo.', INVALID_EXTERNAL_REF: 'Referência muito longa.', INVOICE_ONLY_FOR_RECEIVABLES: 'Nota fiscal só para receitas.',
}
const explain = (code: unknown) => (typeof code === 'string' && ERRORS[code]) || 'Não foi possível concluir. Tente de novo.'
const SERVICE_TONE: Record<string, string> = { unknown: 'muted', not_started: 'info', in_progress: 'ok', paused: 'warn', ended: 'muted' }
const FORMAL_TONE: Record<string, string> = { unknown: 'muted', not_sent: 'info', sent: 'info', awaiting_signature: 'sign', signed: 'ok', no_formal_contract: 'muted' }
const STATE_TONE: Record<string, string> = { settled: 'ok', partial: 'warn', overdue: 'bad', forecast: 'muted', open: 'info', cancelled: 'muted' }
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c => (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16)))

/** Valores curtos para eixos: R$ 1,2 mil / R$ 3,4 mi. */
function compact(cents: number): string {
  const v = cents / 100
  const a = Math.abs(v)
  if (a >= 1_000_000) return 'R$ ' + (v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mi'
  if (a >= 1_000) return 'R$ ' + (v / 1_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 }) + ' mil'
  return 'R$ ' + v.toLocaleString('pt-BR', { maximumFractionDigits: 0 })
}

// ───────────────────────── gráficos (SVG simples, responsivos) ─────────────────────────

type Series = { name: string; color: string; values: number[] }
function BarChart({ labels, series, title }: { labels: string[]; series: Series[]; title: string }) {
  const W = 720, H = 230, L = 64, B = 26, T = 12
  const all = series.flatMap(s => s.values)
  const empty = all.every(v => v === 0)
  const max = Math.max(0, ...all), min = Math.min(0, ...all)
  const span = max - min || 1
  const y = (v: number) => T + (H - T - B) * (1 - (v - min) / span)
  const group = (W - L - 8) / labels.length
  const bw = Math.max(3, Math.min(18, (group - 6) / series.length))
  const ticks = [max, (max + min) / 2, min].filter((v, i, a) => a.indexOf(v) === i)
  return <figure className="crm-fin-chart">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} preserveAspectRatio="xMidYMid meet">
      {ticks.map(t => <g key={t}><line x1={L} x2={W - 4} y1={y(t)} y2={y(t)} stroke="#334058" strokeOpacity=".5" strokeDasharray="4 6"/>
        <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#8195ac">{compact(t)}</text></g>)}
      <line x1={L} x2={W - 4} y1={y(0)} y2={y(0)} stroke="#4a5b75"/>
      {labels.map((label, i) => <g key={label + i}>
        {series.map((s, j) => {
          const v = s.values[i] ?? 0
          const x = L + i * group + (group - bw * series.length) / 2 + j * bw
          return <rect key={s.name} x={x} width={bw - 1} y={Math.min(y(v), y(0))} height={Math.max(v === 0 ? 0 : 1, Math.abs(y(v) - y(0)))}
            fill={s.color} rx="2"><title>{s.name + ' · ' + label + ': ' + formatCents(v)}</title></rect>
        })}
        <text x={L + i * group + group / 2} y={H - 8} textAnchor="middle" fontSize="11" fill="#8195ac">{label}</text>
      </g>)}
    </svg>
    <figcaption className="crm-fin-legend">{series.map(s => <span key={s.name}><i style={{ background: s.color }}/>{s.name}</span>)}
      {empty && <em>Sem movimentos no período — R$ 0,00.</em>}</figcaption>
  </figure>
}

function LineChart({ labels, series, title }: { labels: string[]; series: Series[]; title: string }) {
  const W = 720, H = 230, L = 64, B = 26, T = 12
  const all = series.flatMap(s => s.values)
  const max = Math.max(1, ...all)
  const x = (i: number) => L + ((W - L - 16) * i) / Math.max(1, labels.length - 1)
  const y = (v: number) => T + (H - T - B) * (1 - v / max)
  return <figure className="crm-fin-chart">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} preserveAspectRatio="xMidYMid meet">
      {[max, max / 2, 0].map(t => <g key={t}><line x1={L} x2={W - 4} y1={y(t)} y2={y(t)} stroke="#334058" strokeOpacity=".5" strokeDasharray="4 6"/>
        <text x={L - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#8195ac">{compact(all.every(v => v === 0) ? 0 : t)}</text></g>)}
      {series.map(s => <g key={s.name}>
        <path d={s.values.map((v, i) => (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1)).join(' ')} fill="none" stroke={s.color} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round"/>
        {s.values.map((v, i) => <circle key={i} cx={x(i)} cy={y(v)} r="3.5" fill={s.color}><title>{s.name + ' · ' + labels[i] + ': ' + formatCents(v)}</title></circle>)}
      </g>)}
      {labels.map((label, i) => <text key={label + i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="#8195ac">{label}</text>)}
    </svg>
    <figcaption className="crm-fin-legend">{series.map(s => <span key={s.name}><i style={{ background: s.color }}/>{s.name}</span>)}
      {all.every(v => v === 0) && <em>Sem dados no período — R$ 0,00.</em>}</figcaption>
  </figure>
}

function CategoryBars({ rows, empty }: { rows: { label: string; competenceCents: number; cashCents: number }[]; empty: string }) {
  const max = Math.max(1, ...rows.flatMap(r => [r.competenceCents, r.cashCents]))
  if (!rows.length) return <p className="crm-fin-empty">{empty}</p>
  return <div className="crm-fin-cats">{rows.map(r => <div key={r.label} className="crm-fin-cat">
    <div className="crm-fin-cat-head"><span>{r.label}</span><strong>{formatCents(r.competenceCents)}</strong></div>
    <div className="crm-fin-track" title={'Competência: ' + formatCents(r.competenceCents)}><i style={{ width: (100 * r.competenceCents / max) + '%' }}/></div>
    <div className="crm-fin-track crm-fin-track-cash" title={'Caixa: ' + formatCents(r.cashCents)}><i style={{ width: (100 * r.cashCents / max) + '%' }}/></div>
    <small>Caixa no mês: {formatCents(r.cashCents)}</small>
  </div>)}</div>
}

// ───────────────────────── peças de formulário ─────────────────────────

function Field({ label, hint, children, wide }: { label: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return <label className="crm-fin-field" data-wide={wide || undefined}><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>
}
function MoneyInput({ value, onChange, name, required = true }: { value: string; onChange: (v: string) => void; name: string; required?: boolean }) {
  const invalid = value !== '' && parseMoneyToCents(value) === null
  return <><input name={name} inputMode="decimal" autoComplete="off" placeholder="0,00" value={value} required={required} aria-invalid={invalid || undefined}
    onChange={e => onChange(e.target.value.replace(/[^\d.,R$\s]/g, ''))}/>{invalid && <em className="crm-fin-inline-error">Use o formato 1.234,56</em>}</>
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    const old = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus()
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', key)
    return () => { document.removeEventListener('keydown', key); document.body.style.overflow = old; prev?.focus?.() }
  }, [onClose])
  return <div className="crm-modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <div ref={ref} className="crm-modal crm-fin-modal" role="dialog" aria-modal="true" aria-label={title}>
      <div className="crm-fin-modal-head"><h2>{title}</h2><button type="button" className="crm-icon-btn" aria-label="Fechar" onClick={onClose}>✕</button></div>
      {children}
    </div>
  </div>
}

// ───────────────────────── painel ─────────────────────────

type Dialog =
  | { kind: 'client'; client?: Client }
  | { kind: 'source'; direction: Dir; source?: Source; clientId?: string }
  | { kind: 'settle'; entry: Entry; key: string }
  | { kind: 'entry'; entry: Entry }
  | { kind: 'invoice'; entry: Entry }
  | { kind: 'history'; entry: Entry }
  | { kind: 'end'; source: Source }
  | null

export default function FinancePanel() {
  const [tab, setTab] = useState<Tab>('geral')
  const [month, setMonth] = useState(() => todayInBrazil().slice(0, 7))
  const [filters, setFilters] = useState({ client: '', category: '', source: '' })
  // Cada resposta fica ligada à consulta (filtros) que a produziu. Os números só aparecem quando essa chave é a dos
  // filtros atuais — nunca valores de um período sob o rótulo de outro.
  const [result, setResult] = useState<{ key: string; body: Overview } | null>(null)
  const [pending, setPending] = useState(false)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<{ key: string; text: string } | null>(null)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  const inflight = useRef<AbortController | null>(null)
  const queryKey = useMemo(() => {
    const q = new URLSearchParams({ month })
    if (filters.client) q.set('client', filters.client)
    if (filters.category) q.set('category', filters.category)
    if (filters.source) q.set('source', filters.source)
    return q.toString()
  }, [month, filters])

  const load = useCallback(() => {
    // Só a consulta mais recente vale: a anterior é abortada e, se ainda assim responder, é descartada.
    const id = ++seq.current
    inflight.current?.abort()
    const ctrl = new AbortController()
    inflight.current = ctrl
    const key = queryKey
    setLoading(true)
    setLoadError(null)
    fetch('/api/crm/finance?' + key, { cache: 'no-store', credentials: 'same-origin', signal: ctrl.signal })
      .then(r => r.json().then(body => ({ ok: r.ok, body })))
      .then(({ ok, body }) => {
        if (id !== seq.current) return
        if (!ok) { setResult(null); setLoadError({ key, text: explain(body?.error) }); return }
        if (body.migrationPending) { setPending(true); setResult(null); return }
        if (!body.kpis || typeof body.month !== 'string') { setResult(null); setLoadError({ key, text: explain(null) }); return }
        setPending(false); setResult({ key, body: body as Overview })
      })
      .catch(() => { if (id === seq.current && !ctrl.signal.aborted) { setResult(null); setLoadError({ key, text: 'Não foi possível consultar o Financeiro. Nenhum valor está sendo exibido até a consulta funcionar.' }) } })
      .finally(() => { if (id === seq.current) setLoading(false) })
  }, [queryKey])
  useEffect(() => { load(); return () => inflight.current?.abort() }, [load])

  // Dados válidos para os filtros atuais (ou nada). Durante a troca de filtros, nada antigo é mostrado.
  const data = result && result.key === queryKey ? result.body : null
  // Listas dos seletores (clientes/fontes) não são números: mantêm as opções enquanto carrega.
  const options = result?.body ?? null

  async function post(body: Record<string, unknown>, success: string): Promise<boolean> {
    setBusy(true); setMessage(null)
    try {
      const r = await fetch('/api/crm/finance', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const res = await r.json().catch(() => ({}))
      if (!r.ok) { setMessage({ kind: 'error', text: explain(res.error) }); return false }
      setMessage({ kind: 'ok', text: res.duplicate ? 'Movimento já estava registrado — nada foi duplicado.' : success })
      load()
      return true
    } catch { setMessage({ kind: 'error', text: 'Falha de conexão. Nada foi alterado se não houver confirmação.' }); return false }
    finally { setBusy(false) }
  }

  const today = data?.today ?? todayInBrazil()
  const k = data?.kpis ?? {}
  const v = (key: string) => k[key] ?? 0
  const activeClients = useMemo(() => (data?.clients ?? []).filter(c => !c.archived), [data])
  const entries = data?.entries ?? []
  const byDir = (d: Dir) => entries.filter(e => e.direction === d)

  if (pending) return <section className="crm-card crm-panel crm-fin">
    <div className="crm-info-box"><strong>Financeiro aguardando a migração 0011.</strong> O código já está publicado, mas as tabelas do Financeiro
      ainda não existem neste banco (Neon Preview). Nenhum dado foi criado nem alterado. Depois da aplicação autorizada da migração
      <code> db/migrations/0011_finance.sql</code>, esta tela passa a funcionar sem nova publicação.</div>
    <Kpis v={() => 0}/>
  </section>

  return <div className="crm-fin">
    <nav className="crm-fin-tabs" aria-label="Seções do Financeiro">
      {TABS.map(t => <button key={t.id} type="button" data-active={tab === t.id} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>{t.label}</button>)}
    </nav>

    <section className="crm-fin-filters" aria-label="Filtros">
      <Field label="Mês"><div className="crm-fin-month">
        <button type="button" className="crm-btn" aria-label="Mês anterior" onClick={() => setMonth(addMonths(month, -1))}>‹</button>
        <input type="month" value={month} min="2000-01" max="2100-12" onChange={e => e.target.value && setMonth(e.target.value)} aria-label="Mês de referência"/>
        <button type="button" className="crm-btn" aria-label="Próximo mês" onClick={() => setMonth(addMonths(month, 1))}>›</button>
      </div></Field>
      <Field label="Ano"><select value={month.slice(0, 4)} onChange={e => setMonth(e.target.value + '-' + month.slice(5, 7))}>
        {Array.from({ length: 9 }, (_, i) => String(Number(today.slice(0, 4)) - 6 + i)).map(y => <option key={y}>{y}</option>)}</select></Field>
      <Field label="Cliente"><select value={filters.client} onChange={e => setFilters({ ...filters, client: e.target.value })}>
        <option value="">Todos</option>{(options?.clients ?? []).map(c => <option key={c.id} value={c.id}>{c.name}{c.archived ? ' (arquivado)' : ''}</option>)}</select></Field>
      <Field label="Categoria"><select value={filters.category} onChange={e => setFilters({ ...filters, category: e.target.value })}>
        <option value="">Todas</option>
        <optgroup label="Receitas">{Object.entries(REVENUE_CATEGORIES).map(([id, l]) => <option key={id} value={id}>{l}</option>)}</optgroup>
        <optgroup label="Despesas">{Object.entries(EXPENSE_CATEGORIES).map(([id, l]) => <option key={id} value={id}>{l}</option>)}</optgroup></select></Field>
      <Field label="Fonte de receita / despesa"><select value={filters.source} onChange={e => setFilters({ ...filters, source: e.target.value })}>
        <option value="">Todas</option>{(options?.sources ?? []).map(s => <option key={s.id} value={s.id}>{(s.direction === 'in' ? 'Receita · ' : 'Despesa · ') + s.description}</option>)}</select></Field>
      {(filters.client || filters.category || filters.source) && <button type="button" className="crm-btn" onClick={() => setFilters({ client: '', category: '', source: '' })}>Limpar filtros</button>}
    </section>

    {message && <p className="crm-fin-message" data-kind={message.kind} role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p>}
    {!data && loading && <section className="crm-card crm-panel crm-fin-loading" role="status" aria-live="polite" aria-busy="true">
      <span className="crm-fin-spinner" aria-hidden="true"/><div><strong>Carregando {monthLabel(month)}{filters.client || filters.category || filters.source ? ' com os filtros escolhidos' : ''}…</strong>
      <small>Os valores aparecem assim que o Neon responder. Nenhum número de outro período é exibido.</small></div></section>}
    {!data && !loading && loadError && loadError.key === queryKey && <section className="crm-card crm-panel crm-fin-loading" role="alert" data-error>
      <div><strong>Não foi possível carregar o Financeiro.</strong><small>{loadError.text}</small></div>
      <button type="button" className="crm-btn" onClick={load}>Tentar de novo</button></section>}
    {data && loading && <p className="crm-fin-refresh" role="status">Atualizando…</p>}

    {data && tab === 'geral' && <Overview data={data} v={v}/>}
    {data && tab === 'contratos' && <Contracts data={data} month={month} setDialog={setDialog} post={post} busy={busy}/>}
    {data && tab === 'receitas' && <EntryList title={'Receitas de ' + monthLabel(month)} subtitle="Competência do mês selecionado. Previsão não é receita: só vira caixa com recebimento confirmado."
      list={byDir('in').filter(e => e.competenceMonth === month)} setDialog={setDialog} empty="Nenhuma receita com competência neste mês. Cadastre contratos em Clientes e Contratos."/>}
    {data && tab === 'despesas' && <Expenses data={data} month={month} setDialog={setDialog} post={post} busy={busy}/>}
    {data && tab === 'receber' && <MonthlyPending data={data} month={month} direction="in" setDialog={setDialog}/>}
    {data && tab === 'pagar' && <MonthlyPending data={data} month={month} direction="out" setDialog={setDialog}/>}
    {data && tab === 'notas' && <Invoices data={data} month={month} setDialog={setDialog}/>}
    {data && tab === 'relatorios' && <Reports data={data}/>}

    {dialog?.kind === 'client' && <ClientDialog dialog={dialog} onClose={() => setDialog(null)} post={post} busy={busy}/>}
    {dialog?.kind === 'source' && <SourceDialog dialog={dialog} clients={activeClients} today={today} adminAvailable={data?.adminStatusAvailable === true} onClose={() => setDialog(null)} post={post} busy={busy}/>}
    {dialog?.kind === 'settle' && <SettleDialog dialog={dialog} today={today} onClose={() => setDialog(null)} post={post} busy={busy}/>}
    {dialog?.kind === 'entry' && <EntryDialog entry={dialog.entry} onClose={() => setDialog(null)} post={post} busy={busy}/>}
    {dialog?.kind === 'invoice' && <InvoiceDialog entry={dialog.entry} today={today} onClose={() => setDialog(null)} post={post} busy={busy}/>}
    {dialog?.kind === 'end' && <EndDialog source={dialog.source} today={today} onClose={() => setDialog(null)} post={post} busy={busy}/>}
    {dialog?.kind === 'history' && <HistoryDialog entry={dialog.entry} onClose={() => setDialog(null)} post={post} busy={busy}/>}
  </div>
}

function Kpis({ v }: { v: (key: string) => number }) {
  const cards: [string, number, string, string?][] = [
    ['Receita prevista do mês', v('revenueForecastCents'), 'Competência · cobranças do mês'],
    ['Receita recebida', v('revenueReceivedCashCents'), 'Caixa · entrou no mês', 'Da competência do mês: ' + formatCents(v('revenueReceivedOfCompetenceCents'))],
    ['Despesas previstas', v('expensesForecastCents'), 'Competência · contas do mês'],
    ['Despesas pagas', v('expensesPaidCashCents'), 'Caixa · saiu no mês'],
    ['Resultado do mês (caixa)', v('resultCashCents'), 'Recebido − pago no mês', 'Por competência: ' + formatCents(v('resultCompetenceCents'))],
    ['Contas a receber', v('receivableMonthCents'), 'Saldo das cobranças do mês', 'Em aberto até o mês: ' + formatCents(v('receivableOpenTotalCents'))],
    ['Contas a pagar', v('payableMonthCents'), 'Saldo das contas do mês', 'Em aberto até o mês: ' + formatCents(v('payableOpenTotalCents'))],
    ['Em atraso (hoje)', v('overdueReceivableCents'), v('overdueReceivableCount') + ' a receber vencida(s)', 'A pagar vencido: ' + formatCents(v('overduePayableCents'))],
  ]
  return <div className="crm-fin-kpis">
    {cards.map(([label, cents, sub, extra]) => <div key={label} className="crm-card crm-fin-kpi" data-negative={cents < 0 || undefined}>
      <span>{label}</span><strong>{formatCents(cents)}</strong><small>{sub}</small>{extra && <small className="crm-fin-kpi-extra">{extra}</small>}</div>)}
    <div className="crm-card crm-fin-kpi"><span>Contratos recorrentes ativos</span><strong>{v('activeRecurringContracts')}</strong>
      <small>Equivalente mensal: {formatCents(v('recurringMonthlyCents'))}</small></div>
  </div>
}

function Overview({ data, v }: { data: Overview; v: (key: string) => number }) {
  const c = data.charts
  const noData = !data.sources.length
  return <>
    {noData && <div className="crm-info-box"><strong>Ainda não há contratos nem despesas cadastrados.</strong> Os indicadores mostram R$ 0,00 até que
      você cadastre clientes, contratos e despesas reais. Nenhum valor é estimado ou inventado.</div>}
    <Kpis v={v}/>
    {v('clientAdBudgetCents') > 0 && <p className="crm-fin-note">Verbas de anúncio de clientes neste mês (fora do caixa da agência, não entram nos totais): {formatCents(v('clientAdBudgetCents'))}</p>}
    <div className="crm-fin-grid">
      <section className="crm-card crm-panel"><div className="crm-panel-title">Entradas × saídas por mês — {c.year}</div>
        <div className="crm-panel-subtitle">Base caixa: datas reais de recebimento e pagamento</div>
        <BarChart title={'Entradas e saídas por mês em ' + c.year} labels={c.yearMonths.map(m => shortMonth(m.month))}
          series={[{ name: 'Entradas', color: '#34d6a0', values: c.yearMonths.map(m => m.cashIn) }, { name: 'Saídas', color: '#f13c4b', values: c.yearMonths.map(m => m.cashOut) }]}/></section>
      <section className="crm-card crm-panel"><div className="crm-panel-title">Receita dos últimos 12 meses</div>
        <div className="crm-panel-subtitle">Prevista (competência) × recebida (caixa)</div>
        <LineChart title="Receita dos últimos 12 meses" labels={c.last12.map(m => shortMonth(m.month))}
          series={[{ name: 'Prevista (competência)', color: '#8ca8ff', values: c.last12.map(m => m.competenceIn) }, { name: 'Recebida (caixa)', color: '#34d6a0', values: c.last12.map(m => m.cashIn) }]}/></section>
      <section className="crm-card crm-panel"><div className="crm-panel-title">Comparação dos meses de {c.year}</div>
        <div className="crm-panel-subtitle">Resultado de caixa mês a mês (recebido − pago) e receita recebida de {c.year - 1}</div>
        <BarChart title={'Resultado mensal em ' + c.year} labels={c.yearMonths.map(m => shortMonth(m.month))}
          series={[{ name: 'Resultado ' + c.year, color: '#22c7f2', values: c.yearMonths.map(m => m.cashIn - m.cashOut) },
            { name: 'Receita recebida ' + (c.year - 1), color: '#4a5b75', values: c.previousYearMonths.map(m => m.cashIn) }]}/></section>
      <section className="crm-card crm-panel"><div className="crm-panel-title">Receita por categoria — {monthLabel(data.month)}</div>
        <div className="crm-panel-subtitle">Barra cheia: competência · barra fina: caixa</div>
        <CategoryBars rows={c.categories.in} empty="Sem receitas neste mês — R$ 0,00."/></section>
      <section className="crm-card crm-panel"><div className="crm-panel-title">Despesas por categoria — {monthLabel(data.month)}</div>
        <div className="crm-panel-subtitle">Gastos próprios da agência (sem verbas de anúncio de clientes)</div>
        <CategoryBars rows={c.categories.out} empty="Sem despesas neste mês — R$ 0,00."/></section>
    </div>
  </>
}

function Badge({ e }: { e: Entry }) { return <span className="crm-fin-badge" data-tone={STATE_TONE[e.state]}>{e.stateLabel}</span> }

function EntryRow({ e, setDialog }: { e: Entry; setDialog: (d: Dialog) => void }) {
  const open = e.state !== 'cancelled' && e.remainingCents > 0
  // Nas receitas, o cliente é a informação principal; o serviço e a competência ficam logo abaixo.
  const clientFirst = e.direction === 'in' && Boolean(e.clientName)
  return <div className="crm-fin-row" data-overdue={e.overdue || undefined}>
    <div className="crm-fin-row-main"><strong>{clientFirst ? e.clientName : e.description}</strong>
      <small>{[clientFirst ? e.description : e.clientName, e.categoryLabel, 'Competência ' + monthLabel(e.competenceMonth)].filter(Boolean).join(' · ')}{e.clientAdBudget ? ' · verba de cliente (fora do caixa)' : ''}</small></div>
    <div className="crm-fin-row-cell"><span>Vencimento</span>{formatDate(e.dueDate)}</div>
    <div className="crm-fin-row-cell"><span>Valor</span>{formatCents(e.amountCents)}</div>
    <div className="crm-fin-row-cell"><span>{e.direction === 'in' ? 'Recebido' : 'Pago'}</span>{formatCents(e.settledCents)}</div>
    <div className="crm-fin-row-cell"><span>Saldo</span><b>{formatCents(e.remainingCents)}</b></div>
    <div className="crm-fin-row-cell"><Badge e={e}/>{e.invoice && e.invoice.status === 'pending' && <span className="crm-fin-badge" data-tone="warn">NF pendente</span>}</div>
    <div className="crm-fin-row-actions">
      {open && <button type="button" className="crm-btn crm-btn-primary" onClick={() => setDialog({ kind: 'settle', entry: e, key: newKey() })}>{e.direction === 'in' ? 'Registrar recebimento' : 'Registrar pagamento'}</button>}
      <button type="button" className="crm-btn" onClick={() => setDialog({ kind: 'history', entry: e })}>Histórico ({e.settlements.length})</button>
      {e.state !== 'cancelled' && e.settledCents === 0 && <button type="button" className="crm-btn" onClick={() => setDialog({ kind: 'entry', entry: e })}>Ajustar / cancelar</button>}
      {e.invoice && e.state !== 'cancelled' && <button type="button" className="crm-btn" onClick={() => setDialog({ kind: 'invoice', entry: e })}>Nota fiscal</button>}
    </div>
  </div>
}

function EntryList({ title, subtitle, list, setDialog, empty, totals }: { title: string; subtitle: string; list: Entry[]; setDialog: (d: Dialog) => void; empty: string; totals?: [string, number][] }) {
  return <section className="crm-card crm-panel">
    <div className="crm-panel-head"><div><div className="crm-panel-title">{title}</div><div className="crm-panel-subtitle">{subtitle}</div></div></div>
    {totals && <div className="crm-fin-totals">{totals.map(([l, c]) => <div key={l}><span>{l}</span><strong>{formatCents(c)}</strong></div>)}</div>}
    {list.length ? list.map(e => <EntryRow key={e.id} e={e} setDialog={setDialog}/>) : <p className="crm-fin-empty">{empty}</p>}
  </section>
}

function MonthlyPending({ data, month, direction, setDialog }: { data: Overview; month: string; direction: Dir; setDialog: (d: Dialog) => void }) {
  const [showOverdue, setShowOverdue] = useState(false)
  const allOpen = data.entries.filter(e => e.direction === direction && e.state !== 'cancelled' && e.remainingCents > 0)
  const current = allOpen.filter(e => e.competenceMonth === month)
  const previousOverdue = allOpen.filter(e => e.competenceMonth < month && e.overdue)
  const olderTotal = previousOverdue.reduce((sum, e) => sum + e.remainingCents, 0)
  const currentTotal = current.reduce((sum, e) => sum + e.remainingCents, 0)
  const noun = direction === 'in' ? 'receber' : 'pagar'
  return <>
    <EntryList title={'Contas a ' + noun + ' — ' + monthLabel(month)}
      subtitle="Somente cobranças em aberto da competência selecionada. Ao registrar a quitação, a cobrança sai desta lista e permanece no histórico."
      list={current} setDialog={setDialog}
      empty={'Nenhuma cobrança pendente em ' + monthLabel(month) + '.'}
      totals={[[direction === 'in' ? 'Saldo a receber neste mês' : 'Saldo a pagar neste mês', currentTotal]]}/>
    {previousOverdue.length > 0 && <section className="crm-card crm-panel crm-fin-older-debts">
      <div className="crm-panel-head">
        <div><div className="crm-panel-title">Pendências anteriores <span className="crm-fin-badge" data-tone="bad">{previousOverdue.length} em atraso</span></div>
          <div className="crm-panel-subtitle">Competências anteriores ao mês selecionado, sem pagamento integral. Não misturadas com o faturamento do mês.</div></div>
        <button type="button" className="crm-btn" aria-expanded={showOverdue}
          onClick={() => setShowOverdue(x => !x)}>{showOverdue ? 'Ocultar atrasos' : 'Ver atrasos'}</button>
      </div>
      <div className="crm-fin-older-total">Total em atraso de meses anteriores: <strong>{formatCents(olderTotal)}</strong></div>
      {showOverdue && previousOverdue.map(e => <EntryRow key={e.id} e={e} setDialog={setDialog}/>)}
    </section>}
  </>
}

function SourceRow({ s, setDialog, post, busy, monthEntry, referenceMonth }: { s: Source; setDialog: (d: Dialog) => void; post: (b: Record<string, unknown>, ok: string) => Promise<boolean>; busy: boolean; monthEntry?: Entry | null; referenceMonth?: string }) {
  return <div className="crm-fin-row">
    <div className="crm-fin-row-main"><strong>{s.description}</strong>
      <small>{[s.clientName ?? s.supplier, s.categoryLabel, PERIODICITIES[s.periodicity], s.costKind === 'fixed' ? 'Fixa' : s.costKind === 'variable' ? 'Variável' : null,
        s.clientAdBudget ? 'Verba de cliente (fora do caixa)' : null, s.invoiceRequired ? 'Emite NF' : null].filter(Boolean).join(' · ')}</small></div>
    <div className="crm-fin-row-cell"><span>Valor</span>{formatCents(s.amountCents)}</div>
    <div className="crm-fin-row-cell"><span>Vencimento</span>dia {s.dueDay}</div>
    <div className="crm-fin-row-cell"><span>Início cadastrado / término</span>{formatDate(s.startDate)} → {s.endDate ? formatDate(s.endDate) : 'sem término'}
      {s.generateFrom > s.startDate.slice(0, 7) && <small>Cobranças recorrentes desde {monthLabel(s.generateFrom)}</small>}</div>
    <div className="crm-fin-row-cell"><span className="crm-fin-badge" data-tone={s.status === 'active' ? 'ok' : s.status === 'paused' ? 'warn' : 'muted'}>{SOURCE_STATUS[s.status]}</span></div>
    {s.direction === 'in' && <div className="crm-fin-admin" aria-label="Situação administrativa (não altera cobranças)">
      <span className="crm-fin-badge" data-tone={SERVICE_TONE[s.serviceStatus]}>Serviço: {SERVICE_STATUS[s.serviceStatus]}</span>
      <span className="crm-fin-badge" data-tone={FORMAL_TONE[s.formalizationStatus]}>{s.formalizationStatus === 'awaiting_signature' ? '✍ ' : ''}Contrato: {FORMALIZATION_STATUS[s.formalizationStatus]}</span>
    </div>}
    {s.direction === 'in' && referenceMonth && <div className="crm-fin-month-status">
      <span className="crm-fin-badge" data-tone={monthEntry ? STATE_TONE[monthEntry.state] : 'muted'}>
        {monthLabel(referenceMonth)}: {monthEntry ? monthEntry.stateLabel : 'Sem cobrança nesta competência'}
      </span>
      {monthEntry && <small>Recebido {formatCents(monthEntry.settledCents)} · saldo {formatCents(monthEntry.remainingCents)}</small>}
    </div>}
    <div className="crm-fin-row-actions">
      {s.status !== 'ended' && <button type="button" className="crm-btn" onClick={() => setDialog({ kind: 'source', direction: s.direction, source: s })}>Editar</button>}
      {s.status === 'active' && s.periodicity !== 'one_time' && <button type="button" className="crm-btn" disabled={busy}
        onClick={() => post({ action: 'source_status', id: s.id, status: 'paused' }, 'Pausado. Previsões futuras sem movimento foram canceladas (histórico preservado).')}>Pausar</button>}
      {s.status === 'paused' && <button type="button" className="crm-btn" disabled={busy}
        onClick={() => post({ action: 'source_status', id: s.id, status: 'active' }, 'Reativado a partir do mês atual.')}>Reativar</button>}
      {s.status !== 'ended' && <button type="button" className="crm-btn" disabled={busy} onClick={() => setDialog({ kind: 'end', source: s })}>Encerrar</button>}
    </div>
  </div>
}

function Contracts({ data, month, setDialog, post, busy }: { data: Overview; month: string; setDialog: (d: Dialog) => void; post: (b: Record<string, unknown>, ok: string) => Promise<boolean>; busy: boolean }) {
  const [onlyAwaiting, setOnlyAwaiting] = useState(false)
  const [showEnded, setShowEnded] = useState(false)
  const all = data.sources.filter(s => s.direction === 'in')
  const awaiting = all.filter(s => s.formalizationStatus === 'awaiting_signature' && s.status !== 'ended')
  const visible = all.filter(s => showEnded || s.status !== 'ended')
  const contracts = onlyAwaiting ? awaiting : visible
  const clients = onlyAwaiting ? data.clients.filter(c => awaiting.some(s => s.clientId === c.id)) : data.clients
  return <>
    {!data.adminStatusAvailable && <p className="crm-fin-note">Situação do serviço e do contrato: disponível após a aplicação da migração 0012 (todos aparecem como "Não informado").</p>}
    <div className="crm-info-box">Esta seção mostra os <strong>serviços contratados</strong>, não uma linha por faturamento mensal.
      Os pagamentos são registrados por competência em Contas a Receber; o histórico permanece disponível em cada cliente.</div>
    {awaiting.length > 0 && <div className="crm-fin-awaiting" role="status"><span>✍ <strong>{awaiting.length}</strong> contrato(s) aguardando assinatura</span>
      <button type="button" className="crm-btn" aria-pressed={onlyAwaiting} onClick={() => setOnlyAwaiting(!onlyAwaiting)}>{onlyAwaiting ? 'Mostrar todos' : 'Ver somente estes'}</button></div>}
    <div className="crm-fin-actions">
      <button type="button" className="crm-btn crm-btn-primary" onClick={() => setDialog({ kind: 'client' })}>+ Novo cliente</button>
      <button type="button" className="crm-btn" disabled={!data.clients.some(c => !c.archived)} onClick={() => setDialog({ kind: 'source', direction: 'in' })}>+ Novo contrato / receita</button>
      {all.some(s => s.status === 'ended') && <button type="button" className="crm-btn" aria-pressed={showEnded}
        onClick={() => setShowEnded(x => !x)}>{showEnded ? 'Ocultar contratos encerrados' : 'Ver contratos encerrados'}</button>}
    </div>
    {!data.clients.length && <p className="crm-fin-empty">Nenhum cliente financeiro cadastrado.</p>}
    {clients.map(c => {
      const services = contracts.filter(s => s.clientId === c.id)
      const activeCount = services.filter(s => s.status === 'active').length
      const history = data.entries.filter(e => e.direction === 'in' && e.clientId === c.id && e.competenceMonth <= month && e.state !== 'cancelled')
        .sort((a, b) => b.dueDate.localeCompare(a.dueDate))
      return <section key={c.id} className="crm-card crm-panel crm-fin-client" data-archived={c.archived || undefined}>
        <div className="crm-panel-head"><div><div className="crm-panel-title">{c.name}{c.archived && <span className="crm-fin-badge" data-tone="muted">Arquivado</span>}</div>
          <div className="crm-panel-subtitle">{[c.company, activeCount + ' serviço(s) ativo(s) de ' + services.length + ' cadastrado(s)'].filter(Boolean).join(' · ')}{c.notes ? ' · ' + c.notes : ''}</div></div>
          <div className="crm-fin-row-actions">
            {!c.archived && <button type="button" className="crm-btn" onClick={() => setDialog({ kind: 'source', direction: 'in', clientId: c.id })}>+ Serviço</button>}
            <button type="button" className="crm-btn" onClick={() => setDialog({ kind: 'client', client: c })}>Editar cliente</button>
            <button type="button" className="crm-btn" disabled={busy} onClick={() => post({ action: 'client_archive', id: c.id, archived: !c.archived }, c.archived ? 'Cliente reativado.' : 'Cliente arquivado (histórico preservado).')}>{c.archived ? 'Reativar' : 'Arquivar'}</button>
          </div></div>
        {services.map(s => <SourceRow key={s.id} s={s} setDialog={setDialog} post={post} busy={busy} referenceMonth={month}
          monthEntry={data.entries.find(e => e.sourceId === s.id && e.competenceMonth === month && e.state !== 'cancelled')}/>)}
        {!services.length && <p className="crm-fin-empty">Nenhum serviço ativo cadastrado para este cliente.</p>}
        <details className="crm-fin-client-history">
          <summary>Histórico de faturamento e pagamentos até {monthLabel(month)} ({history.length})</summary>
          {history.length ? history.map(e => <EntryRow key={e.id} e={e} setDialog={setDialog}/>)
            : <p className="crm-fin-empty">Sem lançamentos históricos neste período.</p>}
        </details>
      </section>
    })}
  </>
}

function Expenses({ data, month, setDialog, post, busy }: { data: Overview; month: string; setDialog: (d: Dialog) => void; post: (b: Record<string, unknown>, ok: string) => Promise<boolean>; busy: boolean }) {
  const list = data.sources.filter(s => s.direction === 'out')
  return <>
    <div className="crm-fin-actions"><button type="button" className="crm-btn crm-btn-primary" onClick={() => setDialog({ kind: 'source', direction: 'out' })}>+ Nova despesa</button></div>
    <section className="crm-card crm-panel"><div className="crm-panel-title">Despesas cadastradas</div>
      <div className="crm-panel-subtitle">Fixas e variáveis. Verbas de anúncio de clientes ficam registradas, mas fora do caixa da agência.</div>
      {list.length ? list.map(s => <SourceRow key={s.id} s={s} setDialog={setDialog} post={post} busy={busy}/>) : <p className="crm-fin-empty">Nenhuma despesa cadastrada — R$ 0,00.</p>}
    </section>
    <EntryList title={'Contas de ' + monthLabel(month)} subtitle="Competência do mês selecionado." list={data.entries.filter(e => e.direction === 'out' && e.competenceMonth === month)}
      setDialog={setDialog} empty="Nenhuma conta com competência neste mês."/>
  </>
}

function Invoices({ data, month, setDialog }: { data: Overview; month: string; setDialog: (d: Dialog) => void }) {
  const ins = data.entries.filter(e => e.direction === 'in' && e.state !== 'cancelled')
  const pendingReceived = ins.filter(e => e.invoice?.status === 'pending' && e.settledCents > 0)
  const ofMonth = ins.filter(e => e.competenceMonth === month)
  return <>
    <div className="crm-info-box">Controle administrativo das notas fiscais. <strong>Não há emissão automática de NF-e/NFS-e nem cálculo de impostos</strong>:
      registre aqui o número e a data da nota emitida no sistema oficial.</div>
    <section className="crm-card crm-panel"><div className="crm-panel-title">Recebidas com nota pendente</div>
      <div className="crm-panel-subtitle">Cobranças com recebimento registrado e emissão ainda pendente</div>
      {pendingReceived.length ? pendingReceived.map(e => <InvoiceRow key={e.id} e={e} setDialog={setDialog}/>) : <p className="crm-fin-empty">Nenhuma nota pendente para cobranças recebidas.</p>}
    </section>
    <section className="crm-card crm-panel"><div className="crm-panel-title">Notas das cobranças de {monthLabel(month)}</div>
      {ofMonth.length ? ofMonth.map(e => <InvoiceRow key={e.id} e={e} setDialog={setDialog}/>) : <p className="crm-fin-empty">Nenhuma cobrança neste mês.</p>}
    </section>
  </>
}
function InvoiceRow({ e, setDialog }: { e: Entry; setDialog: (d: Dialog) => void }) {
  const inv = e.invoice!
  return <div className="crm-fin-row">
    <div className="crm-fin-row-main"><strong>{e.description}</strong><small>{[e.clientName, 'Competência ' + monthLabel(e.competenceMonth)].filter(Boolean).join(' · ')}</small></div>
    <div className="crm-fin-row-cell"><span>Valor</span>{formatCents(e.amountCents)}</div>
    <div className="crm-fin-row-cell"><span>Recebido</span>{formatCents(e.settledCents)}</div>
    <div className="crm-fin-row-cell"><span>Nota</span><span className="crm-fin-badge" data-tone={inv.status === 'issued' ? 'ok' : inv.status === 'pending' ? 'warn' : 'muted'}>{inv.label}</span></div>
    <div className="crm-fin-row-cell"><span>Número / emissão</span>{inv.number ? inv.number + ' · ' + formatDate(inv.issuedOn) : '—'}</div>
    <div className="crm-fin-row-actions"><button type="button" className="crm-btn" onClick={() => setDialog({ kind: 'invoice', entry: e })}>Atualizar nota</button></div>
  </div>
}

function Reports({ data }: { data: Overview }) {
  const year = data.month.slice(0, 4)
  const ACTIONS: Record<string, string> = { created: 'Cadastro', updated: 'Alteração', archived: 'Arquivado', unarchived: 'Reativado', recorded: 'Movimento registrado',
    reversed: 'Estorno', cancelled: 'Cancelamento', adjusted: 'Ajuste', status_paused: 'Pausa', status_active: 'Reativação', status_ended: 'Encerramento', admin_status: 'Situação do serviço/contrato' }
  const ENTITY: Record<string, string> = { client: 'Cliente', source: 'Contrato/despesa', entry: 'Lançamento', settlement: 'Recebimento/pagamento', invoice: 'Nota fiscal' }
  return <>
    <div className="crm-fin-actions">
      <a className="crm-btn" href={'/api/crm/finance/export?kind=entries&year=' + year} download>Exportar lançamentos {year} (CSV)</a>
      <a className="crm-btn" href={'/api/crm/finance/export?kind=movements&year=' + year} download>Exportar movimentos de caixa {year} (CSV)</a>
    </div>
    <div className="crm-fin-grid">
      {Object.values(data.reports).map(r => <section key={r.label} className="crm-card crm-panel">
        <div className="crm-panel-title">{r.label}</div><div className="crm-panel-subtitle">{r.currentLabel} × {r.previousLabel} · filtros aplicados</div>
        <div className="crm-table-wrap"><table className="crm-fin-table"><thead><tr><th>Indicador</th><th>Atual</th><th>Anterior</th><th>Evolução</th></tr></thead>
          <tbody>{r.rows.map(row => {
            const c = percentChange(row.current, row.previous)
            return <tr key={row.key}><td>{row.label}</td><td>{formatCents(row.current)}</td><td>{formatCents(row.previous)}</td>
              <td data-trend={c.comparable ? (c.percent > 0 ? 'up' : c.percent < 0 ? 'down' : 'flat') : 'na'}>{formatChange(row.current, row.previous)}</td></tr>
          })}</tbody></table></div>
      </section>)}
    </div>
    <section className="crm-card crm-panel"><div className="crm-panel-title">Trilha de auditoria</div>
      <div className="crm-panel-subtitle">Últimas 60 alterações financeiras (quem: referência não reversível da sessão administrativa)</div>
      {data.audit.length ? <div className="crm-table-wrap"><table className="crm-fin-table"><thead><tr><th>Quando</th><th>Registro</th><th>Ação</th><th>Sessão</th></tr></thead>
        <tbody>{data.audit.map((a, i) => <tr key={i}><td>{a.createdAt ? new Date(a.createdAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'}</td>
          <td>{ENTITY[a.entity] ?? a.entity}</td><td>{ACTIONS[a.action] ?? (a.action.startsWith('set_') ? 'Nota: ' + (INVOICE_STATUS[a.action.slice(4) as keyof typeof INVOICE_STATUS] ?? a.action) : a.action)}</td>
          <td><code>{a.actorRef}</code></td></tr>)}</tbody></table></div> : <p className="crm-fin-empty">Nenhuma alteração registrada ainda.</p>}
    </section>
  </>
}

// ───────────────────────── diálogos ─────────────────────────

type PostFn = (b: Record<string, unknown>, ok: string) => Promise<boolean>

function ClientDialog({ dialog, onClose, post, busy }: { dialog: { client?: Client }; onClose: () => void; post: PostFn; busy: boolean }) {
  const c = dialog.client
  const [f, setF] = useState({ name: c?.name ?? '', company: c?.company ?? '', notes: c?.notes ?? '' })
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (await post({ action: c ? 'client_update' : 'client_create', id: c?.id, ...f }, c ? 'Cliente atualizado.' : 'Cliente cadastrado.')) onClose()
  }
  return <Modal title={c ? 'Editar cliente' : 'Novo cliente'} onClose={onClose}>
    <form className="crm-fin-form" onSubmit={submit}>
      <Field label="Nome do cliente" wide><input required minLength={2} maxLength={160} value={f.name} onChange={e => setF({ ...f, name: e.target.value })}/></Field>
      <Field label="Empresa" wide><input maxLength={160} value={f.company} onChange={e => setF({ ...f, company: e.target.value })}/></Field>
      <Field label="Observações" wide><textarea maxLength={2000} rows={3} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })}/></Field>
      <div className="crm-modal-actions"><button type="button" className="crm-btn" onClick={onClose}>Cancelar</button><button className="crm-btn crm-btn-primary" disabled={busy}>Salvar</button></div>
    </form>
  </Modal>
}

function SourceDialog({ dialog, clients, today, adminAvailable, onClose, post, busy }: { dialog: { direction: Dir; source?: Source; clientId?: string }; clients: Client[]; today: string; adminAvailable: boolean; onClose: () => void; post: PostFn; busy: boolean }) {
  const s = dialog.source
  const dir = dialog.direction
  const cats = dir === 'in' ? REVENUE_CATEGORIES : EXPENSE_CATEGORIES
  const [f, setF] = useState({
    clientId: s?.clientId ?? dialog.clientId ?? '', category: s?.category ?? '', description: s?.description ?? '', supplier: s?.supplier ?? '',
    amount: s ? centsToInput(s.amountCents) : '', periodicity: s?.periodicity ?? 'monthly', costKind: s?.costKind ?? 'fixed',
    startDate: s?.startDate ?? today, endDate: s?.endDate ?? '', dueDay: String(s?.dueDay ?? (dir === 'out' ? Number(today.slice(8, 10)) : 10)),
    generateFrom: '', invoiceRequired: s?.invoiceRequired ?? false, clientAdBudget: s?.clientAdBudget ?? false, notes: s?.notes ?? '', applyToOpenFuture: false,
    serviceStatus: s?.serviceStatus ?? 'unknown', formalizationStatus: s?.formalizationStatus ?? 'unknown',
  })
  const initial = useRef(f)
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch })
  const past = f.startDate.slice(0, 7) < today.slice(0, 7)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!s) {
      const body = { action: 'source_create', direction: dir, ...f, clientId: dir === 'in' || f.clientAdBudget ? f.clientId : '',
        ...(dir === 'in' && adminAvailable ? {} : { serviceStatus: 'unknown', formalizationStatus: 'unknown' }) }
      if (await post(body, 'Cadastrado. Previsões geradas sem duplicidade.')) onClose()
      return
    }
    // Situação do serviço/contrato vai por uma ação própria, que não toca em valores nem em lançamentos.
    const i = initial.current
    const statusChanged = f.serviceStatus !== i.serviceStatus || f.formalizationStatus !== i.formalizationStatus
    const coreKeys = ['category', 'description', 'supplier', 'amount', 'startDate', 'dueDay', 'endDate', 'costKind', 'invoiceRequired', 'notes', 'applyToOpenFuture'] as const
    const coreChanged = coreKeys.some(k => f[k] !== i[k])
    if (coreChanged && !await post({ action: 'source_update', id: s.id, direction: dir, category: f.category, description: f.description, supplier: f.supplier,
      amount: f.amount, startDate: dir === 'in' && s.periodicity === 'monthly' ? f.startDate : undefined, dueDay: f.dueDay, endDate: f.endDate, costKind: f.costKind, invoiceRequired: f.invoiceRequired, notes: f.notes,
      applyToOpenFuture: f.applyToOpenFuture }, 'Alterações salvas. Movimentos já registrados não foram alterados.')) return
    if (statusChanged && !await post({ action: 'source_admin_status', id: s.id, serviceStatus: f.serviceStatus, formalizationStatus: f.formalizationStatus },
      coreChanged ? 'Alterações e situação do contrato salvas. Cobranças não foram alteradas.' : 'Situação atualizada. Nenhuma cobrança foi gerada ou cancelada.')) return
    onClose()
  }
  return <Modal title={(s ? 'Editar ' : 'Nova ') + (dir === 'in' ? 'receita / contrato' : 'despesa')} onClose={onClose}>
    <form className="crm-fin-form" onSubmit={submit}>
      {dir === 'in' && !s && <Field label="Cliente" wide><select required value={f.clientId} onChange={e => set({ clientId: e.target.value })}>
        <option value="">Selecione…</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.company ? ' — ' + c.company : ''}</option>)}</select></Field>}
      <Field label={dir === 'in' ? 'Tipo de serviço / receita' : 'Categoria'} wide><select required value={f.category} onChange={e => set({ category: e.target.value })}>
        <option value="">Selecione…</option>{Object.entries(cats).map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></Field>
      <Field label="Descrição" wide><input required minLength={2} maxLength={200} value={f.description} onChange={e => set({ description: e.target.value })}/></Field>
      {dir === 'out' && <Field label="Fornecedor (opcional)" wide><input maxLength={160} value={f.supplier} onChange={e => set({ supplier: e.target.value })}/></Field>}
      <Field label={dir === 'in' ? 'Valor contratado (R$)' : 'Valor (R$)'}><MoneyInput name="amount" value={f.amount} onChange={amount => set({ amount })}/></Field>
      {!s && <Field label="Periodicidade"><select value={f.periodicity} onChange={e => set({ periodicity: e.target.value as Source['periodicity'] })}>
        {Object.entries(PERIODICITIES).map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></Field>}
      {dir === 'out' && <Field label="Tipo de despesa"><select value={f.costKind ?? 'fixed'} onChange={e => set({ costKind: e.target.value as 'fixed' | 'variable' })}>
        <option value="fixed">Fixa</option><option value="variable">Variável</option></select></Field>}
      {s && dir === 'in' && s.periodicity === 'monthly' && <Field label="Início real dos trabalhos" hint="Atualiza apenas a data do serviço, sem alterar competências nem pagamentos já lançados.">
        <input type="date" required value={f.startDate} onChange={e => set({ startDate: e.target.value })}/></Field>}
      {!s && <Field label={dir === 'in' ? 'Data de início' : 'Data da primeira ocorrência'}><input type="date" required value={f.startDate}
        onChange={e => set({ startDate: e.target.value, dueDay: dir === 'out' && e.target.value ? String(Number(e.target.value.slice(8, 10))) : f.dueDay })}/></Field>}
      <Field label="Dia de vencimento" hint="Em meses mais curtos, vence no último dia."><input inputMode="numeric" pattern="[0-9]*" required value={f.dueDay}
        onChange={e => set({ dueDay: e.target.value.replace(/\D/g, '').slice(0, 2) })}/></Field>
      {f.periodicity !== 'one_time' && <Field label="Data de término (opcional)"><input type="date" value={f.endDate} onChange={e => set({ endDate: e.target.value })}/></Field>}
      {!s && past && f.periodicity !== 'one_time' && <Field label="Gerar cobranças a partir de" hint="Padrão: mês atual. Escolha um mês anterior só se quiser lançar meses passados.">
        <input type="month" value={f.generateFrom || today.slice(0, 7)} min={f.startDate.slice(0, 7)} onChange={e => set({ generateFrom: e.target.value })}/></Field>}
      {dir === 'in' && <fieldset className="crm-fin-admin-fields" data-wide disabled={!adminAvailable}>
        <legend>Controle administrativo <small>(não bloqueia cobranças nem recebimentos)</small></legend>
        <Field label="Situação do serviço"><select value={f.serviceStatus} onChange={e => set({ serviceStatus: e.target.value as Source['serviceStatus'] })}>
          {Object.entries(SERVICE_STATUS).map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></Field>
        <Field label="Situação do contrato / formalização"><select value={f.formalizationStatus} onChange={e => set({ formalizationStatus: e.target.value as Source['formalizationStatus'] })}>
          {Object.entries(FORMALIZATION_STATUS).map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></Field>
        {!adminAvailable && <small className="crm-fin-admin-hint">Disponível após a migração 0012. Até lá, fica "Não informado".</small>}
      </fieldset>}
      {dir === 'in' && <label className="crm-fin-check" data-wide><input type="checkbox" checked={f.invoiceRequired} onChange={e => set({ invoiceRequired: e.target.checked })}/>Emitir nota fiscal (controle manual)</label>}
      {dir === 'out' && !s && <label className="crm-fin-check" data-wide><input type="checkbox" checked={f.clientAdBudget} onChange={e => set({ clientAdBudget: e.target.checked })}/>Verba de anúncio de cliente (não passa pelo caixa da agência)</label>}
      {dir === 'out' && f.clientAdBudget && !s && <Field label="Cliente da verba (opcional)" wide><select value={f.clientId} onChange={e => set({ clientId: e.target.value })}>
        <option value="">—</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>}
      {s && <label className="crm-fin-check" data-wide><input type="checkbox" checked={f.applyToOpenFuture} onChange={e => set({ applyToOpenFuture: e.target.checked })}/>
        Aplicar o novo valor/vencimento aos lançamentos futuros já gerados e sem movimento (o mês atual e os pagos não mudam)</label>}
      <Field label="Observações" wide><textarea rows={2} maxLength={2000} value={f.notes} onChange={e => set({ notes: e.target.value })}/></Field>
      <div className="crm-modal-actions"><button type="button" className="crm-btn" onClick={onClose}>Cancelar</button><button className="crm-btn crm-btn-primary" disabled={busy}>Salvar</button></div>
    </form>
  </Modal>
}

function SettleDialog({ dialog, today, onClose, post, busy }: { dialog: { entry: Entry; key: string }; today: string; onClose: () => void; post: PostFn; busy: boolean }) {
  const e = dialog.entry
  const [f, setF] = useState({ amount: centsToInput(e.remainingCents), settledOn: today, method: '', notes: '' })
  const cents = parseMoneyToCents(f.amount)
  const submit = async (ev: FormEvent) => {
    ev.preventDefault()
    // A chave nasce ao abrir o formulário: toque duplo ou reenvio após falha de rede não duplicam o movimento.
    if (await post({ action: 'settle', entryId: e.id, idempotencyKey: dialog.key, ...f }, e.direction === 'in' ? 'Recebimento registrado.' : 'Pagamento registrado.')) onClose()
  }
  return <Modal title={e.direction === 'in' ? 'Registrar recebimento' : 'Registrar pagamento'} onClose={onClose}>
    <p className="crm-fin-modal-sub">{e.description} · competência {monthLabel(e.competenceMonth)} · saldo {formatCents(e.remainingCents)}</p>
    <form className="crm-fin-form" onSubmit={submit}>
      <Field label="Valor efetivo (R$)" hint={cents && cents < e.remainingCents ? 'Parcial: restará ' + formatCents(e.remainingCents - cents) : undefined}>
        <MoneyInput name="amount" value={f.amount} onChange={amount => setF({ ...f, amount })}/></Field>
      <Field label={e.direction === 'in' ? 'Data em que entrou' : 'Data em que saiu'}><input type="date" required max={today} value={f.settledOn} onChange={ev => setF({ ...f, settledOn: ev.target.value })}/></Field>
      <Field label="Forma (opcional)"><input maxLength={60} placeholder="PIX, boleto, cartão…" value={f.method} onChange={ev => setF({ ...f, method: ev.target.value })}/></Field>
      <Field label="Observações" wide><input maxLength={500} value={f.notes} onChange={ev => setF({ ...f, notes: ev.target.value })}/></Field>
      <div className="crm-modal-actions"><button type="button" className="crm-btn" onClick={onClose}>Cancelar</button>
        <button className="crm-btn crm-btn-primary" disabled={busy || !cents || cents > e.remainingCents}>Confirmar</button></div>
    </form>
  </Modal>
}

function EntryDialog({ entry: e, onClose, post, busy }: { entry: Entry; onClose: () => void; post: PostFn; busy: boolean }) {
  const [f, setF] = useState({ amount: centsToInput(e.amountCents), dueDate: e.dueDate, reason: '' })
  return <Modal title="Ajustar ou cancelar lançamento" onClose={onClose}>
    <p className="crm-fin-modal-sub">{e.description} · competência {monthLabel(e.competenceMonth)}. Só é possível sem movimentos registrados; tudo fica na auditoria.</p>
    <form className="crm-fin-form" onSubmit={async ev => { ev.preventDefault(); if (await post({ action: 'entry_update', id: e.id, amount: f.amount, dueDate: f.dueDate }, 'Lançamento ajustado.')) onClose() }}>
      <Field label="Valor (R$)"><MoneyInput name="amount" value={f.amount} onChange={amount => setF({ ...f, amount })}/></Field>
      <Field label="Vencimento"><input type="date" required value={f.dueDate} onChange={ev => setF({ ...f, dueDate: ev.target.value })}/></Field>
      <div className="crm-modal-actions"><button className="crm-btn crm-btn-primary" disabled={busy}>Salvar ajuste</button></div>
    </form>
    <form className="crm-fin-form crm-fin-danger" onSubmit={async ev => { ev.preventDefault(); if (await post({ action: 'entry_cancel', id: e.id, reason: f.reason }, 'Lançamento cancelado (permanece no histórico).')) onClose() }}>
      <Field label="Motivo do cancelamento" wide><input required minLength={3} maxLength={300} value={f.reason} onChange={ev => setF({ ...f, reason: ev.target.value })}/></Field>
      <div className="crm-modal-actions"><button type="button" className="crm-btn" onClick={onClose}>Fechar</button><button className="crm-btn" disabled={busy}>Cancelar lançamento</button></div>
    </form>
  </Modal>
}

function InvoiceDialog({ entry: e, today, onClose, post, busy }: { entry: Entry; today: string; onClose: () => void; post: PostFn; busy: boolean }) {
  const inv = e.invoice!
  const [f, setF] = useState({ status: inv.status, number: inv.number ?? '', issuedOn: inv.issuedOn ?? '', externalRef: inv.externalRef ?? '', notes: inv.notes })
  return <Modal title="Nota fiscal" onClose={onClose}>
    <p className="crm-fin-modal-sub">{e.description} · {formatCents(e.amountCents)} · competência {monthLabel(e.competenceMonth)}</p>
    <form className="crm-fin-form" onSubmit={async ev => { ev.preventDefault(); if (await post({ action: 'invoice_set', entryId: e.id, ...f }, 'Nota fiscal atualizada.')) onClose() }}>
      <Field label="Situação"><select value={f.status} onChange={ev => setF({ ...f, status: ev.target.value as typeof f.status })}>
        {Object.entries(INVOICE_STATUS).map(([id, l]) => <option key={id} value={id}>{l}</option>)}</select></Field>
      <Field label="Número"><input maxLength={60} required={f.status === 'issued'} value={f.number} onChange={ev => setF({ ...f, number: ev.target.value })}/></Field>
      <Field label="Data de emissão"><input type="date" max={today} required={f.status === 'issued'} value={f.issuedOn} onChange={ev => setF({ ...f, issuedOn: ev.target.value })}/></Field>
      <Field label="Referência externa (opcional)"><input maxLength={200} value={f.externalRef} onChange={ev => setF({ ...f, externalRef: ev.target.value })}/></Field>
      <Field label="Observações" wide><input maxLength={1000} value={f.notes} onChange={ev => setF({ ...f, notes: ev.target.value })}/></Field>
      <div className="crm-modal-actions"><button type="button" className="crm-btn" onClick={onClose}>Cancelar</button><button className="crm-btn crm-btn-primary" disabled={busy}>Salvar</button></div>
    </form>
  </Modal>
}

function HistoryDialog({ entry: e, onClose, post, busy }: { entry: Entry; onClose: () => void; post: PostFn; busy: boolean }) {
  const [reason, setReason] = useState('')
  const [target, setTarget] = useState<string | null>(null)
  return <Modal title="Histórico de movimentos" onClose={onClose}>
    <p className="crm-fin-modal-sub">{e.description} · valor {formatCents(e.amountCents)} · {e.direction === 'in' ? 'recebido' : 'pago'} {formatCents(e.settledCents)} · saldo {formatCents(e.remainingCents)}
      {e.cancelReason ? ' · cancelado: ' + e.cancelReason : ''}</p>
    {e.settlements.length ? e.settlements.map(s => <div key={s.id} className="crm-fin-row" data-reversed={!!s.reversedAt || undefined}>
      <div className="crm-fin-row-main"><strong>{formatCents(s.amountCents)} em {formatDate(s.settledOn)}</strong>
        <small>{[s.method, s.notes, s.reversedAt ? 'ESTORNADO: ' + (s.reversalReason ?? '') : null].filter(Boolean).join(' · ') || 'Sem observações'}</small></div>
      {!s.reversedAt && <div className="crm-fin-row-actions"><button type="button" className="crm-btn" onClick={() => setTarget(s.id)}>Estornar</button></div>}
    </div>) : <p className="crm-fin-empty">Nenhum movimento registrado.</p>}
    {target && <form className="crm-fin-form crm-fin-danger" onSubmit={async ev => { ev.preventDefault(); if (await post({ action: 'settlement_reverse', id: target, reason }, 'Movimento estornado (permanece no histórico).')) onClose() }}>
      <Field label="Motivo do estorno" wide><input required minLength={3} maxLength={300} value={reason} onChange={ev => setReason(ev.target.value)}/></Field>
      <div className="crm-modal-actions"><button type="button" className="crm-btn" onClick={() => setTarget(null)}>Voltar</button><button className="crm-btn" disabled={busy}>Confirmar estorno</button></div>
    </form>}
  </Modal>
}

function EndDialog({ source: s, today, onClose, post, busy }: { source: Source; today: string; onClose: () => void; post: PostFn; busy: boolean }) {
  const [endDate, setEndDate] = useState(today >= s.startDate ? today : s.startDate)
  return <Modal title={s.direction === 'in' ? 'Encerrar contrato' : 'Encerrar despesa'} onClose={onClose}>
    <p className="crm-fin-modal-sub">{s.description}. Lançamentos posteriores ao mês de término e sem movimento serão cancelados com motivo; nada é apagado
      e o histórico de recebimentos/pagamentos permanece. Encerrado não pode ser reativado.</p>
    <form className="crm-fin-form" onSubmit={async ev => { ev.preventDefault(); if (await post({ action: 'source_status', id: s.id, status: 'ended', endDate }, 'Encerrado. Histórico preservado.')) onClose() }}>
      <Field label="Data de término"><input type="date" required min={s.startDate} value={endDate} onChange={ev => setEndDate(ev.target.value)}/></Field>
      <div className="crm-modal-actions"><button type="button" className="crm-btn" onClick={onClose}>Voltar</button><button className="crm-btn crm-btn-primary" disabled={busy}>Encerrar</button></div>
    </form>
  </Modal>
}
