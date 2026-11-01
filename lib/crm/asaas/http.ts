import { CUSTOMER_ID, PAYMENT_ID, SUBSCRIPTION_ID, type AsaasEnvironment, type AsaasReadGateway } from './types'

/**
 * Integração Asaas — FASE 2.2A: cliente HTTP de LEITURA preparado, DESATIVADO e sem acesso à rede.
 *
 * Garantias desta fase (verificadas por testes):
 *  - Só existe a URL base do SANDBOX. Production é recusado na criação (não há URL de produção neste módulo).
 *  - O cliente NUNCA usa o fetch global: o transporte HTTP precisa ser injetado. Nenhuma rota, tela ou serviço
 *    importa este módulo; nos testes o transporte é um simulador (mock) com respostas fictícias.
 *  - Desativado por padrão: sem `enabled: true` explícito, qualquer chamada falha antes de montar a requisição.
 *  - SOMENTE LEITURA: apenas GET em clientes, assinaturas e cobranças. Não há método de criação, alteração,
 *    cancelamento, estorno, envio de notificação ou configuração de webhook.
 *  - A chave da API fica só numa variável interna (closure): não é propriedade do objeto, não aparece em
 *    JSON.stringify/inspect, em mensagens de erro nem em registros. Chave de produção é recusada no Sandbox.
 *  - Toda requisição tem tempo-limite (AbortController) e limite de tamanho de resposta.
 *  - Erros viram códigos curtos (AsaasHttpError); o corpo da resposta de erro nunca é repassado (pode conter dados
 *    pessoais) — só códigos de erro do Asaas no formato esperado.
 *
 * Valores a confirmar na homologação do Sandbox (Fase 2.2B): URL base, prefixo da chave e formato do erro.
 */

/** URL base da API Sandbox do Asaas (documentação oficial). Única URL presente neste módulo. */
export const ASAAS_SANDBOX_BASE_URL = 'https://api-sandbox.asaas.com/v3'

/** Prefixos documentados das chaves: Sandbox ("hmlg") e Production ("prod"). */
const SANDBOX_KEY = /^\$aact_hmlg_[A-Za-z0-9_\-:.=+/]{16,400}$/
const PRODUCTION_KEY_HINT = /^\$aact_prod_/

export const DEFAULT_TIMEOUT_MS = 8_000
const MAX_TIMEOUT_MS = 20_000
const MAX_RESPONSE_BYTES = 512 * 1024
const PAGE_LIMIT = 100
const MAX_PAGES = 20
/** Retentativas LIMITADAS, só para 429 e 502/503/504 (nunca para 4xx de autenticação nem para 500). */
const DEFAULT_MAX_RETRIES = 2
const MAX_RETRIES = 3
/** Retry-After acima disto não é esperado: a chamada falha (nunca fica presa aguardando). */
const MAX_RETRY_AFTER_MS = 30_000
/** Orçamento de requisições por cliente (proteção contra laço) e intervalo mínimo entre requisições. */
const DEFAULT_MAX_REQUESTS = 60
const DEFAULT_MIN_INTERVAL_MS = 300
const RETRYABLE = new Set([429, 502, 503, 504])
export const LISTABLE_RESOURCES = ['customers', 'payments', 'subscriptions'] as const
export type ListableResource = typeof LISTABLE_RESOURCES[number]
export type AsaasPage = { object: 'list'; hasMore: boolean; totalCount: number | null; limit: number | null; offset: number | null; data: unknown[] }

export class AsaasHttpError extends Error {
  constructor(readonly code: string, readonly status: number | null = null, readonly asaasCodes: readonly string[] = [],
    readonly retryAfterSeconds: number | null = null) {
    super(code)
    this.name = 'AsaasHttpError'
  }
}

/** Resposta mínima que o transporte injetado precisa devolver (compatível com a Response do fetch). */
export type AsaasTransportResponse = { status: number; text(): Promise<string>; headers?: { get(name: string): string | null } }
export type AsaasTransportRequest = { method: 'GET'; headers: Record<string, string>; signal: AbortSignal }
/** Transporte HTTP injetado (fetch-like). Nesta fase, apenas simuladores de teste. */
export type AsaasTransport = (url: string, init: AsaasTransportRequest) => Promise<AsaasTransportResponse>

export type AsaasHttpConfig = {
  environment: AsaasEnvironment
  /** Liga o cliente. Ausente/false = desativado (padrão). */
  enabled?: boolean
  apiKey?: string | null
  transport?: AsaasTransport
  timeoutMs?: number
  userAgent?: string
  maxRetries?: number
  maxRequests?: number
  minIntervalMs?: number
  /** Espera injetável (testes). Padrão: setTimeout. */
  sleep?: (ms: number) => Promise<void>
  /** Observador SANITIZADO de cada requisição (endpoint sem query, status, duração, código) — nunca cabeçalhos ou corpo. */
  onRequest?: (info: AsaasRequestInfo) => void
}

export type AsaasRequestInfo = { method: 'GET'; path: string; status: number | null; ms: number; attempt: number; code: string | null }

