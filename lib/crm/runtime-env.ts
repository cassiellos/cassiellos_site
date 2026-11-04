/**
 * Política explícita de ambientes do Mini CRM (Next.js na Vercel).
 *
 * O mesmo código é publicado em DOIS projetos Vercel:
 * - `agencia-cassiellos`: site institucional (Production = branch main, sem o CRM) e o CRM no Preview da
 *   branch feature/mini-crm-shark-scale (comportamento original, mantido).
 * - `cassiellos-crm`: o CRM em Production.
 *
 * Por isso VERCEL_ENV=production sozinho NÃO liga o CRM: a produção do site institucional também é
 * "production". O CRM em Production exige a confirmação explícita CRM_PRODUCTION_ENABLED=true, definida
 * somente no projeto cassiellos-crm (ambiente Production). Qualquer outro caso — development, variável
 * ausente, valor inesperado — devolve null e as rotas do CRM continuam respondendo 404, como antes.
 */
import { HOMOLOG_BRANCH, homologEnvFromProcess, homologMode } from './homolog-mode'

export type CrmRuntime = 'preview' | 'production'

type Env = Record<string, string | undefined>

/** Leitura explícita das duas chaves (funciona em qualquer runtime do Next.js). */
function defaultEnv(): Env {
  return { ...homologEnvFromProcess(), VERCEL_ENV: process.env.VERCEL_ENV, CRM_PRODUCTION_ENABLED: process.env.CRM_PRODUCTION_ENABLED }
}

export function crmRuntime(env: Env = defaultEnv()): CrmRuntime | null {
  // Branch de homologação isolada (lib/crm/homolog-mode.ts): só liga com TODAS as condições do modo; do contrário o CRM
  // inteiro responde 404 — a branch nunca cai no Preview normal (que usaria o banco do CRM) nem em Production.
  if (env.VERCEL_GIT_COMMIT_REF === HOMOLOG_BRANCH) return homologMode(env).active ? 'preview' : null
  // Comparações exatas, como as demais chaves do CRM (ex.: PWA_PUSH_ENABLED === 'true').
  if (env.VERCEL_ENV === 'preview') return 'preview'
  if (env.VERCEL_ENV === 'production' && env.CRM_PRODUCTION_ENABLED === 'true') return 'production'
  return null
}

/** O CRM está autorizado neste deploy (Preview da branch do CRM ou Production do cassiellos-crm). */
export function isCrmRuntimeEnabled(env: Env = defaultEnv()): boolean {
  return crmRuntime(env) !== null
}

/**
 * Módulos sem dependência de framework (finanças, push, ações administrativas) recebem os valores brutos
 * do ambiente na própria requisição e aplicam a MESMA política: `vercelEnv` (VERCEL_ENV) e
 * `crmProductionEnabled` (CRM_PRODUCTION_ENABLED). VERCEL_ENV=production sem a confirmação continua 404.
 */
export type CrmRuntimeRequestEnv = {
  vercelEnv: string | undefined; crmProductionEnabled?: string | undefined
  /** Chaves do modo de homologação (lib/crm/homolog-mode.ts), repassadas junto com o ambiente da requisição. */
  homologEnv?: Env
}

export function crmRuntimeRequestEnv(): CrmRuntimeRequestEnv {
  return { vercelEnv: process.env.VERCEL_ENV, crmProductionEnabled: process.env.CRM_PRODUCTION_ENABLED, homologEnv: homologEnvFromProcess() }
}

export function isCrmRuntimeRequest(req: CrmRuntimeRequestEnv): boolean {
  return crmRuntime({ ...req.homologEnv, VERCEL_ENV: req.vercelEnv, CRM_PRODUCTION_ENABLED: req.crmProductionEnabled }) !== null
}

/** Rótulo gravado nos metadados de leads/eventos. Fora da Vercel mantém o rótulo histórico 'preview'. */
export function crmEnvironmentLabel(env: Env = defaultEnv()): CrmRuntime {
  return crmRuntime(env) ?? 'preview'
}
