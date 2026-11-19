import { crmRuntime } from '../runtime-env'
import { parseBrazilianWhatsapp, type BrazilianPhone } from '../whatsapp'

/**
 * Chaves gerais das comunicações transacionais (e-mail pela Resend e WhatsApp). SOMENTE no servidor.
 *
 * Tudo começa DESLIGADO: sem as variáveis abaixo o CRM se comporta exatamente como antes — nenhuma
 * consulta extra ao banco na confirmação, nenhum botão novo, nenhum envio. Ligar cada parte é uma
 * decisão separada; não existe chave única que ligue e-mail e WhatsApp ao mesmo tempo.
 *
 * E-MAIL (Resend)
 * - COMMS_RESEND_ENABLED=true ....... chave geral do canal de e-mail.
 * - RESEND_API_KEY .................. credencial do servidor (variável Sensitive na Vercel).
 * - RESEND_FROM ..................... remetente verificado; padrão DEFAULT_FROM.
 * - COMMS_EMAIL_CONFIRMATION=true ... e-mail de confirmação após a reunião gravada.
 * - COMMS_EMAIL_REMINDERS=true ...... lembretes de 24 h e 1 h.
 * - RESEND_WEBHOOK_SECRET ........... segredo Svix do webhook de status (entregue, devolvido, …).
 * - COMMS_EMAIL_DAILY_CAP / COMMS_EMAIL_MONTHLY_CAP: travas conservadoras do plano Free
 *   (100/dia e 3.000/mês em 18/11/2026). Conferir a página de preços antes de alterar.
 *
 * WHATSAPP
 * - COMMS_WHATSAPP_NUMBER ........... número comercial da Cassiellos (quem RECEBE a mensagem do lead).
 * - COMMS_WHATSAPP_BUTTON=true ...... Modo A: botão wa.me na confirmação. Não usa API nenhuma.
 * - COMMS_WHATSAPP_CLOUD=true ....... Modo B: Cloud API oficial. DESLIGADO por padrão; só depois da
 *   homologação da coexistência e de autorização expressa do titular.
 * - COMMS_WHATSAPP_AUTO_REPLY=true .. resposta automática do Modo B (exige COMMS_WHATSAPP_CLOUD).
 * - WHATSAPP_VERIFY_TOKEN / WHATSAPP_APP_SECRET / WHATSAPP_PHONE_NUMBER_ID / WHATSAPP_ACCESS_TOKEN.
 * - COMMS_WHATSAPP_FREE_TIER ........ trava conservadora de mensagens de serviço por mês.
 *
 * O Modo A nunca depende do Modo B: desligar a Cloud API não tira o botão do ar.
 *
 * PREVIEW: nenhuma automação roda em deploy de Preview a menos que COMMS_PREVIEW_ENABLED=true seja
 * definida NAQUELE ambiente. É uma trava independente das chaves acima: mesmo com a Resend ligada e
 * a credencial presente no projeto, um Preview não envia nada por conta própria. Serve para que um
 * teste controlado seja uma decisão explícita, e não um efeito colateral de abrir uma branch.
 */

type Env = Record<string, string | undefined>

export const DEFAULT_FROM = 'Agência Cassiellos <agendamentos@cassiellos.com.br>'
/** Plano Free da Resend em 18/11/2026: 3.000/mês e 100/dia. Travas conservadoras, não cotas negociadas. */
export const FREE_PLAN_DAILY_CAP = 100
export const FREE_PLAN_MONTHLY_CAP = 3_000
/** Agendamento nativo da Resend: até 30 dias à frente (scheduled_at). Além disso, varredura própria. */
export const RESEND_MAX_SCHEDULE_DAYS = 30
/** Franquia de referência de mensagens de serviço do WhatsApp. NÃO é garantia de ausência de custo. */
export const WHATSAPP_DEFAULT_FREE_TIER = 1_000

const on = (value: string | undefined) => value === 'true'

/**
 * Ambiente autorizado a executar automações de comunicação.
 * Production do cassiellos-crm: sim. Preview: só com a trava explícita. Resto: não.
 */
export function commsEnvAllowed(env: Env): boolean {
  const runtime = crmRuntime(env)
  if (runtime === null) return false
  return runtime === 'production' || on(env.COMMS_PREVIEW_ENABLED)
}

function cap(value: string | undefined, fallback: number): number {
  const parsed = Number(value?.trim())
  return Number.isInteger(parsed) && parsed > 0 && parsed <= fallback ? parsed : fallback
}

/** `Nome <conta@dominio>` ou `conta@dominio`, sem quebras de linha (evita injeção de cabeçalho). */
const FROM = /^(?:[^<>\r\n]{1,60}<[^\s@<>]+@[a-z0-9.-]+\.[a-z]{2,}>|[^\s@<>]+@[a-z0-9.-]+\.[a-z]{2,})$/i

export type EmailConfig = {
  /** Enviar de verdade: ambiente suportado + chave geral + credencial + remetente válido. */
  ready: boolean
  confirmation: boolean
  reminders: boolean
  apiKey: string | null
  from: string
  dailyCap: number
  monthlyCap: number
  webhookSecret: string | null
  issues: EmailIssue[]
}

export type EmailIssue =
  | 'ENV_NOT_SUPPORTED' | 'PREVIEW_NOT_ENABLED' | 'SWITCH_OFF' | 'API_KEY_MISSING'
  | 'FROM_INVALID' | 'WEBHOOK_SECRET_MISSING'

