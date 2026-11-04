/**
 * Modo de HOMOLOGAÇÃO ISOLADA do /agendar — somente o Preview da branch `crm-homolog`.
 *
 * Porta única e explícita: o modo só fica ATIVO quando TODAS as condições abaixo são verdadeiras. Qualquer
 * informação ausente, diferente ou ambígua deixa o modo inativo (falha fechada):
 *
 *  1. CRM_HOMOLOG_MODE === 'true' (valor exato);
 *  2. VERCEL === '1' e VERCEL_ENV === 'preview' (nunca Production, nunca local);
 *  3. VERCEL_GIT_COMMIT_REF === 'crm-homolog' (branch exata);
 *  4. CRM_HOMOLOG_DATABASE_URL definida e DIFERENTE do banco do CRM (CRM_DATABASE_URL): host + banco distintos;
 *  5. ao menos uma origem confirmada pela própria Vercel (VERCEL_BRANCH_URL ou VERCEL_URL, hospedagem *.vercel.app).
 *     Nenhuma URL é presumida nem escrita no código;
 *  6. nenhuma integração real ligada (Google, Push, Meta Pixel/CAPI/homologação/Chronos).
 *
 * Quando ativo: o banco é SOMENTE CRM_HOMOLOG_DATABASE_URL, o Google real não é usado (agenda simulada, sem convite),
 * as origens aceitas são SOMENTE as confirmadas pela Vercel e as chaves oficiais de teste do Turnstile passam a ser
 * aceitas (e as chaves reais, recusadas). Quando a branch é `crm-homolog` mas o modo NÃO está ativo, o CRM inteiro
 * responde 404 (lib/crm/runtime-env.ts): a branch nunca cai no comportamento normal de Preview com o banco do CRM.
 *
 * Este módulo não importa nenhum outro módulo do CRM (evita dependência circular) e nunca devolve valores de
 * variáveis — apenas códigos de motivo e nomes de variáveis.
 */
export const HOMOLOG_BRANCH = 'crm-homolog'

type Env = Record<string, string | undefined>

export type HomologReason =
  | 'not_requested'
  | 'not_vercel_preview'
  | 'wrong_branch'
  | 'database_missing'
  | 'database_shared'
  | 'origin_unconfirmed'
  | 'real_integration_enabled'

export type HomologState =
  | { active: true; origins: readonly string[]; hostnames: readonly string[] }
  | { active: false; reason: HomologReason; blockedBy?: readonly string[] }

/** Leitura explícita (referências estáticas, como em runtime-env.ts): funciona em qualquer runtime do Next.js. */
export function homologEnvFromProcess(): Env {
  return {
    VERCEL: process.env.VERCEL,
    VERCEL_ENV: process.env.VERCEL_ENV,
    VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
    VERCEL_BRANCH_URL: process.env.VERCEL_BRANCH_URL,
    VERCEL_URL: process.env.VERCEL_URL,
    CRM_HOMOLOG_MODE: process.env.CRM_HOMOLOG_MODE,
    CRM_HOMOLOG_DATABASE_URL: process.env.CRM_HOMOLOG_DATABASE_URL,
    CRM_DATABASE_URL: process.env.CRM_DATABASE_URL,
    CRM_GOOGLE_BOOKINGS_ENABLED: process.env.CRM_GOOGLE_BOOKINGS_ENABLED,
    PWA_PUSH_ENABLED: process.env.PWA_PUSH_ENABLED,
    META_PIXEL_ENABLED: process.env.META_PIXEL_ENABLED,
    META_CAPI_MODE: process.env.META_CAPI_MODE,
    META_HOMOLOGATION_ENABLED: process.env.META_HOMOLOGATION_ENABLED,
    META_CHRONOS_LIVE_ENABLED: process.env.META_CHRONOS_LIVE_ENABLED,
  }
}

/** Hospedagem *.vercel.app sem esquema, porta, caminho ou credenciais. */
const VERCEL_HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.vercel\.app$/

function confirmedHost(value: string | undefined): string | null {
  const host = value?.trim().toLowerCase() ?? ''
  return host.length <= 253 && VERCEL_HOST.test(host) ? host : null
}

/** host + banco, sem usuário, senha ou parâmetros: compara DESTINOS, não textos. */
function databaseTarget(raw: string | undefined): string | null {
  const value = raw?.trim()
  if (!value) return null
  try {
    const url = new URL(value)
    return url.hostname.toLowerCase() + url.pathname
  } catch {
    return null
  }
}

/** Nomes (nunca valores) das integrações reais que estão ligadas por variável. */
export function realIntegrationsEnabled(env: Env): string[] {
  const on: string[] = []
  if (env.CRM_GOOGLE_BOOKINGS_ENABLED === 'true') on.push('CRM_GOOGLE_BOOKINGS_ENABLED')
  if (env.PWA_PUSH_ENABLED === 'true') on.push('PWA_PUSH_ENABLED')
  if (env.META_PIXEL_ENABLED?.trim() === 'true') on.push('META_PIXEL_ENABLED')
  if (env.META_HOMOLOGATION_ENABLED === 'true') on.push('META_HOMOLOGATION_ENABLED')
  if (env.META_CHRONOS_LIVE_ENABLED?.trim() === 'true') on.push('META_CHRONOS_LIVE_ENABLED')
  const capi = env.META_CAPI_MODE?.trim().toLowerCase()
  if (capi && capi !== 'off') on.push('META_CAPI_MODE')
  return on
}

export function homologMode(env: Env = homologEnvFromProcess()): HomologState {
  if (env.CRM_HOMOLOG_MODE !== 'true') return { active: false, reason: 'not_requested' }
  if (env.VERCEL !== '1' || env.VERCEL_ENV !== 'preview') return { active: false, reason: 'not_vercel_preview' }
  if (env.VERCEL_GIT_COMMIT_REF !== HOMOLOG_BRANCH) return { active: false, reason: 'wrong_branch' }

  const homologDb = databaseTarget(env.CRM_HOMOLOG_DATABASE_URL)
  if (!homologDb) return { active: false, reason: 'database_missing' }
  if (homologDb === databaseTarget(env.CRM_DATABASE_URL)) return { active: false, reason: 'database_shared' }

  const hostnames = [...new Set([confirmedHost(env.VERCEL_BRANCH_URL), confirmedHost(env.VERCEL_URL)]
    .filter((host): host is string => host !== null))]
  if (!hostnames.length) return { active: false, reason: 'origin_unconfirmed' }

  const blockedBy = realIntegrationsEnabled(env)
  if (blockedBy.length) return { active: false, reason: 'real_integration_enabled', blockedBy }

  return { active: true, hostnames, origins: hostnames.map(host => 'https://' + host) }
}

export function isHomologActive(env: Env = homologEnvFromProcess()): boolean {
  return homologMode(env).active
}

/** Banco do CRM: em homologação, SOMENTE o banco de homologação; nunca CRM_DATABASE_URL. */
export function crmDatabaseUrl(env: Env = homologEnvFromProcess()): string | undefined {
  return isHomologActive(env) ? env.CRM_HOMOLOG_DATABASE_URL : env.CRM_DATABASE_URL
}
