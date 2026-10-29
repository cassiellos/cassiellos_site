/**
 * Cloudflare Turnstile — verificação antiabuso do formulário público (Fase 3 / item 4).
 *
 * - A validação acontece SOMENTE no servidor (Siteverify); o navegador só obtém o token.
 * - Exige success === true, hostname permitido, action esperada e token recente.
 * - Tokens inválidos, expirados ou reutilizados são rejeitados (o Siteverify aceita
 *   cada token uma única vez; validade de 300 s).
 * - Falha fechada: sem configuração válida ou com o serviço indisponível, nada é gravado.
 * - Chaves oficiais de TESTE nunca são aceitas em ambiente publicado (Vercel).
 * - Nenhum token, segredo, IP ou e-mail é devolvido nos resultados ou escrito em logs.
 * - Turnstile NÃO comprova a titularidade do e-mail (ver allowlist / confirmação futura).
 */

export const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'
/** Action enviada pelo widget do formulário de diagnóstico e exigida no servidor. */
export const TURNSTILE_BOOKING_ACTION = 'booking_lead'
export const TURNSTILE_TOKEN_MAX_LENGTH = 2048
export const TURNSTILE_TOKEN_MAX_AGE_SECONDS = 300

/** Chaves e token oficiais de teste da Cloudflare (documentação Turnstile > Testing). */
export const TURNSTILE_TEST_KEYS = {
  siteAlwaysPasses: '1x00000000000000000000AA',
  siteAlwaysBlocks: '2x00000000000000000000AB',
  siteInvisiblePasses: '1x00000000000000000000BB',
  siteInvisibleBlocks: '2x00000000000000000000BB',
  siteForcesInteractive: '3x00000000000000000000FF',
  secretAlwaysPasses: '1x0000000000000000000000000000000AA',
  secretAlwaysFails: '2x0000000000000000000000000000000AA',
  secretTokenSpent: '3x0000000000000000000000000000000AA',
  dummyToken: 'XXXX.DUMMY.TOKEN.XXXX',
} as const

const TEST_KEY_PATTERN = /^[123]x0{20,}[A-Z]{2}$/

export function isTurnstileTestKey(key: string | undefined | null): boolean {
  return typeof key === 'string' && TEST_KEY_PATTERN.test(key.trim())
}

export type TurnstileConfig =
  | { status: 'ready'; siteKey: string; secretKey: string; usingTestKeys: boolean }
  | { status: 'missing' | 'invalid' | 'test_keys_in_deployment' }

type Env = Record<string, string | undefined>

/** Lê e valida as chaves. Em ambiente publicado (Vercel) chaves de teste são recusadas. */
export function getTurnstileConfig(env: Env = process.env): TurnstileConfig {
  const siteKey = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || ''
  const secretKey = env.TURNSTILE_SECRET_KEY?.trim() || ''
  if (!siteKey || !secretKey) return { status: 'missing' }
  const shape = /^[0-9A-Za-z_-]{10,200}$/
  if (!shape.test(siteKey) || !shape.test(secretKey)) return { status: 'invalid' }
  const usingTestKeys = isTurnstileTestKey(siteKey) || isTurnstileTestKey(secretKey)
  const deployed = Boolean(env.VERCEL) || Boolean(env.VERCEL_ENV)
  if (usingTestKeys && deployed) return { status: 'test_keys_in_deployment' }
  return { status: 'ready', siteKey, secretKey, usingTestKeys }
}

export type TurnstileFailure =
  | 'missing'            // nenhum token enviado
  | 'invalid'            // token malformado ou recusado pela Cloudflare
  | 'expired_or_reused'  // token vencido (300 s) ou já validado antes
  | 'hostname_mismatch'  // token emitido para outro domínio
  | 'action_mismatch'    // token emitido para outra ação/formulário
  | 'unavailable'        // Siteverify fora do ar / tempo esgotado / erro interno
  | 'misconfigured'      // chave secreta recusada pela Cloudflare

export type TurnstileResult =
  | { ok: true; hostname: string; action: string; challengeTs: string | null }
  | { ok: false; reason: TurnstileFailure; codes: string[] }

export type FetchLike = (url: string, init: {
  method: 'POST'
  headers: Record<string, string>
  body: string
  signal: AbortSignal
}) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export type VerifyTurnstileInput = {
  token: unknown
  secretKey: string
  expectedAction: string
  expectedHostnames: readonly string[]
  remoteIp?: string | null
  now?: Date
  timeoutMs?: number
  fetchImpl?: FetchLike
  /** Gerador do idempotency_key (permite repetir a mesma validação uma vez com segurança). */
  idempotencyKey?: () => string
}

