import { NextRequest, NextResponse, after } from 'next/server'
import { getCrmPool } from '@/lib/crm/db'
import { getPublishedFlow } from '@/lib/crm/form-builder/store'
import { routeFlow } from '@/lib/crm/form-builder/flow'
import { isCrmRuntimeEnabled } from '@/lib/crm/runtime-env'
import { isCrmPreviewOrigin, CRM_CANONICAL_ORIGIN, crmAllowedOrigins } from '@/lib/crm/preview-origins'
import { clean, validatedName, validatedEmail, validatedPhone } from '@/lib/crm/booking-intake-request'
import { validateBrazilianMobilePhone } from '@/lib/crm/contact-validation'
import { TURNSTILE_BOOKING_ACTION, getTurnstileConfig, verifyTurnstileToken } from '@/lib/crm/turnstile'
import { INTAKE_LIMIT, requestFingerprint, consumeRequestQuota } from '@/lib/crm/request-limits'
import { sanitizeAttribution } from '@/lib/crm/attribution'
import { resolveMarketingConsent, META_CLICK_ID_PARAM } from '@/lib/marketing/meta'
import { saveLeadSubmission } from '@/lib/crm/lead-intake'
import { classifyNewLeadAsTest, getCrmBookingMode } from '@/lib/crm/booking-mode'
import { bookingAccessConfig } from '@/lib/crm/booking-access'
import { createBookingGrant } from '@/lib/crm/booking-grant'
import { getBookingForm } from '@/lib/crm/booking-forms'
import { dispatchLeadToMeta, metaLeadClientFromHeaders, pgLeadCapiStore, metaLeadConfig } from '@/lib/crm/meta-lead-capi'
import { dbErrorKind, opsLog } from '@/lib/crm/ops-log'

export const runtime='nodejs'
export const dynamic='force-dynamic'
export const maxDuration=60
const headers={'Cache-Control':'no-store, private','X-Robots-Tag':'noindex, nofollow','Referrer-Policy':'no-referrer'}
const send=(data:unknown,status=200)=>NextResponse.json(data,{status,headers})
// Registro operacional mínimo (lib/crm/ops-log.ts): só código técnico, status e slug do formulário; nada do visitante.
const ops=(slug:string,code:Parameters<typeof opsLog>[0]['code'],status:number,extra:Partial<Parameters<typeof opsLog>[0]>={})=>
  opsLog({stage:'form_submit',code,status,form:slug,...extra})
