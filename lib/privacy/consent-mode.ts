/**
 * Google Consent Mode v2 — traduz as escolhas do sistema de consentimento do CRM (`cassiellos_consent`) para os quatro
 * sinais do Google. Módulo puro: não lê cookie, não envia nada e NUNCA concede por conta própria.
 *
 * - O padrão é SEMPRE "denied" nos quatro sinais.
 * - `analytics_storage` acompanha a escolha "métricas" do visitante.
 * - `ad_storage`, `ad_user_data` e `ad_personalization` ficam "denied" enquanto `googleAdsSignals` for falso. O aviso de
 *   marketing atual cita apenas o Meta Pixel/CAPI; só depois de o texto jurídico incluir o Google (e de autorização
 *   expressa) esses sinais podem seguir a escolha "marketing".
 * - Sem escolha registrada (null) ou com recusa, nada é concedido. Revogação volta a "denied" na hora.
 */
export type ConsentSignal = 'granted' | 'denied'
export type ConsentModeState = {
  analytics_storage: ConsentSignal
  ad_storage: ConsentSignal
  ad_user_data: ConsentSignal
  ad_personalization: ConsentSignal
}

export const CONSENT_MODE_DEFAULT: Readonly<ConsentModeState> = Object.freeze({
  analytics_storage: 'denied',
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
})

export function consentModeFrom(
  consent: { analytics: boolean | null; marketing: boolean | null } | null | undefined,
  options: { googleAdsSignals?: boolean } = {},
): ConsentModeState {
  const analytics: ConsentSignal = consent?.analytics === true ? 'granted' : 'denied'
  const ads: ConsentSignal = options.googleAdsSignals === true && consent?.marketing === true ? 'granted' : 'denied'
  return { analytics_storage: analytics, ad_storage: ads, ad_user_data: ads, ad_personalization: ads }
}

/** Cookies do Google Analytics/Ads que a página remove quando o visitante recusa ou revoga. */
export const GOOGLE_COOKIE_PATTERN = /^(_ga|_ga_[A-Za-z0-9]+|_gid|_gat(_[A-Za-z0-9_-]+)?|_gcl_(au|aw|dc|gb|ag))$/

export function googleCookieNames(cookieHeader: string): string[] {
  return cookieHeader.split(';').map(part => part.trim().split('=')[0]).filter(name => GOOGLE_COOKIE_PATTERN.test(name))
}
