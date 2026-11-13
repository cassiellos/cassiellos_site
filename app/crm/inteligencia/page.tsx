import { cookies } from 'next/headers'
import { notFound, redirect } from 'next/navigation'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import { isIntelEnabled } from '@/lib/crm/intel/feature'
import { isCrmRuntimeEnabled } from '@/lib/crm/runtime-env'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Inteligência | CRM Cassiellos' }

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

/**
 * Compatibilidade com links antigos: a Central agora é uma área nativa de /crm,
 * e não tem mais shell, navegação ou login próprios.
 */
export default async function IntelPage({ searchParams }: Props) {
  if (!isCrmRuntimeEnabled() || !isIntelEnabled(process.env.MI_ENABLED)) notFound()
  const params = await searchParams
  const requestedArea = typeof params.area === 'string' ? params.area : ''
  const area = (['prospeccao', 'agencia', 'cliente', 'conexoes'] as const).find(a => a === requestedArea) ?? 'agencia'
  const target = new URLSearchParams({ view: 'intel-' + area })
  for (const key of ['period', 'platform', 'status', 'client', 'campaign'] as const) {
    const value = params[key]
    // Mantém filtros válidos em links salvos; evita parâmetros não previstos.
    if (typeof value === 'string' && /^[a-zA-Z0-9_ -]{1,60}$/.test(value)) target.set(key, value)
  }
  const destination = '/crm?' + target.toString()
  const session = (await cookies()).get(crmSessionCookieName())?.value
  if (!verifyCrmSession(session)) {
    redirect('/crm/login?next=' + encodeURIComponent('/crm?view=intel-' + area))
  }
  redirect(destination)
}
