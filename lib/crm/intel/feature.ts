/**
 * Flag EXCLUSIVA da Central de Inteligência (separada das configurações do CRM comercial).
 * Comparação exata, como as demais chaves do CRM: só `MI_ENABLED=true` liga a rota, a API e o link do menu.
 * Ausente ou com qualquer outro valor (inclusive em Production hoje) → a Central não existe (404) e o menu não muda.
 */
export function isIntelEnabled(flag: string | undefined): boolean {
  return flag === 'true'
}
