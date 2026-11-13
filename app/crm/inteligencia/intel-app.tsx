'use client'

import { useEffect, useMemo, useState } from 'react'
import '../crm.css'
import './inteligencia.css'
import {
  acceptFailure, acceptResponse, beginRequest, chooseClient, effectiveFilters, initialState, navigateArea, prefsFromFilters, requestKey,
  type FetchState, type FilterPrefs,
} from '@/lib/crm/intel/client-state'
import { PERIOD_LABEL, PERIOD_PRESETS, type PeriodPreset } from '@/lib/crm/intel/dates'
import { CLIENT_AREAS, SEARCH_AREAS, STATUS_AREAS, normalizeForArea } from '@/lib/crm/intel/filters'
import { INTEL_AREAS, type CampaignStatusFilter, type ClientOption, type IntelArea, type IntelFilters, type IntelPayload, type PlatformFilter } from '@/lib/crm/intel/view-types'
import { ClientArea, ConnectionsArea, OverviewArea, ProspectingArea } from './intel-areas'
import { StateMessage } from './intel-ui'

const AREA_LABEL: Record<IntelArea, string> = { prospeccao: 'Prospecção Cassiellos', agencia: 'Visão geral da agência', cliente: 'Visão do cliente', conexoes: 'Conexões e integrações' }
const AREA_SHORT: Record<IntelArea, string> = { prospeccao: 'Prospecção', agencia: 'Visão geral', cliente: 'Cliente', conexoes: 'Conexões' }
const AREA_DESC: Record<IntelArea, string> = {
  prospeccao: 'Campanhas de aquisição da própria agência: investimento, leads, reuniões e custo por resultado.',
  agencia: 'Todos os clientes monitorados: investimento, eficiência, conversões por origem, atualização e alertas.',
  cliente: 'Desempenho de um cliente por vez, com todas as contas e propriedades confirmadas dele.',
  conexoes: 'Conexão técnica, acesso à plataforma e vínculo com o cliente de cada conta, sincronizações e ações previstas.',
}
const AREA_ICON: Record<IntelArea, string> = { prospeccao: 'M3 12h4l3-7 4 14 3-7h4', agencia: 'M3 3v18h18M7 16l5-5 4 3 5-7', cliente: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', conexoes: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7' }
const STATUS_LABEL: Record<CampaignStatusFilter, string> = { all: 'Todas', active: 'Ativas', paused: 'Pausadas' }

const DEFAULT: IntelFilters = { area: 'agencia', period: '30d', platform: 'all', status: 'all', client: 'all', campaign: '' }

function filtersFromUrl(): IntelFilters {
  if (typeof window === 'undefined') return DEFAULT
  const p = new URLSearchParams(window.location.search)
  const area = (INTEL_AREAS as readonly string[]).includes(p.get('area') ?? '') ? p.get('area') as IntelArea : DEFAULT.area
  const period = (PERIOD_PRESETS as readonly string[]).includes(p.get('period') ?? '') ? p.get('period') as PeriodPreset : DEFAULT.period
  const platform = (['all', 'google_ads', 'meta_ads'] as const).find(x => x === p.get('platform')) ?? 'all'
  const status = (['all', 'active', 'paused'] as const).find(x => x === p.get('status')) ?? 'all'
  const client = /^[a-z0-9_]{3,64}$/.test(p.get('client') ?? '') ? p.get('client') as string : area === 'cliente' ? '' : 'all'
  const campaign = (p.get('campaign') ?? '').slice(0, 60)
  return { area, period, platform, status, client, campaign }
}

function Svg({ d }: { d: string }) {
  return <svg aria-hidden="true" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d}/></svg>
}

