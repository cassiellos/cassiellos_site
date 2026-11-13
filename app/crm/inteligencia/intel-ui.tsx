'use client'

import type { ReactNode } from 'react'
import { deltaPct, formatAgo, formatInstant, formatInt, formatMetric, formatMoney, metricTitle } from '@/lib/crm/intel/format'
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

export function Kpi({ label, value, foot, title, delta, tone }: { label: string; value: string; foot?: ReactNode; title?: string; delta?: number | null; tone?: 'sim' }) {
  return <div className="crm-card mi-kpi" data-tone={tone}>
    <div className="mi-kpi-label">{label}</div>
    <div className="mi-kpi-value" title={title}>{value}</div>
    <div className="mi-kpi-foot">{delta !== undefined && delta !== null && <span className="mi-delta" data-dir={delta >= 0 ? 'up' : 'down'}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta).toLocaleString('pt-BR')}% vs período anterior</span>}{foot}</div>
  </div>
}

export function metricText(v: MetricValue, kind: 'money' | 'percent' | 'number', currency?: string) {
  return <span title={metricTitle(v)} data-empty={v.kind !== 'value' ? 'true' : undefined}>{formatMetric(v, kind, currency)}</span>
}

/** KPIs de anúncios de UMA moeda (nunca somadas entre moedas). */
export function CurrencyKpiGrid({ k, extra }: { k: CurrencyKpis; extra?: ReactNode }) {
  return <div className="mi-kpis">
    <Kpi label={'Investimento · ' + k.currency} value={formatMoney(k.costMicros, k.currency)} delta={deltaPct(k.costMicros, k.previousCostMicros)} foot={<SimulatedTag/>}/>
    <Kpi label="Impressões" value={formatInt(k.impressions)}/>
    <Kpi label="Cliques" value={formatInt(k.clicks)}/>
    <Kpi label="CTR" value={formatMetric(k.ctr, 'percent')} title={metricTitle(k.ctr)} foot="cliques ÷ impressões"/>
    <Kpi label="CPC" value={formatMetric(k.cpcMicros, 'money', k.currency)} title={metricTitle(k.cpcMicros)} foot="investimento ÷ cliques"/>
    <Kpi label="CPM" value={formatMetric(k.cpmMicros, 'money', k.currency)} title={metricTitle(k.cpmMicros)} foot="por mil impressões"/>
    {extra}
  </div>
}

export function ConversionsTable({ rows }: { rows: ConversionKpi[] }) {
  if (!rows.length) return <p className="mi-empty">Nenhuma conversão reportada no período.</p>
  return <div className="crm-table-wrap"><table className="mi-table">
    <thead><tr><th>Origem</th><th>Definição</th><th>Atribuição</th><th className="mi-num">Conversões</th><th className="mi-num">Custo por conversão</th></tr></thead>
    <tbody>{rows.map(r => <tr key={r.platform + r.basisLabel + r.currency}>
      <td><PlatformTag platform={r.platform}/> <small className="mi-muted">{r.currency}</small></td><td>{r.basisLabel}</td><td>{r.attributionLabel}</td>
      <td className="mi-num">{r.conversions === null ? <span className="mi-muted">Não reportadas</span> : r.conversions.toLocaleString('pt-BR')}</td>
      <td className="mi-num">{metricText(r.costPerConversionMicros, 'money', r.currency)}</td>
    </tr>)}</tbody>
  </table></div>
}

export function CampaignTable({ rows }: { rows: CampaignRow[] }) {
  if (!rows.length) return <p className="mi-empty">Nenhuma campanha com os filtros atuais.</p>
  return <div className="crm-table-wrap"><table className="mi-table">
    <thead><tr><th>Campanha</th><th>Conta</th><th>Situação</th><th className="mi-num">Investimento</th><th className="mi-num">Impressões</th><th className="mi-num">Cliques</th><th className="mi-num">CTR</th><th className="mi-num">CPC</th><th className="mi-num">Conversões</th><th className="mi-num">Custo/conv.</th></tr></thead>
    <tbody>{rows.map(r => <tr key={r.key}>
      <td><strong>{r.name}</strong><span className="mi-sub"><PlatformTag platform={r.platform}/> {r.channel}</span></td>
      <td>{r.assetName}</td>
      <td><span className="mi-badge" data-tone={r.status === 'active' ? 'ok' : 'muted'}>{r.status === 'active' ? 'Ativa' : r.status === 'paused' ? 'Pausada' : 'Removida'}</span></td>
      <td className="mi-num">{r.hasData ? formatMoney(r.costMicros, r.currency) : <span className="mi-muted">Sem veiculação</span>}</td>
      <td className="mi-num">{r.hasData ? formatInt(r.impressions) : '—'}</td>
      <td className="mi-num">{r.hasData ? formatInt(r.clicks) : '—'}</td>
      <td className="mi-num">{metricText(r.ctr, 'percent')}</td>
      <td className="mi-num">{metricText(r.cpcMicros, 'money', r.currency)}</td>
      <td className="mi-num">{r.conversions === null ? <span className="mi-muted">—</span> : r.conversions.toLocaleString('pt-BR')}</td>
      <td className="mi-num">{metricText(r.costPerConversionMicros, 'money', r.currency)}</td>
    </tr>)}</tbody>
  </table></div>
}

export function AssetCardView({ a, now, onSync, syncing, syncNote }: { a: AssetCard; now: Date; onSync?: (id: string) => void; syncing?: boolean; syncNote?: string | null }) {
  return <article className="mi-asset" data-state={a.state}>
    <div className="mi-asset-head"><PlatformTag platform={a.platform}/><StateBadge state={a.state}/></div>
    <strong className="mi-asset-name">{a.name}</strong>
    <dl className="mi-asset-meta">
      <div><dt>Conta</dt><dd>{a.externalIdLabel}</dd></div>
      <div><dt>Moeda</dt><dd>{a.currency ?? '—'}</dd></div>
      <div><dt>Fuso</dt><dd>{a.timeZone ?? '—'}</dd></div>
      <div><dt>Acesso</dt><dd>{a.accessPath === 'manager' ? 'Conta gerente (MCC)' : a.accessPath === 'direct' ? 'Direto' : '—'}</dd></div>
      <div><dt>Última sincronização</dt><dd>{formatInstant(a.lastSyncAt)}{a.lastSyncAt && <small> ({formatAgo(a.lastSyncAt, now)})</small>}</dd></div>
      <div><dt>Último sucesso</dt><dd>{formatInstant(a.lastSuccessAt)}</dd></div>
    </dl>
    {a.note && <p className="mi-asset-note">{a.note}</p>}
    {a.alerts.length > 0 && <ul className="mi-asset-alerts">{a.alerts.map(x => <li key={x.kind}>{x.message}</li>)}</ul>}
    {onSync && a.association === 'confirmed' && a.connectionStatus === 'active' && <div className="mi-asset-actions">
      <button type="button" className="crm-btn" onClick={() => onSync(a.assetId)} disabled={syncing}>{syncing ? 'Sincronizando…' : 'Atualizar agora (simulação)'}</button>
      {syncNote && <small role="status">{syncNote}</small>}
    </div>}
  </article>
}

export function StateMessage({ kind, children }: { kind: 'loading' | 'error' | 'empty' | 'unauthorized'; children: ReactNode }) {
  return <div className={'crm-card mi-state'} data-kind={kind} role={kind === 'error' || kind === 'unauthorized' ? 'alert' : 'status'}>{kind === 'loading' && <span className="mi-spinner" aria-hidden="true"/>}{children}</div>
}
