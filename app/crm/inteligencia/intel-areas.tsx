'use client'

import { useState } from 'react'
import { formatAgo, formatInstant, formatInt, formatMetric, formatMoney, metricTitle } from '@/lib/crm/intel/format'
import type { ClientView, ConnectionsView, OverviewView, ProspectingView, Trend } from '@/lib/crm/intel/view-types'
import { CompareBars, PLATFORM_COLOR, StackedShare, TrendChart, type ChartSeries } from './intel-charts'
import {
  AssetCardView, CampaignTable, ConversionsTable, CurrencyKpiGrid, Kpi, Panel, PlatformTag, SimulatedTag, STATE_LABEL, StateBadge, StateMessage, metricText,
} from './intel-ui'

/* ---------- utilidades de gráfico ---------- */
function spendSeries(trend: Trend, currency: string): ChartSeries[] {
  return trend.series.filter(s => s.unit === 'micros' && s.currency === currency)
    .map(s => ({ key: s.key, label: s.label, color: PLATFORM_COLOR[s.platform] ?? '#ccc', values: s.values }))
}
const currenciesOf = (trend: Trend) => [...new Set(trend.series.filter(s => s.currency).map(s => s.currency as string))].sort((a, b) => (a === 'BRL' ? -1 : b === 'BRL' ? 1 : a.localeCompare(b)))

function SpendTrendPanel({ trend, title }: { trend: Trend; title: string }) {
  const currencies = currenciesOf(trend)
  const [picked, setPicked] = useState<string | null>(null)
  const currency = picked && currencies.includes(picked) ? picked : currencies[0] ?? 'BRL'
  return <Panel title={title} subtitle={<>Investimento diário por plataforma · {currency} · cada conta no próprio fuso · <SimulatedTag/></>}
    actions={currencies.length > 1 ? <div className="mi-seg" role="group" aria-label="Moeda do gráfico">{currencies.map(c =>
      <button key={c} type="button" aria-pressed={c === currency} onClick={() => setPicked(c)}>{c}</button>)}</div> : undefined}>
    <TrendChart days={trend.days} series={spendSeries(trend, currency)} format={v => formatMoney(v, currency)} title={title + ' em ' + currency}/>
    {currencies.length > 1 && <p className="mi-note">Há contas em mais de uma moeda. Os valores não são somados nem convertidos sem taxa de câmbio identificada.</p>}
  </Panel>
}

