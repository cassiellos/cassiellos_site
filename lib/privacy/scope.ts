/**
 * Escopo das páginas: CRM (funil de agendamento e painel administrativo) × site institucional.
 * O CRM é publicado no Preview; o site institucional, na main — com autorizações separadas.
 */
export function isCrmScopePath(pathname: string): boolean {
  return /^\/(agendar|formularios|crm|mini-crm)(\/|$)/.test(pathname)
}

/**
 * Jornadas com métricas PRÓPRIAS de funil (uma pergunta por tela). Nelas o rastreador global do site não pode contar
 * cada pergunta respondida como "envio de formulário" nem cada alternativa como clique de CTA: o progresso é medido
 * pelos eventos do funil (lib/crm/funnel-events no /agendar; lib/tracking no /formularios).
 */
export function ownsFunnelMetrics(pathname: string): boolean {
  return /^\/(agendar|formularios)(\/|$)/.test(pathname)
}
