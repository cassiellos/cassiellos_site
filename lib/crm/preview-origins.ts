import { homologMode } from './homolog-mode'
import { crmRuntime, type CrmRuntime } from './runtime-env'

/**
 * Origens HTTPS autorizadas do Mini CRM, por ambiente (lib/crm/runtime-env.ts).
 *
 * - crm.cassiellos.com.br é o domínio definitivo do CRM e do callback Google OAuth
 *   (coberto pela propriedade de domínio cassiellos.com.br verificada no Search Console).
 * - Preview (projeto agencia-cassiellos, branch feature/mini-crm-shark-scale): o domínio definitivo e os
 *   aliases estáveis das branches na Vercel continuam aceitos, exatamente como antes.
 * - Production (projeto cassiellos-crm): SOMENTE o domínio definitivo. Nenhum alias *.vercel.app é aceito
 *   para alterações (CSRF) nem como callback OAuth.
 * - Fora da Vercel (testes/local) vale a lista do Preview, como antes.
 */
export const CRM_CANONICAL_ORIGIN = 'https://crm.cassiellos.com.br'
export const CRM_LEGACY_PREVIEW_ORIGIN =
  'https://agencia-cassiellos-git-feature-mini-244029-cassiellos-projects.vercel.app'

export const CRM_FORM_DESIGN_PREVIEW_ORIGIN =
  'https://agencia-cassiellos-git-design-formul-5e3c88-cassiellos-projects.vercel.app'

export const CRM_PREVIEW_ORIGINS: readonly string[] = [CRM_CANONICAL_ORIGIN, CRM_LEGACY_PREVIEW_ORIGIN, CRM_FORM_DESIGN_PREVIEW_ORIGIN]
export const CRM_PRODUCTION_ORIGINS: readonly string[] = [CRM_CANONICAL_ORIGIN]

export function crmAllowedOrigins(runtime: CrmRuntime | null = crmRuntime()): readonly string[] {
  // Homologação isolada: SOMENTE as origens confirmadas pela Vercel neste deploy (VERCEL_BRANCH_URL / VERCEL_URL).
  // Nenhuma origem do CRM real vale aqui e nenhuma URL é presumida (lib/crm/homolog-mode.ts).
  const homolog = homologMode()
  if (homolog.active) return homolog.origins
  return runtime === 'production' ? CRM_PRODUCTION_ORIGINS : CRM_PREVIEW_ORIGINS
}

/** Comparação exata (esquema + host, sem porta, sem barra final) com as origens do ambiente atual. */
export function isCrmPreviewOrigin(
  origin: string | null | undefined,
  runtime: CrmRuntime | null = crmRuntime(),
): origin is string {
  return typeof origin === 'string' && crmAllowedOrigins(runtime).includes(origin)
}

/**
 * Hosts aceitos para CRM_GOOGLE_REDIRECT_URI.
 * Production: somente o domínio definitivo. Demais casos: o domínio definitivo ou um alias *.vercel.app.
 */
export function isAllowedOAuthRedirectHost(hostname: string, runtime: CrmRuntime | null = crmRuntime()): boolean {
  const canonical = new URL(CRM_CANONICAL_ORIGIN).hostname
  if (runtime === 'production') return hostname === canonical
  return hostname === canonical || hostname.endsWith('.vercel.app')
}