/* ---------- A. Prospecção Cassiellos ---------- */
export function ProspectingArea({ v, now }: { v: ProspectingView; now: Date }) {
  const brl = v.kpis.byCurrency.find(c => c.currency === 'BRL') ?? v.kpis.byCurrency[0]
  const ch = v.funnel.byChannel
  const totalCost = ch.reduce((s, c) => s + (c.currency === (brl?.currency ?? 'BRL') ? c.costMicros : 0), 0)
  const funnelSeries: ChartSeries[] = v.trend.series.filter(s => s.platform === 'crm').map(s => ({ key: s.key, label: s.label, color: s.key.endsWith('leads') ? PLATFORM_COLOR.crm_leads : PLATFORM_COLOR.crm_meetings, values: s.values }))
  return <>
    <div className="mi-callout"><strong>Funil comercial simulado.</strong> Leads e reuniões desta área são fictícios. Na integração real virão do funil do CRM (atribuição por UTM), sem somar com as conversões reportadas pelas plataformas. O CRM real não foi consultado.</div>
    {!v.kpis.hasData ? <StateMessage kind="empty">Sem investimento das campanhas de aquisição no período selecionado.</StateMessage> : brl && <CurrencyKpiGrid k={brl} extra={<>
      <Kpi label="Leads (simulados)" value={formatInt(v.funnel.leads)} tone="sim" foot={v.funnel.unattributedLeads ? formatInt(v.funnel.unattributedLeads) + ' sem origem atribuída' : 'por canal atribuído'}/>
      <Kpi label="Reuniões (simuladas)" value={formatInt(v.funnel.meetings)} tone="sim" foot="confirmadas"/>
      <Kpi label="CPL" value={formatMetric(ch.length === 1 ? ch[0].cplMicros : cplOf(totalCost, ch.reduce((s, c) => s + c.leads, 0)), 'money', brl.currency)} foot="investimento ÷ leads atribuídos" tone="sim"/>
      <Kpi label="Custo por reunião" value={formatMetric(ch.length === 1 ? ch[0].costPerMeetingMicros : cplOf(totalCost, v.funnel.meetings), 'money', brl.currency)} foot="investimento ÷ reuniões" tone="sim"/>
    </>}/>}
    <div className="mi-grid-2">
      <SpendTrendPanel trend={v.trend} title="Evolução do investimento"/>
      <Panel title="Leads e reuniões" subtitle={<>Funil comercial por dia · <SimulatedTag/></>}>
        <TrendChart days={v.trend.days} series={funnelSeries} format={n => formatInt(n)} title="Leads e reuniões simulados por dia"/>
      </Panel>
    </div>
    <Panel title="Resultado por canal" subtitle="CPL e custo por reunião usam apenas leads atribuídos ao canal. Conversões das plataformas aparecem à parte e não são somadas.">
      {ch.length === 0 ? <p className="mi-empty">Sem canais com investimento no período.</p> : <div className="crm-table-wrap"><table className="mi-table">
        <thead><tr><th>Canal</th><th className="mi-num">Investimento</th><th className="mi-num">Leads</th><th className="mi-num">CPL</th><th className="mi-num">Reuniões</th><th className="mi-num">Custo por reunião</th><th className="mi-num">Conversões reportadas pela plataforma</th></tr></thead>
        <tbody>{ch.map(c => <tr key={c.platform}><td><PlatformTag platform={c.platform}/></td><td className="mi-num">{formatMoney(c.costMicros, c.currency)}</td>
          <td className="mi-num">{formatInt(c.leads)}</td><td className="mi-num">{metricText(c.cplMicros, 'money', c.currency)}</td><td className="mi-num">{formatInt(c.meetings)}</td>
          <td className="mi-num">{metricText(c.costPerMeetingMicros, 'money', c.currency)}</td><td className="mi-num">{c.platformConversions === null ? '—' : formatInt(c.platformConversions)}</td></tr>)}</tbody>
      </table></div>}
    </Panel>
    <Panel title="Campanhas de aquisição" subtitle="Ordenadas por investimento no período"><CampaignTable rows={v.campaigns}/></Panel>
    <Panel title="Contas da agência" subtitle="Fonte, moeda, fuso e atualização de cada conta"><div className="mi-assets">{v.assets.map(a => <AssetCardView key={a.assetId} a={a} now={now}/>)}</div></Panel>
  </>
}
function cplOf(cost: number, n: number) { return n > 0 ? { kind: 'value' as const, value: Math.round(cost / n) } : cost > 0 ? { kind: 'zero_denominator' as const } : { kind: 'no_data' as const } }