function safeCodes(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((c): c is string => typeof c === 'string' && /^[a-z0-9-]{1,64}$/.test(c)).slice(0, 8)
    : []
}

function validIp(value: string | null | undefined): string | null {
  if (!value) return null
  const first = value.split(',')[0]?.trim() || ''
  return /^[0-9a-fA-F:.]{3,45}$/.test(first) ? first : null
}

async function callSiteverify(input: VerifyTurnstileInput, token: string, key: string): Promise<
  { kind: 'response'; data: Record<string, unknown> } | { kind: 'unavailable'; codes: string[] }
> {
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as FetchLike)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 5_000)
  try {
    const body: Record<string, string> = { secret: input.secretKey, response: token, idempotency_key: key }
    const ip = validIp(input.remoteIp)
    if (ip) body.remoteip = ip
    const response = await fetchImpl(TURNSTILE_SITEVERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (response.status >= 500) return { kind: 'unavailable', codes: ['http-' + response.status] }
    const data = await response.json()
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return { kind: 'unavailable', codes: ['bad-response'] }
    }
    return { kind: 'response', data: data as Record<string, unknown> }
  } catch {
    return { kind: 'unavailable', codes: [controller.signal.aborted ? 'timeout' : 'network-error'] }
  } finally {
    clearTimeout(timer)
  }
}

/** Valida o token no Siteverify. Nunca lança exceção; nunca devolve token ou segredo. */
export async function verifyTurnstileToken(input: VerifyTurnstileInput): Promise<TurnstileResult> {
  const token = typeof input.token === 'string' ? input.token.trim() : ''
  if (!token) return { ok: false, reason: 'missing', codes: [] }
  if (token.length > TURNSTILE_TOKEN_MAX_LENGTH || /\s/.test(token)) {
    return { ok: false, reason: 'invalid', codes: ['malformed-token'] }
  }
  const key = (input.idempotencyKey ?? (() => crypto.randomUUID()))()

  // One retry with the SAME idempotency_key only when Cloudflare could not answer.
  let outcome = await callSiteverify(input, token, key)
  if (outcome.kind === 'unavailable' ||
    (outcome.kind === 'response' && safeCodes(outcome.data['error-codes']).includes('internal-error'))) {
    outcome = await callSiteverify(input, token, key)
  }
  if (outcome.kind === 'unavailable') return { ok: false, reason: 'unavailable', codes: outcome.codes }

  const data = outcome.data
  const codes = safeCodes(data['error-codes'])
  if (data.success !== true) {
    if (codes.includes('missing-input-secret') || codes.includes('invalid-input-secret')) {
      return { ok: false, reason: 'misconfigured', codes }
    }
    if (codes.includes('internal-error')) return { ok: false, reason: 'unavailable', codes }
    if (codes.includes('timeout-or-duplicate')) return { ok: false, reason: 'expired_or_reused', codes }
    if (codes.includes('missing-input-response')) return { ok: false, reason: 'missing', codes }
    return { ok: false, reason: 'invalid', codes }
  }

  const hostname = typeof data.hostname === 'string' ? data.hostname.toLowerCase() : ''
  if (!hostname || !input.expectedHostnames.map(h => h.toLowerCase()).includes(hostname)) {
    return { ok: false, reason: 'hostname_mismatch', codes: [] }
  }
  const action = typeof data.action === 'string' ? data.action : ''
  if (action !== input.expectedAction) return { ok: false, reason: 'action_mismatch', codes: [] }

  // Defense in depth: Cloudflare already enforces the 300 s validity.
  const challengeTs = typeof data.challenge_ts === 'string' ? data.challenge_ts : null
  if (challengeTs) {
    const issued = Date.parse(challengeTs)
    const now = (input.now ?? new Date()).getTime()
    if (!Number.isFinite(issued) || now - issued > (TURNSTILE_TOKEN_MAX_AGE_SECONDS + 30) * 1000 ||
      issued - now > 60_000) {
      return { ok: false, reason: 'expired_or_reused', codes: ['stale-challenge'] }
    }
  }
  return { ok: true, hostname, action, challengeTs }
}

/** Código público (sem detalhes internos) para cada falha. */
export function publicTurnstileError(reason: TurnstileFailure): { status: number; error: string } {
  switch (reason) {
    case 'missing': return { status: 400, error: 'SECURITY_CHECK_REQUIRED' }
    case 'expired_or_reused': return { status: 403, error: 'SECURITY_CHECK_EXPIRED' }
    case 'unavailable':
    case 'misconfigured': return { status: 503, error: 'SECURITY_CHECK_UNAVAILABLE' }
    default: return { status: 403, error: 'SECURITY_CHECK_FAILED' }
  }
}
