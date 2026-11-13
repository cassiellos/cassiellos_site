'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import '../crm.css'
import './inteligencia.css'
import { acceptFailure, acceptResponse, beginRequest, initialState, requestKey, type FetchState } from '@/lib/crm/intel/client-state'
import { PERIOD_LABEL, PERIOD_PRESETS, type PeriodPreset } from '@/lib/crm/intel/dates'
import { INTEL_AREAS, type CampaignStatusFilter, type ClientOption, type IntelArea, type IntelFilters, type IntelPayload, type PlatformFilter } from '@/lib/crm/intel/view-types'
import { ClientArea, ConnectionsArea, OverviewArea, ProspectingArea } from './intel-areas'
import { StateMessage } from './intel-ui'

const AREA_LABEL: Record<IntelArea, string> = { prospeccao: 'Prospecção Cassiellos', agencia: 'Visão geral da agência', cliente: 'Visão do cliente', conexoes: 'Conexões e integrações' }
const AREA_DESC: Record<IntelArea, string> = {
  prospeccao: 'Campanhas de aquisição da própria agência: investimento, leads, reuniões e custo por resultado.',
  agencia: 'Todos os clientes monitorados: investimento, eficiência, conversões por origem, atualização e alertas.',
  cliente: 'Desempenho de um cliente por vez, com todas as contas e propriedades confirmadas dele.',
  conexoes: 'Situação das autorizações, vínculos de contas, sincronizações e ações administrativas previstas.',
}
const AREA_ICON: Record<IntelArea, string> = { prospeccao: 'M3 12h4l3-7 4 14 3-7h4', agencia: 'M3 3v18h18M7 16l5-5 4 3 5-7', cliente: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8', conexoes: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7' }

const DEFAULT: IntelFilters = { area: 'agencia', period: '30d', platform: 'all', status: 'all', client: 'all', campaign: '' }

function filtersFromUrl(): IntelFilters {
  if (typeof window === 'undefined') return DEFAULT
  const p = new URLSearchParams(window.location.search)
  const area = (INTEL_AREAS as readonly string[]).includes(p.get('area') ?? '') ? p.get('area') as IntelArea : DEFAULT.area
  const period = (PERIOD_PRESETS as readonly string[]).includes(p.get('period') ?? '') ? p.get('period') as PeriodPreset : DEFAULT.period
  const platform = (['all', 'google_ads', 'meta_ads'] as const).find(x => x === p.get('platform')) ?? 'all'
  const status = (['all', 'active', 'paused'] as const).find(x => x === p.get('status')) ?? 'all'
  const client = /^[a-z0-9_]{3,64}$/.test(p.get('client') ?? '') ? p.get('client') as string : area === 'cliente' ? '' : 'all'
  return { area, period, platform, status, client, campaign: '' }
}

function Svg({ d }: { d: string }) {
  return <svg aria-hidden="true" width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={d}/></svg>
}

