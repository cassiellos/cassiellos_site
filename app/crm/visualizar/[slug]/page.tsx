import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import { getCrmPool } from '@/lib/crm/db'
import { getDraftFlowBySlug } from '@/lib/crm/form-builder/store'
import { validFlowSlug } from '@/lib/crm/form-builder/flow'
import { isCrmRuntimeEnabled } from '@/lib/crm/runtime-env'
import PublicFlow from '@/app/formularios/[slug]/public-flow'
import '@/app/formularios/[slug]/public-flow.css'
import './preview.css'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = {
  title: 'Prévia privada do formulário | SHARK SCALE',
  robots: { index: false, follow: false, nocache: true },
}

export default async function FormDraftPreviewPage({ params }: { params: Promise<{ slug: string }> }) {
  if (!isCrmRuntimeEnabled() && process.env.NODE_ENV === 'production') notFound()
  const { slug } = await params
  if (!validFlowSlug(slug)) notFound()
  const cookieStore = await cookies()
  const session = cookieStore.get(crmSessionCookieName())?.value
  if (!verifyCrmSession(session)) {
    redirect('/crm/login?next=' + encodeURIComponent('/crm/visualizar/' + slug))
  }
  // Rascunho salvo no banco; acesso privado. Não publica e não gera dados de marketing.
  const doc = await getDraftFlowBySlug(getCrmPool(), slug)
  if (!doc) notFound()
  return <div className="crm-draft-preview-page">
    <div className="crm-draft-preview-banner" role="status">
      <div>
        <strong>PRÉVIA PRIVADA · NÃO PUBLICADA</strong>
        <span>Visualização da última versão salva do formulário. Nenhum lead ou evento de anúncio será registrado.</span>
      </div>
      <a href={'/crm?view=formularios&form=' + encodeURIComponent(slug)}>← Voltar ao editor</a>
    </div>
    <PublicFlow key={doc.id + ':' + doc.revision} slug={doc.slug} title={doc.title}
      description={doc.description} version={doc.revision} flow={doc.draft}
      metaPixelId={null} turnstileSiteKey={null} previewOnly />
  </div>
}
