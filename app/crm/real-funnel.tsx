'use client'
import { useEffect,useState } from 'react'
import './real-funnel.css'
type Lead={id:string;isTest:boolean;name:string;company:string|null;niche:string|null;stage:string;lane:string;createdAt:string}
const lanes=[['new','Novos'],['contacted','Contatados'],['qualified','Qualificados'],['scheduled','Reunião agendada'],['completed','Reunião realizada'],['closed','Contrato fechado'],['disqualified','Desqualificados']] as const
export default function RealFunnel(){
 const [leads,setLeads]=useState<Lead[]>([])
 const [status,setStatus]=useState<'loading'|'ready'|'error'|'unauthorized'>('loading')
 const [reload,setReload]=useState(0)
 const [busy,setBusy]=useState<string|null>(null)
 const [message,setMessage]=useState('')
 useEffect(()=>{
   const controller=new AbortController();setStatus('loading')
   fetch('/api/crm/funnel',{credentials:'same-origin',cache:'no-store',signal:controller.signal})
     .then(async response=>{if(response.status===401)throw Error('UNAUTHORIZED');if(!response.ok)throw Error('FAILED');return response.json()})
     .then(result=>{if(!controller.signal.aborted){setLeads(result.leads);setStatus('ready')}})
     .catch(error=>{if(!controller.signal.aborted)setStatus(error instanceof Error&&error.message==='UNAUTHORIZED'?'unauthorized':'error')})
   return ()=>controller.abort()
 },[reload])
 async function update(id:string,stage:string){
   setBusy(id);setMessage('')
   try{
     const response=await fetch('/api/crm/funnel',{method:'PATCH',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,stage})})
     const data=await response.json()
     if(!response.ok)throw Error(data.error||'FAILED')
     setReload(x=>x+1)
   }catch(error){
     setMessage(error instanceof Error&&error.message==='AUTOMATED_STAGE_LOCKED'
      ?'Este lead já tem reunião ou contrato vinculado. Essa etapa depende do registro real.'
      :'Não foi possível atualizar a etapa. Tente novamente.')
   }finally{setBusy(null)}
 }
 return <section className="crm-real-funnel">
   <div className="crm-real-funnel-intro"><strong>FUNIL REAL · NEON PREVIEW</strong><span>Um cadastro por lead. Etapas de reunião e contrato dependem de eventos reais, sem movimentações artificiais.</span><button className="crm-btn" type="button" onClick={()=>setReload(x=>x+1)}>Atualizar</button></div>
   {status==='loading'&&<div className="crm-card crm-real-funnel-message">Carregando oportunidades…</div>}
   {status==='error'&&<div className="crm-card crm-real-funnel-message" role="alert">Não foi possível consultar o funil. Tente atualizar.</div>}
   {status==='unauthorized'&&<div className="crm-card crm-real-funnel-message" role="alert">Sessão expirada. <a href="/crm/login">Entre novamente.</a></div>}
   {message&&<div className="crm-card crm-real-funnel-message" role="alert">{message}</div>}
   {status==='ready'&&<div className="crm-real-funnel-scroll"><div className="crm-real-funnel-grid">
     {lanes.map(([key,label])=>{const items=leads.filter(l=>l.lane===key);return <div className="crm-real-funnel-col" key={key}>
       <div className="crm-real-funnel-col-head"><strong>{label}</strong><span>{items.length}</span></div>
       <div className="crm-real-funnel-cards">{items.length===0?<p>Sem registros</p>:items.map(lead=><article key={lead.id} className="crm-real-funnel-card">
         <strong>{lead.company||lead.name} {lead.isTest&&<span className="crm-test-tag">TESTE</span>}</strong><small>{lead.name}</small><small>{lead.niche||'Nicho não informado'}</small>
         {['new','contacted','qualified','disqualified'].includes(key)&&<label>Qualificação
           <select aria-label={'Alterar qualificação de '+lead.name} disabled={busy===lead.id} value={lead.stage} onChange={e=>update(lead.id,e.target.value)}>
             <option value="new">Novo</option><option value="contacted">Contatado</option><option value="qualified">Qualificado</option><option value="disqualified">Desqualificado</option>
           </select>
         </label>}
         {['scheduled','completed','closed'].includes(key)&&<span className="crm-real-funnel-automatic">Etapa automática · somente leitura</span>}
       </article>)}</div>
     </div>})}
   </div></div>}
   <p className="crm-real-funnel-footer">Reuniões são derivadas da Agenda e contratos de negócios ganhos. Alterações de qualificação ficam registradas no histórico do lead.</p>
 </section>
}