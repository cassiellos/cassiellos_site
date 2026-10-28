'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import './crm.css'

type View = 'dashboard' | 'leads' | 'agenda' | 'funil' | 'conversoes' | 'relatorios' | 'configuracoes'
type Lead = { id: string; company: string; contact: string; origin: string; status: string; date: string; amount: string; initials: string }

const initialLeads: Lead[] = [
  { id: '01', company: 'Empresa Exemplo A', contact: 'Contato ilustrativo 01', origin: 'Meta Ads', status: 'Agendado', date: '28 out, 14:30', amount: 'R$ 3.500', initials: 'EA' },
  { id: '02', company: 'Empresa Exemplo B', contact: 'Contato ilustrativo 02', origin: 'Instagram', status: 'Qualificado', date: '28 out, 11:45', amount: 'R$ 2.800', initials: 'EB' },
  { id: '03', company: 'Empresa Exemplo C', contact: 'Contato ilustrativo 03', origin: 'Site', status: 'Novo', date: '27 out, 17:10', amount: 'R$ 4.000', initials: 'EC' },
  { id: '04', company: 'Empresa Exemplo D', contact: 'Contato ilustrativo 04', origin: 'Indicação', status: 'Cliente', date: '27 out, 09:20', amount: 'R$ 5.200', initials: 'ED' },
  { id: '05', company: 'Empresa Exemplo E', contact: 'Contato ilustrativo 05', origin: 'Meta Ads', status: 'Novo', date: '26 out, 16:15', amount: 'R$ 2.500', initials: 'EE' },
]

const navigation: { id: View; label: string; icon: string; count?: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { id: 'leads', label: 'Leads', icon: 'users', count: '124' },
  { id: 'agenda', label: 'Agenda', icon: 'calendar', count: '18' },
  { id: 'funil', label: 'Funil comercial', icon: 'funnel' },
  { id: 'conversoes', label: 'Conversões Meta', icon: 'target' },
  { id: 'relatorios', label: 'Relatórios', icon: 'chart' },
  { id: 'configuracoes', label: 'Configurações', icon: 'settings' },
]

const funnel = [
  { label: 'Novos leads', value: 124, width: 100 },
  { label: 'Qualificados', value: 72, width: 58 },
  { label: 'Agendados', value: 18, width: 23 },
  { label: 'Contratos', value: 4, width: 9 },
]

const meetings = [
  { hour: '09:00', day: '29', month: 'OUT', title: 'Diagnóstico comercial', with: 'Empresa Exemplo A', type: 'Confirmado' },
  { hour: '11:30', day: '29', month: 'OUT', title: 'Reunião estratégica', with: 'Empresa Exemplo B', type: 'Pendente' },
  { hour: '15:00', day: '30', month: 'OUT', title: 'Apresentação de proposta', with: 'Empresa Exemplo C', type: 'Confirmado' },
  { hour: '10:00', day: '31', month: 'OUT', title: 'Follow-up', with: 'Empresa Exemplo E', type: 'Pendente' },
]

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const shapes: Record<string, ReactNode> = {
    grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></>,
    funnel: <><path d="M4 4h16l-6.5 7.7V19l-3 2v-9.3L4 4Z"/></>,
    target: <><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></>,
    chart: <><path d="M3 3v18h18"/><path d="m7 16 5-5 4 3 5-7"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a2 2 0 0 0 .4 2.2l-2 2a2 2 0 0 0-2.2-.4 2 2 0 0 0-1.2 1.8h-2.8A2 2 0 0 0 10.4 19a2 2 0 0 0-2.2.4l-2-2a2 2 0 0 0 .4-2.2 2 2 0 0 0-1.8-1.2v-2.8A2 2 0 0 0 6.6 10a2 2 0 0 0-.4-2.2l2-2a2 2 0 0 0 2.2.4A2 2 0 0 0 11.6 4h2.8a2 2 0 0 0 1.2 2.2 2 2 0 0 0 2.2-.4l2 2a2 2 0 0 0-.4 2.2 2 2 0 0 0 1.8 1.2V14a2 2 0 0 0-1.8 1Z"/></>,
    search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    arrow: <path d="M7 17 17 7M9 7h8v8"/>,
    down: <path d="m6 9 6 6 6-6"/>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    pulse: <><path d="M3 12h4l3-7 4 14 3-7h4"/></>,
    shield: <><path d="m12 22 8-5V5l-8-3-8 3v12l8 5Z"/><path d="m9 12 2 2 4-4"/></>,
    close: <path d="M18 6 6 18M6 6l12 12"/>,
    briefcase: <><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/></>,
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{shapes[name] || shapes.grid}</svg>
}

