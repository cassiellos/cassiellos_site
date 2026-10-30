/**
 * Links do WhatsApp do CRM (envio SEMPRE manual pelo administrador:
 * o link apenas abre a conversa no aparelho dele, com o texto preenchido quando for o caso).
 * Nenhuma API do WhatsApp é usada.
 *
 * Validação de números do Brasil (o formulário é nacional):
 * - aceita 10/11 dígitos (DDD + número) ou 12/13 com o código do país 55;
 * - DDD precisa existir no plano de numeração da Anatel;
 * - 11 dígitos = celular (começa com 9); 10 dígitos = fixo (2 a 5), que pode ter WhatsApp Business.
 * Número inválido = nenhum botão de WhatsApp (a mensagem avisa o administrador).
 */

const VALID_DDDS = new Set([
  11, 12, 13, 14, 15, 16, 17, 18, 19,
  21, 22, 24, 27, 28,
  31, 32, 33, 34, 35, 37, 38,
  41, 42, 43, 44, 45, 46, 47, 48, 49,
  51, 53, 54, 55,
  61, 62, 63, 64, 65, 66, 67, 68, 69,
  71, 73, 74, 75, 77, 79,
  81, 82, 83, 84, 85, 86, 87, 88, 89,
  91, 92, 93, 94, 95, 96, 97, 98, 99,
])

export type BrazilianPhone = { e164Digits: string; display: string }

/** Normaliza para 55 + DDD + número; null quando o número não é um telefone brasileiro válido. */
export function parseBrazilianWhatsapp(value: unknown): BrazilianPhone | null {
  if (typeof value !== 'string') return null
  let digits = value.replace(/\D/g, '')
  if (digits.length > 13 || digits.length < 10) return null
  if (digits.length >= 12) {
    if (!digits.startsWith('55')) return null
    digits = digits.slice(2)
  }
  if (digits.length !== 10 && digits.length !== 11) return null
  const ddd = Number(digits.slice(0, 2))
  if (!VALID_DDDS.has(ddd)) return null
  const subscriber = digits.slice(2)
  if (subscriber.length === 9 && subscriber[0] !== '9') return null
  if (subscriber.length === 8 && !/^[2-5]/.test(subscriber)) return null
  if (/^(\d)\1+$/.test(subscriber)) return null
  const split = subscriber.length === 9 ? 5 : 4
  return {
    e164Digits: '55' + digits,
    display: '+55 (' + digits.slice(0, 2) + ') ' + subscriber.slice(0, split) + '-' + subscriber.slice(split),
  }
}

/** Maior URL de link aceita (margem conservadora para navegadores e para o WhatsApp). */
export const MAX_BUTTON_URL_LENGTH = 2000

/**
 * https://wa.me/<número>[?text=<texto codificado>]. Sem número (testes com dados fictícios)
 * vira https://wa.me/?text=…, que só abre o seletor de conversas do próprio administrador.
 */
export function whatsappLink(phone: BrazilianPhone | null, text?: string): string | null {
  const base = 'https://wa.me/' + (phone ? phone.e164Digits : '')
  const url = text ? base + '?text=' + encodeURIComponent(text) : base
  if (!phone && !text) return null
  return url.length <= MAX_BUTTON_URL_LENGTH ? url : null
}
