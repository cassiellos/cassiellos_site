'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import './real-leads.css'
import LeadManagement from './lead-management'
import { attributionChannel, CHANNEL_LABELS } from '@/lib/crm/attribution'
import { parseBrazilianWhatsapp, whatsappLink } from '@/lib/crm/whatsapp'

type StoredLead = {
  id: string
  isTest: boolean
  name: string
  email: string | null
  whatsapp: string | null
  company: string | null
  niche: string | null
  status: string
  revenue: string | null
  objective: string | null
  formVersion: string | null
  latestContactName: string | null
  latestContactWhatsapp: string | null
  source: string | null
  campaign: string | null
  medium: string | null
  createdAt: string
  submittedAt: string | null
  hasMeeting: boolean
}

const labelStatus: Record<string, string> = {
  new: 'Novo', contacted: 'Contatado', qualified: 'Qualificado',
  disqualified: 'Desqualificado', customer: 'Cliente',
}
const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: 'short',
  year: 'numeric', hour: '2-digit', minute: '2-digit',
})

function dateLabel(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : dateFormatter.format(parsed)
}

function initials(value: string): string {
  return (value.trim().split(/\s+/).slice(0, 2).map(s => s.charAt(0)).join('') || '—').toUpperCase()
}

export default function RealLeadsPanel({ search, focusLeadId = null }: { search: string; focusLeadId?: string | null }) {
  const [entries, setEntries] = useState<StoredLead[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'unauthorized'>('loading')
  const [refresh, setRefresh] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null)
  const detailRef = useRef<HTMLDivElement>(null)
  // A ficha é exibida fora da tabela, em uma camada fixa acima de todo o CRM.
  useEffect(() => { setPortalRoot(document.getElementById('cassiellos-crm')) }, [])
  useEffect(() => {
    if (!selected || !portalRoot) return
    const dialog = detailRef.current
    if (!dialog) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSelected(null)
        return
      }
      if (event.key !== 'Tab') return
      const elements = Array.from(dialog.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter(el => el.getClientRects().length > 0)
      if (elements.length === 0) { event.preventDefault(); dialog.focus(); return }
      const first = elements[0]
      const last = elements[elements.length - 1]
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault(); last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previousFocus?.focus()
    }
  }, [selected, portalRoot])
  useEffect(() => {
    // Não exibe dados carregados anteriormente depois de uma sessão expirada.
    if (state === 'unauthorized') setSelected(null)
  }, [state])

  const load = useCallback(() => setRefresh(v => v + 1), [])
  const [focused, setFocused] = useState<string | null>(null)
  // Abre uma única vez a ficha pedida pelo link direto, se o lead estiver na lista carregada.
  useEffect(() => {
    if (state !== 'ready' || !focusLeadId || focused === focusLeadId) return
    setFocused(focusLeadId)
    if (entries.some(lead => lead.id === focusLeadId)) {
      setSelected(focusLeadId)
    }
  }, [state, entries, focusLeadId, focused])
  useEffect(() => {
    const controller = new AbortController()
    setState('loading')
    fetch('/api/crm/leads', {
      cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
    }).then(async r => {
      if (r.status === 401) throw new Error('UNAUTHORIZED')
      if (!r.ok) throw new Error('UNAVAILABLE')
      const value: unknown = await r.json()
      if (!value || typeof value !== 'object' || !('leads' in value) || !Array.isArray(value.leads)) {
        throw new Error('INVALID_RESPONSE')
      }
      return value as { leads: StoredLead[]; total: number }
    }).then(data => {
      if (controller.signal.aborted) return
      setEntries(data.leads)
      setTotal(data.total)
      setState('ready')
    }).catch(error => {
      if (controller.signal.aborted) return
      setState(error instanceof Error && error.message === 'UNAUTHORIZED' ? 'unauthorized' : 'error')
    })
    return () => controller.abort()
  }, [refresh])

  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR')
    if (!term) return entries
    return entries.filter(lead => [
      lead.name, lead.company, lead.email, lead.whatsapp, lead.niche,
      lead.status, lead.revenue, lead.objective, lead.source, lead.campaign,
    ].some(value => (value || '').toLocaleLowerCase('pt-BR').includes(term)))
  }, [entries, search])

  const active = entries.find(lead => lead.id === selected)
  return <section className="crm-card crm-table-panel crm-real-leads">
    <div className="crm-table-head crm-real-head">
      <div>
        <div className="crm-panel-title">Leads cadastrados no Neon</div>
        <div className="crm-panel-subtitle">
          {state === 'ready'
            ? String(total ?? 0) + ' lead(s) no banco Preview · ' + String(filtered.length) + ' exibido(s)'
            : 'Registros reais do ambiente de testes'}
        </div>
      </div>
      <button className="crm-btn" type="button" onClick={load} disabled={state === 'loading'}>
        {state === 'loading' ? 'Carregando…' : 'Atualizar lista'}
      </button>
    </div>
    <div className="crm-real-info" role="status">
      <strong>NEON PREVIEW</strong> Leads reais no Neon Preview. A ficha do lead permite registrar ações administrativas com histórico.
    </div>
    {state === 'loading' ? <div className="crm-real-message">Carregando leads do banco…</div> : null}
    {state === 'unauthorized' ? <div className="crm-real-message" role="alert">
      Sua sessão expirou. <a href="/crm/login">Entrar novamente no CRM</a>.
    </div> : null}
    {state === 'error' ? <div className="crm-real-message" role="alert">
      Não foi possível consultar os leads. Tente atualizar a lista.
    </div> : null}
    {state === 'ready' && filtered.length === 0
      ? <div className="crm-real-message">{search ? 'Nenhum lead corresponde à busca.' : 'Nenhum lead registrado neste ambiente.'}</div>
      : null}
    {state === 'ready' && filtered.length > 0 ? <div className="crm-table-wrap"><table>
      <thead><tr>
        <th>Empresa / Contato</th><th>Contato</th><th>Segmento</th>
        <th>Faturamento informado</th><th>Origem</th><th>Etapa</th><th>Entrada</th><th>Detalhes</th>
      </tr></thead>
      <tbody>{filtered.map(lead => <tr key={lead.id}>
        <td><div className="crm-company">
          <span className="crm-company-logo">{initials(lead.company || lead.name)}</span>
          <span>{lead.company || 'Empresa não informada'} {lead.isTest && <span className="crm-test-tag">TESTE</span>}
            <span className="crm-real-person">{lead.name}</span>
            {lead.latestContactName && lead.latestContactName.trim().toLowerCase() !== lead.name.trim().toLowerCase() &&
              <span className="crm-real-person">Último formulário: {lead.latestContactName}</span>}
          </span>
        </div></td>
        <td className="crm-real-contact">
          <span>{lead.whatsapp || '—'}</span><span>{lead.email || '—'}</span>
        </td>
        <td>{lead.niche || '—'}</td>
        <td>{lead.revenue || 'Não informado'}</td>
        <td>{lead.source || 'Origem não identificada'}</td>
        <td><span className="crm-status">{labelStatus[lead.status] || lead.status}</span></td>
        <td>{dateLabel(lead.createdAt)}</td>
        <td><button type="button" className="crm-btn crm-real-detail-btn"
          aria-haspopup="dialog"
          aria-expanded={selected === lead.id}
          aria-label={(selected === lead.id ? 'Fechar respostas de ' : 'Ver respostas de ') + (lead.company || lead.name)}
          onClick={() => setSelected(s => s === lead.id ? null : lead.id)}>
          {selected === lead.id ? 'Fechar' : 'Ver respostas'}
        </button></td>
      </tr>)}</tbody>
    </table></div> : null}
    {state === 'ready' && total !== null && total > 100 ? <p className="crm-real-note">
      Exibindo os 100 cadastros mais recentes. Paginação será adicionada antes de operar com maior volume.
    </p> : null}
    {active && portalRoot && state !== 'unauthorized' && state !== 'error' ? createPortal(
      <div className="crm-real-modal-overlay" onMouseDown={event => {
        if (event.target === event.currentTarget) setSelected(null)
      }}>
        <div className="crm-real-modal" ref={detailRef} role="dialog" aria-modal="true"
          aria-labelledby="crm-real-modal-title" tabIndex={-1}>
          <header className="crm-real-modal-header">
            <div>
              <span className="crm-real-modal-eyebrow">FICHA DO LEAD {active.isTest ? '· TESTE' : ''}</span>
              <h2 id="crm-real-modal-title">{active.company || active.latestContactName || active.name}</h2>
              <small>Respostas do formulário e histórico comercial em um só lugar.</small>
            </div>
            <button type="button" className="crm-btn" onClick={() => setSelected(null)} aria-label="Fechar ficha do lead">Fechar ×</button>
          </header>
          <div className="crm-real-modal-body">
            <section className="crm-real-detail" aria-label="Respostas do formulário">
              <div className="crm-real-detail-head">
                <div>
                  <strong>Respostas do formulário</strong>
                  <small>{active.formVersion || 'Formulário sem versão'} · {active.submittedAt ? dateLabel(active.submittedAt) : 'Registro manual'}</small>
                </div>
              </div>
              <div className="crm-real-detail-grid">
                <div><span>Contato cadastrado</span><strong>{active.name}</strong></div>
                <div><span>Nome informado no último formulário</span><strong>{active.latestContactName || '—'}</strong></div>
                <div><span>WhatsApp informado no último formulário</span><strong>{parseBrazilianWhatsapp(active.latestContactWhatsapp)?.display || active.latestContactWhatsapp || '—'}</strong></div>
                <div><span>Empresa cadastrada</span><strong>{active.company || '—'}</strong></div>
                <div><span>WhatsApp</span><strong>{parseBrazilianWhatsapp(active.whatsapp)?.display || active.whatsapp || '—'}</strong></div>
                <div><span>Faturamento informado</span><strong>{active.revenue || '—'}</strong></div>
                <div><span>Objetivo principal</span><strong>{active.objective || '—'}</strong></div>
                <div><span>Fonte da campanha</span><strong>{active.source || 'Não identificada'}</strong></div>
                <div><span>Campanha</span><strong>{active.campaign || 'Não identificada'}</strong></div>
                <div><span>Meio</span><strong>{active.medium || 'Não identificado'}</strong></div>
                <div><span>Canal (padrão de UTMs)</span><strong>{CHANNEL_LABELS[attributionChannel(active.source, active.medium)]}</strong></div>
                <div><span>Reunião no CRM</span><strong>{active.hasMeeting ? 'Existe registro' : 'Ainda não agendada'}</strong></div>
              </div>
              {(() => {
                const chat = whatsappLink(parseBrazilianWhatsapp(active.whatsapp))
                return chat
                  ? <a className="crm-btn crm-btn-primary crm-real-whatsapp" href={chat} target="_blank" rel="noopener noreferrer">Conversar no WhatsApp</a>
                  : <p className="crm-real-note">WhatsApp inválido ou ausente: confira o cadastro.</p>
              })()}
            </section>
            <LeadManagement key={active.id} leadId={active.id} onClose={() => setSelected(null)} onChanged={load}/>
          </div>
        </div>
      </div>, portalRoot
    ) : null}
  </section>
}
