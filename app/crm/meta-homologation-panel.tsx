'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Homologação do Meta Pixel no Pixel COMERCIAL (somente Preview). Libera ESTE navegador por até 30 minutos para no
 * máximo 1 Lead e 1 Schedule de contatos de teste, marcados como homologação, depois da confirmação real do backend.
 * Os eventos podem aparecer nas métricas agregadas do conjunto de dados. Nada muda para outros visitantes.
 */
type Status = { available: boolean; active: boolean; expiresAt: string | null; scope?: 'conversions' | 'chronos' | null; maxMinutes: number }
const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', timeStyle: 'short' })
const errors: Record<string, string> = {
  HOMOLOGATION_UNAVAILABLE: 'Homologação indisponível: a chave META_HOMOLOGATION_ENABLED ou o Pixel comercial não estão ligados no Preview.',
  UNAUTHORIZED: 'Sua sessão administrativa expirou. Entre novamente.',
}

export default function MetaHomologationPanel() {
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    fetch('/api/crm/meta-homologation', { cache: 'no-store', credentials: 'same-origin' })
      .then(r => r.json().then(data => ({ ok: r.ok, data })))
      .then(({ ok, data }) => ok ? setStatus(data as Status) : setError(errors[data?.error] || 'Não foi possível consultar.'))
      .catch(() => setError('Não foi possível consultar.'))
  }, [])
  useEffect(load, [load])

  async function change(method: 'POST' | 'DELETE', scope: 'conversions' | 'chronos' = 'conversions') {
    if (method === 'POST' && scope === 'conversions' && !window.confirm('Ativar a homologação do Meta Pixel NESTE navegador por 30 minutos? '
      + 'No máximo 1 Lead e 1 Schedule de teste irão ao Pixel COMERCIAL (28992534033707610), marcados como homologação, '
      + 'e podem aparecer nas métricas do conjunto de dados. Use apenas o contato de teste.')) return
    if (method === 'POST' && scope === 'chronos' && !window.confirm('Ativar a homologação dos eventos Chronos NESTE navegador por 30 minutos? '
      + 'Somente ChronosView, ChronosFirstInteraction, ChronosSubmit e Chronos_View_Scheduled irão ao Pixel COMERCIAL '
      + '(28992534033707610), marcados como homologação, uma vez por sessão. Lead e Schedule NÃO são enviados nesta liberação. '
      + 'Use apenas o contato de teste.')) return
    setBusy(true); setError('')
    try {
      const r = await fetch('/api/crm/meta-homologation', {
        method, cache: 'no-store', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ confirmed: true, scope }) : undefined,
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) setError(errors[data?.error] || 'Não foi possível alterar.')
    } finally { setBusy(false); load() }
  }

  return <section className="crm-card crm-panel" aria-labelledby="meta-homologation-title">
    <div className="crm-panel-title" id="meta-homologation-title">Meta Pixel · Homologação</div>
    <div className="crm-panel-subtitle">Validação técnica do agendamento · Pixel comercial · ambiente Preview</div>
    <div className="crm-meta-validation" role="status">
      <div className="crm-meta-validation-head"><span className="crm-meta-check" aria-hidden="true">✓</span>
        <strong>Schedule validado na Meta</strong><span className="crm-tag">Teste aprovado</span>
      </div>
      <div className="crm-meta-validation-details">
        <span>03/11/2026 · 09h43min10s (Brasília)</span>
        <span>Programar (Schedule) · Navegador / Pixel</span>
      </div>
      <p>Comprovação registrada no Gerenciador de Eventos. Histórico verificado manualmente — esta tela não consulta eventos da Meta em tempo real.</p>
    </div>
    {status && !status.available && <p className="crm-meta-closed">Homologação encerrada. O modo de teste está desativado neste Preview; isso não desativa o Pixel comercial.</p>}
    {status?.available && <>
      <p style={{ color: '#a8b8cb', fontSize: 12 }}>
        {status.active && status.expiresAt
          ? <>Ativa até <strong>{fmt.format(new Date(status.expiresAt))}</strong>{status.scope === 'chronos' ? ' · somente eventos Chronos (sem Lead/Schedule)' : ''}. Abra o formulário pela aba "Testar eventos" da Meta, neste mesmo navegador.</>
          : 'Inativa. O formulário usa o Pixel comercial e nenhum evento de teste é enviado à Meta.'}
      </p>
      {status.active
        ? <button type="button" className="crm-btn" disabled={busy} onClick={() => change('DELETE')}>Encerrar homologação</button>
        : <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="crm-btn crm-btn-primary" disabled={busy} onClick={() => change('POST')}>Ativar por 30 minutos</button>
          <button type="button" className="crm-btn" disabled={busy} onClick={() => change('POST', 'chronos')}>Ativar eventos Chronos (30 min)</button>
        </div>}
    </>}
    {error && <p role="alert" style={{ color: '#ffd4da', fontSize: 12 }}>{error}</p>}
  </section>
}
