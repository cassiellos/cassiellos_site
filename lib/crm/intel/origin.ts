/**
 * Origem aceita para AÇÕES (POST) da Central de Inteligência.
 *
 * Regra geral do CRM (lib/crm/preview-origins.ts): lista exata por ambiente. Num Preview de branch EXCLUSIVA da Central
 * (ex.: feat/mi-foundation-mock), a URL do próprio deploy não está nessa lista — o botão de atualização simulada
 * receberia 403. Para a Central (e só para ela), em VERCEL_ENV=preview aceita-se TAMBÉM a origem do PRÓPRIO deploy,
 * informada pela Vercel (VERCEL_BRANCH_URL / VERCEL_URL — nunca presumida nem vinda da requisição).
 * Em Production nada muda: somente as origens do CRM. Fora da Vercel: só a lista do CRM.
 */
import { isCrmPreviewOrigin } from '../preview-origins'

export type IntelOriginEnv = { vercelEnv?: string; branchUrl?: string; deploymentUrl?: string }

const HOST_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.vercel\.app$/

export function isIntelOriginAllowed(origin: string | null | undefined, env: IntelOriginEnv, crmCheck: (o: string | null | undefined) => boolean = isCrmPreviewOrigin): boolean {
  if (crmCheck(origin)) return true
  if (typeof origin !== 'string' || env.vercelEnv !== 'preview') return false
  const own = [env.branchUrl, env.deploymentUrl].filter((h): h is string => typeof h === 'string' && HOST_RE.test(h)).map(h => 'https://' + h)
  return own.includes(origin)
}
