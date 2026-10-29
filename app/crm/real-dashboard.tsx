'use client'
import { useEffect, useMemo, useState } from 'react'
import './real-dashboard.css'

type Data = {
  metrics: { leads:number; qualified:number; scheduled:number; completed:number; contracts:number }
  days: {date:string; count:number}[]
  recent: {id:string; name:string; company:string|null; stage:string; source:string|null; createdAt:string}[]
}
const zone = 'America/Sao_Paulo'
const formatDay = new Intl.DateTimeFormat('pt-BR', {day:'2-digit',month:'2-digit',timeZone:'UTC'})
const fullTime = new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',timeZone:zone})
const stages: Record<string,string> = {new:'Novo',contacted:'Contatado',qualified:'Qualificado',disqualified:'Desqualificado',customer:'Cliente'}

function LeadGraph({days}:{days:Data['days']}) {
  const max = Math.max(1,...days.map(d=>d.count))
  const points = days.map((d,i)=>({x:32 + i*680/Math.max(1,days.length-1),y:196-d.count/max*170}))
  const line = points.map((p,i)=>(i===0?'M':'L')+p.x.toFixed(2)+' '+p.y.toFixed(2)).join(' ')
  const area = line + ' L 712 196 L 32 196 Z'
  return <div className="crm-live-graph">
    <svg viewBox="0 0 744 216" role="img" aria-label="Evolução diária real dos leads no período">
      {[0,.25,.5,.75,1].map(n=><line key={n} x1="32" x2="712" y1={196-n*170} y2={196-n*170}
        stroke="#334058" strokeOpacity=".5" strokeDasharray="4 7"/>)}
      {points.length>0&&<><path d={area} fill="rgba(241,60,75,.13)"/><path d={line}
        stroke="#f13c4b" strokeWidth="3.3" fill="none" strokeLinejoin="round" strokeLinecap="round"/>
        {points.map((p,i)=>days[i].count>0&&<circle key={i} cx={p.x} cy={p.y} r="3.8" fill="#f13c4b"/>)}</>}
    </svg>
    <div className="crm-live-chart-labels">{days.filter((_,i)=>i===0||i===days.length-1||(days.length<=7)||(i%5===0)).map(d=>
      <span key={d.date}>{formatDay.format(new Date(d.date+'T12:00:00Z'))}</span>)}</div>
  </div>
}

