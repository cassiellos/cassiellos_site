/**
 * Origens HTTPS autorizadas do Mini CRM no ambiente Preview
 * (branch feature/mini-crm-shark-scale).
 *
 * - crm.cassiellos.com.br é o domínio definitivo do CRM e do callback Google OAuth
 *   (coberto pela propriedade de domínio cassiellos.com.br verificada no Search Console).
 * - O alias estável da branch na Vercel continua aceito durante a transição,
 *   até a migração ser validada; removê-lo exige uma alteração explícita aqui.
 */
export const CRM_CANONICAL_ORIGIN = 'https://crm.cassiellos.com.br'
export const CRM_LEGACY_PREVIEW_ORIGIN =
  'https://agencia-cassiellos-git-feature-mini-244029-cassiellos-projects.vercel.app'

export const CRM_PREVIEW_ORIGINS: readonly string[] = [CRM_CANONICAL_ORIGIN, CRM_LEGACY_PREVIEW_ORIGIN]

/** Comparação exata (esquema + host, sem porta, sem barra final). */
export function isCrmPreviewOrigin(origin: string | null | undefined): origin is string {
  return typeof origin === 'string' && CRM_PREVIEW_ORIGINS.includes(origin)
}

/** Hosts aceitos para CRM_GOOGLE_REDIRECT_URI: o domínio definitivo ou um alias *.vercel.app. */
export function isAllowedOAuthRedirectHost(hostname: string): boolean {
  return hostname === new URL(CRM_CANONICAL_ORIGIN).hostname || hostname.endsWith('.vercel.app')
}
