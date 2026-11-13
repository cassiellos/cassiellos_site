import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import { isIntelEnabled } from '@/lib/crm/intel/feature'
import { isCrmRuntimeEnabled } from '@/lib/crm/runtime-env'
import IntelApp from './intel-app'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Central de Inteligência · CRM' }

/**
 * Central de Inteligência de Marketing — rota própria e isolada do CRM comercial.
 * Mesma proteção das demais telas administrativas: ambiente do CRM + sessão válida; além disso, flag exclusiva
 * MI_ENABLED=true (desligada por padrão — Production não exibe nada enquanto a flag não for autorizada).
 */
export default async function IntelPage() {
  if (!isCrmRuntimeEnabled() || !isIntelEnabled(process.env.MI_ENABLED)) notFound()
  const session = (await cookies()).get(crmSessionCookieName())?.value
  if (!verifyCrmSession(session)) redirect('/crm/login?next=' + encodeURIComponent('/crm/inteligencia'))
  return <IntelApp />
}
