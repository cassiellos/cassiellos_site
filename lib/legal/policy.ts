/**
 * Fonte ÚNICA de versão e identificação do controlador para os textos jurídicos.
 *
 * - LEGAL_POLICY_VERSION é exibida como "Última atualização" na Política de Privacidade e na
 *   Política de Cookies e gravada em crm.consents (policy_version) pelo cadastro. Uma só data
 *   mantém as três coisas sincronizadas.
 * - Ela DEVE ser a data EFETIVA da publicação: no commit que publicar os textos, troque pelo
 *   dia da publicação (nunca uma data futura). Se houver duas publicações no mesmo dia, use
 *   sufixo (ex.: 2026-11-04.2). O histórico fica em docs/legal/historico-politicas.md.
 * - Dados empresariais pendentes ficam null: nada é inventado e nada aparece no texto até
 *   ser preenchido. legalPublicationBlockers() lista o que ainda impede a publicação.
 */

export const LEGAL_POLICY_VERSION = '2026-10-29'

export type DataProtectionOfficer = { name: string; email: string }

export type LegalController = {
  /** Nome pelo qual a empresa se apresenta no site. */
  tradeName: string
  /** Razão social — PENDENTE de confirmação pelo responsável. */
  legalName: string | null
  /** CNPJ — PENDENTE de confirmação pelo responsável. */
  cnpj: string | null
  /** Canal de privacidade (provisório até a revisão jurídica). */
  privacyChannel: string
  privacyChannelConfirmed: boolean
  /** Encarregado (art. 41 da LGPD) — só preencher depois de decidir/confirmar o enquadramento. */
  dataProtectionOfficer: DataProtectionOfficer | null
  /** Enquadramento como agente de tratamento de pequeno porte (Res. CD/ANPD nº 2/2022) confirmado? */
  smallAgentStatusConfirmed: boolean
  /** Prazo de retenção dos registros de consentimento definido e documentado? */
  consentRetentionDefined: boolean
}

export const LEGAL_CONTROLLER: LegalController = {
  tradeName: 'Cassiellos',
  legalName: null,
  cnpj: null,
  privacyChannel: 'cassiellosagencia@gmail.com',
  privacyChannelConfirmed: false,
  dataProtectionOfficer: null,
  smallAgentStatusConfirmed: false,
  consentRetentionDefined: false,
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto',
  'setembro', 'outubro', 'novembro', 'dezembro']

/** "2026-10-29" (ou "2026-10-29.2") → "29 de outubro de 2026". */
export function formatPolicyDate(version: string = LEGAL_POLICY_VERSION): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:\.\d+)?$/.exec(version)
  if (!match) throw new Error('LEGAL_POLICY_VERSION inválida: ' + version)
  const [, year, month, day] = match
  const monthName = MONTHS[Number(month) - 1]
  if (!monthName || Number(day) < 1 || Number(day) > 31) throw new Error('LEGAL_POLICY_VERSION inválida: ' + version)
  return Number(day) + ' de ' + monthName + ' de ' + year
}

/** O que ainda impede publicar os textos (lista vazia = pode seguir para a revisão final). */
export function legalPublicationBlockers(controller: LegalController = LEGAL_CONTROLLER): string[] {
  const blockers: string[] = []
  if (!controller.legalName) blockers.push('Razão social não informada')
  if (!controller.cnpj) blockers.push('CNPJ não informado')
  if (!controller.privacyChannelConfirmed) blockers.push('Canal de privacidade ainda provisório')
  if (!controller.dataProtectionOfficer && !controller.smallAgentStatusConfirmed) {
    blockers.push('Encarregado não indicado e enquadramento como agente de pequeno porte não confirmado')
  }
  if (!controller.consentRetentionDefined) blockers.push('Prazo de retenção dos registros de consentimento não definido')
  return blockers
}
