'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { deltaPct, formatAgo, formatDecimal, formatInstant, formatInt, formatMetric, formatMoney, metricTitle } from '@/lib/crm/intel/format'
import type { MetricValue } from '@/lib/crm/intel/metrics'
import type { AssetCard, AssetState, CampaignRow, ConversionKpi, CurrencyKpis } from '@/lib/crm/intel/view-types'
import type { IntelPlatform } from '@/lib/crm/intel/connectors/contracts'

export const PLATFORM_NAME: Record<IntelPlatform | 'crm', string> = { google_ads: 'Google Ads', meta_ads: 'Meta Ads', ga4: 'GA4', gtm: 'GTM', crm: 'CRM' }

export const STATE_LABEL: Record<AssetState | 'no_integration', string> = {
  connected: 'Conectado', no_connection: 'Sem conexão', no_data: 'Sem dados no período', paused: 'Conta pausada', suspended: 'Conta suspensa',
  auth_expired: 'Integração expirada', sync_error: 'Sincronização com erro', stale: 'Dados desatualizados', pending_validation: 'Vínculo a validar',
  no_access: 'Sem acesso', not_found: 'Conta não encontrada', no_integration: 'Sem integração',
}
const STATE_TONE: Record<AssetState | 'no_integration', 'ok' | 'warn' | 'bad' | 'muted'> = {
  connected: 'ok', no_data: 'muted', paused: 'muted', no_connection: 'muted', no_integration: 'muted', pending_validation: 'warn', stale: 'warn',
  sync_error: 'bad', auth_expired: 'bad', suspended: 'bad', no_access: 'warn', not_found: 'warn',
}
/** Estados da INTEGRAÇÃO que tornam os números de uma campanha não atuais (independem do status publicitário). */
export const DATA_WARNING: Partial<Record<AssetState, string>> = {
  auth_expired: 'Dados desatualizados · integração expirada', stale: 'Dados desatualizados', sync_error: 'Última sincronização com erro', suspended: 'Conta suspensa',
}

export function StateBadge({ state }: { state: AssetState | 'no_integration' }) {
  return <span className="mi-badge" data-tone={STATE_TONE[state]}>{STATE_LABEL[state]}</span>
}

export function PlatformTag({ platform }: { platform: IntelPlatform | 'crm' }) {
  return <span className="mi-platform" data-platform={platform}>{PLATFORM_NAME[platform]}</span>
}

export function SimulatedTag() { return <span className="mi-sim-tag">Dados simulados</span> }

export function Panel({ title, subtitle, children, actions, className }: { title: string; subtitle?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return <section className={'crm-card crm-panel mi-panel ' + (className ?? '')}>
    <div className="crm-panel-head"><div><div className="crm-panel-title">{title}</div>{subtitle && <div className="crm-panel-subtitle">{subtitle}</div>}</div>{actions}</div>
    {children}
  </section>
}

export function Kpi({ label, value, foot, title, delta, tone, scope }: { label: string; value: string; foot?: ReactNode; title?: string; delta?: number | null; tone?: 'sim' | 'structural'; scope?: string }) {
  return <div className="crm-card mi-kpi" data-tone={tone}>
    <div className="mi-kpi-label">{label}{scope && <span className="mi-kpi-scope">{scope}</span>}</div>
    <div className="mi-kpi-value" title={title}>{value}</div>
    <div className="mi-kpi-foot">{delta !== undefined && delta !== null && <span className="mi-delta" data-dir={delta >= 0 ? 'up' : 'down'}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toLocaleString('pt-BR')}% vs período anterior</span>}{foot}</div>
  </div>
}

export function metricText(v: MetricValue, kind: 'money' | 'percent' | 'number', currency?: string) {
  return <span title={metricTitle(v)} data-empty={v.kind !== 'value' ? 'true' : undefined}>{formatMetric(v, kind, currency)}</span>
}

/** Conversões são QUANTIDADES de eventos (nunca dinheiro). */
export function conversionsText(n: number | null) {
  return n === null ? <span className="mi-muted">Não reportadas</span> : <>{formatDecimal(n)} <small className="mi-unit">eventos</small></>
}

/**
 * Tabela com rolagem horizontal SINALIZADA (sombra + aviso "deslize") quando não cabe; em telas estreitas, as tabelas
 * marcadas como `cards` viram cartões (cada célula com seu rótulo via data-label), sem perder nenhuma informação.
 */
export function ScrollTable({ children, cards = true, label }: { children: ReactNode; cards?: boolean; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [overflow, setOverflow] = useState(false)
  const [atEnd, setAtEnd] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const check = () => { setOverflow(el.scrollWidth > el.clientWidth + 2); setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 2) }
    check()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(check) : null
    ro?.observe(el)
    el.addEventListener('scroll', check, { passive: true })
    return () => { ro?.disconnect(); el.removeEventListener('scroll', check) }
  }, [])
  return <div className="mi-scroll" data-cards={cards ? 'true' : undefined} data-overflow={overflow ? 'true' : undefined} data-end={atEnd ? 'true' : undefined}>
    {overflow && <div className="mi-scroll-hint" aria-hidden="true">Deslize para ver mais colunas →</div>}
    <div ref={ref} className="crm-table-wrap mi-scroll-box" role="region" aria-label={label + (overflow ? ' (role horizontalmente para ver todas as colunas)' : '')} tabIndex={overflow ? 0 : -1}>{children}</div>
  </div>
}

