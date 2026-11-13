import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import { adminActorFromSession } from '@/lib/crm/admin-actions'
import { handleIntelAdmin, MAX_INTEL_BODY, MAX_INTEL_REAL_BODY, type IntelRequest } from '@/lib/crm/intel/admin-request'
import { isIntelOriginAllowed } from '@/lib/crm/intel/origin'
import { crmRuntimeRequestEnv } from '@/lib/crm/runtime-env'
import { getIntelPool } from '@/lib/crm/db'
import { dataMode } from '@/lib/crm/intel/real/config'
import { handleIntelReal } from '@/lib/crm/intel/real/admin-real'
import { realRuntimeFor } from '@/lib/crm/intel/real/runtime'

// Central de Inteligência de Marketing. Padrão: DADOS SIMULADOS (lib/crm/intel/admin-request.ts).
// Com MI_DATA_MODE=real: clientes e contas reais persistidos no banco do CRM (lib/crm/intel/real/admin-real.ts).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const NO_STORE = { 'Cache-Control': 'private, no-store' }

async function base(request: Request): Promise<Omit<IntelRequest, 'method' | 'rawBody'>> {
  const session = (await cookies()).get(crmSessionCookieName())?.value
  const valid = verifyCrmSession(session)
  return {
    ...crmRuntimeRequestEnv(),
    intelEnabled: process.env.MI_ENABLED,
    sessionValid: valid,
    originAllowed: isIntelOriginAllowed(request.headers.get('origin'), { vercelEnv: process.env.VERCEL_ENV, branchUrl: process.env.VERCEL_BRANCH_URL, deploymentUrl: process.env.VERCEL_URL }),
    contentType: request.headers.get('content-type'),
    searchParams: new URL(request.url).searchParams,
    actorRef: valid && session ? adminActorFromSession(session).sessionRef : 'anon',
  }
}

function handle(req: Parameters<typeof handleIntelAdmin>[1]) {
  // A sessão é verificada ANTES de qualquer acesso ao banco (handleIntelReal); sem MI_DATA_MODE=real nada do modo real é carregado.
  if (dataMode() === 'real') return handleIntelReal({ runtime: realRuntimeFor(getIntelPool(), process.env) }, req)
  return handleIntelAdmin({}, req)
}

export async function GET(request: Request) {
  const res = await handle({ ...(await base(request)), method: 'GET' })
  return NextResponse.json(res.body, { status: res.status, headers: NO_STORE })
}

export async function POST(request: Request) {
  const length = Number(request.headers.get('content-length') ?? '0')
  const max = dataMode() === 'real' ? MAX_INTEL_REAL_BODY : MAX_INTEL_BODY
  if (length > max) return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413, headers: NO_STORE })
  const rawBody = (await request.text()).slice(0, max + 1)
  const res = await handle({ ...(await base(request)), method: 'POST', rawBody })
  return NextResponse.json(res.body, { status: res.status, headers: NO_STORE })
}
