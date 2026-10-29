/**
 * Classificação de leads reais x testes do Mini CRM Cassiellos.
 *
 * - CRM_BOOKING_MODE: "live" habilita a classificação como lead real. Qualquer outro
 *   valor (inclusive ausente, vazio ou com erro de digitação) é tratado como "test".
 * - CRM_TEST_EMAILS: e-mails de teste separados por vírgula, ponto e vírgula ou espaço.
 *   O e-mail da allowlist de agendamento (CRM_BOOKING_ALLOWED_EMAIL) é sempre teste.
 * - Domínios reservados para documentação/teste (RFC 2606 / RFC 6761) e os domínios de
 *   exemplo usados na interface também são sempre teste.
 *
 * A classificação vale apenas para leads NOVOS. Um lead existente mantém a sua marca;
 * reuniões e contratos herdam a marca do lead no banco.
 */
export type CrmBookingMode = 'test' | 'live'

/** Domínios inteiros (e seus subdomínios) tratados como teste. */
export const TEST_EMAIL_DOMAINS: readonly string[] = [
  'example.com',
  'example.net',
  'example.org',
  'exemplo.com',
  'exemplo.com.br',
]

/** TLDs reservados que nunca recebem e-mail real. */
export const TEST_EMAIL_TLDS: readonly string[] = ['test', 'example', 'invalid', 'localhost']

export function getCrmBookingMode(raw: string | undefined = process.env.CRM_BOOKING_MODE): CrmBookingMode {
  return raw?.trim().toLowerCase() === 'live' ? 'live' : 'test'
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

/** Lê CRM_TEST_EMAILS (+ o e-mail da allowlist) como um conjunto normalizado. */
export function parseTestEmails(
  raw: string | undefined = process.env.CRM_TEST_EMAILS,
  allowedEmail: string | undefined = process.env.CRM_BOOKING_ALLOWED_EMAIL,
): Set<string> {
  const emails = new Set<string>()
  for (const item of (raw ?? '').split(/[\s,;]+/)) {
    const email = normalizeEmail(item)
    if (email.includes('@')) emails.add(email)
  }
  const allowed = normalizeEmail(allowedEmail)
  if (allowed.includes('@')) emails.add(allowed)
  return emails
}

export function isTestEmailDomain(email: string): boolean {
  const domain = normalizeEmail(email).split('@').pop() ?? ''
  if (!domain) return true
  const tld = domain.split('.').pop() ?? ''
  if (TEST_EMAIL_TLDS.includes(tld)) return true
  return TEST_EMAIL_DOMAINS.some(test => domain === test || domain.endsWith('.' + test))
}

export function isTestEmail(email: string, testEmails: ReadonlySet<string>): boolean {
  const normalized = normalizeEmail(email)
  return !normalized.includes('@') || testEmails.has(normalized) || isTestEmailDomain(normalized)
}

/**
 * is_test para um lead NOVO. Em modo "test" tudo é teste; em modo "live" só é real
 * o e-mail que não está na lista de testes nem usa domínio/TLD de teste.
 */
export function classifyNewLeadAsTest(input: {
  email: string
  mode?: CrmBookingMode
  testEmails?: ReadonlySet<string>
}): boolean {
  const mode = input.mode ?? getCrmBookingMode()
  if (mode !== 'live') return true
  return isTestEmail(input.email, input.testEmails ?? parseTestEmails())
}

/**
 * Regra para o futuro envio à Meta Conversions API: somente eventos com marca
 * explícita de lead real (isTest === false) podem ser enviados. Ausência de marca,
 * valores inválidos ou testes nunca são enviados.
 */
export function isMetaDispatchAllowed(metadata: unknown): boolean {
  return Boolean(metadata) && typeof metadata === 'object' &&
    (metadata as { isTest?: unknown }).isTest === false
}