/** KPIs de anúncios de UMA moeda (nunca somadas entre moedas). */
export function CurrencyKpiGrid({ k, extra, scoped }: { k: CurrencyKpis; extra?: ReactNode; scoped?: boolean }) {
  const scope = scoped ? 'recorte' : undefined
  return <div className="mi-kpis">
    <Kpi label={'Investimento · ' + k.currency} scope={scope} value={formatMoney(k.costMicros, k.currency)} delta={deltaPct(k.costMicros, k.previousCostMicros)} foot={<SimulatedTag/>}/>
    <Kpi label="Impressões" scope={scope} value={formatInt(k.impressions)}/>
    <Kpi label="Cliques" scope={scope} value={formatInt(k.clicks)}/>
    <Kpi label="CTR" scope={scope} value={formatMetric(k.ctr, 'percent')} title={metricTitle(k.ctr)} foot="cliques ÷ impressões"/>
    <Kpi label={'CPC · ' + k.currency} scope={scope} value={formatMetric(k.cpcMicros, 'money', k.currency)} title={metricTitle(k.cpcMicros)} foot="investimento ÷ cliques"/>
    <Kpi label={'CPM · ' + k.currency} scope={scope} value={formatMetric(k.cpmMicros, 'money', k.currency)} title={metricTitle(k.cpmMicros)} foot="por mil impressões"/>
    {extra}
  </div>
}

export function ConversionsTable({ rows }: { rows: ConversionKpi[] }) {
  if (!rows.length) return <p className="mi-empty">Nenhuma conversão reportada no período.</p>
  return <ScrollTable label="Conversões por origem"><table className="mi-table">
    <thead><tr><th>Origem</th><th>Definição (unidade: eventos)</th><th>Atribuição</th><th className="mi-num">Conversões</th><th className="mi-num">Custo por conversão</th></tr></thead>
    <tbody>{rows.map(r => <tr key={r.platform + r.basisLabel + r.currency}>
      <td data-label="Origem"><PlatformTag platform={r.platform}/></td><td data-label="Definição">{r.basisLabel}</td><td data-label="Atribuição">{r.attributionLabel}</td>
      <td className="mi-num" data-label="Conversões">{conversionsText(r.conversions)}</td>
      <td className="mi-num" data-label={'Custo por conversão (' + r.currency + ')'}>{metricText(r.costPerConversionMicros, 'money', r.currency)}</td>
    </tr>)}</tbody>
  </table></ScrollTable>
}

export function CampaignTable({ rows }: { rows: CampaignRow[] }) {
  if (!rows.length) return <p className="mi-empty">Nenhuma campanha com os filtros atuais.</p>
  return <ScrollTable label="Campanhas"><table className="mi-table mi-table-campaigns">
    <thead><tr><th>Campanha</th><th>Situação atual</th><th className="mi-num">Investimento</th><th className="mi-num">Conversões</th><th>Conta</th><th className="mi-num">Impressões</th><th className="mi-num">Cliques</th><th className="mi-num">CTR</th><th className="mi-num">CPC</th><th className="mi-num">Custo/conv.</th></tr></thead>
    <tbody>{rows.map(r => <tr key={r.key}>
      <td data-label="Campanha" className="mi-cell-title"><strong>{r.name}</strong><span className="mi-sub"><PlatformTag platform={r.platform}/> {r.channel}</span></td>
      <td data-label="Situação atual"><span className="mi-badge" data-tone={r.status === 'active' ? 'ok' : 'muted'}>{r.status === 'active' ? 'Ativa' : r.status === 'paused' ? 'Pausada' : 'Removida'}</span>
        {DATA_WARNING[r.dataState] && <span className="mi-badge mi-badge-data" data-tone="bad" title="Situação da integração, independente do status da campanha">{DATA_WARNING[r.dataState]}</span>}</td>
      <td className="mi-num" data-label="Investimento">{r.hasData ? formatMoney(r.costMicros, r.currency) : <span className="mi-muted">Sem veiculação no período</span>}</td>
      <td className="mi-num" data-label="Conversões">{r.hasData ? conversionsText(r.conversions) : '—'}</td>
      <td data-label="Conta">{r.assetName}</td>
      <td className="mi-num" data-label="Impressões">{r.hasData ? formatInt(r.impressions) : '—'}</td>
      <td className="mi-num" data-label="Cliques">{r.hasData ? formatInt(r.clicks) : '—'}</td>
      <td className="mi-num" data-label="CTR">{metricText(r.ctr, 'percent')}</td>
      <td className="mi-num" data-label="CPC">{metricText(r.cpcMicros, 'money', r.currency)}</td>
      <td className="mi-num" data-label="Custo por conversão">{metricText(r.costPerConversionMicros, 'money', r.currency)}</td>
    </tr>)}</tbody>
  </table></ScrollTable>
}

