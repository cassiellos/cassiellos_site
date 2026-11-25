import type { ConsentChoices, ConsentState } from './consent'

/**
 * Regras puras do aviso de consentimento da ENTRADA do formulário (primeira camada).
 *
 * - O aviso aparece enquanto faltar alguma escolha relevante; uma vez decidido, nunca mais abre sozinho
 *   (as preferências continuam acessíveis no rodapé).
 * - "Recusar tudo" e "Aceitar tudo" têm o mesmo peso e só gravam quando o visitante clica: ver o aviso,
 *   rolar a página ou preencher o formulário nunca vale como aceite.
 * - Categorias que não existem na página (marketing sem Meta Pixel) não são decididas por ninguém:
 *   ficam como estão (`null`), exatamente como no aviso detalhado.
 */
export function entryConsentPending(consent: ConsentState | null, marketingEnabled: boolean): boolean {
  return !consent || consent.analytics === null || (marketingEnabled && consent.marketing === null)
}

export type EntryConsentAction = 'accept-all' | 'reject-all'

/** Escolhas gravadas por cada botão da primeira camada ("Escolher" não grava nada: abre o aviso detalhado). */
export function entryConsentChoices(action: EntryConsentAction, marketingEnabled: boolean): Partial<ConsentChoices> {
  const granted = action === 'accept-all'
  return marketingEnabled ? { analytics: granted, marketing: granted } : { analytics: granted }
}
