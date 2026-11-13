import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'
import { crmSessionCookieName, verifyCrmSession } from '@/lib/crm/auth'
import { adminActorFromSession } from '@/lib/crm/admin-actions'
import { handleIntelAdmin, MAX_INTEL_BODY, type IntelRequest } from '@/lib/crm/intel/admin-request'
import { isIntelOriginAllowed } from '@/lib/crm/intel/origin'
import { crmRuntimeRequestEnv } from '@/lib/crm/runtime-env'

// Central de Inteligência de Marketing — fundação com DADOS SIMULADOS (ver lib/crm/intel/admin-request.ts).
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 15

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

export async function GET(request: Request) {
  const res = await handleIntelAdmin({}, { ...(await base(request)), method: 'GET' })
  return NextResponse.json(res.body, { status: res.status, headers: NO_STORE })
}

export async function POST(request: Request) {
  const length = Number(request.headers.get('content-length') ?? '0')
  if (length > MAX_INTEL_BODY) return NextResponse.json({ error: 'PAYLOAD_TOO_LARGE' }, { status: 413, headers: NO_STORE })
  const rawBody = (await request.text()).slice(0, MAX_INTEL_BODY + 1)
  const res = await handleIntelAdmin({}, { ...(await base(request)), method: 'POST', rawBody })
  return NextResponse.json(res.body, { status: res.status, headers: NO_STORE })
}