const ACCESS_LABEL = { yes: 'Com acesso de leitura', no: 'Sem acesso', unknown: 'Não verificado' } as const
const ASSOC_LABEL: Record<string, string> = { confirmed: 'Confirmado pelo titular', probable: 'Provável — não autorizado', not_found: 'Conta não encontrada', no_access: 'Sem acesso', ended: 'Encerrado' }

export function AssetCardView({ a, now, onSync, syncing, syncNote }: { a: AssetCard; now: Date; onSync?: (id: string) => void; syncing?: boolean; syncNote?: string | null }) {
  const confirmed = a.association === 'confirmed'
  const waitUntil = a.manualSync.retryAt && Date.parse(a.manualSync.retryAt) > now.getTime() ? a.manualSync.retryAt : null
  const canClick = a.manualSync.allowed || (a.manualSync.retryAt !== null && !waitUntil)
  return <article className="mi-asset" data-state={a.state}>
    <div className="mi-asset-head"><PlatformTag platform={a.platform}/><StateBadge state={a.state}/></div>
    <strong className="mi-asset-name">{a.name}</strong>
    <ul className="mi-trust" aria-label="Conexão, acesso e vínculo">
      <li data-ok={a.connectionStatus === 'active' ? 'true' : 'false'}><span>Conexão técnica</span><strong>{a.connectionStatus === 'none' ? 'Nenhuma' : a.connectionStatus === 'active' ? 'Ativa' : a.connectionStatus === 'expired' ? 'Expirada' : a.connectionStatus === 'revoked' ? 'Revogada' : 'Pendente/erro'}</strong></li>
      <li data-ok={a.platformAccess === 'yes' ? 'true' : 'false'}><span>Acesso à plataforma</span><strong>{ACCESS_LABEL[a.platformAccess]}</strong></li>
      <li data-ok={confirmed ? 'true' : 'false'}><span>Vínculo com o cliente</span><strong>{ASSOC_LABEL[a.association] ?? a.association}</strong></li>
    </ul>
    <dl className="mi-asset-meta">
      <div><dt>Conta</dt><dd>{a.externalIdLabel}</dd></div>
      <div><dt>Moeda</dt><dd>{a.currency ?? '—'}</dd></div>
      <div><dt>Fuso</dt><dd>{a.timeZone ?? '—'}</dd></div>
      <div><dt>Acesso</dt><dd>{a.accessPath === 'manager' ? 'Conta gerente (MCC)' : a.accessPath === 'direct' ? 'Direto' : '—'}</dd></div>
      {confirmed ? <>
        <div><dt>Última sincronização (simulada)</dt><dd>{formatInstant(a.lastSyncAt)}{a.lastSyncAt && <small> ({formatAgo(a.lastSyncAt, now)})</small>}</dd></div>
        <div><dt>Último sucesso</dt><dd>{formatInstant(a.lastSuccessAt)}</dd></div>
      </> : <div className="mi-asset-wide"><dt>Sincronização</dt><dd>Não sincronizada — {a.syncBlockReason ?? 'vínculo não confirmado'}</dd></div>}
    </dl>
    {a.note && <p className="mi-asset-note">{a.note}</p>}
    {confirmed && a.syncBlockReason && <p className="mi-asset-block">{a.syncBlockReason}</p>}
    {a.alerts.length > 0 && <ul className="mi-asset-alerts">{a.alerts.map(x => <li key={x.kind}>{x.message}</li>)}</ul>}
    {onSync && confirmed && <div className="mi-asset-actions">
      <button type="button" className="crm-btn" onClick={() => onSync(a.assetId)} disabled={syncing || !canClick}
        title={!canClick ? (a.manualSync.reason ?? undefined) : 'Simulação: nada é gravado em banco; limite de 1 atualização a cada 15 minutos por conta'}>
        {syncing ? 'Atualizando (simulação)…' : 'Atualizar agora (simulação)'}</button>
      {!canClick && <small className="mi-asset-why">{waitUntil ? 'Limite de 1 atualização a cada 15 minutos por conta. Disponível às ' + new Date(waitUntil).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) + '.' : a.manualSync.reason}</small>}
      {syncNote && <small role="status">{syncNote}</small>}
    </div>}
  </article>
}

export function StateMessage({ kind, children }: { kind: 'loading' | 'error' | 'empty' | 'unauthorized'; children: ReactNode }) {
  return <div className={'crm-card mi-state'} data-kind={kind} role={kind === 'error' || kind === 'unauthorized' ? 'alert' : 'status'}>{kind === 'loading' && <span className="mi-spinner" aria-hidden="true"/>}{children}</div>
}