function Chart({ period }: { period: '7d' | '30d' }) {
  const values = period === '7d' ? [12, 19, 16, 29, 23, 34, 43] : [8, 12, 15, 11, 20, 18, 24, 20, 32, 29, 35, 42]
  const max = 50
  const points = values.map((value, i) => [26 + (700 * i) / (values.length - 1), 210 - (value / max) * 178])
  const line = points.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ')
  const area = line + ' L 726 210 L 26 210 Z'
  const labels = period === '7d' ? ['Qui', 'Sex', 'Sáb', 'Dom', 'Seg', 'Ter', 'Qua'] : ['1 out', '5 out', '10 out', '15 out', '20 out', '25 out', '28 out']
  return <>
    <svg className="crm-graph" viewBox="0 0 752 239" role="img" aria-label="Gráfico ilustrativo de evolução de leads">
      <defs><linearGradient id="crm-chart-gradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f13c4b" stopOpacity=".32"/><stop offset="100%" stopColor="#f13c4b" stopOpacity="0"/></linearGradient></defs>
      {[32,76,121,166,210].map((y, i) => <g key={y}><line x1="26" y1={y} x2="726" y2={y} stroke="#334058" strokeOpacity=".47" strokeDasharray="4 6"/><text x="5" y={y + 4} fontSize="11" fill="#8195ac">{50 - i * 12}</text></g>)}
      <path d={area} fill="url(#crm-chart-gradient)"/>
      <path d={line} fill="none" stroke="#f13c4b" strokeWidth="3.5" strokeLinejoin="round" strokeLinecap="round"/>
      {points.map((p, i) => i === points.length - 1 ? <g key={i}><circle cx={p[0]} cy={p[1]} r="8" fill="#f13c4b" fillOpacity=".2"/><circle cx={p[0]} cy={p[1]} r="4" fill="#f13c4b" stroke="#ffd4d8" strokeWidth="1.4"/></g> : null)}
    </svg>
    <div className="crm-graph-labels">{labels.map(label => <span key={label}>{label}</span>)}</div>
    <div className="crm-graph-legend"><span><i/>Leads recebidos</span><span><i style={{ background: '#22c7f2' }}/>Período ilustrativo</span></div>
  </>
}

function Status({ name }: { name: string }) { return <span className="crm-status" data-status={name}>{name}</span> }

function LeadTable({ leads, limit }: { leads: Lead[]; limit?: number }) {
  const displayed = typeof limit === 'number' ? leads.slice(0, limit) : leads
  if (!displayed.length) return <div className="crm-empty">Nenhum lead demonstrativo encontrado para essa busca.</div>
  return <div className="crm-table-wrap"><table>
    <thead><tr><th>Empresa / contato</th><th>Origem</th><th>Status</th><th>Valor potencial</th><th>Entrada</th></tr></thead>
    <tbody>{displayed.map(lead => <tr key={lead.id}><td><div className="crm-company"><span className="crm-company-logo">{lead.initials}</span><span>{lead.company}<span style={{ display: 'block', fontSize: 10, fontWeight: 400, marginTop: 3, color: '#8397b0' }}>{lead.contact}</span></span></div></td><td>{lead.origin}</td><td><Status name={lead.status}/></td><td style={{ color: '#ebf1fb' }}>{lead.amount}</td><td>{lead.date}</td></tr>)}</tbody>
  </table></div>
}

