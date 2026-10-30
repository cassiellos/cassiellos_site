/**
 * Fonte ÚNICA de versão, identificação do controlador e prazos dos textos jurídicos.
 *
 * - LEGAL_POLICY_VERSION é exibida como "Última atualização" nas Políticas de Privacidade e de Cookies e gravada
 *   em crm.consents (policy_version). DEVE ser a data EFETIVA da publicação (nunca futura); segunda publicação
 *   no mesmo dia: sufixo ".2". Histórico em docs/legal/historico-politicas.md.
 * - Itens que dependem de confirmação do responsável ficam com a marca `false`: o texto correspondente não é
 *   exibido e legalPublicationBlockers() aponta o que ainda impede a publicação. Nada é presumido.
 */

export const LEGAL_POLICY_VERSION = '2026-10-30'

export type DataProtectionOfficer = { name: string; email: string }

export type LegalController = {
  /** Nome pelo qual a empresa se apresenta no site. */
  tradeName: string
  /** Razão social conforme o cadastro do CNPJ. */
  legalName: string | null
  cnpj: string | null
  /** Dados do controlador conferidos e aprovados pelo responsável para publicação. */
  identificationConfirmed: boolean
  privacyChannel: string
  privacyChannelConfirmed: boolean
  /** Encarregado (art. 41 da LGPD): só preencher com indicação formal do responsável. */
  dataProtectionOfficer: DataProtectionOfficer | null
  /** Enquadramento como agente de tratamento de pequeno porte (Res. CD/ANPD nº 2/2022) confirmado pelo responsável. */
  smallAgentStatusConfirmed: boolean
  /** Prazo de retenção dos registros de consentimento aprovado. */
  consentRetentionDefined: boolean
}

export const LEGAL_CONTROLLER: LegalController = {
  tradeName: 'Cassiellos',
  // Conferido em 30/10/2026 no cadastro público do CNPJ (ATIVA, Microempresa) e confirmado pelo responsável (D1).
  legalName: 'CASSIELLOS COMUNICAÇÃO E SERVIÇOS DIGITAIS LTDA',
  cnpj: '67.311.701/0001-12',
  identificationConfirmed: true,
  // D2 (30/10/2026): canal confirmado pelo responsável — caixa monitorada para pedidos dos titulares.
  privacyChannel: 'cassiellosagencia@gmail.com',
  privacyChannelConfirmed: true,
  dataProtectionOfficer: null,
  // D3 (30/10/2026): ME; receita bruta informada muito abaixo do limite da LC 123/2006, art. 3º, II; sem grupo econômico
  // acima do limite (confirmado pelo responsável); nenhum critério de alto risco do art. 4º (verificação técnica).
  smallAgentStatusConfirmed: true,
  // D4 (30/10/2026): vigente enquanto houver finalidade; após revogação, evidência mínima por até 5 anos quando
  // houver fundamento; revisão semestral; eliminação antecipada (docs/legal/historico-politicas.md).
  consentRetentionDefined: true,
}

/** Prazos (D4, aprovado em 30/10/2026). O prazo de 5 anos é decisão da controladora, não exigência da LGPD. */
export const CONSENT_COOKIE_DAYS = 180
export const META_COOKIE_DAYS_APPROX = 90
export const CONSENT_RECORD_RETENTION_YEARS = 5

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto',
  'setembro', 'outubro', 'novembro', 'dezembro']

/** "2026-10-30" (ou "2026-10-30.2") → "30 de outubro de 2026". */
export function formatPolicyDate(version: string = LEGAL_POLICY_VERSION): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:\.\d+)?$/.exec(version)
  if (!match) throw new Error('LEGAL_POLICY_VERSION inválida: ' + version)
  const [, year, month, day] = match
  const monthName = MONTHS[Number(month) - 1]
  if (!monthName || Number(day) < 1 || Number(day) > 31) throw new Error('LEGAL_POLICY_VERSION inválida: ' + version)
  return Number(day) + ' de ' + monthName + ' de ' + year
}

/** Identificação exibida: só com dados conferidos E aprovados. */
export function controllerIdentification(controller: LegalController = LEGAL_CONTROLLER): string | null {
  if (!controller.identificationConfirmed || !controller.legalName || !controller.cnpj) return null
  return controller.legalName + ' (CNPJ ' + controller.cnpj + ')'
}

/** O que ainda impede publicar os textos (lista vazia = pode publicar, com a data efetiva). */
export function legalPublicationBlockers(controller: LegalController = LEGAL_CONTROLLER): string[] {
  const blockers: string[] = []
  if (!controller.identificationConfirmed || !controller.legalName || !controller.cnpj) {
    blockers.push('Identificação do controlador (razão social e CNPJ) não aprovada')
  }
  if (!controller.privacyChannelConfirmed) blockers.push('Canal de privacidade não confirmado')
  if (!controller.dataProtectionOfficer && !controller.smallAgentStatusConfirmed) {
    blockers.push('Encarregado não indicado e enquadramento como agente de pequeno porte não confirmado')
  }
  if (!controller.consentRetentionDefined) blockers.push('Prazo de retenção dos registros de consentimento não aprovado')
  return blockers
}