export type AsaasSandboxGateway = AsaasReadGateway & {
  readonly baseUrl: string
  readonly enabled: boolean
  getCustomer(customerId: string): Promise<unknown>
  /** Uma página da listagem (somente leitura) de clientes, cobranças ou assinaturas. */
  listPage(resource: ListableResource, offset?: number, limit?: number): Promise<AsaasPage>
}

/** Retry-After em segundos (inteiro) ou data HTTP → milissegundos; inválido → null. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | null {
  if (!value) return null
  const v = value.trim()
  if (/^\d{1,6}$/.test(v)) return Number(v) * 1000
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : Math.max(0, t - now)
}

/** Remove de um texto qualquer coisa parecida com uma chave do Asaas (barreira para registros e erros). */
export function redactSecrets(text: string): string {
  return text.replace(/\$aact_[A-Za-z0-9_\-:.=+/]+/g, '[redacted]').replace(/access_token["']?\s*[:=]\s*["']?[^"',\s}]+/gi, 'access_token=[redacted]')
}

function assertId(id: unknown, pattern: RegExp, code: string): string {
  if (typeof id !== 'string' || !pattern.test(id)) throw new AsaasHttpError(code)
  return id
}

function safeAsaasCodes(body: unknown): string[] {
  const errors = (body as { errors?: unknown })?.errors
  if (!Array.isArray(errors)) return []
  return errors.map(e => (e as { code?: unknown })?.code).filter((c): c is string => typeof c === 'string' && /^[a-z0-9_]{1,60}$/i.test(c)).slice(0, 5)
}

function statusCode(status: number): string {
  if (status === 400) return 'ASAAS_BAD_REQUEST'
  if (status === 401) return 'ASAAS_UNAUTHORIZED'
  if (status === 403) return 'ASAAS_FORBIDDEN'
  if (status === 404) return 'ASAAS_NOT_FOUND'
  if (status === 429) return 'ASAAS_RATE_LIMITED'
  if (status >= 500) return 'ASAAS_UPSTREAM_ERROR'
  return 'ASAAS_UNEXPECTED_STATUS'
}

/**
 * Cria o cliente de leitura do Sandbox. Valida a configuração na criação (ambiente, chave, transporte), mas só
 * recusa CHAMADAS quando desativado — assim um cliente desativado pode existir sem nenhuma credencial.
 */
