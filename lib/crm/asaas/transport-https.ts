import { request as httpsRequest, type RequestOptions } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { ASAAS_SANDBOX_BASE_URL, AsaasHttpError, type AsaasTransport, type AsaasTransportRequest, type AsaasTransportResponse } from './http'

/**
 * Integração Asaas — FASE 2.2B: transporte HTTPS REAL, restrito ao Sandbox e somente leitura.
 *
 * Usado SOMENTE pelo script de consulta do titular (scripts/asaas-sandbox-probe.ts). Nenhuma rota, tela ou serviço
 * do CRM importa este arquivo (teste estático garante). Barreiras aplicadas em TEMPO DE EXECUÇÃO, não por convenção:
 *  - método: qualquer coisa diferente de GET é recusada antes de abrir conexão (inclusive por uso indevido do tipo);
 *  - destino: a URL precisa começar EXATAMENTE com a base do Sandbox; host, porta, protocolo, usuário/senha e
 *    caminho são conferidos depois da normalização (sem "..", sem host alternativo, sem http);
 *  - o host é FIXO no código: não existe parâmetro de URL base — impossível redirecionar a chave para outro domínio;
 *  - redirecionamento: nunca seguido; qualquer 3xx vira erro (a chave nunca é reenviada a outro destino);
 *  - TLS verificado (rejectUnauthorized), mínimo TLS 1.2, SNI fixo no host do Sandbox;
 *  - cabeçalhos: só accept, access_token e user-agent; nenhum corpo é enviado;
 *  - tempo-limite (AbortSignal do cliente + tempo-limite de socket) e limite de bytes lidos (aborta ao exceder);
 *  - erros: nunca repassa a mensagem do Node (pode conter cabeçalhos/URL) — só códigos curtos.
 */

const BASE = new URL(ASAAS_SANDBOX_BASE_URL)
export const SANDBOX_HOST = BASE.hostname
const ALLOWED_HEADERS = new Set(['accept', 'access_token', 'user-agent'])
const SOCKET_TIMEOUT_MS = 15_000
const MAX_BYTES = 512 * 1024

/** Função de requisição de baixo nível (compatível com https.request); injetável apenas para testes locais. */
export type LowLevelRequest = (options: RequestOptions, onResponse: (res: IncomingMessage) => void) => {
  on(event: 'error', cb: (e: Error) => void): unknown
  on(event: 'timeout', cb: () => void): unknown
  setTimeout(ms: number): unknown
  destroy(error?: Error): unknown
  end(): unknown
}

/** Confere que a URL é do Sandbox (exata) e devolve o caminho normalizado. Lança em qualquer desvio. */
export function assertSandboxUrl(raw: string): string {
  let u: URL
  try { u = new URL(raw) } catch { throw new AsaasHttpError('URL_NOT_ALLOWED') }
  if (u.protocol !== 'https:' || u.hostname !== SANDBOX_HOST || u.port !== '' || u.username !== '' || u.password !== '' || u.hash !== '') {
    throw new AsaasHttpError('URL_NOT_ALLOWED')
  }
  if (!raw.startsWith(ASAAS_SANDBOX_BASE_URL + '/') || !u.pathname.startsWith(BASE.pathname + '/') || /(^|\/)\.\.?(\/|$)|%2e|%2f|\\/i.test(raw.slice(ASAAS_SANDBOX_BASE_URL.length))) {
    throw new AsaasHttpError('URL_NOT_ALLOWED')
  }
  return u.pathname + u.search
}

export function createSandboxHttpsTransport(opts: { request?: LowLevelRequest; maxBytes?: number } = {}): AsaasTransport {
  const doRequest: LowLevelRequest = opts.request ?? (httpsRequest as unknown as LowLevelRequest)
  const maxBytes = opts.maxBytes ?? MAX_BYTES
  return async (url: string, init: AsaasTransportRequest): Promise<AsaasTransportResponse> => {
    // Barreira de execução: o tipo diz 'GET', mas o valor é conferido (uso indevido via cast/JS é recusado).
    if ((init as { method?: unknown })?.method !== 'GET') throw new AsaasHttpError('METHOD_NOT_ALLOWED')
    if ('body' in (init as object)) throw new AsaasHttpError('BODY_NOT_ALLOWED')
    const path = assertSandboxUrl(url)
    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(init.headers ?? {})) {
      const key = k.toLowerCase()
      if (!ALLOWED_HEADERS.has(key) || typeof v !== 'string' || /[\r\n]/.test(v)) throw new AsaasHttpError('HEADER_NOT_ALLOWED')
      headers[key] = v
    }
    if (init.signal?.aborted) throw new AsaasHttpError('ASAAS_TIMEOUT')
    return new Promise<AsaasTransportResponse>((resolve, reject) => {
      let settled = false
      const fail = (code: string) => { if (!settled) { settled = true; reject(new AsaasHttpError(code)) } }
      const req = doRequest({
        protocol: 'https:', hostname: SANDBOX_HOST, servername: SANDBOX_HOST, port: 443, method: 'GET', path, headers,
        rejectUnauthorized: true, minVersion: 'TLSv1.2', agent: false,
      } as RequestOptions, res => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400) { res.resume(); req.destroy(); return fail('ASAAS_REDIRECT_BLOCKED') }
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (c: Buffer) => {
          size += c.length
          if (size > maxBytes) { req.destroy(); fail('ASAAS_RESPONSE_TOO_LARGE') } else chunks.push(c)
        })
        res.on('error', () => fail('ASAAS_NETWORK_ERROR'))
        res.on('end', () => {
          if (settled) return
          settled = true
          const text = Buffer.concat(chunks).toString('utf8')
          const raw = res.headers ?? {}
          resolve({
            status, text: async () => text,
            headers: { get: (name: string) => { const v = raw[name.toLowerCase()]; return Array.isArray(v) ? v[0] ?? null : v ?? null } },
          })
        })
      })
      req.on('error', () => fail(init.signal?.aborted ? 'ASAAS_TIMEOUT' : 'ASAAS_NETWORK_ERROR'))
      req.on('timeout', () => { req.destroy(); fail('ASAAS_TIMEOUT') })
      req.setTimeout(SOCKET_TIMEOUT_MS)
      init.signal?.addEventListener('abort', () => { req.destroy(); fail('ASAAS_TIMEOUT') }, { once: true })
      req.end()
    })
  }
}
