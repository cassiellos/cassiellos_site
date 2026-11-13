/**
 * Camada HTTP comum dos conectores reais: `fetch` injetável (testes não acessam a rede), tempo-limite, e erros
 * normalizados em `ConnectorError` com mensagem curta e SEM segredos (nunca ecoa token, cabeçalho ou corpo bruto).
 */
import { ConnectorError, type ConnectorErrorKind } from './contracts'

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{
  status: number; headers: { get(name: string): string | null }; text(): Promise<string>
}>

export const DEFAULT_TIMEOUT_MS = 20_000

export async function requestJson(fetchImpl: FetchLike, url: string, init: { method: string; headers: Record<string, string>; body?: string }, mapError: (status: number, body: unknown, headers: { get(n: string): string | null }) => ConnectorError, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<{ body: unknown; headers: { get(n: string): string | null } }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  let res
  try {
    res = await fetchImpl(url, { ...init, signal: ctrl.signal })
  } catch (e) {
    throw new ConnectorError('transient', (e as Error)?.name === 'AbortError' ? 'tempo esgotado' : 'falha de rede')
  } finally { clearTimeout(timer) }
  const text = await res.text()
  let body: unknown = null
  try { body = text ? JSON.parse(text) : null } catch { body = null }
  if (res.status >= 200 && res.status < 300) return { body, headers: res.headers }
  throw mapError(res.status, body, res.headers)
}

export function kindForStatus(status: number): ConnectorErrorKind {
  if (status === 401) return 'auth_expired'
  if (status === 403) return 'permission_denied'
  if (status === 404) return 'not_found'
  if (status === 429) return 'rate_limited'
  if (status >= 500) return 'transient'
  return 'invalid_request'
}

/** Só letras maiúsculas, dígitos e _ (códigos de erro das plataformas) — nunca texto livre vindo da resposta. */
export const safeCode = (v: unknown) => (typeof v === 'string' && /^[A-Za-z_][A-Za-z0-9_.]{1,60}$/.test(v) ? v : null)
