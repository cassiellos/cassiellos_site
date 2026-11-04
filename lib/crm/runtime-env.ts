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
export type CrmRuntime = 'preview' | 'production'

type Env = Record<string, string | undefined>

/** Leitura explícita das duas chaves (funciona em qualquer runtime do Next.js). */
function defaultEnv(): Env {
  return { VERCEL_ENV: process.env.VERCEL_ENV, CRM_PRODUCTION_ENABLED: process.env.CRM_PRODUCTION_ENABLED }
}

export function crmRuntime(env: Env = defaultEnv()): CrmRuntime | null {
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
export type CrmRuntimeRequestEnv = { vercelEnv: string | undefined; crmProductionEnabled?: string | undefined }

export function crmRuntimeRequestEnv(): CrmRuntimeRequestEnv {
  return { vercelEnv: process.env.VERCEL_ENV, crmProductionEnabled: process.env.CRM_PRODUCTION_ENABLED }
}

export function isCrmRuntimeRequest(req: CrmRuntimeRequestEnv): boolean {
  return crmRuntime({ VERCEL_ENV: req.vercelEnv, CRM_PRODUCTION_ENABLED: req.crmProductionEnabled }) !== null
}

/** Rótulo gravado nos metadados de leads/eventos. Fora da Vercel mantém o rótulo histórico 'preview'. */
export function crmEnvironmentLabel(env: Env = defaultEnv()): CrmRuntime {
  return crmRuntime(env) ?? 'preview'
}
