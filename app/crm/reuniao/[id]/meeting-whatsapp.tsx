'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { whatsappSendLink } from '@/lib/crm/whatsapp-message'

/**
 * Mensagem de confirmação pronta (aviso 2). O botão só ABRE o WhatsApp com o texto preenchido:
 * o envio final é sempre do administrador. Nenhuma API do WhatsApp é usada.
 */
export default function MeetingWhatsapp({ initialText, whatsapp, active, focus, meetPending }: {
  initialText: string; whatsapp: string | null; active: boolean; focus: boolean; meetPending: boolean
}) {
  const [text, setText] = useState(initialText)
  const ref = useRef<HTMLElement>(null)
  useEffect(() => { if (focus) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [focus])
  const link = useMemo(() => whatsappSendLink(whatsapp, text), [whatsapp, text])
  const blocked = !active ? 'Reunião cancelada ou encerrada: não envie a confirmação.'
    : !link.ok ? (link.reason === 'INVALID_WHATSAPP' ? 'WhatsApp do lead inválido ou ausente: confira o cadastro antes de enviar.'
      : link.reason === 'TEXT_TOO_LONG' ? 'Mensagem longa demais para o link do WhatsApp.' : 'Escreva a mensagem.') : null

  return <section ref={ref} id="confirmacao" className="crm-card crm-meeting-card" aria-labelledby="whatsapp-title">
    <div className="crm-eyebrow">✅ Confirmação pronta</div>
    <h2 id="whatsapp-title">Mensagem para o cliente</h2>
    <p className="crm-meeting-muted">Revise e toque em “Enviar pelo WhatsApp”. O WhatsApp abre com o texto preenchido; o envio final é seu.</p>
    {meetPending && <p className="crm-meeting-warn">O link do Meet ainda não está disponível. Confira no Google Agenda antes de enviar.</p>}
    <label className="crm-meeting-field">Mensagem
      <textarea rows={9} maxLength={1200} value={text} onChange={e => setText(e.target.value)} />
    </label>
    {blocked && <p className="crm-meeting-warn" role="alert">{blocked}</p>}
    <div className="crm-meeting-actions">
      {active && link.ok
        ? <a className="crm-btn crm-btn-primary crm-meeting-send" href={link.url} target="_blank" rel="noopener noreferrer">Enviar pelo WhatsApp</a>
        : <button type="button" className="crm-btn crm-btn-primary crm-meeting-send" disabled>Enviar pelo WhatsApp</button>}
      <button type="button" className="crm-btn" onClick={() => setText(initialText)} disabled={text === initialText}>Restaurar texto</button>
    </div>
  </section>
}
