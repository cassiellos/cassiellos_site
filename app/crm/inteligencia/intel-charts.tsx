'use client'

import { useId, useMemo, useState } from 'react'
import { formatCivil } from '@/lib/crm/intel/format'

/** Gráficos em SVG próprio (mesmo padrão do LeadGraph do dashboard): sem dependências, acessíveis, responsivos. */

export const PLATFORM_COLOR: Record<string, string> = { google_ads: '#4d8dff', meta_ads: '#22c7f2', crm_leads: '#34d6a0', crm_meetings: '#f5b84b', ga4: '#a78bfa', gtm: '#94a3b8' }

export type ChartSeries = { key: string; label: string; color: string; values: (number | null)[]; dashed?: boolean }

const W = 760, H = 236, PAD_L = 58, PAD_R = 14, PAD_T = 14, PAD_B = 30

function niceMax(v: number): number {
  if (v <= 0) return 1
  const exp = Math.pow(10, Math.floor(Math.log10(v)))
  const n = v / exp
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * exp
}

export function TrendChart({ days, series, format, title, emptyText = 'Sem dados no período selecionado.' }: {
  days: string[]; series: ChartSeries[]; format: (v: number) => string; title: string; emptyText?: string
}) {
  const [hover, setHover] = useState<number | null>(null)
  const id = useId()
  const hasData = series.some(s => s.values.some(v => v !== null && v > 0))
  const max = useMemo(() => niceMax(Math.max(0, ...series.flatMap(s => s.values.map(v => v ?? 0)))), [series])
  if (!days.length || !series.length || !hasData) return <div className="mi-chart-empty" role="note">{emptyText}</div>
  const innerW = W - PAD_L - PAD_R, innerH = H - PAD_T - PAD_B
  const x = (i: number) => PAD_L + (days.length === 1 ? innerW / 2 : (i * innerW) / (days.length - 1))
  const y = (v: number) => PAD_T + innerH - (v / max) * innerH
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => t * max)
  const labelEvery = Math.max(1, Math.ceil(days.length / 7))
  const path = (vals: (number | null)[]) => vals.map((v, i) => (i === 0 || vals[i - 1] === null ? 'M' : 'L') + x(i).toFixed(1) + ' ' + y(v ?? 0).toFixed(1)).join(' ')
  const colW = innerW / Math.max(1, days.length - 1)
  return <figure className="mi-chart" aria-labelledby={id}>
    <figcaption id={id} className="mi-sr-only">{title}</figcaption>
    <div className="mi-chart-legend">{series.map(s => <span key={s.key}><i style={{ background: s.color }} data-dashed={s.dashed ? 'true' : undefined}/>{s.label}</span>)}</div>
    <div className="mi-chart-box">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
        {ticks.map(t => <g key={t}><line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} className="mi-grid"/><text x={PAD_L - 8} y={y(t) + 4} textAnchor="end" className="mi-axis">{format(t)}</text></g>)}
        {days.map((d, i) => i % labelEvery === 0 || i === days.length - 1 ? <text key={d} x={x(i)} y={H - 8} textAnchor="middle" className="mi-axis">{formatCivil(d)}</text> : null)}
        {series.map((s, si) => <g key={s.key}>
          {si === 0 && <path d={path(s.values) + ` L${x(days.length - 1)} ${y(0)} L${x(0)} ${y(0)} Z`} fill={s.color} opacity={0.08}/>}
          <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2.2} strokeDasharray={s.dashed ? '6 5' : undefined} strokeLinejoin="round" strokeLinecap="round"/>
        </g>)}
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD_T} y2={PAD_T + innerH} className="mi-hover-line"/>}
        {hover !== null && series.map(s => s.values[hover] !== null ? <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4} fill={s.color} stroke="#07101f" strokeWidth={2}/> : null)}
        {days.map((d, i) => <rect key={d} x={x(i) - colW / 2} y={PAD_T} width={Math.max(colW, 4)} height={innerH} fill="transparent" tabIndex={0}
          aria-label={formatCivil(d, true) + ': ' + series.map(s => s.label + ' ' + (s.values[i] === null ? 'sem dados' : format(s.values[i] ?? 0))).join('; ')}
          onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} className="mi-hit"/>)}
      </svg>
      {hover !== null && <div className="mi-tooltip" style={{ left: `${(x(hover) / W) * 100}%` }} role="status">
        <strong>{formatCivil(days[hover], true)}</strong>
        {series.map(s => <span key={s.key}><i style={{ background: s.color }}/>{s.label}: {s.values[hover] === null ? 'sem dados' : format(s.values[hover] ?? 0)}</span>)}
      </div>}
    </div>
  </figure>
}

export function StackedShare({ parts, format }: { parts: { key: string; label: string; color: string; value: number; sharePct: number }[]; format: (v: number) => string }) {
  if (!parts.length) return <div className="mi-chart-empty">Sem investimento no período.</div>
  return <div className="mi-share">
    <div className="mi-share-bar" role="img" aria-label={parts.map(p => p.label + ' ' + p.sharePct + '%').join(', ')}>
      {parts.map(p => <span key={p.key} style={{ width: p.sharePct + '%', background: p.color }}/>)}
    </div>
    <ul className="mi-share-legend">{parts.map(p => <li key={p.key}><i style={{ background: p.color }}/><span>{p.label}</span><strong>{format(p.value)}</strong><em>{p.sharePct.toLocaleString('pt-BR')}%</em></li>)}</ul>
  </div>
}

export function CompareBars({ items, format, onSelect }: { items: { key: string; label: string; value: number }[]; format: (v: number) => string; onSelect?: (key: string) => void }) {
  if (!items.length) return <div className="mi-chart-empty">Sem investimento no período.</div>
  const max = Math.max(...items.map(i => i.value), 1)
  return <ul className="mi-compare">{items.map(i => <li key={i.key}>
    {onSelect ? <button type="button" onClick={() => onSelect(i.key)}>{i.label}</button> : <span>{i.label}</span>}
    <div className="mi-compare-track"><div style={{ width: Math.max(2, (i.value / max) * 100) + '%' }}/></div>
    <strong>{format(i.value)}</strong>
  </li>)}</ul>
}