/* ---------- B. Visão geral da agência ---------- */
export function OverviewArea({ v, now, openClient }: { v: OverviewView; now: Date; openClient: (id: string) => void }) {
  const currencies = [...new Set(v.platformTotals.map(p => p.currency))].sort((a, b) => (a === 'BRL' ? -1 : b === 'BRL' ? 1 : a.localeCompare(b)))
  return <>
    <div className="mi-kpis">
      <Kpi label="Clientes monitorados" value={String(v.monitoredClients)} foot="clientes externos (a agência fica em Prospecção)"/>
      {currencies.map(c => { const t = v.platformTotals.filter(p => p.currency === c); return <Kpi key={c} label={'Investimento total · ' + c}
        value={formatMoney(t.reduce((s, p) => s + p.costMicros, 0), c)} foot={t.map(p => (p.platform === 'google_ads' ? 'Google ' : 'Meta ') + formatMoney(p.costMicros, c)).join(' · ')}/> })}
      <Kpi label="Campanhas" value={formatInt(v.campaigns.active + v.campaigns.paused)} foot={formatInt(v.campaigns.active) + ' ativas · ' + formatInt(v.campaigns.paused) + ' pausadas'}/>
      <Kpi label="Alertas de integração" value={String(v.alerts.length)} foot="conexões, vínculos e dados"/>
    </div>
    <Panel title="Desempenho por plataforma" subtitle="Taxas calculadas sobre os totais de cada plataforma e moeda (nunca média de percentuais)">
      <div className="crm-table-wrap"><table className="mi-table">
        <thead><tr><th>Plataforma</th><th>Moeda</th><th className="mi-num">Investimento</th><th className="mi-num">Impressões</th><th className="mi-num">Cliques</th><th className="mi-num">CTR</th><th className="mi-num">CPC</th><th className="mi-num">CPM</th></tr></thead>
        <tbody>{v.platformTotals.map(p => <tr key={p.platform + p.currency}><td><PlatformTag platform={p.platform}/></td><td>{p.currency}</td>
          <td className="mi-num">{formatMoney(p.costMicros, p.currency)}</td><td className="mi-num">{formatInt(p.impressions)}</td><td className="mi-num">{formatInt(p.clicks)}</td>
          <td className="mi-num">{metricText(p.ctr, 'percent')}</td><td className="mi-num">{metricText(p.cpcMicros, 'money', p.currency)}</td><td className="mi-num">{metricText(p.cpmMicros, 'money', p.currency)}</td></tr>)}
          {!v.platformTotals.length && <tr><td colSpan={8} className="mi-empty">Sem dados no período.</td></tr>}</tbody>
      </table></div>
    </Panel>
    <div className="mi-grid-2">
      <SpendTrendPanel trend={v.trend} title="Tendência do investimento"/>
      <Panel title="Distribuição do investimento" subtitle="Por plataforma, separada por moeda">
        {v.distribution.map(d => <div key={d.currency} className="mi-dist"><div className="mi-dist-ccy">{d.currency}</div>
          <StackedShare parts={d.parts.map(p => ({ key: p.platform, label: p.platform === 'google_ads' ? 'Google Ads' : 'Meta Ads', color: PLATFORM_COLOR[p.platform], value: p.costMicros, sharePct: p.sharePct }))} format={x => formatMoney(x, d.currency)}/></div>)}
        {!v.distribution.length && <p className="mi-empty">Sem investimento no período.</p>}
      </Panel>
    </div>
    <div className="mi-grid-2">
      <Panel title="Comparação entre clientes" subtitle="Investimento no período, por moeda (clique para abrir o cliente)">
        {v.comparison.map(c => <div key={c.currency} className="mi-dist"><div className="mi-dist-ccy">{c.currency}</div>
          <CompareBars items={c.items.map(i => ({ key: i.clientId, label: i.name, value: i.costMicros }))} format={x => formatMoney(x, c.currency)} onSelect={openClient}/></div>)}
        {!v.comparison.length && <p className="mi-empty">Sem investimento no período.</p>}
      </Panel>
      <Panel title="Conversões por origem" subtitle="Cada plataforma com sua definição e atribuição — não representam pessoas ou leads únicos e não são somadas">
        <ConversionsTable rows={v.conversions}/>
      </Panel>
    </div>
    <Panel title="Clientes" subtitle="Situação, investimento, eficiência e atualização de cada cliente">
      <div className="crm-table-wrap"><table className="mi-table">
        <thead><tr><th>Cliente</th><th>Situação</th><th>Plataformas</th><th className="mi-num">Investimento</th><th className="mi-num">CTR</th><th className="mi-num">CPC</th><th className="mi-num">CPM</th><th>Conversões (por plataforma)</th><th className="mi-num">Campanhas</th><th>Atualização</th><th className="mi-num">Alertas</th></tr></thead>
        <tbody>{v.rows.map(r => <tr key={r.id}>
          <td><button type="button" className="mi-link" onClick={() => openClient(r.id)}>{r.name}</button></td>
          <td><StateBadge state={r.state}/></td>
          <td>{r.platforms.length ? r.platforms.map(p => <PlatformTag key={p} platform={p}/>) : <span className="mi-muted">Nenhuma</span>}</td>
          <td className="mi-num">{r.byCurrency.length ? r.byCurrency.map(c => <div key={c.currency}>{formatMoney(c.costMicros, c.currency)}</div>) : <span className="mi-muted">Sem dados</span>}</td>
          <td className="mi-num">{r.byCurrency.map(c => <div key={c.currency}>{metricText(c.ctr, 'percent')}</div>)}</td>
          <td className="mi-num">{r.byCurrency.map(c => <div key={c.currency}>{metricText(c.cpcMicros, 'money', c.currency)}</div>)}</td>
          <td className="mi-num">{r.byCurrency.map(c => <div key={c.currency}>{metricText(c.cpmMicros, 'money', c.currency)}</div>)}</td>
          <td>{r.conversions.length ? r.conversions.map(c => <div key={c.platform + c.currency}><PlatformTag platform={c.platform}/> {c.conversions === null ? 'não reportadas' : formatInt(c.conversions)}</div>) : <span className="mi-muted">—</span>}</td>
          <td className="mi-num">{r.activeCampaigns} ativas<br/><small className="mi-muted">{r.pausedCampaigns} pausadas</small></td>
          <td>{r.lastSuccessAt ? <>{formatInstant(r.lastSuccessAt)}<br/><small className="mi-muted">{formatAgo(r.lastSuccessAt, now)}</small></> : <span className="mi-muted">—</span>}</td>
          <td className="mi-num">{r.openAlerts ? <span className="mi-badge" data-tone="warn">{r.openAlerts}</span> : '0'}</td>
        </tr>)}</tbody>
      </table></div>
    </Panel>
    <Panel title="Alertas de integração e ausência de dados" subtitle="Situações que pedem acompanhamento">
      {v.alerts.length === 0 ? <p className="mi-empty">Nenhum alerta.</p> : <ul className="mi-alerts">{v.alerts.map((a, i) => <li key={i}>
        <PlatformTag platform={a.platform}/><div><strong>{a.clientName} · {a.assetName}</strong><span>{alertLabel(a.kind)} — {a.message}</span></div></li>)}</ul>}
    </Panel>
  </>
}
const ALERT_LABEL: Record<string, string> = {
  auth_expired: 'Integração expirada', auth_revoked: 'Autorização revogada', permission_denied: 'Sem permissão', rate_limited: 'Limite de chamadas', sync_failed: 'Falha na sincronização',
  sync_partial: 'Sincronização parcial', stale: 'Dados desatualizados', stale_data: 'Dados desatualizados', no_data: 'Sem dados', account_suspended: 'Conta suspensa',
  association_probable: 'Vínculo a validar', association_not_found: 'Conta não encontrada', association_no_access: 'Sem acesso',
}
const alertLabel = (k: string) => ALERT_LABEL[k] ?? k

