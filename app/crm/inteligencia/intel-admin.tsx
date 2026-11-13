'use client'

/**
 * Painéis ADMINISTRATIVOS do modo real, dentro das áreas existentes da Central (sem página paralela):
 * - Visão do cliente → cadastro, edição, pausa e arquivamento de clientes monitorados; vínculo financeiro explícito;
 *   contas confirmadas do cliente selecionado (encerrar vínculo).
 * - Conexões e integrações → autorizar Google Ads / Meta (OAuth oficial), descobrir contas, associar conta × cliente com
 *   CONFIRMAÇÃO explícita, sincronizar, revogar e consultar a auditoria.
 * Nenhum segredo chega aqui: a API só devolve referências públicas (IDs, nomes, situações).
 */
import { useMemo, useState } from 'react'
import { formatInstant } from '@/lib/crm/intel/format'
import { formatExternalId } from '@/lib/crm/intel/model'
import { Panel, PlatformTag, ScrollTable } from './intel-ui'

type Client = { id: string; name: string; kind: 'agency' | 'client'; status: 'active' | 'paused' | 'archived'; financeClientId: string | null; financeClientName: string | null; notes: string; updatedAt: string }
type Conn = { id: string; provider: 'google' | 'meta'; authKind: string; label: string; status: string; scopes: string[]; expiresAt: string | null; lastVerifiedAt: string | null; lastErrorCode: string | null; createdAt: string }
type AssetRow = { id: string; platform: 'google_ads' | 'meta_ads'; externalId: string; name: string; currencyCode: string | null; timeZone: string | null; accountStatus: string; lastSeenAt: string | null; connectionId: string | null; accessPath: 'direct' | 'manager' | null; loginCustomerId: string | null }
type Assoc = { id: string; clientId: string; assetId: string; status: string; sharedJustification: string | null; validatedBy: string | null; validatedAt: string | null }
type Provider = { enabled: boolean; configured: boolean; missing: string[]; vault: boolean; systemUserAvailable?: boolean }
export type AdminBlock = {
  clients: Client[]; financeClients: { id: string; name: string; linkedTo: string | null }[]; connections: Conn[]; assets: AssetRow[]; associations: Assoc[]
  audit: { at: string; actor: string; action: string; entity: string; entityId: string; details: Record<string, unknown> }[]
  providers: { google: Provider; meta: Provider }
  rules: { manualIntervalMinutes: number; manualGlobalPerMinute: number; initialBackfillDays: number }
}
export type Act = (action: string, body?: Record<string, unknown>) => Promise<{ ok: boolean; status: number; body: Record<string, unknown> | null }>

const CLIENT_STATUS: Record<string, string> = { active: 'Ativo', paused: 'Pausado', archived: 'Arquivado' }
const CONN_STATUS: Record<string, string> = { active: 'Conectado', pending: 'Pendente', expired: 'Autorização expirada', revoked: 'Revogado', error: 'Com erro' }
const ASSOC_STATUS: Record<string, string> = { confirmed: 'Confirmado', probable: 'Aguardando confirmação', not_found: 'Não encontrado', no_access: 'Sem acesso', ended: 'Encerrado' }
const ACCOUNT_STATUS: Record<string, string> = { active: 'Ativa', paused: 'Pausada', suspended: 'Suspensa', closed: 'Encerrada', unknown: 'Não informada' }
const AUDIT_LABEL: Record<string, string> = {
  client_created: 'Cliente cadastrado', client_updated: 'Cliente alterado', client_archived: 'Cliente arquivado', connection_authorized: 'Plataforma autorizada',
  connection_revoked: 'Acesso revogado', accounts_discovered: 'Contas descobertas', association_proposed: 'Vínculo proposto', association_confirmed: 'Vínculo confirmado',
  association_ended: 'Vínculo encerrado', manual_sync: 'Sincronização manual',
}
const ERRORS: Record<string, string> = {
  INVALID: 'Dados inválidos. Revise os campos.', NOT_FOUND: 'Registro não encontrado.', CONFLICT: 'Este vínculo já existe.', ARCHIVED: 'Cliente arquivado não pode ser alterado.',
  ASSET_ALREADY_OWNED: 'Esta conta já está confirmada para outro cliente.', FINANCE_ALREADY_LINKED: 'Este cadastro financeiro já está vinculado a outro cliente monitorado.',
  PROVIDER_NOT_READY: 'Plataforma não habilitada ou não configurada neste ambiente.', CONNECTION_NOT_ACTIVE: 'A conexão não está ativa. Reautorize a plataforma.',
  SYNC_TOO_SOON: 'Limite de atualização atingido. Tente mais tarde.', SYNC_NOT_ALLOWED: 'Sincronização não permitida para esta conta.', ASSET_NOT_IN_CLIENT: 'Conta não confirmada para este cliente.',
  PLATFORM_PERMISSION_DENIED: 'A plataforma recusou o acesso (permissão).', PLATFORM_AUTH_EXPIRED: 'Autorização expirada. Reautorize a plataforma.', PLATFORM_RATE_LIMITED: 'Limite da plataforma atingido. Tente mais tarde.',
  UNAUTHORIZED: 'Sessão expirada. Entre novamente.', FORBIDDEN: 'Origem não autorizada.',
}
export const errorText = (code: unknown) => (typeof code === 'string' && ERRORS[code]) || 'Não foi possível concluir a operação.'

