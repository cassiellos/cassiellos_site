'use client'

import { useCallback, useEffect, useState } from 'react'
import './notifications-panel.css'

/**
 * NOTIFICAÇÕES (Etapa 5 — PWA + Web Push). Somente administradores, somente Preview.
 * A permissão do navegador só é pedida depois de um toque explícito em "Ativar notificações neste aparelho".
 * Os avisos não levam dados pessoais: título e texto genéricos; os detalhes só aparecem no CRM autenticado.
 */

type Env = { switchOn: boolean; vapidReady: boolean; ready: boolean; publicKey: string | null; issues: string[] }
type Device = { id: string; label: string; pushHost: string; status: string; createdAt: string; lastAcceptedAt: string | null; lastFailureAt: string | null; failureCount: number }
type History = { id: string; kind: string; isTest: boolean; createdAt: string; openedAt: string | null; cancelReason: string | null; lastError: string | null
  deliveries: { total: number; accepted: number; displayed: number; clicked: number; pending: number; failed: number; cancelled: number } }
type Status = {
  env: Env; migrationPending: boolean
  settings: { notifyLeads: boolean; notifyMeetings: boolean; whatsappTemplate: string; templateCustomized: boolean; lastTestAt: string | null }
  defaults: { whatsappTemplate: string }; limits: { whatsappTemplate: number }
  variables: { name: string; description: string }[]; devices: Device[]; history: History[]
}
type BeforeInstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const when = (iso: string | null) => iso ? fmt.format(new Date(iso)) : '—'
const KIND: Record<string, string> = { lead_created: 'Novo lead', meeting_confirmed: 'Reunião confirmada', meeting_whatsapp_ready: 'Confirmação pronta', test: 'Teste' }
const DEVICE_STATUS: Record<string, string> = { active: 'Ativo', revoked: 'Revogado', expired: 'Expirado', rejected: 'Precisa autorizar de novo' }
const ISSUES: Record<string, string> = {
  NOT_PREVIEW: 'fora do Preview', SWITCH_OFF: 'avisos automáticos desligados (PWA_PUSH_ENABLED)',
  VAPID_MISSING: 'chaves VAPID ainda não configuradas na Vercel', VAPID_INVALID: 'chaves VAPID inválidas', SUBJECT_INVALID: 'VAPID_SUBJECT inválido',
}
const ERRORS: Record<string, string> = {
  UNAUTHORIZED: 'Sua sessão administrativa expirou. Entre novamente.',
  MIGRATION_PENDING: 'A migração 0010 ainda não foi aplicada neste banco (depende de autorização).',
  VAPID_NOT_READY: 'As chaves VAPID ainda não foram configuradas na Vercel.',
  ENDPOINT_NOT_ALLOWED: 'Serviço de push deste navegador não reconhecido.', INVALID_SUBSCRIPTION: 'Inscrição do navegador inválida.',
  TOO_MANY_DEVICES: 'Limite de 10 aparelhos ativos. Revogue um antes.', NO_ACTIVE_DEVICE: 'Nenhum aparelho ativo para receber o teste.',
  TEST_TOO_SOON: 'Aguarde 30 segundos entre testes.', CONFIRMATION_REQUIRED: 'Confirmação necessária.',
  TEMPLATE_EMPTY: 'A mensagem não pode ficar vazia.', TEMPLATE_TOO_LONG: 'A mensagem passou do limite.', TEMPLATE_UNKNOWN_VARIABLE: 'Há uma variável desconhecida na mensagem.',
  VAPID_REJECTED: 'O serviço de push recusou a chave: autorize o aparelho de novo.', SUBSCRIPTION_GONE: 'Inscrição expirada no aparelho.',
  DEVICE_EXPIRED: 'Aparelho expirado.', DEVICE_REVOKED: 'Aparelho revogado.', DEVICE_INACTIVE: 'Aparelho inativo.', DISABLED: 'Avisos desligados.',
  EXPIRED: 'Venceu sem envio (24 h).', MEETING_CANCELLED: 'Reunião cancelada antes do envio.', MEETING_ENDED: 'Reunião já encerrada.',
  PREVIOUS_NOT_DELIVERED: 'O aviso 1 não chegou a este aparelho.', RATE_LIMITED: 'Limite do serviço de push.', PUSH_SERVICE_ERROR: 'Erro no serviço de push.',
  NETWORK_ERROR: 'Falha de rede.', TIMEOUT: 'Tempo esgotado.', INTERRUPTED: 'Envio interrompido (será repetido).',
}
const describe = (code: string | null | undefined) => code ? (ERRORS[code] || ERRORS[code.replace(/^MAX_ATTEMPTS_/, '')] || code) : ''

