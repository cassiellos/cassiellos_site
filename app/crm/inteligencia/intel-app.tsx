'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import '../crm.css'
import './inteligencia.css'
import {
  EMPTY_CLIENT_LISTS, absorbClientLists, acceptFailure, acceptResponse, adoptEffectiveFilters, beginRequest, chooseClient, initialState, navigateArea,
  prefsFromFilters, requestKey, resolveFilters,
  type ClientLists, type FetchState, type FilterPrefs,
} from '@/lib/crm/intel/client-state'
import { PERIOD_LABEL, PERIOD_PRESETS, type PeriodPreset } from '@/lib/crm/intel/dates'
import { CLIENT_AREAS, SEARCH_AREAS, STATUS_AREAS } from '@/lib/crm/intel/filters'
import { type CampaignStatusFilter, type IntelArea, type IntelFilters, type IntelPayload, type PlatformFilter } from '@/lib/crm/intel/view-types'
import { ClientArea, ConnectionsArea, OverviewArea, ProspectingArea } from './intel-areas'
import { ClientAdmin, ConnectionsAdmin, errorText, type Act, type AdminBlock } from './intel-admin'
import { DataModeContext, StateMessage } from './intel-ui'

const STATUS_LABEL: Record<CampaignStatusFilter, string> = { all: 'Todas', active: 'Ativas', paused: 'Pausadas' }

/** Resposta carregada: payload da área (null no modo real sem cliente/agência), modo e bloco administrativo (modo real). */
type Loaded = { area: IntelArea; payload: IntelPayload | null; mode: 'demo' | 'real'; admin: AdminBlock | null; needsAgency: boolean }

const DEFAULT: IntelFilters = { area: 'agencia', period: '30d', platform: 'all', status: 'all', client: 'all', campaign: '' }

function filtersFromUrl(area: IntelArea): IntelFilters {
  if (typeof window === 'undefined') return DEFAULT
  const p = new URLSearchParams(window.location.search)
  const period = (PERIOD_PRESETS as readonly string[]).includes(p.get('period') ?? '') ? p.get('period') as PeriodPreset : DEFAULT.period
  const platform = (['all', 'google_ads', 'meta_ads'] as const).find(x => x === p.get('platform')) ?? 'all'
  const status = (['all', 'active', 'paused'] as const).find(x => x === p.get('status')) ?? 'all'
  const client = /^[a-z0-9_-]{3,64}$/.test(p.get('client') ?? '') ? p.get('client') as string : area === 'cliente' ? '' : 'all'
  const campaign = (p.get('campaign') ?? '').slice(0, 60)
  return { area, period, platform, status, client, campaign }
}