export async function POST(req:NextRequest,{params}:{params:Promise<{slug:string}>}){
  if(!isCrmRuntimeEnabled())return send({error:'NOT_FOUND'},404)
  const {slug}=await params
  // Only the CRM-owned, same-origin frontend may submit. No wildcard/CORS.
  if(!isCrmPreviewOrigin(req.headers.get('origin')))return send({error:'FORBIDDEN'},403)
  if(!req.headers.get('content-type')?.startsWith('application/json'))return send({error:'INVALID_CONTENT_TYPE'},415)
  let data:Record<string,unknown>
  try {
    const raw=await req.text()
    if(raw.length>16000)return send({error:'PAYLOAD_TOO_LARGE'},413)
    data=JSON.parse(raw)
    if(!data||typeof data!=='object'||Array.isArray(data))throw Error('invalid')
  }catch{return send({error:'INVALID_REQUEST'},400)}
  if(data.website)return send({error:'INVALID_REQUEST'},400)
  let knownForm=''
  try{
    const doc=await getPublishedFlow(getCrmPool(),slug)
    if(!doc?.published){ops('','FORM_NOT_AVAILABLE',404);return send({error:'FORM_NOT_AVAILABLE'},404)}
    knownForm=doc.slug
    if(data.version!==doc.publishedVersion){ops(doc.slug,'FORM_UPDATED',409);return send({error:'FORM_UPDATED'},409)}
    const key=clean(data.idempotencyKey,50)
    if(!key||!(/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i).test(key))return send({error:'INVALID_REQUEST_KEY'},400)
    const result=routeFlow(doc.published,data.answers)
    if(!result)return send({error:'INVALID_FLOW_ANSWERS'},400)
    const name=validatedName(data.name),email=validatedEmail(data.email),phone=validatedPhone(data.whatsapp)
    if(!name||!email||!phone||!validateBrazilianMobilePhone(data.whatsapp).ok)return send({error:'INVALID_CONTACT'},400)
    if(data.contactRequest!==true)return send({error:'CONTACT_REQUEST_REQUIRED'},400)

    const cfg=getTurnstileConfig()
    if(cfg.status!=='ready'){ops(doc.slug,'SECURITY_CHECK_UNAVAILABLE',503,{reason:'misconfigured'});return send({error:'SECURITY_CHECK_UNAVAILABLE'},503)}
    const expectedHostnames=[...new Set([CRM_CANONICAL_ORIGIN,...crmAllowedOrigins()].map(x=>new URL(x).hostname))]
    const token=await verifyTurnstileToken({
      token:data.turnstileToken,secretKey:cfg.secretKey,remoteIp:req.headers.get('x-vercel-forwarded-for'),
      expectedAction:TURNSTILE_BOOKING_ACTION,expectedHostnames,
    })
    if(!token.ok){ops(doc.slug,'SECURITY_CHECK_FAILED',403,{reason:token.reason,cfCodes:token.codes});return send({error:'SECURITY_CHECK_FAILED'},403)}
    if(token.action!==TURNSTILE_BOOKING_ACTION || !expectedHostnames.includes(token.hostname)){ops(doc.slug,'SECURITY_CHECK_FAILED',403,{reason:'mismatch'});return send({error:'SECURITY_CHECK_FAILED'},403)}
    const fingerprint=requestFingerprint(INTAKE_LIMIT,req.headers.get('x-vercel-forwarded-for'))
    if(!fingerprint){ops(doc.slug,'SECURITY_CHECK_UNAVAILABLE',503,{reason:'misconfigured'});return send({error:'SECURITY_CHECK_UNAVAILABLE'},503)}
    if(!(await consumeRequestQuota(getCrmPool(),INTAKE_LIMIT,fingerprint))){ops(doc.slug,'TOO_MANY_REQUESTS',429);return send({error:'TOO_MANY_REQUESTS'},429)}

    const marketing=resolveMarketingConsent(data.marketing,req.headers.get('cookie'))
    const attribution=sanitizeAttribution(data.attribution,clean)
    if(!marketing.consent)delete attribution[META_CLICK_ID_PARAM]

    const saved=await saveLeadSubmission(getCrmPool(),{
      idempotencyKey:key,name,email,phone,formSlug:doc.slug,
      formVersion:'flow-v'+doc.publishedVersion,niche:doc.title,answers:result.answers,attribution,
      newLeadIsTest:classifyNewLeadAsTest({email}),bookingMode:getCrmBookingMode(),
      protection:{turnstile:'verified',action:token.action,hostname:token.hostname,challengeTs:token.challengeTs},
      marketing,eventSourceUrl:CRM_CANONICAL_ORIGIN+'/formularios/'+doc.slug,
      flow:{id:doc.id,version:doc.publishedVersion,outcome:result.result.outcome,path:result.path},
    })
    // Somente cadastro novo de lead real gera conversão. Reenvio, lead de teste e recusa não disparam Meta.
    const leadEventId=!saved.reused&&!saved.resubmitted&&saved.isTest===false&&marketing.consent
      ? saved.leadEventId : null
    const capi=leadEventId?metaLeadConfig():null
    if(leadEventId&&capi?.mode==='live'){
      const client=metaLeadClientFromHeaders(req.headers)
      after(()=>dispatchLeadToMeta({config:capi,store:pgLeadCapiStore(getCrmPool()),
        fetch:(url,init)=>fetch(url,{...init,cache:'no-store'}),
        log:entry=>console.info(JSON.stringify(entry))},
        {eventId:leadEventId,...client}).then(()=>undefined))
    }
    // Uma sessão assinada vincula o agendamento à MESMA inscrição já validada.
    // Só o caminho qualificado recebe calendário; sem nova coleta nem novo Lead.
    const inlineBooking=result.result.outcome==='qualified' && Boolean(getBookingForm(doc.slug))
    const bookingEnabled=inlineBooking && bookingAccessConfig().enabled
    const bookingToken=bookingEnabled?createBookingGrant({
      leadId:saved.leadId,submissionId:saved.submissionId,formSlug:doc.slug,
    }):null
    // leadMode: classificação do servidor (crm.leads.is_test) para o rastreamento do funil: só "live" conta como real.
    // Reenvio idempotente (reused) não informa o modo: o navegador mantém o modo da página.
    return send({ok:true,reused:saved.reused,
      ...(!saved.reused&&typeof saved.isTest==='boolean'?{leadMode:saved.isTest?'test':'live'}:{}),
      ...(inlineBooking?{inlineBooking:true,bookingEnabled,bookingToken}:{}),
      ...(leadEventId?{tracking:{lead:{eventName:'Lead',eventId:leadEventId}}}:{}),outcome:result.result.outcome,
      title:result.result.title,description:result.result.description,
      actionLabel:inlineBooking?'':result.result.actionLabel,
      actionHref:inlineBooking?'':result.result.actionHref},saved.reused?200:201)
  }catch(error){
    console.warn('[public-form-flow] submission_failed')
    ops(knownForm,'FORM_SUBMISSION_UNAVAILABLE',503,{dbKind:dbErrorKind(error)})
    return send({error:'FORM_SUBMISSION_UNAVAILABLE'},503)
  }
}