/* ---------- C. Visão individual do cliente ---------- */
export function ClientArea({ v, now, onSync, syncing, syncNotes }: { v: ClientView; now: Date; onSync: (assetId: string) => void; syncing: string | null; syncNotes: Record<string, string> }) {
  const none = v.assets.length === 0
  return <>
    <div className="mi-client-head crm-card">
      <div><div className="crm-eyebrow">Cliente selecionado</div><h2>{v.client.name}</h2>
        <p className="mi-muted">{v.assets.length} ativo(s) confirmado(s) · {v.pendingAssets.length} pendência(s) de vínculo · {v.client.financeLinked ? 'vinculado ao cadastro financeiro' : 'sem vínculo com o cadastro financeiro'}</p></div>
      <StateBadge state={v.client.state}/>
    </div>
    {none ? <StateMessage kind="empty"><strong>Sem integração.</strong> Este cliente ainda não tem contas conectadas e confirmadas. Quando houver, as métricas aparecerão aqui — nada de outro cliente é exibido.</StateMessage> : <>
      {!v.kpis.hasData && <StateMessage kind="empty">Sem dados de anúncios no período selecionado para as contas confirmadas deste cliente.</StateMessage>}
      {v.kpis.byCurrency.map(k => <div key={k.currency} className="mi-ccy-block">{v.kpis.byCurrency.length > 1 && <div className="mi-ccy-title">Contas em {k.currency}</div>}<CurrencyKpiGrid k={k}/></div>)}
      {v.kpis.byCurrency.length > 1 && <p className="mi-note">Este cliente tem contas em {v.kpis.byCurrency.map(k => k.currency).join(' e ')}. Os totais ficam separados por moeda: não há conversão cambial identificada.</p>}
      <div className="mi-grid-2">
        <SpendTrendPanel trend={v.trend} title="Evolução do investimento"/>
        <Panel title="Conversões por origem" subtitle="Definição e atribuição de cada plataforma; não somadas entre si"><ConversionsTable rows={v.kpis.conversions}/></Panel>
      </div>
      <Panel title="Campanhas" subtitle="Ativas e pausadas · filtros de situação e busca no topo"><CampaignTable rows={v.campaigns}/></Panel>
      {(v.ga4.length > 0 || v.gtm.length > 0) && <div className="mi-grid-2">
        {v.ga4.map(g => <Panel key={g.assetId} title={'Comportamento no site · ' + g.name} subtitle={<>Google Analytics 4 · não somar às conversões das plataformas · <SimulatedTag/></>}>
          {!g.hasData ? <p className="mi-empty">Sem dados no período.</p> : <><div className="mi-mini-kpis">
            <div><span>Sessões</span><strong>{formatInt(g.sessions)}</strong></div><div><span>Usuários</span><strong>{formatInt(g.totalUsers)}</strong></div>
            <div><span>Taxa de engajamento</span><strong title={metricTitle(g.engagementRate)}>{formatMetric(g.engagementRate, 'percent')}</strong></div><div><span>Eventos-chave</span><strong>{formatInt(g.keyEvents)}</strong></div></div>
            <CompareBars items={g.sources.map(s => ({ key: s.source + s.medium, label: s.source + ' / ' + s.medium, value: s.sessions }))} format={n => formatInt(n) + ' sessões'}/></>}
        </Panel>)}
        {v.gtm.map(g => <Panel key={g.assetId} title={'Diagnóstico de tags · ' + g.publicId} subtitle="Google Tag Manager · somente leitura de metadados (não é fonte de métricas)">
          <ul className="mi-checks">
            <li data-ok="true">Versão publicada: {g.liveVersionId ?? '—'} · {g.tagCount} tags</li>
            <li data-ok={String(g.hasGa4Tag)}>{g.hasGa4Tag ? 'Tag do GA4 encontrada' : 'Tag do GA4 não encontrada'}</li>
            <li data-ok={String(g.hasMetaPixelTag)}>{g.hasMetaPixelTag ? 'Tag do Pixel Meta encontrada' : 'Tag do Pixel Meta não encontrada no contêiner'}</li>
            <li data-ok="true">Leitura em {formatInstant(g.fetchedAt)}</li>
          </ul>
        </Panel>)}
      </div>}
    </>}
    {v.assets.length > 0 && <Panel title="Contas e propriedades confirmadas" subtitle="Somente vínculos confirmados alimentam as métricas"><div className="mi-assets">
      {v.assets.map(a => <AssetCardView key={a.assetId} a={a} now={now} onSync={onSync} syncing={syncing === a.assetId} syncNote={syncNotes[a.assetId] ?? null}/>)}</div></Panel>}
    {v.pendingAssets.length > 0 && <Panel title="Vínculos pendentes" subtitle="Prováveis, não encontrados ou sem acesso — não entram em nenhuma métrica"><div className="mi-assets">
      {v.pendingAssets.map(a => <AssetCardView key={a.assetId} a={a} now={now}/>)}</div></Panel>}
  </>
}

