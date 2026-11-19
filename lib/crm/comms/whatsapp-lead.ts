import { whatsappLink, type BrazilianPhone } from '../whatsapp'
import { isPublicReference } from './reference'

/**
 * Modo A — o LEAD abre a conversa com a Cassiellos.
 *
 * Sentido oposto ao de lib/crm/whatsapp-message.ts, que é o administrador abrindo conversa COM o lead.
 * Aqui o destino é sempre o número comercial da Cassiellos e o texto é fixo: nada do lead
 * (nome, e-mail, telefone, link do Meet, id interno) entra na URL — só a referência pública opaca,
 * que o WhatsApp mostra na tela antes do envio.
 *
 * Clicar NÃO envia nada: o próprio lead decide enviar. Por isso o clique nunca pode marcar a
 * confirmação por WhatsApp como feita (ver STATUS_AWAITING_LEAD).
 */

export const LEAD_MESSAGE_PREFIX =
  'Olá! Acabei de agendar meu diagnóstico estratégico com a Cassiellos e gostaria de receber a confirmação da reunião por aqui. Referência: '

/** Enquanto o Modo B não estiver ativo e o webhook não confirmar, é só isto que sabemos. */
export const STATUS_AWAITING_LEAD = 'awaiting_lead' as const

export function leadWhatsappMessage(reference: string): string | null {
  return isPublicReference(reference) ? LEAD_MESSAGE_PREFIX + reference + '.' : null
}

/** Extrai a referência de uma mensagem recebida (Modo B). Tolerante a maiúsculas e pontuação ao redor. */
export function referenceFromIncomingMessage(body: unknown): string | null {
  if (typeof body !== 'string' || body.length > 4_000) return null
  const match = body.toLowerCase().match(/refer[êe]ncia:?\s*([a-hjkmnp-z2-9]{10})\b/)
  return match && isPublicReference(match[1]) ? match[1] : null
}

export type LeadWhatsappLink =
  | { ok: true; url: string; reference: string }
  | { ok: false; reason: 'BUSINESS_NUMBER_UNAVAILABLE' | 'INVALID_REFERENCE' | 'LINK_TOO_LONG' }

export function buildLeadWhatsappLink(
  businessPhone: BrazilianPhone | null, reference: string,
): LeadWhatsappLink {
  if (!businessPhone) return { ok: false, reason: 'BUSINESS_NUMBER_UNAVAILABLE' }
  const text = leadWhatsappMessage(reference)
  if (!text) return { ok: false, reason: 'INVALID_REFERENCE' }
  const url = whatsappLink(businessPhone, text)
  return url ? { ok: true, url, reference } : { ok: false, reason: 'LINK_TOO_LONG' }
}
