'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * Homologação do Meta Pixel (somente Preview). Libera ESTE navegador por até 30 minutos: o formulário passa a
 * usar o Pixel do dataset de HOMOLOGAÇÃO (nunca o comercial) e Lead/Schedule de contatos de teste são enviados
 * a ele, depois da confirmação real do backend. Nada muda para outros visitantes.
 */
type Status = { available: boolean; active: boolean; expiresAt: string | null; maxMinutes: number }
const fmt = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', timeStyle: 'short' })
const errors: Record<string, string> = {
  HOMOLOGATION_UNAVAILABLE: 'Homologação indisponível: falta configurar o dataset de homologação no Preview.',
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

  async function change(method: 'POST' | 'DELETE') {
    if (method === 'POST' && !window.confirm('Ativar a homologação do Meta Pixel NESTE navegador por 30 minutos? '
      + 'Os eventos irão só para o dataset de homologação. Use apenas o contato de teste.')) return
    setBusy(true); setError('')
    try {
      const r = await fetch('/api/crm/meta-homologation', {
        method, cache: 'no-store', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ confirmed: true }) : undefined,
      })
      const data = await r.json().catch(() => ({}))
      if (!r.ok) setError(errors[data?.error] || 'Não foi possível alterar.')
    } finally { setBusy(false); load() }
  }

  return <section className="crm-card crm-panel" aria-labelledby="meta-homologation-title">
    <div className="crm-panel-title" id="meta-homologation-title">Homologação do Meta Pixel</div>
    <div className="crm-panel-subtitle">Somente Preview · dataset de homologação · até 30 minutos neste navegador</div>
    {status && !status.available && <div className="crm-info-box">Indisponível: o dataset de homologação não está configurado.</div>}
    {status?.available && <>
      <p style={{ color: '#a8b8cb', fontSize: 12 }}>
        {status.active && status.expiresAt
          ? <>Ativa até <strong>{fmt.format(new Date(status.expiresAt))}</strong>. Abra o formulário nesta mesma janela.</>
          : 'Inativa. O formulário usa o Pixel comercial e nenhum evento de teste é enviado à Meta.'}
      </p>
      {status.active
        ? <button type="button" className="crm-btn" disabled={busy} onClick={() => change('DELETE')}>Encerrar homologação</button>
        : <button type="button" className="crm-btn crm-btn-primary" disabled={busy} onClick={() => change('POST')}>Ativar por 30 minutos</button>}
    </>}
    {error && <p role="alert" style={{ color: '#ffd4da', fontSize: 12 }}>{error}</p>}
  </section>
}
