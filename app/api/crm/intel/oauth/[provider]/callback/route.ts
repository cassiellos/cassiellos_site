import { getIntelPool } from '@/lib/crm/db'
import { handleOAuthCallback } from '@/lib/crm/intel/real/oauth-callback'
import { realRuntimeFor } from '@/lib/crm/intel/real/runtime'

// Retorno do OAuth da Central (modo real). Ver lib/crm/intel/real/oauth-callback.ts.
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function GET(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params
  const url = new URL(request.url)
  const res = await handleOAuthCallback(realRuntimeFor(getIntelPool(), process.env), {
    provider, code: url.searchParams.get('code'), state: url.searchParams.get('state'), error: url.searchParams.get('error'), intelEnabled: process.env.MI_ENABLED,
  })
  return new Response(res.html, { status: res.status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' } })
}
