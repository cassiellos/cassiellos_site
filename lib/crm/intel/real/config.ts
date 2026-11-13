/**
 * Configuração do MODO REAL da Central (somente variáveis de ambiente do servidor; nada vai ao navegador).
 *
 *   MI_DATA_MODE=real            liga o modo real (padrão: demonstração). Sem ele, nada consulta o banco nem as plataformas.
 *   MI_VAULT_KEYS / MI_VAULT_KEY_CURRENT   chaves do cofre (separadas do Google Calendar).
 *   MI_OAUTH_REDIRECT_BASE       origem HTTPS do CRM para os retornos OAuth (ex.: https://crm.cassiellos.com.br).
 *   Google Ads (desligado até MI_GOOGLE_ADS_ENABLED=true): MI_GOOGLE_ADS_CLIENT_ID, MI_GOOGLE_ADS_CLIENT_SECRET,
 *     MI_GOOGLE_ADS_API_VERSION (opcional, padrão v26). MI_GOOGLE_ADS_DEVELOPER_TOKEN é legado e opcional desde 09/09/2026;
 *     acesso à API é concedido ao projeto Google Cloud que possui o OAuth client, conforme documentação oficial.
 *   Meta Ads (desligado até MI_META_ADS_ENABLED=true): MI_META_APP_ID, MI_META_APP_SECRET, MI_META_GRAPH_VERSION (opcional,
 *     padrão v26.0), MI_META_RESULT_ACTION (opcional, padrão lead), MI_META_SYSTEM_USER_TOKEN (opcional; usuário de sistema).
 * As credenciais do Google Calendar (CRM_GOOGLE_*) e do CAPI (META_CAPI_*) NÃO são usadas aqui.
 */
export type Env = Record<string, string | undefined>

export type ProviderStatus = { enabled: boolean; configured: boolean; missing: string[] }

export function dataMode(env: Env = process.env): 'demo' | 'real' {
  return env.MI_DATA_MODE === 'real' ? 'real' : 'demo'
}

const need = (env: Env, keys: string[]) => keys.filter(k => !env[k]?.trim())

export function redirectBase(env: Env = process.env): string | null {
  const v = env.MI_OAUTH_REDIRECT_BASE?.trim()
  if (!v) return null
  try { const u = new URL(v); return u.protocol === 'https:' && u.pathname === '/' && !u.search ? u.origin : null } catch { return null }
}

export function googleStatus(env: Env = process.env): ProviderStatus {
  const missing = need(env, ['MI_GOOGLE_ADS_CLIENT_ID', 'MI_GOOGLE_ADS_CLIENT_SECRET', 'MI_VAULT_KEYS', 'MI_OAUTH_REDIRECT_BASE'])
  if (env.MI_OAUTH_REDIRECT_BASE && !redirectBase(env)) missing.push('MI_OAUTH_REDIRECT_BASE (https)')
  return { enabled: env.MI_GOOGLE_ADS_ENABLED === 'true', configured: missing.length === 0, missing }
}

export function metaStatus(env: Env = process.env): ProviderStatus {
  const missing = need(env, ['MI_META_APP_ID', 'MI_META_APP_SECRET', 'MI_VAULT_KEYS', 'MI_OAUTH_REDIRECT_BASE'])
  if (env.MI_OAUTH_REDIRECT_BASE && !redirectBase(env)) missing.push('MI_OAUTH_REDIRECT_BASE (https)')
  return { enabled: env.MI_META_ADS_ENABLED === 'true', configured: missing.length === 0, missing }
}

export const providerReady = (s: ProviderStatus) => s.enabled && s.configured