export default function IntelApp() {
  const [filters, setFilters] = useState<IntelFilters>(DEFAULT)
  const [ready, setReady] = useState(false)
  const [state, setState] = useState<FetchState<IntelPayload>>(initialState)
  const [refresh, setRefresh] = useState(0)
  const [search, setSearch] = useState('')
  const [clients, setClients] = useState<ClientOption[]>([])
  const [connClients, setConnClients] = useState<ClientOption[]>([])
  const [syncing, setSyncing] = useState<string | null>(null)
  const [syncNotes, setSyncNotes] = useState<Record<string, string>>({})
  const [now, setNow] = useState(() => new Date())
  const keyRef = useRef('')

  useEffect(() => { setFilters(filtersFromUrl()); setReady(true) }, [])
  // Busca de campanha com espera curta (evita uma requisição por tecla).
  useEffect(() => { const t = setTimeout(() => setFilters(f => f.campaign === search.trim() ? f : { ...f, campaign: search.trim().slice(0, 60) }), 350); return () => clearTimeout(t) }, [search])

  useEffect(() => {
    if (!ready) return
    const key = requestKey(filters)
    keyRef.current = key
    setState(prev => beginRequest(prev, filters))
    const url = new URL(window.location.href)
    url.search = ''
    for (const [k, val] of Object.entries({ area: filters.area, client: filters.client, period: filters.period, platform: filters.platform, status: filters.status })) if (val && val !== 'all') url.searchParams.set(k, val)
    window.history.replaceState(null, '', url.pathname + url.search)
    const params = new URLSearchParams({ area: filters.area, period: filters.period, platform: filters.platform, status: filters.status, client: filters.client, campaign: filters.campaign })
    if (!filters.client) params.delete('client')
    const controller = new AbortController()
    fetch('/api/crm/intel?' + params.toString(), { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
      .then(async res => {
        if (res.status === 401) { setState(s => acceptFailure(s, key, 'unauthorized', 'UNAUTHORIZED')); return }
        const body = await res.json().catch(() => null) as (IntelPayload & { ok?: boolean; error?: string }) | null
        if (!res.ok || !body || !body.ok) { setState(s => acceptFailure(s, key, 'error', body?.error ?? 'HTTP_' + res.status)); return }
        const payload = { area: body.area, view: body.view } as IntelPayload
        if (payload.area === 'cliente' && payload.view.client.id !== filters.client && filters.client) { setState(s => acceptFailure(s, key, 'error', 'MISMATCH')); return }
        setNow(new Date())
        if (payload.area === 'conexoes') setConnClients(payload.view.clients)
        else if ('clients' in payload.view) setClients(payload.view.clients.filter(c => c.kind === 'client'))
        if (payload.area === 'cliente' && !filters.client) setFilters(f => ({ ...f, client: payload.view.client.id }))
        setState(s => acceptResponse(s, key, payload))
      })
      .catch(err => { if ((err as Error).name !== 'AbortError') setState(s => acceptFailure(s, key, 'error', 'NETWORK')) })
    return () => controller.abort()
  }, [filters, refresh, ready])

  const set = (patch: Partial<IntelFilters>) => setFilters(f => ({ ...f, ...patch }))
  const openArea = (area: IntelArea) => { setSearch(''); setFilters(f => ({ ...f, area, campaign: '', client: area === 'cliente' ? (f.client !== 'all' && clients.some(c => c.id === f.client) ? f.client : clients[0]?.id ?? '') : area === 'prospeccao' ? 'all' : 'all' })) }
  const openClient = (id: string) => { setSearch(''); setFilters(f => ({ ...f, area: 'cliente', client: id, campaign: '' })) }

  async function simulateSync(assetId: string) {
    setSyncing(assetId)
    try {
      const res = await fetch('/api/crm/intel', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'simulate_sync', assetId }) })
      const body = await res.json().catch(() => null) as { run?: { status: string; rows: number; inserted: number; updated: number; unchanged: number }; error?: string; retryAt?: string } | null
      const note = res.ok && body?.run ? `Simulação concluída: ${body.run.rows} linhas (${body.run.inserted} novas, ${body.run.updated} alteradas, ${body.run.unchanged} iguais)`
        : body?.error === 'SYNC_TOO_SOON' ? 'Aguarde: nova atualização permitida às ' + new Date(body.retryAt ?? '').toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : 'Não foi possível simular a atualização.'
      setSyncNotes(n => ({ ...n, [assetId]: note }))
      if (res.ok) setRefresh(r => r + 1)
    } finally { setSyncing(null) }
  }

  const payload = state.data
  const showStatus = filters.area !== 'conexoes'
  const showSearch = filters.area === 'cliente' || filters.area === 'prospeccao'
  const clientChoices = useMemo(() => clients.filter(c => c.kind === 'client'), [clients])
  const meta = payload?.view.meta

  return <div id="cassiellos-crm" data-crm-root className="mi-root">
    <div className="crm-layout">
      <aside className="crm-sidebar" aria-label="Navegação da Central de Inteligência">
        <div className="crm-brand"><img className="crm-brand-symbol" src="/brand/cassiellos-symbol-signal-red.svg" width={40} height={26} alt="Símbolo oficial Cassiellos"/><div><div className="crm-brand-word">Cassiellos</div><span className="crm-brand-sub">Central de Inteligência</span></div></div>
        <nav className="crm-nav-wrap" aria-label="Áreas">
          <div className="crm-nav-label">Inteligência</div>
          {INTEL_AREAS.map(a => <button key={a} type="button" className="crm-nav-btn" data-active={filters.area === a} aria-current={filters.area === a ? 'page' : undefined} onClick={() => openArea(a)}><Svg d={AREA_ICON[a]}/>{AREA_LABEL[a]}</button>)}
          <div className="crm-nav-label crm-nav-label-section">CRM</div>
          <a className="crm-nav-btn mi-nav-link" href="/crm"><Svg d="M15 18l-6-6 6-6"/>Voltar ao CRM</a>
        </nav>
        <div className="crm-sidebar-footer"><div className="mi-sidebar-note"><strong>Fundação · dados simulados</strong><span>Nenhuma conta real conectada. Nada é gravado no banco.</span></div>
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
            {(filters.area === 'agencia' || filters.area === 'cliente' || filters.area === 'conexoes') && <label className="mi-field"><span>Cliente</span>
              <select value={filters.client} onChange={e => set({ client: e.target.value })} disabled={!(filters.area === 'conexoes' ? connClients : clients).length}>
                {filters.area !== 'cliente' && <option value="all">Todos os clientes</option>}
                {filters.area === 'cliente' && !filters.client && <option value="">Carregando…</option>}
                {(filters.area === 'conexoes' ? connClients : clientChoices).map(c => <option key={c.id} value={c.id}>{c.name}{c.kind === 'agency' ? ' (agência)' : ''}</option>)}
              </select></label>}
            <div className="mi-field"><span>Plataforma</span><div className="mi-seg" role="group" aria-label="Plataforma">
              {([['all', 'Todas'], ['google_ads', 'Google Ads'], ['meta_ads', 'Meta Ads']] as [PlatformFilter, string][]).map(([k, l]) => <button key={k} type="button" aria-pressed={filters.platform === k} onClick={() => set({ platform: k })}>{l}</button>)}
            </div></div>
            {showStatus && <div className="mi-field"><span>Campanhas</span><div className="mi-seg" role="group" aria-label="Situação das campanhas">
              {([['all', 'Todas'], ['active', 'Ativas'], ['paused', 'Pausadas']] as [CampaignStatusFilter, string][]).map(([k, l]) => <button key={k} type="button" aria-pressed={filters.status === k} onClick={() => set({ status: k })}>{l}</button>)}
            </div></div>}
            {showSearch && <label className="mi-field mi-field-grow"><span>Buscar campanha</span><input type="search" value={search} maxLength={60} placeholder="Nome da campanha" onChange={e => setSearch(e.target.value)}/></label>}
            <button type="button" className="crm-btn mi-refresh" onClick={() => setRefresh(r => r + 1)} disabled={state.status === 'loading'}>Atualizar</button>
          </div>
          {meta && <div className="mi-stamp">Período: <strong>{meta.period.label}</strong> ({meta.period.start.split('-').reverse().join('/')} a {meta.period.end.split('-').reverse().join('/')}{meta.period.includesToday ? ', inclui hoje — dados do dia em consolidação' : ''}) · Fuso de exibição: {meta.reportTimeZone} · cada conta usa o próprio fuso e moeda · Gerado {new Date(meta.generatedAt).toLocaleString('pt-BR', { timeZone: meta.reportTimeZone })}</div>}

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