export default function RealDashboard({period,openView}:{period:'7d'|'30d';openView:(view:'leads'|'agenda'|'funil')=>void}) {
  const [data,setData]=useState<Data|null>(null)
  const [state,setState]=useState<'loading'|'ready'|'unauthorized'|'error'>('loading')
  const [refresh,setRefresh]=useState(0)
  useEffect(()=>{
    const controller=new AbortController()
    setState('loading')
    fetch('/api/crm/dashboard?period='+period,{cache:'no-store',credentials:'same-origin',signal:controller.signal})
      .then(async response=>{
        if(response.status===401) throw new Error('UNAUTHORIZED')
        if(!response.ok) throw new Error('UNAVAILABLE')
        const result:unknown=await response.json()
        if(!result||typeof result!=='object'||!('metrics' in result)||!('days' in result)||!('recent' in result))throw new Error('INVALID')
        return result as Data
      }).then(result=>{if(!controller.signal.aborted){setData(result);setState('ready')}})
      .catch(error=>{if(!controller.signal.aborted)setState(error instanceof Error&&error.message==='UNAUTHORIZED'?'unauthorized':'error')})
    return ()=>controller.abort()
  },[period,refresh])
  const metricItems=useMemo(()=>data?[
    ['Leads recebidos',data.metrics.leads,'users'],
    ['Reuniões agendadas',data.metrics.scheduled,'calendar'],
    ['Reuniões realizadas',data.metrics.completed,'pulse'],
    ['Contratos fechados',data.metrics.contracts,'briefcase'],
  ] as const:[],[data])
  const funnel=useMemo(()=>data?[
    ['Leads recebidos',data.metrics.leads],['Qualificados',data.metrics.qualified],
    ['Agendados',data.metrics.scheduled],['Contratos',data.metrics.contracts],
  ] as const:[],[data])
  return <div className="crm-live-dashboard">
    <div className="crm-live-state"><strong>DADOS REAIS · NEON PREVIEW</strong><span>Período: últimos {period==='7d'?'7':'30'} dias. As métricas são baseadas em registros do banco, não em demonstrações.</span>
      <button type="button" className="crm-btn" onClick={()=>setRefresh(v=>v+1)} disabled={state==='loading'}>Atualizar</button></div>
    {state==='loading'&&<div className="crm-card crm-live-message">Consultando dados reais do Neon…</div>}
    {state==='unauthorized'&&<div className="crm-card crm-live-message" role="alert">Sua sessão expirou. <a href="/crm/login">Entrar novamente.</a></div>}
    {state==='error'&&<div className="crm-card crm-live-message" role="alert">Não foi possível consultar o banco. Clique em Atualizar para tentar novamente.</div>}
    {state==='ready'&&data&&<>
      <div className="crm-metrics">{metricItems.map(([label,value,icon])=><div className="crm-card crm-metric" key={label}>
        <div className="crm-metric-top"><span>{label}</span><span className="crm-live-metric-mark">{icon==='users'?'♧':icon==='calendar'?'▣':icon==='pulse'?'⌁':'◇'}</span></div>
        <div className="crm-metric-value">{value}</div>
        <div className="crm-live-metric-foot">No período selecionado · Neon</div>
      </div>)}</div>
      <div className="crm-dashboard-grid">
        <section className="crm-card crm-panel"><div className="crm-panel-head"><div>
          <div className="crm-panel-title">Evolução da captação</div>
          <div className="crm-panel-subtitle">Leads cadastrados por dia · dados reais</div>
        </div></div><LeadGraph days={data.days}/></section>
        <section className="crm-card crm-panel"><div className="crm-panel-head"><div>
          <div className="crm-panel-title">Funil de conversão</div>
          <div className="crm-panel-subtitle">Indicadores reais do período · métricas independentes</div>
        </div><button type="button" className="crm-icon-btn" aria-label="Abrir funil demonstrativo" onClick={()=>openView('funil')}>↗</button></div>
        <div className="crm-funnel-list">{funnel.map(([label,value])=><div className="crm-funnel-row" key={label}>
          <span>{label}</span><div className="crm-funnel-track"><div className="crm-funnel-fill" style={{width:(data.metrics.leads?Math.min(100,value/data.metrics.leads*100):0)+'%'}}/></div><strong>{value}</strong>
        </div>)}</div>
        <p className="crm-live-note">Qualificados: etapa atual do lead. Reuniões e contratos: eventos registrados no período. Cada indicador tem seu próprio critério.</p>
        <div className="crm-live-event-note">Evento interno confirmado: <code>Chronos_Scheduled</code> · envio à Meta ainda não ativado.</div>
        </section>
      </div>
      <section className="crm-card crm-table-panel">
        <div className="crm-table-head"><div><div className="crm-panel-title">Leads recentes</div><div className="crm-panel-subtitle">Últimos 5 registros reais no Neon</div></div>
          <button type="button" className="crm-btn" onClick={()=>openView('leads')}>Ver todos ↗</button></div>
        {data.recent.length===0?<p className="crm-live-message">Nenhum lead cadastrado.</p>:<div className="crm-table-wrap"><table><thead><tr><th>Empresa / contato</th><th>Origem</th><th>Etapa</th><th>Entrada</th></tr></thead>
          <tbody>{data.recent.map(lead=><tr key={lead.id}><td><strong>{lead.company||lead.name}</strong><span className="crm-live-secondary">{lead.name}</span></td>
            <td>{lead.source||'Não identificada'}</td><td>{stages[lead.stage]||lead.stage}</td><td>{fullTime.format(new Date(lead.createdAt))}</td></tr>)}</tbody></table></div>}
      </section>
    </>}
  </div>
}
