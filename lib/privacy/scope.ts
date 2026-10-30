/**
 * Escopo das páginas: CRM (funil de agendamento e painel administrativo) × site institucional.
 * O CRM é publicado no Preview; o site institucional, na main — com autorizações separadas.
 */
export function isCrmScopePath(pathname: string): boolean {
  return /^\/(agendar|crm|mini-crm)(\/|$)/.test(pathname)
}
