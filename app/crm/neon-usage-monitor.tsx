'use client'

import { useCallback, useEffect, useState } from 'react'
import { usagePercent, usageSeverity, type NeonUsageResult, type UsageQuantity } from '@/lib/crm/neon-usage'

const REFRESH_MS = 15 * 60 * 1000
const fmt = (n: number, digits = 2) => n.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits })

function bytes(value: number): string {
  if (value >= 1024 ** 3) return fmt(value / (1024 ** 3), 2) + ' GB'
  if (value >= 1024 ** 2) return fmt(value / (1024 ** 2), 1) + ' MB'
  if (value >= 1024) return fmt(value / 1024, 1) + ' KB'
  return fmt(value, 0) + ' B'
}

function UsageBar({ label, value, kind, help }: {
  label: string; value: UsageQuantity; kind: 'cu' | 'bytes'; help?: string
}) {
  const pct = usagePercent(value)
  const tone = usageSeverity(value)
  const text = (n: number) => kind === 'cu' ? fmt(n) + ' CU-h' : bytes(n)
  const amount = value.used === null ? '—' : text(value.used)
  const limit = value.limit === null ? 'limite não informado' : text(value.limit)
  return <div className="crm-neon-meter" data-tone={tone}>
    <div className="crm-neon-meter-head">
      <span title={help || label}>{label}</span>
      <strong>{amount}</strong>
    </div>
    <div className="crm-neon-meter-track" role={pct === null ? undefined : 'progressbar'}
      aria-label={label}
      aria-valuemin={pct === null ? undefined : 0}
      aria-valuemax={pct === null ? undefined : 100}
      aria-valuenow={pct === null ? undefined : Math.round(pct)}
      aria-valuetext={pct === null ? 'Limite não disponível' : fmt(pct, 1) + '% utilizado'}>
      {pct !== null && <div className="crm-neon-meter-fill"
        style={{ width: pct === 0 ? '0' : 'max(2px, ' + pct + '%)' }}/>}
    </div>
    <small>{pct === null ? limit : fmt(Math.max(0, 100 - pct), 1) + '% livre · limite ' + limit}</small>
  </div>
}

export default function NeonUsageMonitor() {
  const [result, setResult] = useState<NeonUsageResult | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [mobileExpanded, setMobileExpanded] = useState(false)

  const load = useCallback(async (signal?: AbortSignal) => {
    setRefreshing(true)
    try {
      const response = await fetch('/api/crm/neon-usage', { credentials: 'same-origin', cache: 'no-store', signal })
      if (!response.ok) throw new Error('NEON_USAGE_UNAVAILABLE')
      const value: NeonUsageResult = await response.json()
      if (!signal?.aborted) setResult(
        value.status === 'ready' || value.status === 'not_configured' || value.status === 'unavailable'
          ? value : { status: 'unavailable' },
      )
    } catch {
      if (!signal?.aborted) setResult({ status: 'unavailable' })
    } finally {
      if (!signal?.aborted) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    const id = window.setInterval(() => {
      if (!document.hidden) void load(controller.signal)
    }, REFRESH_MS)
    return () => { controller.abort(); window.clearInterval(id) }
  }, [load])

  const ready = result?.status === 'ready' ? result : null
  const updated = ready ? new Date(ready.updatedAt).toLocaleString('pt-BR', {
    timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  }) : null

  return <section className="crm-neon-monitor" data-mobile-expanded={mobileExpanded} aria-label="Uso de recursos do banco Neon">
    <div className="crm-neon-title-row">
      <div className="crm-neon-title">
        <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none">
          <path d="M5 2.8h9.4c4 0 6.6 2.7 6.6 6.5v5.4c0 4-2.7 6.4-6.2 6.4h-1.9V8.5l-5.6 9.8c-1.1 2-3.1 2.8-4.7 2.8V5.5C2.6 3.9 3.5 2.8 5 2.8Z" stroke="currentColor" strokeWidth="1.65" strokeLinejoin="round"/>
        </svg>
        <span>NEON</span>
      </div>
      {ready && <span className="crm-neon-plan">{ready.plan}</span>}
      <button type="button" className="crm-neon-toggle" aria-controls="crm-neon-details"
        aria-expanded={mobileExpanded} onClick={() => setMobileExpanded(value => !value)}>
        {mobileExpanded ? 'Fechar' : 'Ver uso'}
      </button>
      <button type="button" className="crm-neon-refresh" aria-label="Atualizar consumo da Neon"
        title="Atualizar consumo" disabled={refreshing} onClick={() => void load()}>
        <svg viewBox="0 0 24 24" width="13" height="13" fill="none"
          stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>
        </svg>
      </button>
    </div>

    <div id="crm-neon-details" className="crm-neon-details">
    {!result && <p className="crm-neon-status" role="status">Carregando uso da Neon…</p>}
    {result?.status === 'not_configured' && <p className="crm-neon-status" role="status">
      <strong>Conexão pendente.</strong> Configure a chave privada Neon no ambiente Preview da Vercel.
    </p>}
    {result?.status === 'unavailable' && <p className="crm-neon-status" role="status">
      <strong>Dados indisponíveis.</strong> Confira a conexão ou tente atualizar.
    </p>}

    {ready && <div className="crm-neon-meters">
      <UsageBar label="Processamento mensal" value={ready.compute} kind="cu"
        help="CU-horas consumidas no projeto durante o ciclo mensal da Neon."/>
      <UsageBar label="Armazenamento · Preview" value={ready.storagePreview} kind="bytes"
        help="Tamanho lógico da branch Preview; não representa todo o consumo faturável do projeto."/>
      <UsageBar label="Saída de dados mensal" value={ready.outboundTransfer} kind="bytes"
        help="Transferência de saída (egress) contabilizada no projeto neste ciclo."/>
      <p className="crm-neon-footnote">
        Armazenamento: tamanho lógico da Preview, não total do projeto.
      </p>
      <div className="crm-neon-update" aria-label="Última atualização">
        <span>{updated ? 'Atualizado ' + updated : 'Atualização pendente'}</span>
        <span>15 min</span>
      </div>
    </div>}
    </div>
  </section>
}
