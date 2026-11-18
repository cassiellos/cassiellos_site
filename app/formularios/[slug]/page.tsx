import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { getCrmPool } from '@/lib/crm/db'
import { getPublishedFlow } from '@/lib/crm/form-builder/store'
import { isCrmRuntimeEnabled } from '@/lib/crm/runtime-env'
import { getTurnstileConfig } from '@/lib/crm/turnstile'
import { getMetaPixelConfig } from '@/lib/marketing/meta'
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
  return <PublicFlow key={doc.id+'-'+doc.publishedVersion} slug={doc.slug} title={doc.publishedMeta?.title||doc.title}
    description={doc.publishedMeta?.description||doc.description} version={doc.publishedVersion} flow={doc.published}
    turnstileSiteKey={cfg.status==='ready'?cfg.siteKey:null} metaPixelId={pixel.enabled?pixel.pixelId:null}/>
}
