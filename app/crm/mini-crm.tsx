'use client'

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import './crm.css'
import RealLeadsPanel from './real-leads'
import RealAgendaPanel from './real-agenda'
import RealDashboard from './real-dashboard'
import RealFunnel from './real-funnel'
import StuckReservations from './stuck-reservations'
import AvailabilityPanel from './availability-panel'
import MetaHomologationPanel from './meta-homologation-panel'
import NotificationsPanel from './notifications-panel'
import FinancePanel from './finance-panel'
import NeonUsageMonitor from './neon-usage-monitor'

type View = 'dashboard' | 'leads' | 'agenda' | 'disponibilidade' | 'funil' | 'conversoes' | 'notificacoes' | 'relatorios' | 'configuracoes' | 'financeiro'
const navigation: { id: View; label: string; icon: string; count?: string }[] = [
  { id: 'dashboard', label: 'Dashboard', icon: 'grid' },
  { id: 'leads', label: 'Leads', icon: 'users' },
  { id: 'agenda', label: 'Agenda', icon: 'calendar' },
  { id: 'disponibilidade', label: 'Disponibilidade', icon: 'clock' },
  { id: 'funil', label: 'Funil comercial', icon: 'funnel' },
  { id: 'conversoes', label: 'Conversões Meta', icon: 'target' },
  { id: 'notificacoes', label: 'Notificações', icon: 'bell' },
  { id: 'relatorios', label: 'Relatórios', icon: 'chart' },
  { id: 'configuracoes', label: 'Configurações', icon: 'settings' },
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
    wallet: <><rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M16 15h2M7 6V4.5A1.5 1.5 0 0 1 8.5 3h9A1.5 1.5 0 0 1 19 4.5V6"/></>,
    briefcase: <><rect x="3" y="7" width="18" height="14" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/></>,
  }
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{shapes[name] || shapes.grid}</svg>
}

const sectionNames: Record<View, string> = {
  dashboard: 'Dashboard', leads: 'Gestão de leads', agenda: 'Agenda de reuniões', disponibilidade: 'Disponibilidade', funil: 'Funil comercial', conversoes: 'Conversões Meta', notificacoes: 'Notificações', relatorios: 'Relatórios', configuracoes: 'Configurações', financeiro: 'Financeiro',
}

