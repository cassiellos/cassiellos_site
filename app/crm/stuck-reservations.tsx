'use client'

import { useEffect, useState } from 'react'

/**
 * Fase 3.4 — reservas presas em "processamento" (mais de 15 min). Nada é apagado:
 * o administrador confere o Google e só então libera (sem evento) ou registra a
 * reunião (evento existente). O servidor refaz a conferência antes de agir.
 */
type Reservation = {
  id: string; leadName: string; company: string | null; isTest: boolean
  startsAt: string; endsAt: string; createdAt: string; slotPassed: boolean
}
type Check = 'active' | 'cancelled' | 'not_found' | 'unavailable'

const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })
const googleLabel: Record<Check, string> = {
  active: 'Evento ATIVO no Google: o horário está ocupado. Registre a reunião no CRM.',
  cancelled: 'Evento cancelado no Google: a reserva pode ser encerrada.',
  not_found: 'Nenhum evento no Google: a reserva pode ser encerrada.',
  unavailable: 'Google indisponível no momento. Nada foi alterado.',
}
const errors: Record<string, string> = {
  GOOGLE_STATE_MISMATCH: 'O estado no Google mudou. Confira novamente antes de decidir.',
  GOOGLE_UNAVAILABLE: 'Google indisponível no momento. Nada foi alterado.',
  RESERVATION_NOT_STUCK: 'Esta reserva já foi resolvida ou não está mais travada.',
  UNAUTHORIZED: 'Sua sessão administrativa expirou. Entre novamente.',
}

export default function StuckReservations() {
  const [items, setItems] = useState<Reservation[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [checks, setChecks] = useState<Record<string, Check>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    setState('loading')
    fetch('/api/crm/reservations', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
      .then(async r => { if (!r.ok) throw new Error('FAILED'); return r.json() })
      .then(data => { if (!controller.signal.aborted) { setItems(Array.isArray(data.reservations) ? data.reservations : []); setState('ready') } })
      .catch(() => { if (!controller.signal.aborted) setState('error') })
    return () => controller.abort()
  }, [refresh])

  async function post(body: Record<string, unknown>) {
    const r = await fetch('/api/crm/reservations', {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
    const data = await r.json().catch(() => ({}))
    return { ok: r.ok, data }
  }

  async function inspect(id: string) {
    setBusy(id); setMessage('')
    try {
      const { ok, data } = await post({ action: 'inspect', bookingId: id })
      setChecks(c => ({ ...c, [id]: ok && typeof data.google === 'string' ? data.google as Check : 'unavailable' }))
      if (!ok && data.error) setMessage(errors[data.error] || 'Não foi possível conferir agora.')
    } finally { setBusy(null) }
  }

  async function resolve(item: Reservation, action: 'release' | 'adopt') {
    const text = action === 'release'
      ? 'Encerrar esta reserva e liberar o horário? O sistema confere o Google novamente e só libera se não houver evento ativo. Nenhum registro é apagado.'
      : 'Registrar a reunião confirmada no CRM a partir do evento existente no Google? Nenhum evento de conversão é criado.'
    if (!window.confirm(text)) return
    setBusy(item.id); setMessage('')
    try {
      const { ok, data } = await post({ action, bookingId: item.id, confirmed: true })
      setMessage(ok ? (action === 'release' ? 'Reserva encerrada e horário liberado.' : 'Reunião registrada no CRM.')
        : errors[data.error] || 'Não foi possível concluir. Nada foi alterado.')
      if (ok) setRefresh(v => v + 1)
      else if (data.google) setChecks(c => ({ ...c, [item.id]: data.google as Check }))
    } finally { setBusy(null) }
  }

  return <section className="crm-card crm-real-agenda crm-stuck-reservations">
    <div className="crm-real-agenda-title">
      <div>
        <div className="crm-panel-title">Reservas em processamento</div>
        <p>Reservas sem conclusão há mais de 15 minutos · conferência com o Google antes de qualquer decisão</p>
      </div>
      <button className="crm-btn" type="button" onClick={() => setRefresh(v => v + 1)} disabled={state === 'loading'}>
        {state === 'loading' ? 'Carregando…' : 'Atualizar'}</button>
    </div>
    {message && <p className="crm-real-agenda-message" role="status">{message}</p>}
    {state === 'error' && <p className="crm-real-agenda-message" role="alert">Não foi possível consultar as reservas.</p>}
    {state === 'ready' && items.length === 0 && <p className="crm-real-agenda-message">Nenhuma reserva travada. Tudo em ordem.</p>}
    {state === 'ready' && items.length > 0 && <div className="crm-real-agenda-items">
      {items.map(item => {
        const check = checks[item.id]
        return <article className="crm-real-agenda-item" key={item.id}>
          <div className="crm-real-agenda-content">
            <strong>{item.company || item.leadName} {item.isTest && <span className="crm-test-tag">TESTE</span>}</strong>
            <span>Horário: {fmt.format(new Date(item.startsAt))}{item.slotPassed ? ' (já passou)' : ''} · reservado em {fmt.format(new Date(item.createdAt))}</span>
            {check && <span className="crm-stuck-check" data-state={check}>{googleLabel[check]}</span>}
          </div>
          <div className="crm-real-agenda-actions">
            <button className="crm-btn" type="button" disabled={busy !== null} onClick={() => inspect(item.id)}>
              {busy === item.id ? 'Conferindo…' : 'Conferir no Google'}</button>
            {(check === 'not_found' || check === 'cancelled') &&
              <button className="crm-btn crm-btn-danger" type="button" disabled={busy !== null} onClick={() => resolve(item, 'release')}>Encerrar e liberar</button>}
            {check === 'active' &&
              <button className="crm-btn" type="button" disabled={busy !== null} onClick={() => resolve(item, 'adopt')}>Registrar reunião</button>}
          </div>
        </article>
      })}
    </div>}
  </section>
}
