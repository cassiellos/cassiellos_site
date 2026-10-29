'use client'

import { useEffect, useMemo, useState } from 'react'
import './real-agenda.css'

type Appointment = {
  id: string
  isTest: boolean
  leadId: string
  name: string
  company: string | null
  email: string | null
  whatsapp: string | null
  niche: string | null
  status: string
  startsAt: string
  endsAt: string
  meetUrl: string | null
  hasCalendarEvent: boolean
  confirmedAt: string | null
}
type Totals = { total: number; confirmed: number; completed: number; cancelled: number; pending: number }

const zone = 'America/Sao_Paulo'
const fullDate = new Intl.DateTimeFormat('pt-BR', { timeZone: zone, weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
const hourTime = new Intl.DateTimeFormat('pt-BR', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false })
const shortMonth = new Intl.DateTimeFormat('pt-BR', { timeZone: zone, month: 'short' })
const dayNumber = new Intl.DateTimeFormat('pt-BR', { timeZone: zone, day: '2-digit' })
const labels: Record<string, string> = { confirmed: 'Confirmada', pending: 'Pendente', completed: 'Realizada', cancelled: 'Cancelada', no_show: 'Não compareceu', rescheduled: 'Reagendada' }

export default function RealAgendaPanel() {
  const [appointments, setAppointments] = useState<Appointment[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'unauthorized'>('loading')
  const [refresh, setRefresh] = useState(0)
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    setState('loading')
    fetch('/api/crm/agenda', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
      .then(async response => {
        if (response.status === 401) throw new Error('UNAUTHORIZED')
        if (!response.ok) throw new Error('AGENDA_UNAVAILABLE')
        const result: unknown = await response.json()
        if (!result || typeof result !== 'object' || !('appointments' in result) ||
            !Array.isArray(result.appointments) || !('totals' in result)) throw new Error('INVALID_RESPONSE')
        return result as { appointments: Appointment[]; totals: Totals }
      }).then(result => {
        if (controller.signal.aborted) return
        setAppointments(result.appointments)
        setTotals(result.totals)
        setState('ready')
      }).catch(error => {
        if (controller.signal.aborted) return
        setState(error instanceof Error && error.message === 'UNAUTHORIZED' ? 'unauthorized' : 'error')
      })
    return () => controller.abort()
  }, [refresh])

  const visible = useMemo(() => appointments.filter(appointment =>
    filter === 'all' || appointment.status === filter), [appointments, filter])
  const selectedItem = appointments.find(appointment => appointment.id === selected)

  return <section className="crm-card crm-real-agenda">
    <div className="crm-real-agenda-title">
      <div>
        <div className="crm-panel-title">Agenda de reuniões</div>
        <p>Compromissos registrados no Neon Preview · Fuso horário de Brasília</p>
      </div>
      <button className="crm-btn" type="button" onClick={() => setRefresh(r => r + 1)} disabled={state === 'loading'}>
        {state === 'loading' ? 'Carregando…' : 'Atualizar agenda'}
      </button>
    </div>
    <div className="crm-real-agenda-notice"><strong>DADOS REAIS · NEON PREVIEW</strong> Somente leitura. Para cancelar ou marcar falta, abra a ficha do lead em Leads.</div>
    {state === 'ready' && totals && <div className="crm-real-agenda-stats">
      {[
        ['Total de reuniões', totals.total],
        ['Confirmadas', totals.confirmed],
        ['Realizadas', totals.completed],
        ['Canceladas', totals.cancelled],
      ].map(([label, value]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}
    </div>}
    {state === 'loading' && <p className="crm-real-agenda-message">Consultando agendamentos no banco de dados…</p>}
    {state === 'unauthorized' && <p className="crm-real-agenda-message" role="alert">Sua sessão administrativa expirou. <a href="/crm/login">Entre novamente.</a></p>}
    {state === 'error' && <p className="crm-real-agenda-message" role="alert">Não foi possível consultar os agendamentos. Clique em Atualizar agenda para tentar novamente.</p>}
    {state === 'ready' && <>
      <div className="crm-real-agenda-filters" aria-label="Filtrar reuniões">
        {[['all', 'Todas'], ['confirmed', 'Confirmadas'], ['completed', 'Realizadas'], ['cancelled', 'Canceladas'], ['no_show', 'Faltas']].map(([key, label]) =>
          <button key={key} type="button" aria-pressed={filter === key} data-selected={filter === key} onClick={() => setFilter(key)}>{label}</button>)}
      </div>
      {visible.length === 0 ? <p className="crm-real-agenda-message">Nenhuma reunião registrada neste filtro.</p> :
        <div className="crm-real-agenda-items">
          {visible.map(appointment => {
            const start = new Date(appointment.startsAt)
            const end = new Date(appointment.endsAt)
            return <article className="crm-real-agenda-item" key={appointment.id}>
              <div className="crm-date-block"><b>{dayNumber.format(start)}</b><small>{shortMonth.format(start)}</small></div>
              <div className="crm-real-agenda-content">
                <strong>{appointment.company || appointment.name} {appointment.isTest && <span className="crm-test-tag">TESTE</span>}</strong>
                <span>{appointment.name} · {fullDate.format(start)}</span>
                <span>{hourTime.format(start)}–{hourTime.format(end)} · {appointment.niche || 'Diagnóstico estratégico'}</span>
              </div>
              <span className={appointment.status === 'confirmed' ? 'crm-tag' : 'crm-tag crm-tag-muted'}>
                {labels[appointment.status] || appointment.status}
              </span>
              <div className="crm-real-agenda-actions">
                <button className="crm-btn" type="button" aria-expanded={selected === appointment.id} onClick={() => setSelected(current => current === appointment.id ? null : appointment.id)}>
                  {selected === appointment.id ? 'Fechar' : 'Detalhes'}
                </button>
                {appointment.meetUrl && /^https:\/\/meet\.google\.com\//.test(appointment.meetUrl) &&
                  <a href={appointment.meetUrl} target="_blank" rel="noopener noreferrer" className="crm-real-agenda-meet">Abrir Meet ↗</a>}
              </div>
            </article>
          })}
        </div>}
      {selectedItem && <div className="crm-real-agenda-detail">
        <strong>Detalhes da reunião</strong>
        <dl>
          <div><dt>Participante</dt><dd>{selectedItem.name}</dd></div>
          <div><dt>Empresa</dt><dd>{selectedItem.company || 'Não informada'}</dd></div>
          <div><dt>E-mail</dt><dd>{selectedItem.email || '—'}</dd></div>
          <div><dt>WhatsApp</dt><dd>{selectedItem.whatsapp || '—'}</dd></div>
          <div><dt>Nicho</dt><dd>{selectedItem.niche || '—'}</dd></div>
          <div><dt>Status</dt><dd>{labels[selectedItem.status] || selectedItem.status}</dd></div>
          <div><dt>Google Calendar</dt><dd>{selectedItem.hasCalendarEvent ? 'Evento registrado' : 'Sem evento vinculado'}</dd></div>
        </dl>
      </div>}
      {totals !== null && totals.total > 150 && <p className="crm-real-agenda-message">Exibindo as 150 reuniões mais recentes. A paginação será implementada conforme o volume crescer.</p>}
    </>}
  </section>
}
