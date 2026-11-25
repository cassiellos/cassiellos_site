import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getCrmPool } from '@/lib/crm/db'
import { getPublishedFlow } from '@/lib/crm/form-builder/store'
import { isCrmRuntimeEnabled } from '@/lib/crm/runtime-env'
import { getTurnstileConfig } from '@/lib/crm/turnstile'
import { getMetaPixelConfig, getMetaCustomScheduleEnabled } from '@/lib/marketing/meta'
import { getCrmBookingMode } from '@/lib/crm/booking-mode'
import { bookingAccessConfig } from '@/lib/crm/booking-access'
import { funnelModeFor } from '@/lib/crm/funnel-events'
import { getGtmFormConfig } from '@/lib/tracking/gtm-config'
import { getEntryNoticeConfig } from '@/lib/privacy/entry-notice-config'
import { dbErrorKind, opsLog } from '@/lib/crm/ops-log'
import { retryTransient } from '@/lib/crm/db-retry'
import PublicFlow from './public-flow'
import './public-flow.css'

export const dynamic='force-dynamic'
export const metadata:Metadata={
  title:'Diagnóstico estratégico | Cassiellos',
  description:'Responda algumas perguntas para conversar com a Agência Cassiellos.',
  robots:{index:false,follow:false,nocache:true},
}
export default async function FlowPage({params}:{params:Promise<{slug:string}>}){
  if(!isCrmRuntimeEnabled() && process.env.NODE_ENV==='production')notFound()
  const {slug}=await params
  let doc:Awaited<ReturnType<typeof getPublishedFlow>>
  // Leitura idempotente: falha transitória de conexão (início a frio do Neon) ganha nova tentativa antes de virar erro.
  try{doc=await retryTransient(()=>getPublishedFlow(getCrmPool(),slug))}catch(error){
    // Registro operacional mínimo: a página do formulário não abriu. Só a categoria do erro; o slug da URL não é registrado.
    opsLog({stage:'form_page',code:'FORM_PAGE_UNAVAILABLE',dbKind:dbErrorKind(error)})
    throw error
  }
  if(!doc?.published)notFound()
  const cfg=getTurnstileConfig()
  const pixel=getMetaPixelConfig()
  // Mensuração do funil: "test" no ambiente de testes (modo de teste ou allowlist ativa); só "live" conta como real.
  // GTM do formulário: desligado salvo TRACKING_GTM_ENABLED=true + GTM_FORM_CONTAINER_ID válido.
  const trackingMode=funnelModeFor({bookingMode:getCrmBookingMode(),allowlistActive:bookingAccessConfig().restrictedToAllowedEmail})
  const gtm=getGtmFormConfig()
  // Aviso de entrada: desligado salvo CONSENT_ENTRY_NOTICE_ENABLED=true (chave exclusiva; não concede consentimento).
  const entryNotice=getEntryNoticeConfig()
  return <PublicFlow key={doc.id+'-'+doc.publishedVersion} slug={doc.slug} title={doc.publishedMeta?.title||doc.title}
    description={doc.publishedMeta?.description||doc.description} version={doc.publishedVersion} flow={doc.published}
    turnstileSiteKey={cfg.status==='ready'?cfg.siteKey:null} metaPixelId={pixel.enabled?pixel.pixelId:null}
    customScheduleEnabled={pixel.enabled && getMetaCustomScheduleEnabled()}
    trackingMode={trackingMode} gtmContainerId={gtm.enabled?gtm.containerId:null}
    entryNoticeEnabled={entryNotice.enabled}/>
}
