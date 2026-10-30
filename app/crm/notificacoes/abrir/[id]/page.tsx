import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import { pushRuntimeDeps } from '@/lib/crm/push/runtime'
import { resolveNotification } from '@/lib/crm/push/store'
import { safeCrmReturnPath } from '@/lib/crm/return-path'

export const dynamic = 'force-dynamic'

/**
 * Destino de TODO aviso do PWA: o aviso só leva este ID opaco. Aqui, com a sessão administrativa,
 * o servidor descobre a tela certa (ficha do lead ou da reunião) e redireciona. Sem sessão: login → volta.
 */
export default async function OpenNotificationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const self = safeCrmReturnPath('/crm/notificacoes/abrir/' + id)
  const cookieStore = await cookies()
  if (!verifyCrmSession(cookieStore.get(crmSessionCookieName())?.value)) {
    redirect(self ? '/crm/login?next=' + encodeURIComponent(self) : '/crm/login')
  }
  let target = '/crm'
  try { target = await resolveNotification(pushRuntimeDeps().pool, id) } catch { target = '/crm' }
  redirect(safeCrmReturnPath(target) ?? '/crm')
}