const sectionNames: Record<View, string> = {
  dashboard: 'Dashboard', leads: 'Gestão de leads', agenda: 'Agenda de reuniões', funil: 'Funil comercial', conversoes: 'Conversões Meta', relatorios: 'Relatórios', configuracoes: 'Configurações',
}

export default function MiniCrm() {
  const [view, setView] = useState<View>('dashboard')
  const [period, setPeriod] = useState<'7d' | '30d'>('7d')
  const [search, setSearch] = useState('')
  const [leads, setLeads] = useState<Lead[]>(initialLeads)
  const [modal, setModal] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)
  const newLeadButtonRef = useRef<HTMLButtonElement>(null)

  // Mantém o teclado dentro da janela e devolve o foco ao botão após fechar.
  useEffect(() => {
    if (!modal) return
    const oldOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onDialogKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setModal(false)
        return
      }
      if (event.key !== 'Tab') return

      const focusables = Array.from(
        modalRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      )
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (!first || !last) return
      if (event.shiftKey && (document.activeElement === first || !modalRef.current?.contains(document.activeElement))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (document.activeElement === last || !modalRef.current?.contains(document.activeElement))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onDialogKeyDown)
    return () => {
      document.removeEventListener('keydown', onDialogKeyDown)
      document.body.style.overflow = oldOverflow
      newLeadButtonRef.current?.focus()
    }
  }, [modal])
  const [company, setCompany] = useState('')
  const [contact, setContact] = useState('')
  const filteredLeads = useMemo(() => leads.filter(lead => [lead.company, lead.contact, lead.origin, lead.status].join(' ').toLowerCase().includes(search.toLowerCase())), [leads, search])
  const openView = (next: View) => { setView(next); setSearch('') }
  const createLead = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!company.trim() || !contact.trim()) return
    setLeads(current => [{ id: String(Date.now()), company: company.trim(), contact: contact.trim(), origin: 'Manual', status: 'Novo', date: 'Agora (demo)', amount: '—', initials: company.trim().slice(0, 2).toUpperCase() }, ...current])
    setCompany(''); setContact(''); setModal(false); setView('leads')
  }
  return <div id="cassiellos-crm" data-crm-root>
    <div className="crm-layout">
      <aside className="crm-sidebar" aria-label="Navegação do Mini CRM">
        <div className="crm-brand"><img className="crm-brand-symbol" src="/brand/cassiellos-symbol-signal-red.svg" width={40} height={26} alt="Símbolo oficial Cassiellos"/><div><div className="crm-brand-word">Cassiellos</div><span className="crm-brand-sub">Mini CRM / Operações</span></div></div>
        <nav className="crm-nav-wrap" aria-label="Seções">
          <div className="crm-nav-label">Workspace</div>
          {navigation.map(item => <button key={item.id} type="button" className="crm-nav-btn" data-active={view === item.id} onClick={() => openView(item.id)} aria-current={view === item.id ? 'page' : undefined}><Icon name={item.icon}/>{item.label}{item.count && <span className="crm-nav-count">{item.count}</span>}</button>)}
        </nav>
        <div className="crm-sidebar-footer"><div className="crm-profile"><span className="crm-avatar">C</span><span><strong>Equipe Cassiellos</strong><small>Ambiente de demonstração</small></span></div></div>
      </aside>

      <main className="crm-main">
        <header className="crm-topbar">
          <div className="crm-breadcrumb"><span>Workspace</span><span style={{ opacity: .45 }}>/</span><strong>{sectionNames[view]}</strong></div>
          <div className="crm-top-actions">
            <label className="crm-search"><Icon name="search" size={16}/><input type="search" aria-label="Buscar leads demonstrativos" placeholder="Buscar leads..." value={search} onChange={e => {setSearch(e.target.value);if (e.target.value) setView('leads')}}/></label>
            <button className="crm-icon-btn" type="button" aria-label="Visualizar eventos" title="Eventos de conversão" onClick={() => openView('conversoes')}><Icon name="bell" size={18}/></button>
            <span className="crm-avatar" aria-label="Perfil da equipe">C</span>
          </div>
        </header>

        <div className="crm-content">
          <div className="crm-hero">
            <div><div className="crm-eyebrow">Painel de performance</div><h1>{view === 'dashboard' ? 'Visão geral do negócio.' : sectionNames[view] + '.'}</h1><p className="crm-description">{view === 'dashboard' ? 'Seu funil, suas reuniões e as oportunidades em um só lugar.' : 'Explore esta visualização demonstrativa do Mini CRM Cassiellos.'}</p></div>
            <div className="crm-controls">
              <button className="crm-btn" type="button" onClick={() => setPeriod(period === '7d' ? '30d' : '7d')}><Icon name="calendar" size={15}/>{period === '7d' ? 'Últimos 7 dias' : 'Últimos 30 dias'}<Icon name="down" size={14}/></button>
              <button ref={newLeadButtonRef} className="crm-btn crm-btn-primary" type="button" onClick={() => setModal(true)}><Icon name="plus" size={16}/>Novo lead</button>
            </div>
          </div>

          <div className="crm-demo-banner"><Icon name="shield" size={16}/><strong>MODO DEMONSTRAÇÃO</strong> Os dados desta tela são fictícios. Nenhuma informação é lida ou gravada no Neon; alterações feitas aqui são temporárias.</div>

          {view === 'dashboard' && <>
            <div className="crm-metrics">
              {[
                { label: 'Leads recebidos', value: '124', trend: '+20%', icon: 'users' },
                { label: 'Reuniões agendadas', value: '18', trend: '+12%', icon: 'calendar' },
                { label: 'Reuniões realizadas', value: '11', trend: '+18%', icon: 'pulse' },
                { label: 'Contratos fechados', value: '4', trend: '+8%', icon: 'briefcase' },
              ].map(metric => <div className="crm-card crm-metric" key={metric.label}><div className="crm-metric-top"><span>{metric.label}</span><span className="crm-metric-icon"><Icon name={metric.icon} size={19}/></span></div><div className="crm-metric-value">{metric.value}</div><div><span className="crm-trend">↗ {metric.trend}</span><span className="crm-trend-muted">vs. período anterior (demo)</span></div></div>)}
            </div>
            <div className="crm-dashboard-grid">
              <section className="crm-card crm-panel"><div className="crm-panel-head"><div><div className="crm-panel-title">Evolução da captação</div><div className="crm-panel-subtitle">Leads recebidos no período</div></div><div className="crm-segment"><button aria-pressed={period === '7d'} data-selected={period === '7d'} onClick={() => setPeriod('7d')} type="button">7 dias</button><button aria-pressed={period === '30d'} data-selected={period === '30d'} onClick={() => setPeriod('30d')} type="button">30 dias</button></div></div><Chart period={period}/></section>
              <section className="crm-card crm-panel"><div className="crm-panel-head"><div><div className="crm-panel-title">Funil de conversão</div><div className="crm-panel-subtitle">Da captação ao fechamento</div></div><button className="crm-icon-btn" aria-label="Abrir funil" type="button" onClick={() => openView('funil')}><Icon name="arrow" size={16}/></button></div><div className="crm-funnel-list">{funnel.map(item => <div className="crm-funnel-row" key={item.label}><span>{item.label}</span><div className="crm-funnel-track"><div className="crm-funnel-fill" style={{ width: item.width + '%' }}/></div><strong>{item.value}</strong></div>)}</div><div style={{marginTop:24,fontSize:11,color:'#8193ab'}}>Evento-chave da campanha: <span style={{color:'#72d6f5',fontFamily:'monospace'}}>Chronos_Scheduled</span></div></section>
            </div>
            <section className="crm-card crm-table-panel"><div className="crm-table-head"><div><div className="crm-panel-title">Leads recentes</div><div className="crm-panel-subtitle">Últimas entradas no funil comercial</div></div><button type="button" className="crm-btn" onClick={() => openView('leads')}>Ver todos <Icon name="arrow" size={14}/></button></div><LeadTable leads={leads} limit={5}/></section>
          </>}

          {view === 'leads' && <section className="crm-card crm-table-panel"><div className="crm-table-head"><div><div className="crm-panel-title">Todos os leads</div><div className="crm-panel-subtitle">{filteredLeads.length} registro(s) demonstrativo(s) nesta visualização</div></div><button type="button" className="crm-btn" onClick={() => setSearch('')}>Limpar busca</button></div><LeadTable leads={filteredLeads}/></section>}

          {view === 'agenda' && <div className="crm-section-grid"><section className="crm-card crm-panel"><div className="crm-panel-head"><div><div className="crm-panel-title">Próximas reuniões</div><div className="crm-panel-subtitle">Compromissos de exemplo</div></div><Icon name="calendar"/></div>{meetings.map(m => <div className="crm-appointment" key={m.title}><div className="crm-date-block"><b>{m.day}</b><small>{m.month}</small></div><div style={{flex:1}}><strong>{m.title}</strong><small>{m.with} · {m.hour}</small></div><span className={m.type === 'Confirmado' ? 'crm-tag' : 'crm-tag crm-tag-muted'}>{m.type}</span></div>)}</section><section className="crm-card crm-panel"><div className="crm-panel-title">Resumo da agenda</div><div className="crm-panel-subtitle">Fluxo de agendamento planejado</div><div className="crm-info-box" style={{marginTop:22}}>O agendamento real, a disponibilidade do calendário e os lembretes automáticos serão integrados em uma etapa posterior.</div>{[['Reuniões agendadas','18'],['Confirmadas','14'],['Realizadas','11'],['Aguardando retorno','3']].map(([k,v]) => <div className="crm-appointment" key={k} style={{justifyContent:'space-between'}}><span>{k}</span><strong>{v}</strong></div>)}</section></div>}

          {view === 'funil' && <><div className="crm-info-box">Este quadro é uma <strong>simulação visual</strong>. Os cards não representam registros reais do CRM.</div><div className="crm-kanban">{[
            ['Novo',leads.filter(l=>l.status==='Novo')],
            ['Qualificado',leads.filter(l=>l.status==='Qualificado')],
            ['Agendado',leads.filter(l=>l.status==='Agendado')],
            ['Cliente',leads.filter(l=>l.status==='Cliente')]
          ].map(([status,items])=> <div className="crm-kanban-col" key={status as string}><div className="crm-kanban-title">{status as string}<span className="crm-kanban-count">{(items as Lead[]).length}</span></div>{(items as Lead[]).map(l => <div key={l.id} className="crm-kanban-item"><strong>{l.company}</strong><small>{l.origin}</small><footer><span>{l.amount}</span><span>{l.date}</span></footer></div>)}</div>)}</div></>}

          {view === 'conversoes' && <div className="crm-section-grid"><section className="crm-card crm-panel"><div className="crm-panel-head"><div><div className="crm-panel-title">Eventos da jornada</div><div className="crm-panel-subtitle">Plano de mensuração — nomes da estratégia Shark Scale</div></div><Icon name="target"/></div>{[
            ['ChronosView','Visualização do formulário'],
            ['ChronosFirstInteraction','Primeira interação'],
            ['ChronosSubmit','Envio de formulário'],
            ['Chronos_View_Scheduled','Visualização do agendamento'],
            ['Chronos_Scheduled','Agendamento confirmado']
          ].map(([name,desc])=><div className="crm-event" key={name}><code>{name}</code><span className="crm-tag crm-tag-muted">Planejado</span><small>{desc}</small></div>)}</section><section className="crm-card crm-panel"><div className="crm-panel-title">Evento principal</div><div style={{fontSize:22,letterSpacing:'-.04em',fontWeight:800,color:'#f13c4b',margin:'18px 0'}}>Chronos_Scheduled</div><p style={{color:'#a8b8cb',fontSize:12}}>Será registrado apenas após a confirmação efetiva do agendamento. O processamento via Conversions API e a deduplicação serão implementados e testados separadamente.</p><div className="crm-info-box" style={{marginTop:23}}>Esta página <strong>não envia eventos à Meta</strong> e não apresenta métricas reais de campanhas.</div></section></div>}

          {view === 'relatorios' && <div className="crm-section-grid"><section className="crm-card crm-panel"><div className="crm-panel-title">Relatório de captação</div><div className="crm-panel-subtitle">Gráfico ilustrativo de volume de leads</div><Chart period={period}/></section><section className="crm-card crm-panel"><div className="crm-panel-title">Indicadores comerciais</div><div className="crm-panel-subtitle">Resultados simulados, sem vínculo com campanhas</div>{[['Leads recebidos','124'],['Agendamentos confirmados','18'],['Reuniões realizadas','11'],['Contratos fechados','4']].map(([label,value]) => <div className="crm-appointment" key={label} style={{justifyContent:'space-between'}}><span>{label}</span><strong>{value}</strong></div>)}</section></div>}

          {view === 'configuracoes' && <div className="crm-section-grid"><section className="crm-card crm-panel"><div className="crm-panel-title">Identidade e segurança</div><div className="crm-panel-subtitle">Prévia de interface, sem alterações em infraestrutura</div><div className="crm-appointment"><Icon name="shield"/><div><strong>Branding Cassiellos</strong><small>Marinho #07101F · Vermelho #F13C4B · Inter</small></div></div><div className="crm-appointment"><Icon name="settings"/><div><strong>Ambiente Preview</strong><small>Funcionalidades reais serão liberadas somente após autenticação adequada.</small></div></div></section><section className="crm-card crm-panel"><div className="crm-panel-title">Integrações previstas</div>{[['Neon PostgreSQL','Backend validado — interface ainda não conectada'],['Meta Conversions API','Pendente'],['Calendário e e-mail','Pendente'],['Telegram','Pendente']].map(([k,v]) => <div className="crm-appointment" key={k}><Icon name="pulse"/><div><strong>{k}</strong><small>{v}</small></div></div>)}</section></div>}

          <div className="crm-footnote">Cassiellos Mini CRM · Prévia visual de desenvolvimento · Sem dados reais</div>
        </div>
      </main>
    </div>
    {modal && <div className="crm-modal-backdrop" onMouseDown={e => {if(e.target === e.currentTarget) setModal(false)}}><div ref={modalRef} className="crm-modal" role="dialog" aria-modal="true" aria-labelledby="crm-modal-title" aria-describedby="crm-modal-description"><h2 id="crm-modal-title">Novo lead de demonstração</h2><p id="crm-modal-description">Esse registro aparecerá apenas nesta sessão do navegador e não será salvo no Neon.</p><form onSubmit={createLead}><label className="crm-field">Empresa<input autoFocus required maxLength={90} placeholder="Ex.: Empresa Exemplo F" value={company} onChange={e=>setCompany(e.target.value)}/></label><label className="crm-field">Nome do contato<input required maxLength={90} placeholder="Ex.: Contato ilustrativo" value={contact} onChange={e=>setContact(e.target.value)}/></label><div className="crm-modal-actions"><button className="crm-btn" type="button" onClick={()=>setModal(false)}>Cancelar</button><button className="crm-btn crm-btn-primary" type="submit"><Icon name="plus" size={16}/>Adicionar na demo</button></div></form></div></div>}
  </div>
}
