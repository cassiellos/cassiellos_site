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

export class AsaasHttpError extends Error {
  constructor(readonly code: string, readonly status: number | null = null, readonly asaasCodes: readonly string[] = []) {
    super(code)
    this.name = 'AsaasHttpError'
  }
}

/** Resposta mínima que o transporte injetado precisa devolver (compatível com a Response do fetch). */
export type AsaasTransportResponse = { status: number; text(): Promise<string> }
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
}

export type AsaasSandboxGateway = AsaasReadGateway & {
  readonly baseUrl: string
  readonly enabled: boolean
  getCustomer(customerId: string): Promise<unknown>
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

  async function get(path: string): Promise<unknown> {
    if (!enabled || !transport || !apiKey) throw new AsaasHttpError('ASAAS_HTTP_DISABLED')
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
    if (res.status < 200 || res.status > 299) throw new AsaasHttpError(statusCode(res.status), res.status, safeAsaasCodes(body))
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
  }
  return Object.freeze(gateway)
}