export default function MiniCrm() {
  const [view, setView] = useState<View>('dashboard')
  const [period, setPeriod] = useState<'7d' | '30d'>('7d')
  const [search, setSearch] = useState('')
  const [focusLead, setFocusLead] = useState<string | null>(null)
  // Links diretos (avisos do PWA): /crm?lead=<id> abre a ficha do lead; /crm?view=notificacoes abre o painel.
  // Também registra o service worker do PWA (sem pedir permissão) e reprocessa a fila de avisos pendentes.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const id = params.get('lead')
    if (id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) { setFocusLead(id); setView('leads') }
    else if (params.get('view') === 'notificacoes') setView('notificacoes')
    else if (params.get('view') === 'financeiro') setView('financeiro')
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/crm-sw.js', { scope: '/crm', updateViaCache: 'none' }).catch(() => undefined)
    fetch('/api/crm/push', { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'process_due' }) }).catch(() => undefined)
  }, [])
  const openView = (next: View) => { setView(next); setSearch('') }
  return <div id="cassiellos-crm" data-crm-root>
    <div className="crm-layout">
      <aside className="crm-sidebar" aria-label="Navegação do CRM">
        <div className="crm-brand"><img className="crm-brand-symbol" src="/brand/cassiellos-symbol-signal-red.svg" width={40} height={26} alt="Símbolo oficial Cassiellos"/><div><div className="crm-brand-word">Cassiellos</div><span className="crm-brand-sub">CRM | Cassiellos</span></div></div>
        <nav className="crm-nav-wrap" aria-label="Seções">
          <div className="crm-nav-label">Workspace</div>
          {navigation.map(item => <button key={item.id} type="button" className="crm-nav-btn" data-active={view === item.id} onClick={() => openView(item.id)} aria-current={view === item.id ? 'page' : undefined}><Icon name={item.icon}/>{item.label}{item.count && <span className="crm-nav-count">{item.count}</span>}</button>)}
          <div className="crm-nav-label crm-nav-label-section">Financeiro</div>
          <button type="button" className="crm-nav-btn" data-active={view === 'financeiro'} onClick={() => openView('financeiro')} aria-current={view === 'financeiro' ? 'page' : undefined}><Icon name="wallet"/>Financeiro</button>
        </nav>
        <div className="crm-sidebar-footer"><NeonUsageMonitor/><div className="crm-profile"><span className="crm-avatar">C</span><span><strong>Equipe Cassiellos</strong><small>CRM · operacional</small></span></div><form action="/api/crm/auth/logout" method="POST"><button type="submit" className="crm-logout"><Icon name="shield" size={15}/> Encerrar sessão</button></form></div>
      </aside>

      <main className="crm-main">
        <header className="crm-topbar">
          <div className="crm-breadcrumb"><span>Workspace</span><span style={{ opacity: .45 }}>/</span><strong>{sectionNames[view]}</strong></div>
          <div className="crm-top-actions">
            <label className="crm-search"><Icon name="search" size={16}/><input type="search" aria-label="Buscar leads no CRM" placeholder="Buscar leads..." value={search} onChange={e => {setSearch(e.target.value);if (e.target.value) setView('leads')}}/></label>
            <button className="crm-icon-btn" type="button" aria-label="Visualizar eventos" title="Eventos de conversão" onClick={() => openView('conversoes')}><Icon name="bell" size={18}/></button><form action="/api/crm/auth/logout" method="POST" className="crm-top-logout"><button type="submit" className="crm-icon-btn" aria-label="Encerrar sessão" title="Encerrar sessão"><Icon name="shield" size={17}/></button></form>
            <span className="crm-avatar" aria-label="Perfil da equipe">C</span>
          </div>
        </header>

        <div className="crm-content">
          <div className="crm-hero">
            <div><div className="crm-eyebrow">Painel de performance</div><h1>{view === 'dashboard' ? 'Visão geral do negócio.' : sectionNames[view] + '.'}</h1><p className="crm-description">{view === 'dashboard' ? 'Indicadores reais de captação, reuniões e resultados do CRM.' : view === 'leads' ? 'Cadastros reais protegidos, sincronizados com o banco do CRM.' : view === 'agenda' ? 'Reuniões reais registradas no Neon, com acesso ao Google Meet.' : view === 'funil' ? 'Oportunidades reais, com qualificação e histórico auditável.' : view === 'disponibilidade' ? 'Horário comercial, feriados, bloqueios e exceções do agendamento público.' : view === 'notificacoes' ? 'Avisos do CRM no celular: reuniões confirmadas e ações de WhatsApp.' : view === 'financeiro' ? 'Contratos, receitas, despesas, contas e notas fiscais — competência e caixa separados, direto do banco do CRM.' : view === 'conversoes' ? 'Meta Pixel, eventos Chronos e CAPI habilitados no CRM. Acompanhe os eventos reais no Gerenciador de Eventos da Meta.' : view === 'relatorios' ? 'Indicadores reais de captação e reuniões consultados no banco do CRM.' : 'Configurações operacionais e informações de privacidade do CRM.'}</p></div>
            <div className="crm-controls">
              {(view === 'dashboard' || view === 'relatorios') && <button className="crm-btn" type="button" onClick={() => setPeriod(period === '7d' ? '30d' : '7d')}><Icon name="calendar" size={15}/>{period === '7d' ? 'Últimos 7 dias' : 'Últimos 30 dias'}<Icon name="down" size={14}/></button>}
              
            </div>
          </div>

          {view === 'conversoes' && <div className="crm-meta-context-banner"><Icon name="target" size={16}/><div><strong>INTEGRAÇÃO COMERCIAL HABILITADA</strong> Pixel, eventos Chronos e CAPI foram ativados na Preview em 03/11/2026. Esta tela não consulta a Meta nem as variáveis da Vercel em tempo real; a deduplicação e as conversões reais ainda dependem de verificação externa.</div></div>}
          {view === 'dashboard' && <RealDashboard period={period} openView={openView}/>}
          {view === 'leads' && <RealLeadsPanel search={search} focusLeadId={focusLead}/>}

          {view === 'agenda' && <><RealAgendaPanel/><StuckReservations/></>}
          {view === 'disponibilidade' && <AvailabilityPanel/>}
          {view === 'funil' && <RealFunnel/>}
          {view === 'conversoes' && <MetaHomologationPanel/>}
          {view === 'notificacoes' && <NotificationsPanel/>}
          {view === 'financeiro' && <FinancePanel/>}
          {view === 'conversoes' && <div className="crm-section-grid">
            <section className="crm-card crm-panel">
              <div className="crm-panel-head"><div>
                <div className="crm-panel-title">Eventos da jornada</div>
                <div className="crm-panel-subtitle">Eventos com recebimento comprovado na Meta (Gerenciador de Eventos) · histórico verificado manualmente</div>
              </div><Icon name="target"/></div>
              {([
                ['Schedule','Agendamento confirmado · padrão · navegador · 03/11/2026 09:43:10'],
                ['Lead','Cadastro de lead · padrão · navegador · 30/10/2026 (conjunto de dados)'],
                ['ChronosView','Visualização do formulário · personalizado · navegador · 03/11/2026 11:28:25'],
                ['ChronosFirstInteraction','Primeira interação · personalizado · navegador · 03/11/2026 11:30:29'],
                ['Chronos_View_Scheduled','Etapa de agendamento visível · personalizado · navegador · 03/11/2026 11:33:11'],
                ['ChronosSubmit','Envio aceito pelo backend · personalizado · navegador · 03/11/2026 11:34:00'],
              ] as const).map(([name, desc]) =>
                <div className="crm-event crm-meta-event-verified" key={name}>
                  <code>{name}</code><span className="crm-tag">Validado</span><small>{desc}</small>
                </div>
              )}
              <div className="crm-event">
                <code>Chronos_Scheduled</code><span className="crm-tag crm-tag-muted">Mapeado</span><small>Nome interno do agendamento; enviado à Meta como Schedule (não é um evento separado)</small>
              </div>
              <p style={{ color: '#a8b8cb', fontSize: 12, margin: '10px 0 0' }}>
                Os quatro eventos Chronos foram validados em homologação (marcados <code>cassiellos_teste=homologacao</code>) e agora
                estão habilitados para visitantes reais com consentimento de marketing. Ainda não há comprovação de eventos comerciais reais nesta tela.
              </p>
            </section>
            <section className="crm-card crm-panel">
              <div className="crm-panel-title">Evento de agendamento</div>
              <div className="crm-meta-event-name">Schedule <span>(Programar)</span></div>
              <span className="crm-tag">Homologação aprovada · 03/11/2026</span>
              <p className="crm-meta-explainer">A Meta processou o evento enviado pelo navegador após a confirmação do agendamento no CRM. O evento foi identificado como teste de homologação.</p>
              <div className="crm-meta-future">
                <strong>Próxima etapa: acompanhamento de resultados reais</strong>
                <p>A CAPI está habilitada para reuniões reais elegíveis, com consentimento de marketing. A Meta aceitou um envio de teste pelo servidor; o CRM não importa métricas de campanhas em tempo real, e a deduplicação efetiva ainda depende de conferência na Meta.</p>
              </div>
              <p className="crm-meta-source-note">Dados apresentados: verificação manual no Gerenciador de Eventos, não relatório em tempo real da Meta. Esta página não dispara eventos.</p>
            </section>
          </div>}

          {view === 'relatorios' && <>
            <div className="crm-meta-context-banner"><Icon name="chart"/><div><strong>RELATÓRIO OPERACIONAL</strong> Todos os indicadores abaixo são consultados no banco do CRM e distinguem registros operacionais de testes. Não representam métricas de anúncios da Meta.</div></div>
            <RealDashboard period={period} openView={openView}/>
          </>}

          {view === 'configuracoes' && <div className="crm-section-grid">
            <section className="crm-card crm-panel">
              <div className="crm-panel-title">Operação do CRM</div>
              <div className="crm-panel-subtitle">Acesse os controles funcionais sem criar configurações fictícias.</div>
              <p>Gerencie dispositivos, mensagens e avisos na aba Notificações; horários, bloqueios e exceções na aba Disponibilidade.</p>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:16}}>
                <button type="button" className="crm-btn" onClick={() => openView('notificacoes')}>Abrir Notificações</button>
                <button type="button" className="crm-btn" onClick={() => openView('disponibilidade')}>Abrir Disponibilidade</button>
              </div>
            </section>
            <section className="crm-card crm-panel">
              <div className="crm-panel-title">Privacidade e integrações</div>
              <div className="crm-panel-subtitle">A versão legal vigente é a de 03/11/2026.</div>
              <p>O painel de Conversões Meta registra o histórico de homologação, sem importar métricas ou estados das integrações em tempo real. Configurações de infraestrutura permanecem na Vercel.</p>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:16}}>
                <button type="button" className="crm-btn" onClick={() => openView('conversoes')}>Ver Conversões Meta</button>
                <a className="crm-btn" href="/politica-de-privacidade" target="_blank" rel="noopener noreferrer">Política de Privacidade</a>
                <a className="crm-btn" href="/politica-de-cookies" target="_blank" rel="noopener noreferrer">Política de Cookies</a>
              </div>
            </section>
          </div>}

          <div className="crm-footnote">CRM | Cassiellos · {view === 'conversoes' ? 'Histórico de homologação · métricas de campanhas não integradas' : view === 'configuracoes' ? 'Acesso às configurações operacionais' : 'Acesso administrativo'}</div>
        </div>
      </main>
    </div>
  </div>
}
