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
  const doc=await getPublishedFlow(getCrmPool(),slug)
  if(!doc?.published)notFound()
  const cfg=getTurnstileConfig()
  const pixel=getMetaPixelConfig()
  // Mensuração do funil: "test" no ambiente de testes (modo de teste ou allowlist ativa); só "live" conta como real.
  // GTM do formulário: desligado salvo TRACKING_GTM_ENABLED=true + GTM_FORM_CONTAINER_ID válido.
  const trackingMode=funnelModeFor({bookingMode:getCrmBookingMode(),allowlistActive:bookingAccessConfig().restrictedToAllowedEmail})
  const gtm=getGtmFormConfig()
  return <PublicFlow key={doc.id+'-'+doc.publishedVersion} slug={doc.slug} title={doc.publishedMeta?.title||doc.title}
    description={doc.publishedMeta?.description||doc.description} version={doc.publishedVersion} flow={doc.published}
    turnstileSiteKey={cfg.status==='ready'?cfg.siteKey:null} metaPixelId={pixel.enabled?pixel.pixelId:null}
    customScheduleEnabled={pixel.enabled && getMetaCustomScheduleEnabled()}
    trackingMode={trackingMode} gtmContainerId={gtm.enabled?gtm.containerId:null}/>
}
