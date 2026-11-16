import { NextRequest, NextResponse } from 'next/server'
import { getCrmPool } from '@/lib/crm/db'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import { isCrmRuntimeEnabled } from '@/lib/crm/runtime-env'
import { isCrmPreviewOrigin } from '@/lib/crm/preview-origins'
import { changeFlowDocument, createFlowDocument, FlowStoreError, getFlowDocument, listFlowDocuments } from '@/lib/crm/form-builder/store'
import { validateFlow } from '@/lib/crm/form-builder/flow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const headers = { 'Cache-Control':'private, no-store', 'X-Robots-Tag':'noindex, nofollow', 'Vary':'Cookie' }
const send = (body:unknown,status=200)=>NextResponse.json(body,{status,headers})
function authorized(req:NextRequest){return verifyCrmSession(req.cookies.get(crmSessionCookieName())?.value)}
function fail(e:unknown){
  if(e instanceof FlowStoreError){
    return send({error:e.code},e.code==='MIGRATION_PENDING'?503:e.code==='CONFLICT'?409:e.code==='NOT_FOUND'?404:400)
  }
  console.warn('[form-flows] operation_failed')
  return send({error:'FORMS_UNAVAILABLE'},503)
}

export async function GET(req:NextRequest){
  if(!isCrmRuntimeEnabled())return send({error:'NOT_FOUND'},404)
  if(!authorized(req))return send({error:'UNAUTHORIZED'},401)
  try{
    const id=req.nextUrl.searchParams.get('id')
    if(id)return send({ok:true,form:await getFlowDocument(getCrmPool(),id)})
    return send({ok:true,forms:await listFlowDocuments(getCrmPool())})
  }catch(e){return fail(e)}
}

export async function POST(req:NextRequest){
  if(!isCrmRuntimeEnabled())return send({error:'NOT_FOUND'},404)
  if(!authorized(req))return send({error:'UNAUTHORIZED'},401)
  if(!isCrmPreviewOrigin(req.headers.get('origin')))return send({error:'FORBIDDEN'},403)
  if(!req.headers.get('content-type')?.startsWith('application/json'))return send({error:'INVALID_REQUEST'},415)
  try{
    const raw=await req.text()
    if(raw.length>50000)return send({error:'PAYLOAD_TOO_LARGE'},413)
    const body=JSON.parse(raw) as Record<string,unknown>
    if(!body||typeof body!=='object'||Array.isArray(body))return send({error:'INVALID_REQUEST'},400)
    if(body.action==='create'){
      const result=await createFlowDocument(getCrmPool(),body.title as string,body.slug as string)
      return send({ok:true,form:result},201)
    }
    if(!['save','publish','unpublish'].includes(String(body.action)))return send({error:'INVALID_ACTION'},400)
    if(body.action==='save'){
      const validation=validateFlow(body.draft)
      if(!validation.ok)return send({error:'INVALID_FLOW',issues:validation.issues},400)
    }
    const result=await changeFlowDocument(getCrmPool(),{
      id:body.id as string,revision:body.revision as number,
      action:body.action as 'save'|'publish'|'unpublish',
      title:body.title,slug:body.slug,description:body.description,draft:body.draft,
    })
    return send({ok:true,form:result})
  }catch(e){ if(e instanceof SyntaxError)return send({error:'INVALID_JSON'},400);return fail(e) }
}
