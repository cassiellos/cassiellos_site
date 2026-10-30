import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import { safeCrmReturnPath } from '@/lib/crm/return-path'
import MiniCrm from './mini-crm'

export const dynamic = 'force-dynamic'

type CrmPageProps = { searchParams: Promise<{ lead?: string; view?: string }> }

export default async function CrmPage({ searchParams }: CrmPageProps) {
  const cookieStore = await cookies()
  const session = cookieStore.get(crmSessionCookieName())?.value
  if (!verifyCrmSession(session)) {
    // Link direto (ex.: aviso do PWA) com a sessão expirada: login e depois volta para a mesma tela.
    const { lead, view } = await searchParams
    const target = lead ? '/crm?lead=' + lead : view ? '/crm?view=' + view : null
    const next = safeCrmReturnPath(target)
    redirect(next ? '/crm/login?next=' + encodeURIComponent(next) : '/crm/login')
  }
  return <MiniCrm />
}
