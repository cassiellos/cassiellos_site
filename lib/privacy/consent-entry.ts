import type { ConsentChoices, ConsentState } from './consent'

/**
 * Regras puras do aviso de consentimento da ENTRADA do formulário (primeira camada).
 *
 * Três escolhas de mesmo peso: "Recusar", "Aceitar métricas" e "Personalizar".
 * - O aviso aparece enquanto a escolha de MÉTRICAS não existir. Marketing é uma decisão à parte e nunca segura nem
 *   fecha este aviso: ela só é tomada em "Personalizar" ou nas preferências do rodapé.
 * - "Aceitar métricas" liga SOMENTE métricas; nunca marketing (nem o Meta Pixel, nem a API de Conversões).
 * - "Recusar" recusa tudo o que é opcional na página (métricas e, se o Meta Pixel existir nela, marketing).
 * - Nada é gravado sem clique: ver o aviso, rolar a página ou preencher o formulário nunca vale como aceite.
 * - Depois de decidido, o aviso nunca reabre sozinho (as preferências seguem no rodapé e a revogação vale na hora).
 * - Categorias que não existem na página (marketing sem Meta Pixel) nunca são gravadas.
 */
export function entryConsentPending(consent: ConsentState | null): boolean {
  return !consent || consent.analytics === null
}

export type EntryConsentAction = 'reject' | 'accept-metrics'

/** Escolhas gravadas por cada botão da primeira camada ("Personalizar" não grava nada: abre o aviso detalhado). */
export function entryConsentChoices(action: EntryConsentAction, marketingEnabled: boolean): Partial<ConsentChoices> {
  if (action === 'accept-metrics') return { analytics: true }
  return marketingEnabled ? { analytics: false, marketing: false } : { analytics: false }
}
