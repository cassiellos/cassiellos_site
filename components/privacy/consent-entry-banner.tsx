'use client'

import { useEffect, useState } from 'react'
import type { ConsentState } from '@/lib/privacy/consent'
import { CONSENT_CHANGE_EVENT, getConsent, setConsentChoices } from '@/lib/privacy/consent-client'
import { entryConsentChoices, entryConsentPending, type EntryConsentAction } from '@/lib/privacy/consent-entry'
import ConsentNotice from './consent-notice'

/**
 * Primeira camada do consentimento do formulário público (/formularios): aparece na primeira visita, com três escolhas
 * de mesmo peso — "Recusar", "Aceitar métricas" e "Personalizar". Nada é pré-selecionado e nada é gravado sem clique.
 *
 * - Não bloqueia: não é um modal, não rouba o foco e não cobre o formulário de forma permanente (fica "grudado" no fim
 *   da tela e, ao rolar até o fim, assume seu lugar normal depois do rodapé). O formulário funciona com qualquer escolha.
 * - Métricas e marketing são separados: "Aceitar métricas" nunca liga marketing. Marketing (Meta Pixel e API de Conversões,
 *   quando existirem na página) só é decidido em "Personalizar" ou em "Preferências de cookies", no rodapé.
 * - "Personalizar" abre o aviso detalhado (uma categoria por vez).
 * - Depois de decidido nunca reabre sozinho; as preferências podem ser alteradas ou revogadas no rodapé, com efeito imediato.
 * - Texto proposto, sujeito à aprovação jurídica (o aviso detalhado e as políticas continuam sendo os textos aprovados).
 */
export default function ConsentEntryBanner({ marketingEnabled = false, suppressed = false }: { marketingEnabled?: boolean; suppressed?: boolean }) {
  const [consent, setConsent] = useState<ConsentState | null | undefined>(undefined)
  const [customizing, setCustomizing] = useState(false)

  useEffect(() => {
    const sync = () => setConsent(getConsent())
    sync()
    window.addEventListener(CONSENT_CHANGE_EVENT, sync)
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, sync)
  }, [])

  // `undefined` = ainda não leu o cookie (render do servidor/hidratação): nada aparece, sem salto de layout.
  if (suppressed || consent === undefined) return null

  // Em "Personalizar" o aviso detalhado é quem decide quando fechar (só depois de métricas E marketing decididos, ou
  // só de métricas quando a página não tem Meta Pixel): decidir métricas primeiro não pode fazer o painel sumir antes
  // de o visitante ver a escolha de marketing.
  if (customizing) {
    return <div className="cpf-entry-consent" data-consent-ui="" data-consent-layer="details">
      <ConsentNotice marketingEnabled={marketingEnabled} />
    </div>
  }

  if (!entryConsentPending(consent)) return null

  const choose = (action: EntryConsentAction) => setConsentChoices(entryConsentChoices(action, marketingEnabled))

  return <section className="cpf-entry-consent" role="region" aria-labelledby="cpf-entry-consent-title" data-consent-ui="" data-consent-layer="entry">
    <div className="cpf-entry-consent-text">
      <h2 id="cpf-entry-consent-title">Privacidade nesta página</h2>
      <p>
        Usamos métricas opcionais para entender como este formulário é utilizado e melhorar sua experiência.
        {marketingEnabled ? ' Cookies de marketing só são usados se você ativá-los em Personalizar.' : ''}
        {' '}Recusar não impede o formulário nem o agendamento.{' '}
        <a href="/politica-de-cookies" target="_blank" rel="noopener noreferrer">Política de Cookies</a>
        {' · '}
        <a href="/politica-de-privacidade" target="_blank" rel="noopener noreferrer">Política de Privacidade</a>
      </p>
    </div>
    <div className="cpf-entry-consent-actions">
      <button type="button" className="cpf-entry-choice" data-choice="reject" onClick={() => choose('reject')}>Recusar</button>
      <button type="button" className="cpf-entry-choice" data-choice="metrics" onClick={() => choose('accept-metrics')}>Aceitar métricas</button>
      <button type="button" className="cpf-entry-choice" data-choice="customize" onClick={() => setCustomizing(true)}>Personalizar</button>
    </div>
  </section>
}