function keyBytes(base64url: string): Uint8Array {
  const raw = atob(base64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - base64url.length % 4) % 4))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}
function deviceLabel(): string {
  const ua = navigator.userAgent
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad'
    : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'Aparelho'
  const browser = /Edg\//.test(ua) ? 'Edge' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador'
  return os + ' · ' + browser
}

export default function NotificationsPanel() {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [template, setTemplate] = useState('')
  const [preview, setPreview] = useState<string | null>(null)
  const [device, setDevice] = useState<{ supported: boolean; ios: boolean; standalone: boolean; permission: string; endpoint: string | null; registered: string | null }>(
    { supported: false, ios: false, standalone: false, permission: 'default', endpoint: null, registered: null })
  const [installEvent, setInstallEvent] = useState<BeforeInstallPrompt | null>(null)
  const [label, setLabel] = useState('')

  const apply = useCallback((data: Status) => { setStatus(data); setTemplate(data.settings.whatsappTemplate) }, [])
  const load = useCallback(() => {
    fetch('/api/crm/push', { cache: 'no-store', credentials: 'same-origin' })
      .then(r => r.json().then(data => ({ ok: r.ok, data })))
      .then(({ ok, data }) => ok ? apply(data as Status) : setMessage({ kind: 'error', text: describe(data?.error) || 'Não foi possível consultar.' }))
      .catch(() => setMessage({ kind: 'error', text: 'Não foi possível consultar.' }))
  }, [apply])

  async function post(body: Record<string, unknown>, success?: string): Promise<Record<string, unknown> | null> {
    setBusy(true); setMessage(null)
    try {
      const r = await fetch('/api/crm/push', { method: 'POST', cache: 'no-store', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) { setMessage({ kind: 'error', text: describe(data?.error) || 'Não foi possível concluir.' }); return null }
      if (data?.env) apply(data as Status)
      if (success) setMessage({ kind: 'ok', text: success })
      return data
    } catch { setMessage({ kind: 'error', text: 'Não foi possível concluir.' }); return null } finally { setBusy(false) }
  }

  const inspectDevice = useCallback(async () => {
    const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
    let endpoint: string | null = null
    let registered: string | null = null
    if (supported) {
      try {
        const reg = await navigator.serviceWorker.getRegistration('/crm')
        const sub = await reg?.pushManager.getSubscription()
        endpoint = sub?.endpoint ?? null
        if (endpoint) {
          const r = await fetch('/api/crm/push', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
            headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'device_status', endpoint }) })
          registered = ((await r.json().catch(() => ({}))) as { status?: string | null }).status ?? null
        }
      } catch { /* sem inscrição */ }
    }
    setDevice({ supported, ios, standalone, permission: 'Notification' in window ? Notification.permission : 'unsupported', endpoint, registered })
  }, [])

  useEffect(() => {
    load(); void inspectDevice()
    const onPrompt = (e: Event) => { e.preventDefault(); setInstallEvent(e as BeforeInstallPrompt) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [load, inspectDevice])

  async function enableHere() {
    if (!status?.env.publicKey) { setMessage({ kind: 'error', text: ERRORS.VAPID_NOT_READY }); return }
    if (!device.supported) { setMessage({ kind: 'error', text: 'Este navegador não oferece notificações push.' }); return }
    if (device.ios && !device.standalone) {
      setMessage({ kind: 'error', text: 'No iPhone, primeiro adicione o SHARK SCALE à Tela de Início (Compartilhar → Adicionar à Tela de Início), abra pelo ícone e ative aqui.' })
      return
    }
    setBusy(true); setMessage(null)
    try {
      // Pedido de permissão SOMENTE aqui, depois do toque do administrador.
      const permission = await Notification.requestPermission()
      if (permission !== 'granted') {
        setMessage({ kind: 'error', text: permission === 'denied'
          ? 'As notificações foram bloqueadas. Libere nas configurações do navegador/aparelho para este site e tente de novo.'
          : 'Permissão não concedida.' })
        return
      }
      const reg = await navigator.serviceWorker.register('/crm-sw.js', { scope: '/crm', updateViaCache: 'none' })
      await navigator.serviceWorker.ready
      let sub = await reg.pushManager.getSubscription()
      const key = keyBytes(status.env.publicKey)
      const current = sub?.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null
      if (sub && (!current || current.length !== key.length || current.some((b, i) => b !== key[i]))) { await sub.unsubscribe(); sub = null }
      sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource })
      setBusy(false)
      await post({ action: 'subscribe', subscription: sub.toJSON(), label: label.trim() || deviceLabel() }, 'Aparelho autorizado. Envie um teste para conferir.')
    } catch {
      setMessage({ kind: 'error', text: 'Não foi possível ativar neste aparelho. Verifique as permissões e tente de novo.' })
    } finally { setBusy(false); void inspectDevice(); load() }
  }

  async function disableHere() {
    if (!window.confirm('Desativar as notificações NESTE aparelho?')) return
    try {
      const reg = await navigator.serviceWorker.getRegistration('/crm')
      const sub = await reg?.pushManager.getSubscription()
      if (sub) { await post({ action: 'unsubscribe_self', endpoint: sub.endpoint }); await sub.unsubscribe() }
      setMessage({ kind: 'ok', text: 'Notificações desativadas neste aparelho.' })
    } catch { setMessage({ kind: 'error', text: 'Não foi possível desativar.' }) } finally { void inspectDevice(); load() }
  }

  async function install() {
    if (!installEvent) return
    await installEvent.prompt()
    setInstallEvent(null)
  }

  if (!status) return <section className="crm-card crm-panel"><div className="crm-panel-title">Notificações</div>
    {message ? <p role="alert" className="crm-push-message" data-kind="error">{message.text}</p> : <p className="crm-panel-subtitle">Carregando…</p>}</section>

  const env = status.env
  const here = device.registered === 'active'
  const dirty = template !== status.settings.whatsappTemplate

  return <>
    <section className="crm-card crm-panel crm-push" aria-labelledby="push-title">
      <div className="crm-panel-title" id="push-title">Notificações</div>
      <div className="crm-panel-subtitle">PWA SHARK SCALE · avisos de novos leads e reuniões · sem dados pessoais na tela bloqueada</div>
      <div className="crm-push-grid">
        <div><span>Avisos automáticos</span><strong data-on={env.ready}>{env.ready ? 'LIGADOS' : 'DESLIGADOS'}</strong></div>
        <div><span>Chaves VAPID</span><strong>{env.vapidReady ? 'Configuradas' : 'Pendentes'}</strong></div>
        <div><span>Banco (migração 0010)</span><strong>{status.migrationPending ? 'Pendente' : 'Aplicada'}</strong></div>
        <div><span>Este aparelho</span><strong>{!device.supported ? 'Sem suporte a push' : here ? 'Autorizado' : device.permission === 'denied' ? 'Bloqueado' : 'Não autorizado'}</strong></div>
        <div><span>Aplicativo</span><strong>{device.standalone ? 'Instalado (tela inicial)' : 'Navegador'}</strong></div>
        <div><span>Último teste</span><strong>{when(status.settings.lastTestAt)}</strong></div>
      </div>
      {env.issues.filter(i => i !== 'NOT_PREVIEW' || !env.vapidReady).length > 0 &&
        <div className="crm-info-box">Pendências: {env.issues.map(i => ISSUES[i] || i).join(' · ')}.</div>}
      {status.migrationPending && <div className="crm-info-box">Dispositivos, fila e histórico dependem da migração 0010, aplicada no Neon Preview só com autorização.</div>}
      {device.ios && !device.standalone && <div className="crm-info-box crm-push-ios">
        <strong>iPhone:</strong> as notificações só funcionam com o app instalado. No Safari, toque em <b>Compartilhar</b> → <b>Adicionar à Tela de Início</b>, abra o SHARK SCALE pelo ícone e volte a esta tela.
      </div>}
      {!device.supported && !device.ios && <div className="crm-info-box">Este navegador não oferece notificações push. Use Chrome, Edge, Firefox ou Safari atualizados.</div>}
      <label className="crm-push-field">Nome deste aparelho (opcional)
        <input value={label} maxLength={80} placeholder={typeof navigator === 'undefined' ? '' : deviceLabel()} onChange={e => setLabel(e.target.value)} />
      </label>
      <div className="crm-push-actions">
        {!here && <button type="button" className="crm-btn crm-btn-primary" disabled={busy || !env.vapidReady || status.migrationPending} onClick={enableHere}>Ativar notificações neste aparelho</button>}
        {here && <button type="button" className="crm-btn" disabled={busy} onClick={disableHere}>Desativar neste aparelho</button>}
        <button type="button" className="crm-btn" disabled={busy || !env.vapidReady || status.migrationPending || !status.devices.some(d => d.status === 'active')}
          onClick={async () => { const r = await post({ action: 'test' }); if (r) setMessage({ kind: 'ok', text: 'Teste aceito pelo serviço de push em ' + r.accepted + ' de ' + r.total + ' aparelho(s). Confira o celular.' }); load() }}>Enviar teste</button>
        {installEvent && !device.standalone && <button type="button" className="crm-btn" onClick={install}>Instalar aplicativo</button>}
      </div>
      {message && <p role={message.kind === 'error' ? 'alert' : 'status'} className="crm-push-message" data-kind={message.kind}>{message.text}</p>}
    </section>

    <div className="crm-section-grid crm-push-sections">
      <section className="crm-card crm-panel" aria-labelledby="push-prefs">
        <div className="crm-panel-title" id="push-prefs">Preferências de avisos</div>
        <div className="crm-panel-subtitle">Valem para todos os aparelhos autorizados</div>
        {([['notifyLeads', 'Novo lead (1 aviso por cadastro novo)'], ['notifyMeetings', 'Reunião confirmada (2 avisos: reunião e confirmação pronta)']] as const).map(([key, text]) =>
          <label key={key} className="crm-push-toggle"><input type="checkbox" checked={status.settings[key]} disabled={busy || status.migrationPending}
            onChange={e => post({ action: 'preferences', notifyLeads: key === 'notifyLeads' ? e.target.checked : status.settings.notifyLeads,
              notifyMeetings: key === 'notifyMeetings' ? e.target.checked : status.settings.notifyMeetings }, 'Preferências salvas.')} /> {text}</label>)}
        <div className="crm-panel-title" style={{ marginTop: 22 }}>Mensagem do WhatsApp</div>
        <div className="crm-panel-subtitle">Pré-preenchida no botão “Enviar pelo WhatsApp” da reunião · envio sempre manual</div>
        <label className="crm-push-field">Modelo {status.settings.templateCustomized && <em>(personalizado)</em>}
          <textarea rows={9} maxLength={status.limits.whatsappTemplate} value={template} onChange={e => setTemplate(e.target.value)} />
          <small>{template.length}/{status.limits.whatsappTemplate}</small>
        </label>
        <div className="crm-push-actions">
          <button type="button" className="crm-btn crm-btn-primary" disabled={busy || status.migrationPending || !dirty} onClick={() => post({ action: 'save_template', template }, 'Mensagem salva.')}>Salvar</button>
          <button type="button" className="crm-btn" disabled={busy} onClick={async () => { const r = await post({ action: 'preview_template', template }); if (r?.text) setPreview(String(r.text)) }}>Pré-visualizar</button>
          <button type="button" className="crm-btn" disabled={busy || status.migrationPending || !status.settings.templateCustomized}
            onClick={() => { if (window.confirm('Restaurar a mensagem padrão?')) post({ action: 'restore_template', confirmed: true }, 'Mensagem padrão restaurada.') }}>Restaurar padrão</button>
        </div>
        {preview && <pre className="crm-push-preview" aria-label="Pré-visualização com dados fictícios">{preview}</pre>}
        <div className="crm-push-vars">{status.variables.map(v => <span key={v.name} title={v.description}><code>{'{' + v.name + '}'}</code></span>)}</div>
      </section>

      <section className="crm-card crm-panel" aria-labelledby="push-devices">
        <div className="crm-panel-title" id="push-devices">Aparelhos autorizados</div>
        <div className="crm-panel-subtitle">Só administradores autenticados podem autorizar aparelhos</div>
        {status.devices.length === 0 ? <div className="crm-empty">Nenhum aparelho autorizado.</div> : status.devices.map(d =>
          <div key={d.id} className="crm-push-device">
            <div><strong>{d.label}</strong><small>{DEVICE_STATUS[d.status] || d.status} · desde {when(d.createdAt)} · último aceite {when(d.lastAcceptedAt)}{d.failureCount ? ' · ' + d.failureCount + ' falha(s)' : ''}</small></div>
            {d.status === 'active' && <button type="button" className="crm-btn" disabled={busy}
              onClick={() => { if (window.confirm('Revogar o aparelho "' + d.label + '"?')) post({ action: 'revoke', deviceId: d.id }, 'Aparelho revogado.') }}>Revogar</button>}
          </div>)}
      </section>
    </div>

    <section className="crm-card crm-table-panel crm-push-log" aria-labelledby="push-history">
      <div className="crm-table-head"><div>
        <div className="crm-panel-title" id="push-history">Histórico de notificações</div>
        <div className="crm-panel-subtitle">Aceita = entregue ao serviço de push · Exibida = recibo do aparelho · Aberta = toque no aviso</div>
      </div><button type="button" className="crm-btn" disabled={busy} onClick={async () => { await post({ action: 'process_due' }); load() }}>Reprocessar</button></div>
      {status.history.length === 0 ? <div className="crm-empty">Nenhuma notificação registrada.</div> : <div className="crm-table-wrap"><table>
        <thead><tr><th>Aviso</th><th>Criado</th><th>Aparelhos</th><th>Situação</th></tr></thead>
        <tbody>{status.history.map(h => <tr key={h.id}>
          <td>{KIND[h.kind] || h.kind} {h.isTest && h.kind !== 'test' && <span className="crm-test-tag">TESTE</span>}</td>
          <td>{when(h.createdAt)}{h.openedAt && <small className="crm-push-sub">aberto {when(h.openedAt)}</small>}</td>
          <td>{h.deliveries.accepted}/{h.deliveries.total} aceitas · {h.deliveries.displayed} exibidas · {h.deliveries.clicked} abertas</td>
          <td>{h.deliveries.total === 0 ? 'Sem aparelhos' : h.deliveries.pending ? 'Na fila' : h.deliveries.failed ? 'Falha' : h.deliveries.cancelled === h.deliveries.total ? 'Cancelado' : 'Concluído'}
            {(h.lastError || h.cancelReason) && <small className="crm-push-sub">{describe(h.lastError || h.cancelReason)}</small>}</td>
        </tr>)}</tbody>
      </table></div>}
    </section>
  </>
}
