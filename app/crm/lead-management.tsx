'use client'
import {useEffect,useState} from 'react'
import './lead-management.css'
type Item={id:string;activity_kind:string;performed_by:string|null;details:Record<string,unknown>;created_at:string}
type Meeting={id:string;status:string;starts_at:string;ends_at:string;cancelled_at?:string|null;has_calendar_event?:boolean;cancel_pending?:boolean}
type Deal={id:string;status:string;amount:number|null;description:string|null;closed_at:string|null}
type Info={lead:{id:string;full_name:string;company:string|null;stage:string;is_test:boolean};activities:Item[];appointments:Meeting[];deals:Deal[]}
const descriptions:Record<string,string>={
 form_completed:'Formulário concluído',form_resubmitted:'Formulário reenviado',stage_changed:'Etapa comercial alterada',
 meeting_scheduled:'Reunião agendada',meeting_completed:'Reunião realizada',
 contract_won:'Contrato fechado',note_added:'Nota adicionada',
 meeting_cancelled:'Reunião cancelada',meeting_cancel_sync_failed:'Cancelamento não confirmado pelo Google',
 meeting_no_show:'Não compareceu',classification_changed:'Classificação alterada',booking_reconciled:'Reserva reconciliada',
}
const meetingStatus:Record<string,string>={confirmed:'Confirmada',completed:'Realizada',cancelled:'Cancelada',no_show:'Não compareceu',pending:'Pendente',rescheduled:'Reagendada'}
const errorMessages:Record<string,string>={
 MEETING_NOT_COMPLETED:'Conclua primeiro a reunião antes de registrar um contrato.',
 MEETING_NOT_CONFIRMABLE:'A reunião ainda não terminou ou já foi concluída. Atualize a ficha.',
 CONTRACT_ALREADY_WON:'Já existe um contrato ganho para este lead.',
 GOOGLE_CANCEL_NOT_CONFIRMED:'O Google Calendar não confirmou o cancelamento. A reunião continua ativa e o horário segue ocupado. Tente novamente em instantes.',
 MEETING_ALREADY_ENDED:'Esta reunião já terminou. Marque como realizada ou como não compareceu.',
 MEETING_NOT_CANCELLABLE:'Esta reunião não pode mais ser cancelada. Atualize a ficha.',
 MEETING_NOT_STARTED:'Só é possível marcar falta depois do horário de início.',
 MEETING_NOT_MARKABLE:'Esta reunião não está confirmada. Atualize a ficha.',
 UNAUTHORIZED:'Sua sessão administrativa expirou. Entre novamente.',
}
const fieldNames:Record<string,string>={full_name:'nome',whatsapp:'WhatsApp',company:'empresa',segment:'segmento'}
function fieldList(value:unknown){return Array.isArray(value)?value.filter((v):v is string=>typeof v==='string').map(v=>fieldNames[v]||v).join(', '):''}
const fmt=new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',dateStyle:'short',timeStyle:'short'})
export default function LeadManagement({leadId,onClose,onChanged}:{leadId:string;onClose:()=>void;onChanged?:()=>void}){
 const [info,setInfo]=useState<Info|null>(null)
 const [loading,setLoading]=useState(true)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [actionError,setActionError]=useState('')
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
  setBusy(true);setActionError('')
  try{
   const response=await fetch('/api/crm/lead-management',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({leadId,...payload})})
   if(!response.ok){const result=await response.json().catch(()=>({}));throw Error(result.error||'FAILED')}
   setNote('');setAmount('');setReference('');setRefresh(x=>x+1)
   if(payload.action==='set_classification'||payload.action==='cancel_meeting'||payload.action==='mark_no_show')onChanged?.()
  }catch(e){const code=e instanceof Error?e.message:'FAILED'
   setActionError(errorMessages[code]||'Não foi possível salvar a alteração. Verifique os dados e tente novamente.')
   setRefresh(x=>x+1)
  }finally{setBusy(false)}
 }
 function cancelMeetingAction(meeting:Meeting){
  const reason=window.prompt('Motivo do cancelamento (opcional). Esta ação cancela o convite no Google Calendar e o participante é avisado pelo Google:','')
  if(reason===null)return
  if(!window.confirm('Confirma o cancelamento da reunião de '+fmt.format(new Date(meeting.starts_at))+'? O horário só é liberado após a confirmação do Google.'))return
  action({action:'cancel_meeting',appointmentId:meeting.id,reason,confirmed:true})
 }
 function noShowAction(meeting:Meeting){
  if(!window.confirm('Confirma que o participante NÃO compareceu à reunião de '+fmt.format(new Date(meeting.starts_at))+'? O evento no Google não será alterado.'))return
  action({action:'mark_no_show',appointmentId:meeting.id,confirmed:true})
 }
 function classificationAction(toTest:boolean){
  const reason=window.prompt('Motivo da alteração (opcional):','')
  if(reason===null)return
  if(!window.confirm('Alterar a classificação para '+(toTest?'LEAD DE TESTE':'LEAD REAL')+'? Vale apenas para registros futuros: reuniões, contratos e eventos antigos não mudam e nada é enviado à Meta.'))return
  action({action:'set_classification',isTest:toTest,reason,confirmed:true})
 }
 const completed=info?.appointments.some(a=>a.status==='completed')
 const won=info?.deals.some(d=>d.status==='won')
 return <section className="crm-lead-management" aria-label="Histórico e gestão comercial">
  <div className="crm-lead-management-head"><div><strong>Histórico e gestão comercial</strong><small>{info?.lead.company||info?.lead.full_name||'Lead'}</small></div><button className="crm-btn" type="button" onClick={onClose}>Fechar</button></div>
  {loading&&<p>Carregando histórico do Neon…</p>}
  {error&&<p className="crm-lead-management-error" role="alert">{error}</p>}
  {actionError&&<p className="crm-lead-management-error" role="alert">{actionError}</p>}
  {info&&!loading&&<>
   <div className="crm-lead-management-section"><h3>Classificação</h3>
    <p>Atualmente: <strong>{info.lead.is_test?'Lead de teste':'Lead real'}</strong>. A alteração vale para registros futuros e fica registrada na linha do tempo.</p>
    <button className="crm-btn" type="button" disabled={busy} onClick={()=>classificationAction(!info.lead.is_test)}>
     {info.lead.is_test?'Alterar para lead real':'Alterar para lead de teste'}</button>
   </div>
   <div className="crm-lead-management-section">
    <h3>Registrar atendimento</h3>
    <textarea aria-label="Nova anotação comercial" placeholder="Ex.: Liguei, conversamos sobre o diagnóstico e combinamos novo contato." value={note} onChange={e=>setNote(e.target.value)} maxLength={1000} rows={3}/>
    <button className="crm-btn" disabled={busy||note.trim().length<2} onClick={()=>action({action:'note',note})} type="button">Salvar anotação</button>
   </div>
   <div className="crm-lead-management-section"><h3>Reuniões</h3>
    {info.appointments.length===0?<p>Nenhuma reunião registrada.</p>:
      info.appointments.map(a=><div className="crm-lead-management-meeting" key={a.id}>
       <span>{fmt.format(new Date(a.starts_at))} · {meetingStatus[a.status]||a.status}</span>
       {a.cancel_pending&&<small className="crm-meeting-warning" role="status">Cancelamento não confirmado pelo Google: a reunião continua ativa. Tente cancelar novamente.</small>}
       <span className="crm-lead-management-meeting-actions">
       {a.status==='confirmed'&&(new Date(a.ends_at).getTime()>Date.now()
         ? <small className="crm-meeting-awaiting">“Realizada” fica disponível após o término.</small>
         : <button className="crm-btn" type="button" disabled={busy}
         onClick={()=>{if(window.confirm('Confirma que esta reunião realmente aconteceu?'))action({action:'complete_meeting',appointmentId:a.id})}}>Marcar como realizada</button>)}
       {a.status==='confirmed'&&new Date(a.starts_at).getTime()<=Date.now()&&
         <button className="crm-btn" type="button" disabled={busy} onClick={()=>noShowAction(a)}>Marcar como não compareceu</button>}
       {(a.status==='confirmed'||a.status==='pending')&&new Date(a.ends_at).getTime()>Date.now()&&
         <button className="crm-btn crm-btn-danger" type="button" disabled={busy} onClick={()=>cancelMeetingAction(a)}>Cancelar reunião</button>}
       </span>
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
       {a.activity_kind==='form_resubmitted'&&<p>Novo interesse registrado; cadastro preservado.
        {fieldList(a.details?.differingFields)?' Informado diferente: '+fieldList(a.details?.differingFields)+'.':''}
        {fieldList(a.details?.filledFields)?' Campos vazios preenchidos: '+fieldList(a.details?.filledFields)+'.':''}</p>}
       {a.activity_kind==='stage_changed'&&<p>{String(a.details?.from||'—')} → {String(a.details?.to||'—')}</p>}
       {a.activity_kind==='classification_changed'&&<p>{a.details?.from==='test'?'Teste':'Real'} → {a.details?.to==='test'?'Teste':'Real'}{typeof a.details?.reason==='string'&&a.details.reason?' · '+a.details.reason:''}</p>}
       {a.activity_kind==='meeting_cancelled'&&<p>{a.details?.google==='no_event'?'Sem evento no Google.':'Google Calendar: cancelamento confirmado.'}{typeof a.details?.reason==='string'&&a.details.reason?' Motivo: '+a.details.reason:''}</p>}
       {a.activity_kind==='meeting_cancel_sync_failed'&&<p>Nada foi liberado; a reunião continua ativa.</p>}
       {a.activity_kind==='booking_reconciled'&&<p>{a.details?.decision==='adopt'?'Evento encontrado no Google: reunião registrada no CRM.':'Sem evento ativo no Google: reserva encerrada e horário liberado.'}</p>}
      </li>)}</ol>}
   </div>
  </>}
 </section>
}