export function createAsaasSandboxGateway(config: AsaasHttpConfig): AsaasSandboxGateway {
  if (config.environment !== 'sandbox') throw new AsaasHttpError('PRODUCTION_NOT_ALLOWED_IN_THIS_PHASE')
  const enabled = config.enabled === true
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_TIMEOUT_MS) throw new AsaasHttpError('INVALID_TIMEOUT')
  // A chave só existe nesta variável local (closure).
  const apiKey = config.apiKey ?? null
  const transport = config.transport ?? null
  if (apiKey !== null && PRODUCTION_KEY_HINT.test(apiKey)) throw new AsaasHttpError('PRODUCTION_KEY_IN_SANDBOX')
  if (enabled) {
    if (!transport) throw new AsaasHttpError('TRANSPORT_REQUIRED')
    if (!apiKey || !SANDBOX_KEY.test(apiKey)) throw new AsaasHttpError('INVALID_SANDBOX_KEY')
  }
  const userAgent = (config.userAgent ?? 'cassiellos-crm/financeiro').replace(/[^\x20-\x7e]/g, '').slice(0, 80)
  const maxRetries = config.maxRetries ?? DEFAULT_MAX_RETRIES
  if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > MAX_RETRIES) throw new AsaasHttpError('INVALID_RETRIES')
  const maxRequests = config.maxRequests ?? DEFAULT_MAX_REQUESTS
  if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 1000) throw new AsaasHttpError('INVALID_REQUEST_BUDGET')
  const minIntervalMs = config.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS
  if (!Number.isInteger(minIntervalMs) || minIntervalMs < 0 || minIntervalMs > 10_000) throw new AsaasHttpError('INVALID_INTERVAL')
  const sleep = config.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const onRequest = config.onRequest ?? (() => undefined)
  let requests = 0
  let lastAt = 0

  /** GET com retentativas limitadas (429/502/503/504), respeitando Retry-After e o orçamento de requisições. */
  async function get(path: string): Promise<unknown> {
    if (!enabled || !transport || !apiKey) throw new AsaasHttpError('ASAAS_HTTP_DISABLED')
    for (let attempt = 1; ; attempt++) {
      try {
        return await once(path, attempt)
      } catch (e) {
        const err = e as AsaasHttpError
        if (!(err instanceof AsaasHttpError) || err.status === null || !RETRYABLE.has(err.status) || attempt > maxRetries) throw err
        const wait = err.retryAfterSeconds !== null ? err.retryAfterSeconds * 1000 : 1000 * 2 ** (attempt - 1)
        if (wait > MAX_RETRY_AFTER_MS) throw err
        await sleep(wait)
      }
    }
  }

  async function once(path: string, attempt: number): Promise<unknown> {
    if (requests >= maxRequests) throw new AsaasHttpError('ASAAS_REQUEST_BUDGET_EXCEEDED')
    const gap = lastAt + minIntervalMs - Date.now()
    if (lastAt && gap > 0) await sleep(gap)
    requests++
    lastAt = Date.now()
    const started = Date.now()
    const report = (status: number | null, code: string | null) =>
      onRequest({ method: 'GET', path: path.split('?')[0], status, ms: Date.now() - started, attempt, code })
    try {
      const body = await request(path)
      report(200, null)
      return body
    } catch (e) {
      const err = e as AsaasHttpError
      report(err.status ?? null, err.code ?? 'UNEXPECTED_ERROR')
      throw err
    }
  }

  async function request(path: string): Promise<unknown> {
    if (!transport || !apiKey) throw new AsaasHttpError('ASAAS_HTTP_DISABLED')
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: AsaasTransportResponse
    let text: string
    try {
      res = await transport(ASAAS_SANDBOX_BASE_URL + path, {
        method: 'GET', signal: controller.signal,
        headers: { accept: 'application/json', access_token: apiKey, 'user-agent': userAgent },
      })
      text = await res.text()
    } catch {
      // Nunca repassa a mensagem do transporte (pode conter URL, cabeçalhos ou detalhes de rede).
      throw new AsaasHttpError(controller.signal.aborted ? 'ASAAS_TIMEOUT' : 'ASAAS_NETWORK_ERROR')
    } finally {
      clearTimeout(timer)
    }
    if (typeof text !== 'string' || text.length > MAX_RESPONSE_BYTES) throw new AsaasHttpError('ASAAS_RESPONSE_TOO_LARGE', res.status)
    let body: unknown = null
    if (text.length) {
      try { body = JSON.parse(text) } catch { throw new AsaasHttpError('ASAAS_INVALID_JSON', res.status) }
    }
    if (res.status < 200 || res.status > 299) {
      const ra = parseRetryAfter(res.headers?.get('retry-after'))
      throw new AsaasHttpError(statusCode(res.status), res.status, safeAsaasCodes(body), ra === null ? null : Math.ceil(ra / 1000))
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AsaasHttpError('ASAAS_INVALID_RESPONSE', res.status)
    return body
  }

  async function getObject(path: string, object: string, id: string): Promise<unknown> {
    const body = await get(path) as Record<string, unknown>
    if (body.object !== undefined && body.object !== object) throw new AsaasHttpError('ASAAS_UNEXPECTED_OBJECT')
    if (body.id !== id) throw new AsaasHttpError('ASAAS_ID_MISMATCH')
    return body
  }

  const gateway: AsaasSandboxGateway = {
    environment: 'sandbox',
    baseUrl: ASAAS_SANDBOX_BASE_URL,
    enabled,
    getCustomer: async id => getObject('/customers/' + assertId(id, CUSTOMER_ID, 'INVALID_CUSTOMER_ID'), 'customer', id),
    getPayment: async id => getObject('/payments/' + assertId(id, PAYMENT_ID, 'INVALID_PAYMENT_ID'), 'payment', id),
    getSubscription: async id => getObject('/subscriptions/' + assertId(id, SUBSCRIPTION_ID, 'INVALID_SUBSCRIPTION_ID'), 'subscription', id),
    async listSubscriptionPayments(id) {
      assertId(id, SUBSCRIPTION_ID, 'INVALID_SUBSCRIPTION_ID')
      const out: unknown[] = []
      for (let page = 0; page < MAX_PAGES; page++) {
        const body = await get(`/subscriptions/${id}/payments?offset=${page * PAGE_LIMIT}&limit=${PAGE_LIMIT}`) as Record<string, unknown>
        if (!Array.isArray(body.data)) throw new AsaasHttpError('ASAAS_INVALID_RESPONSE')
        out.push(...body.data)
        if (body.hasMore !== true) return out
        if (body.data.length === 0) throw new AsaasHttpError('ASAAS_INVALID_PAGINATION')
      }
      throw new AsaasHttpError('ASAAS_TOO_MANY_PAGES')
    },
    async listPage(resource, offset = 0, limit = 10) {
      if (!LISTABLE_RESOURCES.includes(resource)) throw new AsaasHttpError('INVALID_RESOURCE')
      if (!Number.isInteger(offset) || offset < 0 || offset > 100_000) throw new AsaasHttpError('INVALID_OFFSET')
      if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_LIMIT) throw new AsaasHttpError('INVALID_LIMIT')
      const body = await get(`/${resource}?offset=${offset}&limit=${limit}`) as Record<string, unknown>
      if (body.object !== 'list' || !Array.isArray(body.data) || typeof body.hasMore !== 'boolean') throw new AsaasHttpError('ASAAS_INVALID_RESPONSE')
      const int = (v: unknown) => (Number.isInteger(v) ? v as number : null)
      return { object: 'list', hasMore: body.hasMore, totalCount: int(body.totalCount), limit: int(body.limit), offset: int(body.offset), data: body.data }
    },
  }
  return Object.freeze(gateway)
}
