'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Histórico discreto das comunicações da reunião. Carrega sob demanda: com as chaves gerais
 * desligadas, a seção mostra isso e nada mais — não é um painel novo nem substitui o dashboard.
 *
 * Os estados são honestos de propósito. "Aceito pela Resend" não é "entregue": só o webhook
 * confirma a entrega. No WhatsApp, "Aguardando o lead" é o estado real enquanto o Modo B não
 * estiver ligado, porque clicar no botão não é enviar.
 */

type Message = {
  id: string; channel: 'email' | 'whatsapp'; kind: string; recipientMasked: string | null
  scheduledFor: string | null; sentAt: string | null; status: string; attempts: number; lastError: string | null
}

type Status = {
  email: { ready: boolean; confirmation: boolean; reminders: boolean; webhookConfigured: boolean }
  whatsapp: { buttonReady: boolean; cloudReady: boolean; autoReply: boolean }
}

const KIND_LABEL: Record<string, string> = {
  confirmation: 'E-mail de confirmação',
  reminder_24h: 'Lembrete — 24 horas antes',
  reminder_1h: 'Lembrete — 1 hora antes',
  whatsapp_auto_reply: 'WhatsApp — resposta automática',
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  scheduled: 'Agendado no provedor',
  sent: 'Aceito pelo provedor',
  delivered: 'Entregue',
  failed: 'Falhou',
  cancelled: 'Cancelado',
  skipped: 'Não enviado',
}

const RESENDABLE = new Set(['failed', 'skipped', 'cancelled'])
const when = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
})
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

export default function MeetingComms({ appointmentId }: { appointmentId: string }) {
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')

  const apply = useCallback((value: unknown) => {
    if (!isRecord(value)) return
    if (Array.isArray(value.messages)) setMessages(value.messages as Message[])
    if (isRecord(value.status)) setStatus(value.status as unknown as Status)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/crm/comms?appointmentId=' + encodeURIComponent(appointmentId),
      { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw Error('COMMS_UNAVAILABLE')
        apply(await response.json())
      })
      .catch((e: unknown) => { if ((e as Error)?.name !== 'AbortError') setError('Não foi possível carregar o histórico.') })
    return () => controller.abort()
  }, [appointmentId, apply])

  async function resend(messageId: string) {
    setBusy(messageId); setError('')
    try {
      const response = await fetch('/api/crm/comms', {
        method: 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'resend', messageId }),
      })
      const value: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const code = isRecord(value) && typeof value.error === 'string' ? value.error : 'RESEND_FAILED'
        setError(code === 'EMAIL_DISABLED' ? 'O envio por e-mail está desligado.'
          : code === 'NOT_RESENDABLE' ? 'Esta mensagem não pode ser reenviada.'
          : 'Não foi possível reenviar.')
        return
      }
      apply(value)
    } catch { setError('Não foi possível reenviar.') } finally { setBusy('') }
  }

  return <section className="crm-card crm-meeting-card" aria-labelledby="comms-title">
    <div className="crm-eyebrow">✉️ Comunicações</div>
    <h2 id="comms-title">E-mail e WhatsApp desta reunião</h2>
    {status && <p className="crm-meeting-muted crm-comms-flags">
      E-mail: {status.email.ready ? 'ligado' : 'desligado'}
      {status.email.ready && ' · confirmação ' + (status.email.confirmation ? 'sim' : 'não') +
        ' · lembretes ' + (status.email.reminders ? 'sim' : 'não') +
        ' · webhook ' + (status.email.webhookConfigured ? 'sim' : 'não')}
      {' | '}WhatsApp: botão {status.whatsapp.buttonReady ? 'ligado' : 'desligado'}
      {' · '}API oficial {status.whatsapp.cloudReady ? (status.whatsapp.autoReply ? 'com resposta automática' : 'sem resposta automática') : 'desligada'}
    </p>}
    {error && <p className="crm-meeting-warn" role="alert">{error}</p>}
    {messages === null && !error && <p className="crm-meeting-muted">Carregando…</p>}
    {messages?.length === 0 && <p className="crm-meeting-muted">
      Nenhuma comunicação automática registrada para esta reunião.
      {status && !status.email.ready && ' O canal de e-mail está desligado.'}
    </p>}
    {messages && messages.length > 0 && <ul className="crm-comms-list">
      {messages.map(item => <li key={item.id}>
        <div className="crm-comms-head">
          <strong>{KIND_LABEL[item.kind] ?? item.kind}</strong>
          <span data-comms-status={item.status}>{STATUS_LABEL[item.status] ?? item.status}</span>
        </div>
        <p className="crm-meeting-muted">
          {item.recipientMasked ?? 'destinatário não registrado'}
          {item.scheduledFor && ' · previsto ' + when.format(new Date(item.scheduledFor))}
          {item.sentAt && ' · enviado ' + when.format(new Date(item.sentAt))}
          {item.attempts > 1 && ' · ' + item.attempts + ' tentativas'}
        </p>
        {item.lastError && <p className="crm-meeting-warn">{item.lastError}</p>}
        {item.channel === 'email' && RESENDABLE.has(item.status) &&
          <button type="button" className="crm-btn" disabled={busy === item.id || !status?.email.ready}
            onClick={() => resend(item.id)}>
            {busy === item.id ? 'Reenviando…' : 'Reenviar'}
          </button>}
      </li>)}
    </ul>}
    {status?.whatsapp.buttonReady && !status.whatsapp.cloudReady && <p className="crm-meeting-muted">
      O WhatsApp está no modo manual: o lead recebe um botão na confirmação e decide enviar a mensagem.
      Enquanto a API oficial não estiver ligada, não há como o CRM saber se ele enviou.
    </p>}
  </section>
}