function useAction(act: Act, onDone: () => void) {
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null)
  async function run(key: string, action: string, body: Record<string, unknown>, okText: string) {
    setBusy(key); setMsg(null)
    try {
      const r = await act(action, body)
      if (r.ok) { setMsg({ tone: 'ok', text: okText }); onDone() } else setMsg({ tone: 'bad', text: errorText(r.body?.error) })
      return r
    } finally { setBusy(null) }
  }
  return { busy, msg, run, setMsg }
}

function Note({ msg }: { msg: { tone: 'ok' | 'bad'; text: string } | null }) {
  return msg ? <p className={'mi-admin-note ' + (msg.tone === 'ok' ? 'mi-admin-ok' : 'mi-err')} role="status">{msg.text}</p> : null
}

/* ======================================================= Visão do cliente ======================================================= */

export function ClientAdmin({ admin, selectedClientId, act, onChanged, onSelect, onArchived }: { admin: AdminBlock; selectedClientId: string | null; act: Act; onChanged: () => void; onSelect: (id: string) => void; onArchived: (id: string) => void }) {
  const { busy, msg, run } = useAction(act, onChanged)
  const [form, setForm] = useState({ name: '', notes: '', financeClientId: '' })
  const [editing, setEditing] = useState<{ id: string; name: string; notes: string; financeClientId: string } | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const clients = admin.clients.filter(c => c.kind === 'client' && (showArchived || c.status !== 'archived'))
  const freeFinance = (keep: string | null) => admin.financeClients.filter(f => !f.linkedTo || f.linkedTo === keep)
  const assetsOf = (clientId: string) => admin.associations.filter(a => a.clientId === clientId && a.status === 'confirmed')
  const selected = admin.clients.find(c => c.id === selectedClientId) ?? null
  const assetById = useMemo(() => new Map(admin.assets.map(a => [a.id, a])), [admin.assets])

  return <>
    <Panel title="Clientes monitorados" subtitle="Cadastro da Central. Um cliente do Financeiro só é monitorado quando vinculado aqui, explicitamente.">
      <form className="mi-admin-form" onSubmit={e => { e.preventDefault(); void run('create', 'create_client', { name: form.name, notes: form.notes, financeClientId: form.financeClientId || null }, 'Cliente cadastrado.').then(r => { if (r.ok) setForm({ name: '', notes: '', financeClientId: '' }) }) }}>
        <label className="mi-field"><span>Nome do cliente</span><input required minLength={2} maxLength={160} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex.: Clínica Sorriso"/></label>
        <label className="mi-field"><span>Cadastro financeiro (opcional)</span><select value={form.financeClientId} onChange={e => setForm({ ...form, financeClientId: e.target.value })}>
          <option value="">Sem vínculo financeiro</option>{freeFinance(null).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select></label>
        <label className="mi-field mi-field-grow"><span>Observações administrativas</span><input maxLength={2000} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} placeholder="Contrato, responsável, observações"/></label>
        <button type="submit" className="crm-btn crm-btn-primary" disabled={busy === 'create' || form.name.trim().length < 2}>Cadastrar cliente</button>
      </form>
      <Note msg={msg}/>
      <label className="mi-admin-check"><input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)}/> Mostrar arquivados</label>
      {clients.length === 0 ? <p className="mi-muted">Nenhum cliente cadastrado. Cadastre o primeiro cliente para associar contas de anúncios.</p> :
      <ScrollTable label="Clientes monitorados"><table className="mi-table">
        <thead><tr><th>Cliente</th><th>Situação</th><th>Financeiro</th><th className="mi-num">Contas confirmadas</th><th>Atualizado</th><th>Ações</th></tr></thead>
        <tbody>{clients.map(c => <tr key={c.id} data-selected={c.id === selectedClientId ? 'true' : undefined}>
          <td data-label="Cliente" className="mi-cell-title">{editing?.id === c.id
            ? <div className="mi-admin-edit-stack">
                <input className="mi-admin-input" aria-label="Nome" value={editing.name} maxLength={160} onChange={e => setEditing({ ...editing, name: e.target.value })}/>
                <input className="mi-admin-input" aria-label="Observações administrativas" placeholder="Observações administrativas" value={editing.notes} maxLength={2000} onChange={e => setEditing({ ...editing, notes: e.target.value })}/>
              </div>
            : <><strong>{c.name}</strong>{c.notes && <span className="mi-sub">{c.notes.slice(0, 80)}</span>}</>}</td>
          <td data-label="Situação"><span className="mi-badge" data-tone={c.status === 'active' ? 'ok' : c.status === 'paused' ? 'warn' : 'muted'}>{CLIENT_STATUS[c.status]}</span></td>
          <td data-label="Financeiro">{editing?.id === c.id
            ? <select className="mi-admin-input" aria-label="Cadastro financeiro" value={editing.financeClientId} onChange={e => setEditing({ ...editing, financeClientId: e.target.value })}>
                <option value="">Sem vínculo</option>{freeFinance(c.id).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}</select>
            : c.financeClientName ?? <span className="mi-muted">Sem vínculo</span>}</td>
          <td className="mi-num" data-label="Contas confirmadas">{assetsOf(c.id).length}</td>
          <td data-label="Atualizado">{formatInstant(c.updatedAt)}</td>
          <td data-label="Ações"><div className="mi-admin-actions">
            {c.status !== 'archived' && <button type="button" className="crm-btn" onClick={() => onSelect(c.id)} disabled={c.id === selectedClientId}>Ver painel</button>}
            {c.status !== 'archived' && (editing?.id === c.id
              ? <><button type="button" className="crm-btn crm-btn-primary" disabled={busy === 'edit'} onClick={() => void run('edit', 'update_client', { clientId: c.id, name: editing.name, notes: editing.notes, financeClientId: editing.financeClientId || null }, 'Cliente atualizado.').then(r => { if (r.ok) setEditing(null) })}>Salvar</button>
                  <button type="button" className="crm-btn" onClick={() => setEditing(null)}>Cancelar</button></>
              : <button type="button" className="crm-btn" onClick={() => setEditing({ id: c.id, name: c.name, notes: c.notes, financeClientId: c.financeClientId ?? '' })}>Editar</button>)}
            {c.status === 'active' && <button type="button" className="crm-btn" disabled={busy === 'st' + c.id} onClick={() => void run('st' + c.id, 'update_client', { clientId: c.id, status: 'paused' }, 'Cliente pausado.')}>Pausar</button>}
            {c.status === 'paused' && <button type="button" className="crm-btn" disabled={busy === 'st' + c.id} onClick={() => void run('st' + c.id, 'update_client', { clientId: c.id, status: 'active' }, 'Cliente reativado.')}>Reativar</button>}
            {c.status !== 'archived' && <button type="button" className="crm-btn mi-btn-danger" disabled={busy === 'ar' + c.id}
              onClick={() => { if (window.confirm(`Arquivar "${c.name}"? Os vínculos com contas de anúncios serão encerrados (o histórico é preservado).`)) void run('ar' + c.id, 'archive_client', { clientId: c.id }, 'Cliente arquivado.').then(r => { if (r.ok) onArchived(c.id) }) }}>Arquivar</button>}
          </div></td>
        </tr>)}</tbody>
      </table></ScrollTable>}
    </Panel>
    {selected && selected.status !== 'archived' && <Panel title={'Contas vinculadas · ' + selected.name} subtitle="Só contas com vínculo confirmado alimentam os indicadores deste cliente. Associações novas são feitas em Conexões e integrações.">
      {assetsOf(selected.id).length === 0 ? <p className="mi-muted">Aguardando conexão: nenhuma conta confirmada para este cliente. Nenhum número é exibido enquanto isso.</p> :
      <ScrollTable label="Contas vinculadas"><table className="mi-table">
        <thead><tr><th>Conta</th><th>Moeda</th><th>Confirmado em</th><th>Ações</th></tr></thead>
        <tbody>{assetsOf(selected.id).map(a => { const asset = assetById.get(a.assetId); return <tr key={a.id}>
          <td data-label="Conta" className="mi-cell-title"><strong>{asset?.name ?? '—'}</strong>{asset && <span className="mi-sub"><PlatformTag platform={asset.platform}/> {formatExternalId(asset.platform, asset.externalId)}</span>}</td>
          <td data-label="Moeda">{asset?.currencyCode ?? '—'}</td><td data-label="Confirmado em">{formatInstant(a.validatedAt)}</td>
          <td data-label="Ações"><button type="button" className="crm-btn mi-btn-danger" disabled={busy === 'end' + a.id}
            onClick={() => { if (window.confirm('Encerrar o vínculo desta conta com o cliente? A partir de agora ela deixa de alimentar os relatórios dele (o histórico é preservado).')) void run('end' + a.id, 'end_link', { clientId: a.clientId, assetId: a.assetId }, 'Vínculo encerrado.') }}>Encerrar vínculo</button></td>
        </tr> })}</tbody>
      </table></ScrollTable>}
    </Panel>}
  </>
}