/* ---------- D. Conexões e integrações ---------- */
export function ConnectionsArea({ v, now }: { v: ConnectionsView; now: Date }) {
  return <>
    <div className="mi-callout"><strong>Estrutura demonstrativa.</strong> Nesta fase não existe login OAuth, troca de tokens nem conexão real. Os controles abaixo estão desabilitados e as situações exibidas são simuladas.</div>
    <div className="mi-conn-cards">{v.connections.map(c => <article key={c.id} className="crm-card mi-conn">
      <div className="mi-asset-head"><span className="mi-platform" data-platform={c.provider === 'google' ? 'google_ads' : 'meta_ads'}>{c.provider === 'google' ? 'Google' : 'Meta'}</span>
        <span className="mi-badge" data-tone={c.status === 'active' ? 'ok' : c.status === 'pending' ? 'warn' : 'bad'}>{CONN_STATUS[c.status]}</span></div>
      <strong>{c.label}</strong>
      <dl className="mi-asset-meta"><div><dt>Tipo</dt><dd>{c.authKind === 'system_user' ? 'Usuário do sistema (portfólio)' : 'Login OAuth'}</dd></div>
        <div><dt>Permissões</dt><dd>{c.scopes.join(', ')}</dd></div><div><dt>Última verificação</dt><dd>{formatInstant(c.lastVerifiedAt)} ({formatAgo(c.lastVerifiedAt, now)})</dd></div></dl>
      <button type="button" className="crm-btn" disabled title="Indisponível nesta fase">{c.status === 'active' ? 'Verificar conexão' : 'Reautorizar'} — indisponível (demonstração)</button>
    </article>)}
      <article className="crm-card mi-conn mi-conn-new"><strong>Nova conexão</strong><p className="mi-muted">Google Ads, GA4, GTM e Meta Ads serão conectados numa fase futura, somente leitura, após aprovação do titular.</p>
        <button type="button" className="crm-btn" disabled>Conectar conta — indisponível (demonstração)</button></article>
    </div>
    <Panel title="Contas por cliente" subtitle="Vínculo, autorização, verificação, sincronização, erros e ação administrativa prevista">
      <div className="crm-table-wrap"><table className="mi-table">
        <thead><tr><th>Cliente</th><th>Plataforma</th><th>Conta externa</th><th>Vínculo</th><th>Autorização</th><th>Última verificação</th><th>Última sincronização</th><th>Erro</th><th>Ação prevista</th></tr></thead>
        <tbody>{v.rows.map((r, i) => <tr key={i}>
          <td>{r.clientName}</td><td><PlatformTag platform={r.platform}/></td>
          <td><strong>{r.assetName}</strong><span className="mi-sub">{r.externalIdLabel}{r.accessPath === 'manager' ? ' · via MCC' : ''}</span></td>
          <td><span className="mi-badge" data-tone={r.association === 'confirmed' ? 'ok' : 'warn'}>{ASSOC[r.association]}</span></td>
          <td><span className="mi-badge" data-tone={r.authStatus === 'active' ? 'ok' : r.authStatus === 'none' ? 'muted' : 'bad'}>{r.authStatus === 'none' ? 'Sem conexão' : CONN_STATUS[r.authStatus]}</span></td>
          <td>{formatInstant(r.lastVerifiedAt)}</td>
          <td>{r.lastSyncAt ? <>{formatInstant(r.lastSyncAt)}<br/><small className="mi-muted">{RUN_STATUS[r.lastRunStatus ?? ''] ?? '—'}</small></> : '—'}</td>
          <td>{r.lastError ? <span className="mi-err">{r.lastError}</span> : <span className="mi-muted">—</span>}</td>
          <td>{r.plannedAction}</td>
        </tr>)}</tbody>
      </table></div>
    </Panel>
    <Panel title="Execuções recentes de sincronização" subtitle={<>Registro do motor de sincronização (mock): tentativas, linhas e erros sanitizados · <SimulatedTag/></>}>
      <div className="crm-table-wrap"><table className="mi-table">
        <thead><tr><th>Início</th><th>Conta</th><th>Tipo</th><th>Origem</th><th>Situação</th><th className="mi-num">Tentativas</th><th className="mi-num">Linhas</th><th>Erro</th></tr></thead>
        <tbody>{v.recentRuns.map((r, i) => <tr key={i}><td>{formatInstant(r.startedAt)}</td><td>{r.assetName}</td><td>{KIND[r.kind] ?? r.kind}</td><td>{TRIGGER[r.trigger] ?? r.trigger}</td>
          <td><span className="mi-badge" data-tone={r.status === 'succeeded' ? 'ok' : r.status === 'partial' ? 'warn' : 'bad'}>{RUN_STATUS[r.status] ?? r.status}</span></td>
          <td className="mi-num">{r.attempts}</td><td className="mi-num">{formatInt(r.rows)}</td><td>{r.error ?? '—'}</td></tr>)}</tbody>
      </table></div>
    </Panel>
  </>
}
const CONN_STATUS: Record<string, string> = { active: 'Autorizada', pending: 'Pendente', expired: 'Expirada', revoked: 'Revogada', error: 'Com erro' }
const ASSOC: Record<string, string> = { confirmed: 'Confirmado', probable: 'Provável', not_found: 'Não encontrado', no_access: 'Sem acesso' }
const RUN_STATUS: Record<string, string> = { succeeded: 'Concluída', partial: 'Parcial', failed: 'Falhou', skipped_locked: 'Ignorada (em andamento)' }
const KIND: Record<string, string> = { ads_daily: 'Métricas diárias', ga4_daily: 'GA4 diário', gtm_snapshot: 'Diagnóstico GTM' }
const TRIGGER: Record<string, string> = { schedule: 'Diária', manual: 'Manual', backfill: 'Histórico' }

export { STATE_LABEL }
