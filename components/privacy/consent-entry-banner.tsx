'use client'

import { useEffect, useState } from 'react'
import type { ConsentState } from '@/lib/privacy/consent'
import { CONSENT_CHANGE_EVENT, getConsent, setConsentChoices } from '@/lib/privacy/consent-client'
import { entryConsentChoices, entryConsentPending } from '@/lib/privacy/consent-entry'
import ConsentNotice from './consent-notice'

/**
 * Primeira camada do consentimento do formulário público (/formularios): aparece ao entrar, com três escolhas de
 * mesmo peso — "Recusar tudo", "Escolher" e "Aceitar tudo". Nada é pré-selecionado e nada é gravado sem clique.
 *
 * - Não bloqueia: não é um modal, não cobre o formulário de forma permanente (fica "grudado" no fim da tela e, ao rolar
 *   até o fim, assume seu lugar normal depois do rodapé) e o formulário funciona com qualquer escolha.
 * - "Escolher" abre o aviso detalhado (uma categoria por vez: métricas e, com o Meta Pixel habilitado, marketing).
 * - Depois de decidido nunca reabre sozinho; as preferências seguem acessíveis em "Preferências de cookies" no rodapé.
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
  if (suppressed || consent === undefined || !entryConsentPending(consent, marketingEnabled)) return null

  if (customizing) {
    return <div className="cpf-entry-consent" data-consent-ui="" data-consent-layer="details">
      <ConsentNotice marketingEnabled={marketingEnabled} />
    </div>
  }

  const choose = (action: 'accept-all' | 'reject-all') => setConsentChoices(entryConsentChoices(action, marketingEnabled))

  return <section className="cpf-entry-consent" role="region" aria-labelledby="cpf-entry-consent-title" data-consent-ui="" data-consent-layer="entry">
    <div className="cpf-entry-consent-text">
      <h2 id="cpf-entry-consent-title">Sua privacidade nesta página</h2>
      <p>
        Usamos métricas opcionais para entender como este formulário é utilizado e melhorar sua experiência
        {marketingEnabled ? ' e, com a sua autorização, o Meta Pixel e a API de Conversões para medir os resultados dos nossos anúncios. Nada disso inclui seu nome, e-mail ou telefone' : ''}.
        {' '}Você pode aceitar, recusar ou escolher — o formulário e o agendamento funcionam normalmente em qualquer caso.{' '}
        <a href="/politica-de-cookies" target="_blank" rel="noopener noreferrer">Política de Cookies</a>
        {' · '}
        <a href="/politica-de-privacidade" target="_blank" rel="noopener noreferrer">Política de Privacidade</a>
      </p>
    </div>
    <div className="cpf-entry-consent-actions">
      <button type="button" className="cpf-entry-choice" data-choice="reject" onClick={() => choose('reject-all')}>Recusar tudo</button>
      <button type="button" className="cpf-entry-choice" data-choice="customize" onClick={() => setCustomizing(true)}>Escolher</button>
      <button type="button" className="cpf-entry-choice" data-choice="accept" onClick={() => choose('accept-all')}>Aceitar tudo</button>
    </div>
  </section>
}
