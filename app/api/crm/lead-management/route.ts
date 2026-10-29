import { NextRequest,NextResponse } from 'next/server'
import { crmSessionCookieName,verifyCrmSession } from '@/lib/crm/auth'
import { getCrmPool,withCrmReadOnlyTransaction } from '@/lib/crm/db'
import { isCrmPreviewOrigin } from '@/lib/crm/preview-origins'
import { adminActorFromSession,cancelMeeting,markNoShow,setLeadClassification } from '@/lib/crm/admin-actions'
import { cancelBookingEvent } from '@/lib/crm/google-calendar'
export const runtime='nodejs'
export const dynamic='force-dynamic'
const headers={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow'}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
function send(value:unknown,status=200){return NextResponse.json(value,{status,headers})}
function allowed(req:NextRequest){return process.env.VERCEL_ENV==='preview'&&verifyCrmSession(req.cookies.get(crmSessionCookieName())?.value)}
export async function GET(req:NextRequest){
 if(process.env.VERCEL_ENV!=='preview')return send({error:'NOT_FOUND'},404)
 if(!allowed(req))return send({error:'UNAUTHORIZED'},401)
 const id=req.nextUrl.searchParams.get('leadId')
 if(!id||!uuid.test(id))return send({error:'INVALID_LEAD'},400)
 try{
 const data=await withCrmReadOnlyTransaction(async client=>{
 const l=await client.query('SELECT id,full_name,company,email,whatsapp,segment,stage,is_test FROM crm.leads WHERE id=$1',[id])
 if(!l.rows[0])return null
 const activities=await client.query('SELECT id,activity_kind,performed_by,details,created_at FROM crm.lead_activities WHERE lead_id=$1 ORDER BY created_at DESC,id DESC LIMIT 100',[id])
 // cancel_pending: the last Google cancellation was not confirmed, so the meeting stays active.
 const appointments=await client.query(`SELECT a.id,a.status,a.starts_at,a.ends_at,a.completed_at,a.cancelled_at,
   (a.calendar_event_id IS NOT NULL) AS has_calendar_event,
   (a.status IN ('pending','confirmed') AND EXISTS(SELECT 1 FROM crm.lead_activities x
     WHERE x.appointment_id=a.id AND x.activity_kind='meeting_cancel_sync_failed')) AS cancel_pending
   FROM crm.appointments a WHERE a.lead_id=$1 ORDER BY a.starts_at DESC LIMIT 20`,[id])
 const deals=await client.query('SELECT id,status,amount,description,closed_at FROM crm.deals WHERE lead_id=$1 ORDER BY created_at DESC LIMIT 20',[id])
 return {lead:l.rows[0],activities:activities.rows,appointments:appointments.rows,deals:deals.rows}
 })
 return data?send({ok:true,...data}):send({error:'NOT_FOUND'},404)
 }catch{return send({error:'HISTORY_UNAVAILABLE'},503)}
}
export async function POST(req:NextRequest){
 if(process.env.VERCEL_ENV!=='preview')return send({error:'NOT_FOUND'},404)
 if(!allowed(req))return send({error:'UNAUTHORIZED'},401)
 if(!isCrmPreviewOrigin(req.headers.get('origin')))return send({error:'FORBIDDEN'},403)
 if(!req.headers.get('content-type')?.startsWith('application/json'))return send({error:'INVALID_REQUEST'},400)
 let data:Record<string,unknown>
 try{const raw=await req.text();if(raw.length>2000)return send({error:'INVALID_REQUEST'},400);data=JSON.parse(raw)}catch{return send({error:'INVALID_REQUEST'},400)}
 const leadId=data.leadId,action=data.action
 if(typeof leadId!=='string'||!uuid.test(leadId))return send({error:'INVALID_LEAD'},400)
 if(action==='cancel_meeting'||action==='mark_no_show'||action==='set_classification')return adminAction(req,leadId,action,data)
 if(action!=='note'&&action!=='complete_meeting'&&action!=='win_deal')return send({error:'INVALID_ACTION'},400)
 const client=await getCrmPool().connect()
 let committed=false
 try{
 await client.query('BEGIN')
 await client.query('SET LOCAL statement_timeout=5000')
 const lead=await client.query('SELECT id FROM crm.leads WHERE id=$1 FOR UPDATE',[leadId])
 if(!lead.rows[0]){await client.query('ROLLBACK');committed=true;return send({error:'NOT_FOUND'},404)}
 if(action==='note'){
   const note=typeof data.note==='string'?data.note.trim():''
   if(note.length<2||note.length>1000){await client.query('ROLLBACK');committed=true;return send({error:'INVALID_NOTE'},400)}
   await client.query(`INSERT INTO crm.lead_activities(lead_id,activity_kind,performed_by,details)
     VALUES($1,'note_added','crm_admin',$2::jsonb)`,[leadId,JSON.stringify({text:note})])
 }else if(action==='complete_meeting'){
   const appointmentId=data.appointmentId
   if(typeof appointmentId!=='string'||!uuid.test(appointmentId)){await client.query('ROLLBACK');committed=true;return send({error:'INVALID_APPOINTMENT'},400)}
   const result=await client.query(`UPDATE crm.appointments SET status='completed',completed_at=now(),updated_at=now()
     WHERE id=$1 AND lead_id=$2 AND status='confirmed'
       AND ends_at <= now() RETURNING id`,[appointmentId,leadId])
   if(!result.rowCount){await client.query('ROLLBACK');committed=true;return send({error:'MEETING_NOT_CONFIRMABLE'},409)}
   await client.query(`INSERT INTO crm.lead_activities(lead_id,appointment_id,activity_kind,performed_by,details)
     VALUES($1,$2,'meeting_completed','crm_admin','{}'::jsonb)`,[leadId,appointmentId])
 }else{
   const amount=typeof data.amount==='number'&&Number.isFinite(data.amount)?data.amount:null
   const reference=typeof data.contractReference==='string'?data.contractReference.trim():''
   if(amount===null||amount<=0||amount>100000000||reference.length<3||reference.length>120){
     await client.query('ROLLBACK');committed=true;return send({error:'INVALID_CONTRACT'},400)
   }
   const existing=await client.query("SELECT id FROM crm.deals WHERE lead_id=$1 AND status='won' LIMIT 1",[leadId])
   if(existing.rows.length){await client.query('ROLLBACK');committed=true;return send({error:'CONTRACT_ALREADY_WON'},409)}
   const meeting=await client.query("SELECT id FROM crm.appointments WHERE lead_id=$1 AND status='completed' ORDER BY completed_at DESC LIMIT 1",[leadId])
   if(!meeting.rows[0]){await client.query('ROLLBACK');committed=true;return send({error:'MEETING_NOT_COMPLETED'},409)}
   // The contract inherits the lead's real/test classification (missing lead -> test).
   const deal=await client.query(`INSERT INTO crm.deals(lead_id,appointment_id,status,amount,contract_reference,closed_at,description,is_test)
     VALUES($1,$2,'won',$3,$4,now(),'Contrato registrado pelo administrador',
       COALESCE((SELECT l.is_test FROM crm.leads l WHERE l.id=$1),true)) RETURNING id`,[leadId,meeting.rows[0].id,amount,reference])
   await client.query("UPDATE crm.leads SET stage='customer',updated_at=now() WHERE id=$1",[leadId])
   await client.query(`INSERT INTO crm.lead_activities(lead_id,deal_id,activity_kind,performed_by,details)
     VALUES($1,$2,'contract_won','crm_admin',$3::jsonb)`,[leadId,deal.rows[0].id,JSON.stringify({amount,contractReference:reference})])
 }
 await client.query('COMMIT');committed=true
 return send({ok:true})
 }catch{return send({error:'ACTION_FAILED'},503)}
 finally{if(!committed)await client.query('ROLLBACK').catch(()=>{});client.release()}
}
/** Phase 3.4: explicit confirmation + audited actor for every administrative change. */
async function adminAction(req:NextRequest,leadId:string,action:string,data:Record<string,unknown>){
 if(data.confirmed!==true)return send({error:'CONFIRMATION_REQUIRED'},400)
 const actor=adminActorFromSession(req.cookies.get(crmSessionCookieName())?.value||'')
 const pool=getCrmPool()
 try{
  if(action==='set_classification'){
   if(typeof data.isTest!=='boolean')return send({error:'INVALID_CLASSIFICATION'},400)
   const r=await setLeadClassification(pool,{leadId,isTest:data.isTest,actor,reason:data.reason})
   return send(r.status<300?{ok:true,outcome:r.outcome}:{error:'NOT_FOUND'},r.status)
  }
  const appointmentId=data.appointmentId
  if(typeof appointmentId!=='string'||!uuid.test(appointmentId))return send({error:'INVALID_APPOINTMENT'},400)
  if(action==='mark_no_show'){
   const r=await markNoShow(pool,{leadId,appointmentId,actor})
   const errors:Record<string,string>={not_found:'NOT_FOUND',not_started:'MEETING_NOT_STARTED',not_markable:'MEETING_NOT_MARKABLE'}
   return send(r.status<300?{ok:true,outcome:r.outcome}:{error:errors[r.outcome]||'ACTION_FAILED'},r.status)
  }
  const r=await cancelMeeting({pool,cancelGoogleEvent:cancelBookingEvent},{leadId,appointmentId,actor,reason:data.reason})
  const errors:Record<string,string>={not_found:'NOT_FOUND',not_cancellable:'MEETING_NOT_CANCELLABLE',
   already_ended:'MEETING_ALREADY_ENDED',google_not_confirmed:'GOOGLE_CANCEL_NOT_CONFIRMED'}
  return send(r.status<300?{ok:true,outcome:r.outcome}:{error:errors[r.outcome]||'ACTION_FAILED'},r.status)
 }catch{return send({error:'ACTION_FAILED'},503)}
}
