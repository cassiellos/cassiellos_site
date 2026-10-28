import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import MiniCrm from './mini-crm'

export const dynamic = 'force-dynamic'

export default async function CrmPage() {
  const cookieStore = await cookies()
  const session = cookieStore.get(crmSessionCookieName())?.value
  if (!verifyCrmSession(session)) {
    redirect('/crm/login')
  }
  return <MiniCrm />
}