export default function IntelApp() {
  const [prefs, setPrefs] = useState<FilterPrefs>(() => prefsFromFilters(DEFAULT))
  const [ready, setReady] = useState(false)
  const [state, setState] = useState<FetchState<IntelPayload>>(initialState)
  const [refresh, setRefresh] = useState(0)
  const [search, setSearch] = useState('')
  const [clients, setClients] = useState<ClientOption[]>([])
  const [connClients, setConnClients] = useState<ClientOption[]>([])
  const [syncing, setSyncing] = useState<string | null>(null)
  const [syncNotes, setSyncNotes] = useState<Record<string, string>>({})
  const [now, setNow] = useState(() => new Date())
  const [navOpen, setNavOpen] = useState(false)

  const externalIds = useMemo(() => clients.filter(c => c.kind === 'client').map(c => c.id), [clients])
  const allIds = useMemo(() => (connClients.length ? connClients : clients).map(c => c.id), [clients, connClients])
  // Filtros EFETIVOS: o que a tela mostra, o que vai na URL e o que a API recebe (uma única fonte de verdade).
  // Antes de conhecer a lista de clientes vale o pedido normalizado; a API valida e devolve o efetivo.
  const filters = useMemo<IntelFilters>(() => externalIds.length ? effectiveFilters(prefs, externalIds, allIds)
    : normalizeForArea({ area: prefs.area, period: prefs.period, platform: prefs.platform, status: prefs.status, campaign: prefs.campaign, client: prefs.client }),
  [prefs, externalIds, allIds])

  useEffect(() => { const f = filtersFromUrl(); setPrefs(prefsFromFilters(f)); setSearch(f.campaign); setReady(true) }, [])
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t) }, [])
  // Busca com espera curta (uma requisição por pausa de digitação, não por tecla).
  useEffect(() => {
    const value = search.trim().slice(0, 60)
    const t = setTimeout(() => setPrefs(p => p.campaign === value ? p : { ...p, campaign: value }), 350)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!ready) return
    const fk = requestKey(filters)
    setState(prev => beginRequest(prev, filters))
    const url = new URL(window.location.href)
    url.search = ''
    const shown: Record<string, string> = { area: filters.area, client: filters.client, period: filters.period, platform: filters.platform, status: filters.status, campaign: filters.campaign }
    for (const [k, val] of Object.entries(shown)) if (val && val !== 'all') url.searchParams.set(k, val)
    window.history.replaceState(null, '', url.pathname + url.search)
    const params = new URLSearchParams({ area: filters.area, period: filters.period, platform: filters.platform, status: filters.status, campaign: filters.campaign })
    if (filters.client) params.set('client', filters.client)
    const controller = new AbortController()
    fetch('/api/crm/intel?' + params.toString(), { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
      .then(async res => {
        if (res.status === 401) { setState(s => acceptFailure(s, fk, 'unauthorized', 'UNAUTHORIZED')); return }
        const body = await res.json().catch(() => null) as (IntelPayload & { ok?: boolean; error?: string }) | null
        if (!res.ok || !body || !body.ok) { setState(s => acceptFailure(s, fk, 'error', body?.error ?? 'HTTP_' + res.status)); return }
        const payload = { area: body.area, view: body.view } as IntelPayload
        setNow(new Date())
        if (payload.area === 'conexoes') setConnClients(payload.view.clients)
        else if ('clients' in payload.view) setClients(payload.view.clients.filter(c => c.kind === 'client'))
        // A API devolve os filtros EFETIVOS. Se diferirem do pedido (ex.: cliente padrão), a tela adota os da API e
        // busca de novo — nunca exibe um filtro diferente do aplicado.
        const eff = payload.view.meta.filters
        if (requestKey(eff) !== fk) {
          setPrefs(p => ({ ...p, client: eff.area === 'prospeccao' ? p.client : eff.client, lastClient: eff.area === 'cliente' ? eff.client : p.lastClient }))
          return
        }
        setState(s => acceptResponse(s, fk, payload))
      })
      .catch(err => { if ((err as Error).name !== 'AbortError') setState(s => acceptFailure(s, fk, 'error', 'NETWORK')) })
    return () => controller.abort()
  }, [filters, refresh, ready])

  const set = (patch: Partial<IntelFilters>) => setPrefs(p => ({ ...p, ...patch }))
  const openArea = (area: IntelArea) => { setSearch(''); setNavOpen(false); setPrefs(p => navigateArea(p, area)) }
  const openClient = (id: string) => { setSearch(''); setPrefs(p => chooseClient(navigateArea(p, 'cliente'), id, externalIds)) }
  const pickClient = (id: string) => { setSearch(''); setPrefs(p => chooseClient(p, id, externalIds)) }

  async function simulateSync(assetId: string) {
    if (state.data?.area !== 'cliente') return
    const clientId = state.data.view.client.id
    setSyncing(assetId)
    try {
      const res = await fetch('/api/crm/intel', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'simulate_sync', clientId, assetId }) })
      const body = await res.json().catch(() => null) as { run?: { status: string; rows: number; inserted: number; updated: number; unchanged: number }; error?: string; retryAt?: string; reason?: string } | null
      const hhmm = (iso?: string) => iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'
      const note = res.ok && body?.run ? `Simulação concluída (em memória): ${body.run.rows} linhas — ${body.run.inserted} novas, ${body.run.updated} alteradas, ${body.run.unchanged} iguais.`
        : body?.error === 'SYNC_TOO_SOON' ? 'Limite de 1 atualização a cada 15 minutos por conta. Disponível às ' + hhmm(body.retryAt) + '.'
        : body?.error === 'SYNC_NOT_ALLOWED' ? 'Atualização não permitida para esta conta (' + (body.reason ?? 'regra de sincronização') + ').'
        : res.status === 401 ? 'Sessão expirada. Entre novamente.'
        : 'Não foi possível simular a atualização.'
      setSyncNotes(n => ({ ...n, [assetId]: note }))
      setRefresh(r => r + 1)
    } finally { setSyncing(null) }
  }

  const payload = state.data
  const meta = payload?.view.meta
  const showStatus = STATUS_AREAS.includes(filters.area)
  const showSearch = SEARCH_AREAS.includes(filters.area)
  const showClient = CLIENT_AREAS.includes(filters.area)
  const clientChoices = filters.area === 'conexoes' ? (connClients.length ? connClients : clients) : clients

  return <div id="cassiellos-crm" data-crm-root className="mi-root">
    <div className="crm-layout">
      <aside className="crm-sidebar" aria-label="Navegação da Central de Inteligência">
        <div className="crm-brand"><img className="crm-brand-symbol" src="/brand/cassiellos-symbol-signal-red.svg" width={40} height={26} alt="Símbolo oficial Cassiellos"/><div><div className="crm-brand-word">Cassiellos</div><span className="crm-brand-sub">Central de Inteligência</span></div>
          <button type="button" className="mi-nav-toggle" aria-expanded={navOpen} aria-controls="mi-areas" onClick={() => setNavOpen(o => !o)}>
            <span aria-hidden="true">{navOpen ? '✕' : '☰'}</span> {navOpen ? 'Fechar' : 'Áreas'}<span className="mi-nav-current"> · {AREA_SHORT[filters.area]}</span></button>
        </div>
        <nav id="mi-areas" className="crm-nav-wrap mi-nav" data-open={navOpen ? 'true' : 'false'} aria-label="Áreas">
          <div className="crm-nav-label">Inteligência</div>
          {INTEL_AREAS.map(a => <button key={a} type="button" className="crm-nav-btn" data-active={filters.area === a} aria-current={filters.area === a ? 'page' : undefined} onClick={() => openArea(a)}><Svg d={AREA_ICON[a]}/>{AREA_LABEL[a]}</button>)}
          <div className="crm-nav-label crm-nav-label-section">CRM</div>
          <a className="crm-nav-btn mi-nav-link" href="/crm"><Svg d="M15 18l-6-6 6-6"/>Voltar ao CRM</a>
        </nav>
        <div className="crm-sidebar-footer"><div className="mi-sidebar-note"><strong>Fundação · dados simulados</strong><span>Nenhuma conta real conectada. Registros mantidos em memória, sem banco.</span></div>
          <form action="/api/crm/auth/logout" method="POST"><button type="submit" className="crm-logout">Encerrar sessão</button></form></div>
      </aside>

      <main className="crm-main">
        <header className="crm-topbar">
          <div className="crm-breadcrumb"><span>Inteligência</span><span style={{ opacity: .45 }}>/</span><strong>{AREA_LABEL[filters.area]}</strong></div>
          <div className="crm-top-actions"><span className="mi-sim-pill" role="note">DADOS SIMULADOS</span></div>
        </header>
        <div className="crm-content">
          <div className="crm-hero">
            <div><div className="crm-eyebrow">Central de Inteligência de Marketing</div><h1>{AREA_LABEL[filters.area]}.</h1><p className="crm-description">{AREA_DESC[filters.area]}</p></div>
          </div>
          <div className="mi-banner" role="note"><strong>Dados simulados.</strong> {meta?.dataNotice ?? 'Demonstração da fundação: nenhuma conta real foi consultada.'}</div>

          <div className="mi-filters" role="search" aria-label="Filtros">
            <label className="mi-field"><span>Período</span>
              <select value={filters.period} onChange={e => set({ period: e.target.value as PeriodPreset })}>{PERIOD_PRESETS.map(p => <option key={p} value={p}>{PERIOD_LABEL[p]}</option>)}</select></label>
            {showClient && <label className="mi-field"><span>Cliente</span>
              <select value={filters.client} onChange={e => pickClient(e.target.value)} disabled={!clientChoices.length}>
                {filters.area !== 'cliente' && <option value="all">Todos os clientes</option>}
                {filters.area === 'cliente' && !filters.client && <option value="">Carregando…</option>}
                {clientChoices.map(c => <option key={c.id} value={c.id}>{c.name}{c.kind === 'agency' ? ' (agência)' : ''}</option>)}
              </select></label>}
            <div className="mi-field"><span>Plataforma</span><div className="mi-seg" role="group" aria-label="Plataforma">
              {([['all', 'Todas'], ['google_ads', 'Google Ads'], ['meta_ads', 'Meta Ads']] as [PlatformFilter, string][]).map(([k, l]) => <button key={k} type="button" aria-pressed={filters.platform === k} onClick={() => set({ platform: k })}>{l}</button>)}
            </div></div>
            {showStatus && <div className="mi-field"><span>Campanhas (situação atual)</span><div className="mi-seg" role="group" aria-label="Situação atual das campanhas">
              {(['all', 'active', 'paused'] as CampaignStatusFilter[]).map(k => <button key={k} type="button" aria-pressed={filters.status === k} onClick={() => set({ status: k })}>{STATUS_LABEL[k]}</button>)}
            </div></div>}
            {showSearch && <label className="mi-field mi-field-grow"><span>Buscar campanha</span><input type="search" value={search} maxLength={60} placeholder="Nome da campanha" onChange={e => setSearch(e.target.value)}/></label>}
            <button type="button" className="crm-btn mi-refresh" onClick={() => setRefresh(r => r + 1)} disabled={state.status === 'loading'}>Recarregar</button>
          </div>
          {meta && <div className="mi-stamp">Período: <strong>{meta.period.label}</strong> ({meta.period.start.split('-').reverse().join('/')} a {meta.period.end.split('-').reverse().join('/')}{meta.period.includesToday ? ', inclui hoje — dados do dia em consolidação' : ''}) · Fuso de exibição: {meta.reportTimeZone} · cada conta usa o próprio fuso e moeda · Gerado {new Date(meta.generatedAt).toLocaleString('pt-BR', { timeZone: meta.reportTimeZone })}</div>}
          {meta?.campaignScope.active && <div className="mi-scope" role="status">
            <strong>Recorte de campanhas ativo:</strong> {meta.campaignScope.status !== 'all' ? 'campanhas ' + STATUS_LABEL[meta.campaignScope.status].toLowerCase() + ' hoje' : ''}{meta.campaignScope.status !== 'all' && meta.campaignScope.search ? ' · ' : ''}{meta.campaignScope.search ? 'busca "' + meta.campaignScope.search + '"' : ''}.
            {' '}Investimento, impressões, cliques, taxas, conversões, gráficos, comparações e contagens consideram só essas campanhas. A situação é a <em>atual</em>: uma campanha pausada hoje pode ter investimento em dias anteriores do período.
            {' '}Não mudam com este recorte: clientes cadastrados, situação das contas e alertas.
            {' '}<button type="button" className="mi-link" onClick={() => { setSearch(''); set({ status: 'all', campaign: '' }) }}>Limpar recorte</button>
          </div>}

          <div aria-live="polite" aria-busy={state.status === 'loading'}>
            {state.status === 'unauthorized' && <StateMessage kind="unauthorized">Sua sessão expirou. <a href="/crm/login?next=%2Fcrm%2Finteligencia">Entrar novamente.</a></StateMessage>}
            {state.status === 'error' && <StateMessage kind="error">Não foi possível carregar a Central ({state.error}). <button type="button" className="mi-link" onClick={() => setRefresh(r => r + 1)}>Tentar novamente</button></StateMessage>}
            {state.status === 'loading' && !payload && <StateMessage kind="loading">Carregando dados simulados…</StateMessage>}
            {payload && state.status !== 'unauthorized' && <div className="mi-area" data-loading={state.status === 'loading' ? 'true' : undefined} key={payload.area + (payload.area === 'cliente' ? payload.view.client.id : '')}>
              {payload.area === 'prospeccao' && <ProspectingArea v={payload.view} now={now}/>}
              {payload.area === 'agencia' && <OverviewArea v={payload.view} now={now} openClient={openClient}/>}
              {payload.area === 'cliente' && <ClientArea v={payload.view} now={now} onSync={simulateSync} syncing={syncing} syncNotes={syncNotes}/>}
              {payload.area === 'conexoes' && <ConnectionsArea v={payload.view} now={now}/>}
            </div>}
          </div>
        </div>
      </main>
    </div>
  </div>
}
