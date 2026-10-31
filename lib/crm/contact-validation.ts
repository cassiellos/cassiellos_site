import { parseBrazilianWhatsapp } from './whatsapp'

/**
 * Validação de contato do formulário de diagnóstico (/agendar) — MESMAS regras no navegador e no servidor.
 *
 * Telefone (campo WhatsApp, formulário nacional):
 * - Regra base de lib/crm/whatsapp.ts (Etapa 5): DDD da Anatel; celular com 9 dígitos começando por 9;
 *   fixo com 8 dígitos começando por 2–5 (pode ter WhatsApp Business); +55 opcional.
 * - Além disso, recusa sequências artificiais (todos os dígitos iguais, inclusive depois do 9 inicial).
 * - Persistido como DDD + número, só dígitos (10 ou 11), o mesmo formato que o CRM já grava e o link
 *   do WhatsApp entende.
 *
 * E-mail: só o FORMATO (sem consulta externa, sem bloqueio de provedor). Formato válido não significa que a
 * caixa postal existe.
 */

export const PHONE_MESSAGES = {
  required: 'Informe seu celular com DDD.',
  invalid: 'Confira o número informado.',
} as const
export const EMAIL_MESSAGE = 'Confira o endereço de e-mail informado.'

/** Mesmo limite que o servidor já aplicava ao e-mail (coluna e contrato atuais). */
export const EMAIL_MAX_LENGTH = 180
const LOCAL_MAX_LENGTH = 64
const DOMAIN_LABEL_MAX_LENGTH = 63

export type PhoneResult =
  | { ok: true; digits: string; display: string }
  | { ok: false; code: 'PHONE_REQUIRED' | 'PHONE_INCOMPLETE' | 'PHONE_INVALID'; message: string }

/** Dígitos nacionais (DDD + número) de uma entrada qualquer: remove pontuação e o +55 quando presente. */
export function nationalPhoneDigits(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const digits = raw.replace(/\D/g, '')
  const international = raw.trim().startsWith('+') || digits.length > 11
  return international && digits.startsWith('55') ? digits.slice(2) : digits
}

export function validateBrazilianPhone(raw: unknown): PhoneResult {
  if (typeof raw !== 'string' || raw.length > 40) {
    return { ok: false, code: 'PHONE_INVALID', message: PHONE_MESSAGES.invalid }
  }
  const digits = nationalPhoneDigits(raw)
  if (!digits) return { ok: false, code: 'PHONE_REQUIRED', message: PHONE_MESSAGES.required }
  if (digits.length < 10) return { ok: false, code: 'PHONE_INCOMPLETE', message: PHONE_MESSAGES.required }
  const parsed = digits.length <= 11 ? parseBrazilianWhatsapp(digits) : null
  // Sequência artificial depois do 9 do celular (ex.: 9 0000-0000); a regra base já recusa todos iguais.
  if (!parsed || (digits.length === 11 && /^9(\d)\1{7}$/.test(digits.slice(2)))) {
    return { ok: false, code: 'PHONE_INVALID', message: PHONE_MESSAGES.invalid }
  }
  return { ok: true, digits, display: formatPhoneInput(digits) }
}

/** Máscara progressiva: (31) 99999-9999 para celular, (31) 3333-4444 para fixo. Nunca mais de 11 dígitos. */
export function formatPhoneInput(raw: string): string {
  const d = nationalPhoneDigits(raw).slice(0, 11)
  if (!d) return ''
  if (d.length <= 2) return '(' + d
  const ddd = '(' + d.slice(0, 2) + ') '
  const rest = d.slice(2)
  if (rest.length <= 4) return ddd + rest
  const split = rest.length === 9 ? 5 : 4
  return ddd + rest.slice(0, split) + '-' + rest.slice(split)
}

/**
 * Próximo valor do campo mascarado. Se o usuário apagou só um caractere de formatação ("-", ")" ou espaço),
 * o dígito anterior também sai — senão a máscara devolveria o mesmo texto e o campo pareceria travado.
 */
export function nextPhoneInput(previous: string, typed: string): string {
  const before = nationalPhoneDigits(previous)
  let digits = nationalPhoneDigits(typed)
  if (typed.length < previous.length && digits === before && digits.length > 0) digits = digits.slice(0, -1)
  return formatPhoneInput(digits)
}

export type EmailResult = { ok: true; email: string } | { ok: false; code: 'EMAIL_REQUIRED' | 'EMAIL_INVALID'; message: string }

const LOCAL_PART = /^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/
const DOMAIN_LABEL = /^(?!-)[a-z0-9-]+(?<!-)$/
const TLD = /^(?:[a-z]{2,}|xn--[a-z0-9-]{2,})$/

/** Normaliza (espaços externos, minúsculas) e confere só a estrutura do endereço. */
export function validateEmailAddress(raw: unknown): EmailResult {
  if (typeof raw !== 'string') return { ok: false, code: 'EMAIL_INVALID', message: EMAIL_MESSAGE }
  const email = raw.trim().toLowerCase()
  if (!email) return { ok: false, code: 'EMAIL_REQUIRED', message: EMAIL_MESSAGE }
  const invalid = { ok: false as const, code: 'EMAIL_INVALID' as const, message: EMAIL_MESSAGE }
  if (email.length > EMAIL_MAX_LENGTH || /\s/.test(email)) return invalid
  const at = email.indexOf('@')
  if (at < 1 || at !== email.lastIndexOf('@')) return invalid
  const local = email.slice(0, at)
  const domain = email.slice(at + 1)
  if (local.length > LOCAL_MAX_LENGTH || !LOCAL_PART.test(local)) return invalid
  const labels = domain.split('.')
  if (labels.length < 2) return invalid
  if (labels.some(label => !label || label.length > DOMAIN_LABEL_MAX_LENGTH || !DOMAIN_LABEL.test(label))) return invalid
  if (!TLD.test(labels[labels.length - 1])) return invalid
  return { ok: true, email }
}