export function readEmailConfig(env: Env = process.env): EmailConfig {
  const issues: EmailIssue[] = []
  const switchOn = on(env.COMMS_RESEND_ENABLED)
  const apiKey = env.RESEND_API_KEY?.trim() || ''
  const from = env.RESEND_FROM?.trim() || DEFAULT_FROM
  const webhookSecret = env.RESEND_WEBHOOK_SECRET?.trim() || ''
  if (!crmRuntime(env)) issues.push('ENV_NOT_SUPPORTED')
  else if (!commsEnvAllowed(env)) issues.push('PREVIEW_NOT_ENABLED')
  if (!switchOn) issues.push('SWITCH_OFF')
  if (!apiKey) issues.push('API_KEY_MISSING')
  if (!FROM.test(from)) issues.push('FROM_INVALID')
  if (!webhookSecret) issues.push('WEBHOOK_SECRET_MISSING')
  // O webhook é opcional para ENVIAR (só refina o status), por isso não entra em `ready`.
  const ready = !issues.some(i => i !== 'WEBHOOK_SECRET_MISSING')
  return {
    ready,
    confirmation: ready && on(env.COMMS_EMAIL_CONFIRMATION),
    reminders: ready && on(env.COMMS_EMAIL_REMINDERS),
    apiKey: ready ? apiKey : null,
    from,
    dailyCap: cap(env.COMMS_EMAIL_DAILY_CAP, FREE_PLAN_DAILY_CAP),
    monthlyCap: cap(env.COMMS_EMAIL_MONTHLY_CAP, FREE_PLAN_MONTHLY_CAP),
    webhookSecret: webhookSecret || null,
    issues,
  }
}

export type WhatsappConfig = {
  /** Modo A: o botão pode ser exibido (número comercial válido + chave do botão + ambiente). */
  buttonReady: boolean
  /** Número comercial da Cassiellos, normalizado; null quando ausente ou inválido. */
  businessPhone: BrazilianPhone | null
  /** Modo B: Cloud API configurada E ligada. Independente do Modo A. */
  cloudReady: boolean
  /** Resposta automática do Modo B (exige cloudReady). */
  autoReply: boolean
  verifyToken: string | null
  appSecret: string | null
  phoneNumberId: string | null
  accessToken: string | null
  freeTier: number
  issues: WhatsappIssue[]
}

export type WhatsappIssue =
  | 'ENV_NOT_SUPPORTED' | 'PREVIEW_NOT_ENABLED' | 'BUTTON_OFF' | 'NUMBER_MISSING' | 'NUMBER_INVALID'
  | 'CLOUD_OFF' | 'CLOUD_CREDENTIALS_MISSING' | 'AUTO_REPLY_OFF'

export function readWhatsappConfig(env: Env = process.env): WhatsappConfig {
  const issues: WhatsappIssue[] = []
  const raw = env.COMMS_WHATSAPP_NUMBER?.trim() || ''
  const businessPhone = raw ? parseBrazilianWhatsapp(raw) : null
  const supported = commsEnvAllowed(env)
  if (!crmRuntime(env)) issues.push('ENV_NOT_SUPPORTED')
  else if (!supported) issues.push('PREVIEW_NOT_ENABLED')
  if (!raw) issues.push('NUMBER_MISSING')
  else if (!businessPhone) issues.push('NUMBER_INVALID')
  if (!on(env.COMMS_WHATSAPP_BUTTON)) issues.push('BUTTON_OFF')

  const verifyToken = env.WHATSAPP_VERIFY_TOKEN?.trim() || ''
  const appSecret = env.WHATSAPP_APP_SECRET?.trim() || ''
  const phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID?.trim() || ''
  const accessToken = env.WHATSAPP_ACCESS_TOKEN?.trim() || ''
  const credentialsOk = Boolean(verifyToken && appSecret && phoneNumberId && accessToken)
  const cloudOn = on(env.COMMS_WHATSAPP_CLOUD)
  if (!cloudOn) issues.push('CLOUD_OFF')
  if (!credentialsOk) issues.push('CLOUD_CREDENTIALS_MISSING')
  if (!on(env.COMMS_WHATSAPP_AUTO_REPLY)) issues.push('AUTO_REPLY_OFF')

  const cloudReady = supported && cloudOn && credentialsOk
  return {
    buttonReady: supported && Boolean(businessPhone) && on(env.COMMS_WHATSAPP_BUTTON),
    businessPhone,
    cloudReady,
    autoReply: cloudReady && on(env.COMMS_WHATSAPP_AUTO_REPLY),
    verifyToken: verifyToken || null,
    appSecret: appSecret || null,
    phoneNumberId: phoneNumberId || null,
    accessToken: accessToken || null,
    freeTier: cap(env.COMMS_WHATSAPP_FREE_TIER, WHATSAPP_DEFAULT_FREE_TIER),
    issues,
  }
}

/** Mesmo estado sem nenhum segredo — seguro para o painel administrativo. */
export function publicCommsStatus(env: Env = process.env) {
  const email = readEmailConfig(env)
  const whatsapp = readWhatsappConfig(env)
  return {
    email: {
      ready: email.ready, confirmation: email.confirmation, reminders: email.reminders,
      from: email.from, dailyCap: email.dailyCap, monthlyCap: email.monthlyCap,
      webhookConfigured: email.webhookSecret !== null, issues: email.issues,
    },
    whatsapp: {
      buttonReady: whatsapp.buttonReady,
      businessPhone: whatsapp.businessPhone?.display ?? null,
      cloudReady: whatsapp.cloudReady, autoReply: whatsapp.autoReply,
      freeTier: whatsapp.freeTier, issues: whatsapp.issues,
    },
  }
}
