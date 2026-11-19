/**
 * Homologação do webhook WhatsApp com o número de TESTE da Meta — somente a branch `crm-homolog`.
 *
 * Quando o domínio da branch fica público (Deployment Protection Exception), este portão garante que
 * a ÚNICA coisa alcançável é a rota oficial do webhook. Tudo o mais (/agendar, /formularios, /crm,
 * demais APIs, páginas do site) responde 404.
 *
 * Liga somente com as TRÊS condições exatas (falha fechada para o lado de NÃO interferir):
 *   1. CRM_HOMOLOG_WEBHOOK_ONLY === 'true' (variável só no Preview da branch crm-homolog);
 *   2. VERCEL_ENV === 'preview';
 *   3. VERCEL_GIT_COMMIT_REF === 'crm-homolog'.
 * Em Production, em outras branches ou sem a variável, o portão não faz nada.
 */
export const HOMOLOG_WEBHOOK_PATH = '/api/crm/comms/whatsapp-webhook'

type Env = Record<string, string | undefined>

export function homologWebhookOnly(env: Env): boolean {
  return env.CRM_HOMOLOG_WEBHOOK_ONLY === 'true'
    && env.VERCEL_ENV === 'preview'
    && env.VERCEL_GIT_COMMIT_REF === 'crm-homolog'
}

/** true = a requisição pode seguir; false = responder 404. */
export function homologPathAllowed(env: Env, pathname: string): boolean {
  if (!homologWebhookOnly(env)) return true
  return pathname === HOMOLOG_WEBHOOK_PATH
}
