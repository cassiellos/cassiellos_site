/**
 * Retorno seguro depois do login (ex.: aviso tocado com a sessão expirada → login → ficha pedida).
 * Só caminhos internos do CRM; nada de URLs externas, "//", barras invertidas ou a própria tela de login.
 */
export function safeCrmReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 200) return null
  if (!/^\/crm(\/[A-Za-z0-9/_-]*)?(\?[A-Za-z0-9=&_-]*)?$/.test(value)) return null
  if (value.includes('//') || value.startsWith('/crm/login')) return null
  return value
}
