import { NextRequest, NextResponse } from 'next/server'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import { getCrmPool, withCrmReadOnlyTransaction } from '@/lib/crm/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = {'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow','X-Content-Type-Options':'nosniff'}
const allowed = ['new','contacted','qualified','disqualified'] as const
type Row = {id:string;full_name:string;company:string|null;segment:string|null;stage:string;created_at:Date;is_test:boolean;meeting_status:string|null;deal_won:boolean}
function auth(req:NextRequest){return verifyCrmSession(req.cookies.get(crmSessionCookieName())?.value)}
function reply(value:unknown,status=200){return NextResponse.json(value,{status,headers})}
export async function GET(req:NextRequest){
 if(process.env.VERCEL_ENV!=='preview')return reply({error:'NOT_FOUND'},404)
 if(!auth(req))return reply({error:'UNAUTHORIZED'},401)
 try{
  const rows=await withCrmReadOnlyTransaction(async client=>(await client.query<Row>(
   `SELECT l.id,l.full_name,l.company,l.segment,l.stage,l.created_at,l.is_test,
      (SELECT a.status FROM crm.appointments a WHERE a.lead_id=l.id AND a.status <> 'cancelled'
       ORDER BY a.created_at DESC LIMIT 1) AS meeting_status,
      EXISTS(SELECT 1 FROM crm.deals d WHERE d.lead_id=l.id AND d.status='won') AS deal_won
      FROM crm.leads l ORDER BY l.created_at DESC,l.id DESC LIMIT 150`
  )).rows)
  return reply({ok:true,leads:rows.map(r=>({
   id:r.id,isTest:r.is_test,name:r.full_name,company:r.company,niche:r.segment,stage:r.stage,
   meetingStatus:r.meeting_status,dealWon:r.deal_won,
   lane:r.deal_won?'closed':r.meeting_status==='completed'?'completed':
     r.meeting_status==='confirmed'?'scheduled':r.stage==='qualified'?'qualified':
     r.stage==='disqualified'?'disqualified':r.stage==='contacted'?'contacted':'new',
   createdAt:new Date(r.created_at).toISOString()
  }))})
 }catch{return reply({error:'FUNNEL_UNAVAILABLE'},503)}
}
export async function PATCH(req:NextRequest){
 if(process.env.VERCEL_ENV!=='preview')return reply({error:'NOT_FOUND'},404)
 if(!auth(req))return reply({error:'UNAUTHORIZED'},401)
 if(req.headers.get('origin')!=='https://agencia-cassiellos-git-feature-mini-244029-cassiellos-projects.vercel.app')
   return reply({error:'FORBIDDEN'},403)
 if(!req.headers.get('content-type')?.startsWith('application/json'))return reply({error:'INVALID_REQUEST'},400)
 let body:Record<string,unknown>
 try {const raw=await req.text(); if(raw.length>1200)return reply({error:'INVALID_REQUEST'},400);body=JSON.parse(raw)}catch{return reply({error:'INVALID_REQUEST'},400)}
 const id=body.id,stage=body.stage
 if(typeof id!=='string'||!/^[a-f0-9-]{36}$/i.test(id)||typeof stage!=='string'||!allowed.includes(stage as typeof allowed[number]))
  return reply({error:'INVALID_STAGE'},400)
 const client=await getCrmPool().connect()
 let committed=false
 try{
  await client.query('BEGIN')
  await client.query('SET LOCAL statement_timeout = 5000')
  const old=await client.query<{stage:string}>('SELECT stage FROM crm.leads WHERE id=$1 FOR UPDATE',[id])
  if(!old.rows[0]){await client.query('ROLLBACK');committed=true;return reply({error:'LEAD_NOT_FOUND'},404)}
  const blocked=await client.query<{has_meeting:boolean;has_won:boolean}>(
    `SELECT EXISTS(SELECT 1 FROM crm.appointments WHERE lead_id=$1 AND status IN ('confirmed','completed')) AS has_meeting,
       EXISTS(SELECT 1 FROM crm.deals WHERE lead_id=$1 AND status='won') AS has_won`,[id])
  if(blocked.rows[0]?.has_meeting||blocked.rows[0]?.has_won){
    await client.query('ROLLBACK');committed=true;return reply({error:'AUTOMATED_STAGE_LOCKED'},409)
  }
  if(old.rows[0].stage!==stage){
   await client.query('UPDATE crm.leads SET stage=$2,updated_at=now() WHERE id=$1',[id,stage])
   await client.query(`INSERT INTO crm.lead_activities(lead_id,activity_kind,performed_by,details)
       VALUES($1,'stage_changed','crm_admin',$2::jsonb)`,
       [id,JSON.stringify({from:old.rows[0].stage,to:stage})])
  }
  await client.query('COMMIT');committed=true
  return reply({ok:true,stage,changed:old.rows[0].stage!==stage})
 }catch{return reply({error:'UPDATE_FAILED'},503)}
 finally{if(!committed)await client.query('ROLLBACK').catch(()=>{});client.release()}
}
