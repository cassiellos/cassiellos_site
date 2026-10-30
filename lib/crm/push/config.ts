import { validVapidKeys, type VapidKeys } from './web-push'

/**
 * Configuração do Web Push administrativo (Etapa 5) — somente no servidor.
 *
 * - PWA_PUSH_ENABLED: chave geral dos avisos AUTOMÁTICOS (novo lead, reunião). Diferente de "true" = DESLIGADA:
 *   nenhuma consulta extra ao banco no cadastro nem na confirmação.
 * - VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY: par P-256 em base64url. A pública vai ao navegador para a inscrição;
 *   a privada nunca sai do servidor (variável Sensitive na Vercel).
 * - VAPID_SUBJECT: contato do servidor para os serviços de push (padrão: o endereço do CRM).
 * - Somente Preview (VERCEL_ENV=preview), como todo o Mini CRM nesta etapa.
 */

export type PushEnvIssue = 'NOT_PREVIEW' | 'SWITCH_OFF' | 'VAPID_MISSING' | 'VAPID_INVALID' | 'SUBJECT_INVALID'

export type PushEnvStatus = {
  /** PWA_PUSH_ENABLED === 'true' */
  switchOn: boolean
  /** VAPID válido no Preview: inscrever aparelhos e enviar o teste. */
  vapidReady: boolean
  /** vapidReady + chave geral ligada: avisos automáticos de leads e reuniões. */
  ready: boolean
  /** Chave pública (pode ir ao navegador) — null sem VAPID válido. */
  publicKey: string | null
  issues: PushEnvIssue[]
}

type Env = Record<string, string | undefined>
export const DEFAULT_VAPID_SUBJECT = 'https://crm.cassiellos.com.br'

export function readPushEnv(env: Env = process.env): PushEnvStatus & { vapid: { keys: VapidKeys; subject: string } | null } {
  const issues: PushEnvIssue[] = []
  const switchOn = env.PWA_PUSH_ENABLED === 'true'
  const keys = { publicKey: env.VAPID_PUBLIC_KEY?.trim() || '', privateKey: env.VAPID_PRIVATE_KEY?.trim() || '' }
  const subject = env.VAPID_SUBJECT?.trim() || DEFAULT_VAPID_SUBJECT
  if (env.VERCEL_ENV !== 'preview') issues.push('NOT_PREVIEW')
  if (!switchOn) issues.push('SWITCH_OFF')
  if (!keys.publicKey || !keys.privateKey) issues.push('VAPID_MISSING')
  else if (!validVapidKeys(keys)) issues.push('VAPID_INVALID')
  if (!/^(mailto:[^\s@]+@[^\s@]+\.[^\s@]+|https:\/\/[a-z0-9.-]+(\/\S*)?)$/i.test(subject)) issues.push('SUBJECT_INVALID')
  const vapidReady = !issues.some(i => i !== 'SWITCH_OFF')
  return {
    switchOn,
    vapidReady,
    ready: vapidReady && switchOn,
    publicKey: vapidReady ? keys.publicKey : null,
    issues,
    vapid: vapidReady ? { keys: keys as VapidKeys, subject } : null,
  }
}

/** Mesmo estado sem a chave privada (seguro para o painel). */
export function publicPushEnv(env: Env = process.env): PushEnvStatus {
  const { vapid: _hidden, ...status } = readPushEnv(env)
  return status
}
