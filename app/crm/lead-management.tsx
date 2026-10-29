'use client'
import {useEffect,useState} from 'react'
import './lead-management.css'
type Item={id:string;activity_kind:string;performed_by:string|null;details:Record<string,unknown>;created_at:string}
type Meeting={id:string;status:string;starts_at:string;ends_at:string}
type Deal={id:string;status:string;amount:number|null;description:string|null;closed_at:string|null}
type Info={lead:{id:string;full_name:string;company:string|null;stage:string};activities:Item[];appointments:Meeting[];deals:Deal[]}
const descriptions:Record<string,string>={
 form_completed:'Formulário concluído',stage_changed:'Etapa comercial alterada',
 meeting_scheduled:'Reunião agendada',meeting_completed:'Reunião realizada',
 contract_won:'Contrato fechado',note_added:'Nota adicionada',
}
const fmt=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'})
export default function LeadManagement({leadId,onClose}:{leadId:string;onClose:()=>void}){
 const [info,setInfo]=useState<Info|null>(null)
 const [loading,setLoading]=useState(true)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [note,setNote]=useState('')
 const [amount,setAmount]=useState('')
 const [reference,setReference]=useState('')
 const [refresh,setRefresh]=useState(0)
 useEffect(()=>{
  const controller=new AbortController();setLoading(true)
  fetch('/api/crm/lead-management?leadId='+encodeURIComponent(leadId),{cache:'no-store',credentials:'same-origin',signal:controller.signal})
   .then(async r=>{if(!r.ok)throw Error('FAILED');return r.json()})
   .then(v=>{if(!controller.signal.aborted){setInfo(v);setError('')}})
   .catch(()=>{if(!controller.signal.aborted)setError('Não foi possível consultar o histórico.')})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
  return ()=>controller.abort()
 },[leadId,refresh])
 async function action(payload:Record<string,unknown>){
  setBusy(true);setError('')
  try{
   const response=await fetch('/api/crm/lead-management',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({leadId,...payload})})
   if(!response.ok){const result=await response.json();throw Error(result.error||'FAILED')}
   setNote('');setAmount('');setReference('');setRefresh(x=>x+1)
  }catch(e){const code=e instanceof Error?e.message:'FAILED'
   setError(code==='MEETING_NOT_COMPLETED'?'Conclua primeiro a reunião antes de registrar um contrato.':
    code==='CONTRACT_ALREADY_WON'?'Já existe um contrato ganho para este lead.':
    'Não foi possível salvar a alteração. Verifique os dados e tente novamente.')
  }finally{setBusy(false)}
 }
 const completed=info?.appointments.some(a=>a.status==='completed')
 const won=info?.deals.some(d=>d.status==='won')
 return <section className="crm-lead-management" aria-label="Histórico e gestão comercial">
  <div className="crm-lead-management-head"><div><strong>Histórico e gestão comercial</strong><small>{info?.lead.company||info?.lead.full_name||'Lead'}</small></div><button className="crm-btn" type="button" onClick={onClose}>Fechar</button></div>
  {loading&&<p>Carregando histórico do Neon…</p>}
  {error&&<p className="crm-lead-management-error" role="alert">{error}</p>}
  {info&&!loading&&<>
   <div className="crm-lead-management-section">
    <h3>Registrar atendimento</h3>
    <textarea aria-label="Nova anotação comercial" placeholder="Ex.: Liguei, conversamos sobre o diagnóstico e combinamos novo contato." value={note} onChange={e=>setNote(e.target.value)} maxLength={1000} rows={3}/>
    <button className="crm-btn" disabled={busy||note.trim().length<2} onClick={()=>action({action:'note',note})} type="button">Salvar anotação</button>
   </div>
   <div className="crm-lead-management-section"><h3>Reuniões</h3>
    {info.appointments.length===0?<p>Nenhuma reunião registrada.</p>:
      info.appointments.map(a=><div className="crm-lead-management-meeting" key={a.id}>
       <span>{fmt.format(new Date(a.starts_at))} · {a.status==='confirmed'?'Confirmada':a.status==='completed'?'Realizada':a.status}</span>
       {a.status==='confirmed'&&<button className="crm-btn" type="button" disabled={busy}
         onClick={()=>{if(window.confirm('Confirma que esta reunião realmente aconteceu?'))action({action:'complete_meeting',appointmentId:a.id})}}>Marcar como realizada</button>}
      </div>)}
   </div>
   <div className="crm-lead-management-section"><h3>Fechamento comercial</h3>
    {won?<p>Contrato ganho já registrado neste lead.</p>:<>
     <p>Somente após a reunião ser marcada como realizada.</p>
     <div className="crm-lead-management-fields"><label>Valor do contrato (R$)<input type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="3000.00"/></label>
      <label>Referência do contrato<input value={reference} maxLength={120} onChange={e=>setReference(e.target.value)} placeholder="Código ou identificação"/></label></div>
     <button className="crm-btn" type="button" disabled={!completed||busy||!Number.isFinite(Number(amount))||Number(amount)<=0||reference.trim().length<3}
      onClick={()=>{if(window.confirm('Confirmar o fechamento deste contrato?'))action({action:'win_deal',amount:Number(amount),contractReference:reference})}}>Registrar contrato fechado</button>
    </>}
   </div>
   <div className="crm-lead-management-section"><h3>Linha do tempo</h3>
    {info.activities.length===0?<p>Nenhuma atividade registrada.</p>:
      <ol className="crm-lead-timeline">{info.activities.map(a=><li key={a.id}><strong>{descriptions[a.activity_kind]||a.activity_kind}</strong><small>{fmt.format(new Date(a.created_at))}</small>
       {a.activity_kind==='note_added'&&typeof a.details?.text==='string'&&<p>{a.details.text}</p>}
       {a.activity_kind==='stage_changed'&&<p>{String(a.details?.from||'—')} → {String(a.details?.to||'—')}</p>}
      </li>)}</ol>}
   </div>
  </>}
 </section>
}