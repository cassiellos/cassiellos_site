/**
 * Chave EXCLUSIVA do aviso de entrada de consentimento em /formularios/[slug] (lida no servidor).
 * DESLIGADA por padrão: sem `CONSENT_ENTRY_NOTICE_ENABLED=true` (exatamente "true") o aviso não é renderizado, e o
 * comportamento é o de antes (consentimento só pelo botão "Preferências de cookies", no rodapé).
 *
 * Esta chave controla APENAS se o aviso aparece. Ela NÃO concede, simula nem dispensa consentimento: não toca no
 * cookie `cassiellos_consent`, nos sinais do Consent Mode, no GTM, no Meta Pixel nem na API de Conversões.
 * Ligar exige a aprovação jurídica do texto e variável no ambiente de produção; desligar é reverter só o aviso.
 */
export type EntryNoticeConfig = { enabled: boolean }

export function getEntryNoticeConfig(env: Record<string, string | undefined> = process.env): EntryNoticeConfig {
  return { enabled: env.CONSENT_ENTRY_NOTICE_ENABLED?.trim() === 'true' }
}