export default function IntelApp({ embeddedArea, onNavigateArea }: { embeddedArea: IntelArea; onNavigateArea: (area: IntelArea) => void }) {
  const [prefs, setPrefs] = useState<FilterPrefs>(() => prefsFromFilters(DEFAULT))
  const [ready, setReady] = useState(false)
  const [state, setState] = useState<FetchState<Loaded>>(initialState)
  const [refresh, setRefresh] = useState(0)
  const [search, setSearch] = useState('')
  // Listas de clientes: só mudam de referência quando o CONTEÚDO muda (N1: ver lib/crm/intel/client-state.ts).
  const [lists, setLists] = useState<ClientLists>(EMPTY_CLIENT_LISTS)
  const { clients, connClients } = lists
  const [syncing, setSyncing] = useState<string | null>(null)
  const [syncNotes, setSyncNotes] = useState<Record<string, string>>({})
  const [now, setNow] = useState(() => new Date())
  const [oauthResult, setOauthResult] = useState<'ok' | 'erro' | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const lastArea = useRef(embeddedArea)

  const externalIds = useMemo(() => clients.filter(c => c.kind === 'client').map(c => c.id), [clients])
  // Filtros EFETIVOS: o que a tela mostra, o que vai na URL e o que a API recebe (uma única fonte de verdade).
  // Antes de conhecer a lista de clientes vale o pedido normalizado; a API valida e devolve o efetivo.
  const filters = useMemo<IntelFilters>(() => resolveFilters(prefs, lists), [prefs, lists])
  // Identidade SEMÂNTICA dos filtros: é ela — e não a referência do objeto — que dispara uma nova busca.
  const filterKey = requestKey(filters)

  useEffect(() => {
    const f = filtersFromUrl(embeddedArea); setPrefs(prefsFromFilters(f)); setSearch(f.campaign); setReady(true)
    const o = new URLSearchParams(window.location.search).get('oauth')
    if (o === 'ok' || o === 'erro') setOauthResult(o)
  }, [])
  // A área ativa é comandada pelo menu do CRM; os filtros sobrevivem à troca entre áreas.
  useEffect(() => {
    if (!ready || lastArea.current === embeddedArea) return
    lastArea.current = embeddedArea
    setSearch('')
    setPrefs(p => navigateArea(p, embeddedArea))
  }, [embeddedArea, ready])
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 30_000); return () => clearInterval(t) }, [])
  // Busca com espera curta (uma requisição por pausa de digitação, não por tecla).
  useEffect(() => {
    const value = search.trim().slice(0, 60)
    const t = setTimeout(() => setPrefs(p => p.campaign === value ? p : { ...p, campaign: value }), 350)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    if (!ready) return
    const fk = filterKey // a busca depende só da chave semântica; `filters` desta renderização tem exatamente essa chave
    setState(prev => beginRequest(prev, filters))
    const url = new URL(window.location.href)
    url.search = ''
    url.searchParams.set('view', `intel-${filters.area}`)
    const shown: Record<string, string> = { area: filters.area, client: filters.client, period: filters.period, platform: filters.platform, status: filters.status, campaign: filters.campaign }
    for (const [k, val] of Object.entries(shown)) if (val && val !== 'all') url.searchParams.set(k, val)
    window.history.replaceState(null, '', url.pathname + url.search)
    const params = new URLSearchParams({ area: filters.area, period: filters.period, platform: filters.platform, status: filters.status, campaign: filters.campaign })
    if (filters.client) params.set('client', filters.client)
    const controller = new AbortController()
    fetch('/api/crm/intel?' + params.toString(), { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
      .then(async res => {
        if (res.status === 401) { setState(s => acceptFailure(s, fk, 'unauthorized', 'UNAUTHORIZED')); return }
        const body = await res.json().catch(() => null) as (IntelPayload & { ok?: boolean; error?: string; mode?: 'real'; admin?: AdminBlock; needsAgency?: boolean }) | null
        if (!res.ok || !body || !body.ok) { setState(s => acceptFailure(s, fk, 'error', body?.error ?? 'HTTP_' + res.status)); return }
        // Pedido substituído (outra seleção) enquanto a resposta chegava: descarta tudo — nada da resposta antiga é aplicado.
        if (controller.signal.aborted) return
        const mode = body.mode === 'real' ? 'real' : 'demo'
        if (body.view === null) {
          // Modo real sem cliente (área Cliente) ou sem agência (Prospecção): só o cadastro, nenhum número.
          setNow(new Date())
          setState(s => acceptResponse(s, fk, { area: body.area, payload: null, mode, admin: body.admin ?? null, needsAgency: !!body.needsAgency }))
          return
        }
        const payload = { area: body.area, view: body.view } as IntelPayload
        setNow(new Date())
        setLists(prev => absorbClientLists(prev, payload.area, 'clients' in payload.view ? payload.view.clients : undefined))
        // A API devolve os filtros EFETIVOS. Se o CLIENTE efetivo diferir do pedido (ex.: cliente padrão da área Cliente), a
        // tela o adota e busca uma única vez mais (normalização que se estabiliza: o novo pedido já coincide com o efetivo).
        // Qualquer outra divergência não é adotável pelas preferências: a resposta é aceita como está (nunca laço nem
        // carregamento eterno).
        const eff = payload.view.meta.filters
        if (requestKey(eff) !== fk && eff.client !== filters.client) {
          setPrefs(p => adoptEffectiveFilters(p, eff))
          return
        }
        setState(s => acceptResponse(s, fk, { area: payload.area, payload, mode, admin: body.admin ?? null, needsAgency: false }))
      })
      .catch(err => { if ((err as Error).name !== 'AbortError' && !controller.signal.aborted) setState(s => acceptFailure(s, fk, 'error', 'NETWORK')) })
    return () => controller.abort()
    // Dependência intencional: a CHAVE semântica dos filtros (string), nunca a referência do objeto `filters` (ver N1).
  }, [filterKey, refresh, ready])

  const set = (patch: Partial<IntelFilters>) => setPrefs(p => ({ ...p, ...patch }))
  const openClient = (id: string) => { setSearch(''); setPrefs(p => chooseClient(navigateArea(p, 'cliente'), id, externalIds)); onNavigateArea('cliente') }
  const pickClient = (id: string) => { setSearch(''); setPrefs(p => chooseClient(p, id, externalIds)) }

  const act: Act = async (action, extra = {}) => {
    const res = await fetch('/api/crm/intel', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...extra }) })
    const body = await res.json().catch(() => null) as Record<string, unknown> | null
    return { ok: res.ok && !!body?.ok, status: res.status, body }
  }
  const reload = () => setRefresh(r => r + 1)

  async function simulateSync(assetId: string) {
    if (state.data?.payload?.area !== 'cliente') return
    const clientId = state.data.payload.view.client.id
    const real = state.data.mode === 'real'
    setSyncing(assetId)
    try {
      const res = await fetch('/api/crm/intel', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: real ? 'sync_now' : 'simulate_sync', clientId, assetId }) })
      const body = await res.json().catch(() => null) as { run?: { status: string; rows: number; inserted: number; updated: number; unchanged: number }; error?: string; retryAt?: string; reason?: string } | null
      const hhmm = (iso?: string) => iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—'
      const note = res.ok && body?.run && real ? (body.run.status === 'succeeded' ? `Sincronização concluída: ${body.run.rows} linhas — ${body.run.inserted} novas, ${body.run.updated} alteradas, ${body.run.unchanged} iguais.` : 'Sincronização terminou com erro. Veja o registro em Conexões e integrações.')
        : res.ok && body?.run ? `Simulação concluída (em memória): ${body.run.rows} linhas — ${body.run.inserted} novas, ${body.run.updated} alteradas, ${body.run.unchanged} iguais.`
        : real && body?.error && body.error !== 'SYNC_TOO_SOON' ? errorText(body.error)
        : body?.error === 'SYNC_TOO_SOON' ? 'Limite de 1 atualização a cada 15 minutos por conta. Disponível às ' + hhmm(body.retryAt) + '.'
        : body?.error === 'SYNC_NOT_ALLOWED' ? 'Atualização não permitida para esta conta (' + (body.reason ?? 'regra de sincronização') + ').'
        : res.status === 401 ? 'Sessão expirada. Entre novamente.'
        : 'Não foi possível simular a atualização.'
      setSyncNotes(n => ({ ...n, [assetId]: note }))
      setRefresh(r => r + 1)
    } finally { setSyncing(null) }
  }

  const loaded = state.data
  const payload = loaded?.payload ?? null
  // Modo e bloco administrativo da última resposta: o painel de cadastro permanece montado enquanto a área recarrega
  // (mensagens de confirmação e formulários não somem a cada atualização).
  const lastAdmin = useRef<{ mode: 'demo' | 'real'; admin: AdminBlock | null; area: IntelArea } | null>(null)
  if (loaded) lastAdmin.current = { mode: loaded.mode, admin: loaded.admin, area: loaded.area }
  const mode = loaded?.mode ?? lastAdmin.current?.mode ?? 'demo'
  const admin = loaded?.admin ?? (lastAdmin.current?.area === filters.area ? lastAdmin.current.admin : null)
  const meta = payload?.view.meta
  const showStatus = STATUS_AREAS.includes(filters.area)
  const showSearch = SEARCH_AREAS.includes(filters.area)
  const showClient = CLIENT_AREAS.includes(filters.area)
  const clientChoices = filters.area === 'conexoes' ? (connClients.length ? connClients : clients) : clients

  // Renderiza dentro da área de conteúdo do CRM: sem segunda barra lateral, topbar ou login.
  return <div className="mi-root mi-embedded">
          {mode === 'demo' && <div className="mi-banner" role="note"><strong>Dados simulados.</strong> {meta?.dataNotice ?? 'Demonstração da fundação: nenhuma conta real foi consultada.'}</div>}
          {mode === 'real' && (meta?.hasImportedData
            ? <div className="mi-banner mi-banner-real" role="note"><span className="mi-real-pill">DADOS REAIS</span> {meta.dataNotice} Última importação: <strong>{new Date(meta.lastImportAt!).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</strong>.</div>
            : <div className="mi-banner mi-banner-wait" role="note"><strong>Modo real · aguardando dados.</strong> Nenhum número é exibido até a primeira importação de uma conta autorizada e confirmada para os clientes desta visão.</div>)}
          {banner && <div className="mi-callout mi-err" role="status">{banner}</div>}

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
            {state.status === 'unauthorized' && <StateMessage kind="unauthorized">Sua sessão expirou. <a href={"/crm/login?next=" + encodeURIComponent("/crm?view=intel-" + filters.area)}>Entrar novamente.</a></StateMessage>}
            {state.status === 'error' && <StateMessage kind="error">Não foi possível carregar a Central ({state.error}). <button type="button" className="mi-link" onClick={() => setRefresh(r => r + 1)}>Tentar novamente</button></StateMessage>}
            {state.status === 'loading' && !loaded && <StateMessage kind="loading">{mode === 'real' ? 'Carregando…' : 'Carregando dados simulados…'}</StateMessage>}
            {loaded && !payload && state.status !== 'unauthorized' && <div className="mi-area" data-loading={state.status === 'loading' ? 'true' : undefined}>
              {loaded.needsAgency && <StateMessage kind="empty">A área Prospecção Cassiellos usa a própria agência como cliente interno. <button type="button" className="mi-link" onClick={() => void act('ensure_agency').then(r => { if (r.ok) reload(); else setBanner(errorText(r.body?.error)) })}>Ativar Prospecção Cassiellos</button></StateMessage>}
              {loaded.area === 'cliente' && <StateMessage kind="empty">Nenhum cliente monitorado cadastrado. Cadastre abaixo — nenhum número é exibido para clientes sem conta conectada.</StateMessage>}
            </div>}
            {payload && state.status !== 'unauthorized' && <DataModeContext.Provider value={mode}><div className="mi-area" data-loading={state.status === 'loading' ? 'true' : undefined} key={payload.area + (payload.area === 'cliente' ? payload.view.client.id : '')}>
              {payload.area === 'prospeccao' && <ProspectingArea v={payload.view} now={now}/>}
              {payload.area === 'agencia' && <OverviewArea v={payload.view} now={now} openClient={openClient}/>}
              {payload.area === 'cliente' && <ClientArea v={payload.view} now={now} onSync={simulateSync} syncing={syncing} syncNotes={syncNotes}/>}
              {payload.area === 'conexoes' && <ConnectionsArea v={payload.view} now={now}/>}
            </div></DataModeContext.Provider>}
            {mode === 'real' && admin && state.status !== 'unauthorized' && <DataModeContext.Provider value={mode}><div className="mi-admin">
              {filters.area === 'cliente' && <ClientAdmin admin={admin} selectedClientId={payload?.area === 'cliente' ? payload.view.client.id : filters.client || null} act={act} onChanged={reload} onSelect={pickClient}/>}
              {filters.area === 'conexoes' && <ConnectionsAdmin admin={admin} act={act} onChanged={reload} oauthResult={oauthResult}/>}
            </div></DataModeContext.Provider>}
          </div>
  </div>
}