import { createAsaasSandboxGateway, type AsaasHttpError, type AsaasRequestInfo, type AsaasTransport, type ListableResource } from './http'
import { CUSTOMER_ID, PAYMENT_ID, SUBSCRIPTION_ID } from './types'

/**
 * Integração Asaas — FASE 2.2B: consulta mínima SOMENTE LEITURA ao Sandbox, com relatório SANITIZADO.
 *
 * Sequência fixa (nenhuma outra chamada é possível por aqui): autenticação → clientes → cobranças → assinaturas,
 * todas GET de listagem com limite pequeno. Para no primeiro 401/403 (não insiste com chave inválida) e no
 * primeiro 429 (não provoca limitação da conta). Não força erros.
 *
 * O relatório contém só: teste, endpoint (sem query), status, duração, contagens, NOMES de campos e conferência de
 * formato dos ids — nunca valores dos registros, cabeçalhos, a chave ou corpos de resposta.
 */

export type ProbeStep = {
  test: string
  endpoint: string
  ok: boolean
  status: number | null
  ms: number | null
  code: string | null
  summary: {
    totalCount: number | null; hasMore: boolean | null; returned: number | null; limitEcho: number | null; offsetEcho: number | null
    itemFields: string[]; idsMatchFormat: boolean | null
  } | null
}
export type ProbeReport = { environment: 'sandbox'; baseUrl: string; steps: ProbeStep[]; stoppedEarly: string | null; contractNotes: string[] }

const STEPS: { test: string; resource: ListableResource; limit: number }[] = [
  { test: '1-autenticacao', resource: 'customers', limit: 1 },
  { test: '2-clientes', resource: 'customers', limit: 10 },
  { test: '3-cobrancas', resource: 'payments', limit: 10 },
  { test: '4-assinaturas', resource: 'subscriptions', limit: 10 },
]
const ID: Record<ListableResource, RegExp> = { customers: CUSTOMER_ID, payments: PAYMENT_ID, subscriptions: SUBSCRIPTION_ID }

export async function runSandboxReadProbe(input: { apiKey: string; transport: AsaasTransport; sleep?: (ms: number) => Promise<void> }): Promise<ProbeReport> {
  const infos: AsaasRequestInfo[] = []
  const gateway = createAsaasSandboxGateway({
    environment: 'sandbox', enabled: true, apiKey: input.apiKey, transport: input.transport, sleep: input.sleep,
    maxRetries: 1, maxRequests: 12, minIntervalMs: 500, onRequest: i => infos.push(i),
  })
  const report: ProbeReport = { environment: 'sandbox', baseUrl: gateway.baseUrl, steps: [], stoppedEarly: null, contractNotes: [] }
  for (const s of STEPS) {
    const before = infos.length
    const step: ProbeStep = { test: s.test, endpoint: 'GET /v3/' + s.resource, ok: false, status: null, ms: null, code: null, summary: null }
    try {
      const page = await gateway.listPage(s.resource, 0, s.limit)
      const items = page.data.filter((d): d is Record<string, unknown> => !!d && typeof d === 'object' && !Array.isArray(d))
      step.ok = true
      step.summary = {
        totalCount: page.totalCount, hasMore: page.hasMore, returned: page.data.length, limitEcho: page.limit, offsetEcho: page.offset,
        itemFields: [...new Set(items.flatMap(i => Object.keys(i)))].filter(k => /^[A-Za-z][A-Za-z0-9_]{0,60}$/.test(k)).sort(),
        idsMatchFormat: items.length ? items.every(i => typeof i.id === 'string' && ID[s.resource].test(i.id)) : null,
      }
      if (page.limit !== null && page.limit !== s.limit) report.contractNotes.push(s.test + ': limit devolvido difere do pedido')
      if (page.offset !== null && page.offset !== 0) report.contractNotes.push(s.test + ': offset devolvido difere do pedido')
      if (page.totalCount === null) report.contractNotes.push(s.test + ': totalCount ausente')
    } catch (e) {
      step.code = (e as AsaasHttpError).code ?? 'UNEXPECTED_ERROR'
      step.status = (e as AsaasHttpError).status ?? null
    }
    const last = infos.slice(before).pop()
    if (last) { step.status = last.status; step.ms = last.ms }
    report.steps.push(step)
    if (!step.ok && (step.status === 401 || step.status === 403)) { report.stoppedEarly = 'AUTENTICACAO_RECUSADA'; break }
    if (!step.ok && step.status === 429) { report.stoppedEarly = 'LIMITE_DE_REQUISICOES'; break }
    if (!step.ok && s.test === '1-autenticacao') { report.stoppedEarly = 'FALHA_NA_AUTENTICACAO'; break }
  }
  return report
}