/* =================================================== Conexões e integrações =================================================== */

export function ConnectionsAdmin({ admin, act, onChanged, oauthResult }: { admin: AdminBlock; act: Act; onChanged: () => void; oauthResult: 'ok' | 'erro' | null }) {
  const { busy, msg, run, setMsg } = useAction(act, onChanged)
  const [pick, setPick] = useState<Record<string, string>>({})
  const clients = admin.clients.filter(c => c.status !== 'archived')
  const clientName = (id: string) => admin.clients.find(c => c.id === id)?.name ?? '—'

  async function startOAuth(provider: 'google' | 'meta') {
    const r = await run('oauth' + provider, 'start_oauth', { provider }, 'Abrindo a autorização oficial…')
    const url = typeof r.body?.url === 'string' ? r.body.url : null
    if (r.ok && url && /^https:\/\/(accounts\.google\.com|www\.facebook\.com)\//.test(url)) window.location.assign(url)
  }
  async function confirmLink(asset: AssetRow, clientId: string) {
    const name = clientName(clientId)
    if (!window.confirm(`Confirmar que a conta "${asset.name}" (${formatExternalId(asset.platform, asset.externalId)}) pertence a "${name}"?\n\nSó após a confirmação os dados desta conta alimentam os relatórios deste cliente.`)) return
    const r = await run('cf' + asset.id, 'confirm_link', { clientId, assetId: asset.id }, 'Vínculo confirmado.')
    if (r.body?.error === 'ASSET_ALREADY_OWNED') {
      const just = window.prompt('Esta conta já pertence a outro cliente. Para compartilhá-la, descreva a justificativa (10 a 500 caracteres). Cancelar mantém o dono atual.')
      if (just && just.trim().length >= 10) await run('cf' + asset.id, 'confirm_link', { clientId, assetId: asset.id, sharedJustification: just.trim() }, 'Vínculo compartilhado confirmado.')
      else setMsg({ tone: 'bad', text: errorText('ASSET_ALREADY_OWNED') })
    }
  }

  const providerCard = (key: 'google' | 'meta', p: Provider) => {
    const ready = p.enabled && p.configured
    return <article key={key} className="crm-card mi-conn">
      <div className="mi-asset-head"><span className="mi-platform" data-platform={key === 'google' ? 'google_ads' : 'meta_ads'}>{key === 'google' ? 'Google Ads' : 'Meta Ads'}</span>
        <span className="mi-badge" data-tone={ready ? 'ok' : 'muted'}>{ready ? 'Disponível' : p.enabled ? 'Configuração pendente' : 'Desativado neste ambiente'}</span></div>
      <p className="mi-muted">{key === 'google' ? 'Autorização oficial do Google (somente leitura, escopo do Google Ads). Suporta contas de administrador (MCC).' : 'Login oficial da Meta com a permissão ads_read (somente leitura). Também aceita usuário do sistema do portfólio empresarial.'}</p>
      {!ready && p.missing.length > 0 && <p className="mi-muted"><small>Configuração do servidor ausente: {p.missing.join(', ')}</small></p>}
      <div className="mi-admin-actions">
        <button type="button" className="crm-btn crm-btn-primary" disabled={!ready || busy === 'oauth' + key} onClick={() => void startOAuth(key)}>Conectar {key === 'google' ? 'Google Ads' : 'Meta Ads'}</button>
        {key === 'meta' && p.systemUserAvailable && <button type="button" className="crm-btn" disabled={!ready || busy === 'su'} onClick={() => void run('su', 'connect_meta_system_user', {}, 'Usuário do sistema conectado.')}>Usar usuário do sistema</button>}
      </div>
    </article>
  }

  return <>
    {oauthResult === 'ok' && <div className="mi-callout" role="status"><strong>Autorização concluída.</strong> Use “Descobrir contas” na conexão nova para listar as contas acessíveis.</div>}
    {oauthResult === 'erro' && <div className="mi-callout mi-err" role="status"><strong>A autorização não foi concluída.</strong> Nenhuma credencial foi gravada. Tente novamente.</div>}
    <div className="mi-conn-cards">{providerCard('google', admin.providers.google)}{providerCard('meta', admin.providers.meta)}</div>
    <Note msg={msg}/>

    <Panel title="Conexões autorizadas" subtitle="Credenciais ficam cifradas no cofre do servidor. Revogar apaga a credencial e interrompe as sincronizações.">
      {admin.connections.length === 0 ? <p className="mi-muted">Nenhuma plataforma conectada.</p> :
      <ScrollTable label="Conexões"><table className="mi-table">
        <thead><tr><th>Conexão</th><th>Tipo</th><th>Situação</th><th>Última verificação</th><th>Ações</th></tr></thead>
        <tbody>{admin.connections.map(c => <tr key={c.id}>
          <td data-label="Conexão" className="mi-cell-title"><strong>{c.label}</strong><span className="mi-sub">{c.scopes.join(', ')}</span></td>
          <td data-label="Tipo">{c.authKind === 'system_user' ? 'Usuário do sistema' : 'Login OAuth'}</td>
          <td data-label="Situação"><span className="mi-badge" data-tone={c.status === 'active' ? 'ok' : c.status === 'revoked' ? 'muted' : 'bad'}>{CONN_STATUS[c.status] ?? c.status}</span>{c.lastErrorCode && <small className="mi-muted"> {c.lastErrorCode}</small>}{c.expiresAt && c.status === 'active' && <small className="mi-muted"> · expira {formatInstant(c.expiresAt)}</small>}</td>
          <td data-label="Última verificação">{formatInstant(c.lastVerifiedAt)}</td>
          <td data-label="Ações"><div className="mi-admin-actions">
            {c.status === 'active' && <button type="button" className="crm-btn" disabled={busy === 'dc' + c.id} onClick={() => void run('dc' + c.id, 'discover', { connectionId: c.id }, 'Contas descobertas.')}>{busy === 'dc' + c.id ? 'Descobrindo…' : 'Descobrir contas'}</button>}
            {c.status !== 'revoked' && <button type="button" className="crm-btn mi-btn-danger" disabled={busy === 'rv' + c.id}
              onClick={() => { if (window.confirm(`Revogar "${c.label}"? A credencial será apagada e as contas desta conexão deixam de sincronizar. Os vínculos e o histórico são preservados.`)) void run('rv' + c.id, 'revoke_connection', { connectionId: c.id }, 'Acesso revogado.') }}>Revogar</button>}
          </div></td>
        </tr>)}</tbody>
      </table></ScrollTable>}
    </Panel>

    <Panel title="Contas de anúncios descobertas" subtitle="Nenhuma conta é associada automaticamente (nem por semelhança de nome). Selecione o cliente e confirme explicitamente.">
      {admin.assets.length === 0 ? <p className="mi-muted">Nenhuma conta descoberta. Conecte uma plataforma e use “Descobrir contas”.</p> :
      <ScrollTable label="Contas descobertas"><table className="mi-table">
        <thead><tr><th>Conta</th><th>Moeda · fuso</th><th>Situação na plataforma</th><th>Acesso</th><th>Vínculos</th><th>Associar ao cliente</th></tr></thead>
        <tbody>{admin.assets.map(a => { const links = admin.associations.filter(x => x.assetId === a.id); const sel = pick[a.id] ?? ''; return <tr key={a.id}>
          <td data-label="Conta" className="mi-cell-title"><strong>{a.name}</strong><span className="mi-sub"><PlatformTag platform={a.platform}/> {formatExternalId(a.platform, a.externalId)}</span></td>
          <td data-label="Moeda · fuso">{a.currencyCode ?? '—'} · {a.timeZone ?? '—'}</td>
          <td data-label="Situação">{ACCOUNT_STATUS[a.accountStatus] ?? a.accountStatus}</td>
          <td data-label="Acesso">{!a.connectionId ? <span className="mi-badge" data-tone="muted">Sem acesso vigente</span> : a.accessPath === 'manager' ? 'Via MCC ' + formatExternalId('google_ads', a.loginCustomerId ?? '') : 'Direto'}</td>
          <td data-label="Vínculos">{links.length === 0 ? <span className="mi-muted">Nenhum</span> : links.map(l => <div key={l.id}><span className="mi-badge" data-tone={l.status === 'confirmed' ? 'ok' : 'warn'}>{ASSOC_STATUS[l.status]}</span> {clientName(l.clientId)}{l.sharedJustification ? ' (compartilhada)' : ''}</div>)}</td>
          <td data-label="Associar"><div className="mi-admin-actions">
            <select className="mi-admin-input" aria-label={'Cliente para ' + a.name} value={sel} onChange={e => setPick({ ...pick, [a.id]: e.target.value })}>
              <option value="">Selecione o cliente…</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.kind === 'agency' ? ' (agência)' : ''}</option>)}</select>
            <button type="button" className="crm-btn" disabled={!sel || busy === 'pp' + a.id || links.some(l => l.clientId === sel)} onClick={() => void run('pp' + a.id, 'propose_link', { clientId: sel, assetId: a.id }, 'Vínculo proposto (aguardando confirmação).')}>Propor</button>
            <button type="button" className="crm-btn crm-btn-primary" disabled={!sel || !a.connectionId || busy === 'cf' + a.id || links.some(l => l.clientId === sel && l.status === 'confirmed')} onClick={() => void confirmLink(a, sel)}>Confirmar vínculo</button>
          </div></td>
        </tr> })}</tbody>
      </table></ScrollTable>}
    </Panel>

    <Panel title="Auditoria" subtitle="Quem fez o quê e quando (associações, autorizações, revogações, sincronizações). Sem dados sensíveis.">
      {admin.audit.length === 0 ? <p className="mi-muted">Nenhum registro.</p> :
      <ScrollTable label="Auditoria"><table className="mi-table">
        <thead><tr><th>Quando</th><th>Ação</th><th>Responsável</th><th>Detalhes</th></tr></thead>
        <tbody>{admin.audit.map((x, i) => <tr key={i}><td data-label="Quando">{formatInstant(x.at)}</td><td data-label="Ação">{AUDIT_LABEL[x.action] ?? x.action}</td>
          <td data-label="Responsável">{x.actor.replace(/^crm_admin:/, 'admin ').slice(0, 20)}</td>
          <td data-label="Detalhes">{x.details.clientId ? clientName(String(x.details.clientId)) : ''}{typeof x.details.status === 'string' ? ' · ' + x.details.status : ''}{typeof x.details.count === 'number' ? ' · ' + x.details.count + ' contas' : ''}{typeof x.details.rows === 'number' ? ' · ' + x.details.rows + ' linhas' : ''}</td></tr>)}</tbody>
      </table></ScrollTable>}
    </Panel>
  </>
}
