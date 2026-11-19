/**
 * Mascaramento do destinatário para o histórico administrativo (LGPD: minimização).
 * O endereço real nunca é copiado para crm.comms_messages — ele é lido de crm.leads
 * no momento do envio. O que fica gravado serve só para o administrador reconhecer a linha.
 */

/** `joao.silva@gmail.com` → `jo***@gmail.com`. Domínio preservado: ajuda a diagnosticar entrega. */
export function maskEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const at = value.lastIndexOf('@')
  if (at < 1 || at === value.length - 1) return null
  const user = value.slice(0, at)
  const domain = value.slice(at + 1)
  if (!domain.includes('.')) return null
  const head = user.slice(0, user.length <= 2 ? 1 : 2)
  return (head + '***@' + domain).slice(0, 120)
}

/** `5531991234567` → `+55 (31) 9****-**67`. Mantém DDD e os dois últimos dígitos. */
export function maskPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const digits = value.replace(/\D/g, '')
  if (digits.length < 10) return null
  const national = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits
  if (national.length !== 10 && national.length !== 11) return null
  const ddd = national.slice(0, 2)
  const subscriber = national.slice(2)
  const first = subscriber[0]
  const last = subscriber.slice(-2)
  const hidden = '*'.repeat(Math.max(0, subscriber.length - 3))
  const body = first + hidden
  const split = subscriber.length === 9 ? 5 : 4
  return '+55 (' + ddd + ') ' + body.slice(0, split) + '-' + body.slice(split) + last
}
