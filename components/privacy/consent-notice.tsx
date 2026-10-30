'use client'

import { useEffect, useRef, useState } from 'react'
import type { ConsentState } from '@/lib/privacy/consent'
import {
  CONSENT_CHANGE_EVENT, CONSENT_OPEN_EVENT, getConsent, openConsentPreferences, setAnalyticsConsent, setMarketingConsent,
} from '@/lib/privacy/consent-client'

/**
 * Aviso de cookies do funil de agendamento (escopo do CRM).
 * - Aparece enquanto faltar alguma escolha, ou quando reaberto por "Preferências de cookies".
 * - Fica no fluxo da página (não cobre campos nem botões) e não bloqueia o formulário: sem escolha,
 *   nada opcional é ativado.
 * - "Recusar" e "Aceitar" têm o mesmo peso visual; nada é pré-selecionado. A revogação vale imediatamente.
 * - Métricas (Etapa 3) e marketing (Etapa 4, texto aprovado em 30/10/2026). Marketing só aparece com o Pixel habilitado
 *   (`marketingEnabled`); com o Pixel desligado o aviso é exatamente o da Etapa 3.
 * O texto jurídico das políticas continua dependendo de aprovação.
 */
export default function ConsentNotice({ marketingEnabled = false }: { marketingEnabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState<ConsentState | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusOnOpen = useRef(false)

  useEffect(() => {
    const pending = (consent: ConsentState | null) =>
      !consent || consent.analytics === null || (marketingEnabled && consent.marketing === null)
    const sync = () => {
      const consent = getConsent()
      setCurrent(consent)
      return consent
    }
    if (pending(sync())) setOpen(true)
    const onOpen = () => { sync(); focusOnOpen.current = true; setOpen(true) }
    const onChange = () => { if (!pending(sync())) setOpen(false) }
    window.addEventListener(CONSENT_OPEN_EVENT, onOpen)
    window.addEventListener(CONSENT_CHANGE_EVENT, onChange)
    return () => {
      window.removeEventListener(CONSENT_OPEN_EVENT, onOpen)
      window.removeEventListener(CONSENT_CHANGE_EVENT, onChange)
    }
  }, [marketingEnabled])

  useEffect(() => {
    if (open && focusOnOpen.current) {
      focusOnOpen.current = false
      heading.current?.focus()
    }
  }, [open])

  if (!open) return null

  const analytics = current?.analytics ?? null
  const marketing = current?.marketing ?? null

  if (!marketingEnabled) {
    const choose = (granted: boolean) => {
      setAnalyticsConsent(granted)
      setOpen(false)
    }
    return <section className="consent-notice" aria-labelledby="consent-notice-title" data-consent-ui="">
      <div>
        <h2 id="consent-notice-title" ref={heading} tabIndex={-1}>Métricas de uso desta página</h2>
        <p>Utilizamos métricas opcionais para entender como nosso formulário é utilizado e melhorar sua experiência.
          Você pode aceitar ou recusar essas métricas sem impedir seu agendamento.</p>
        <p className="consent-notice-links">
          {analytics !== null && <span>Escolha atual: {analytics ? 'métricas aceitas' : 'métricas recusadas'}. </span>}
          <a href="/politica-de-cookies" target="_blank" rel="noopener noreferrer">Política de Cookies</a>
          {' · '}
          <a href="/politica-de-privacidade" target="_blank" rel="noopener noreferrer">Política de Privacidade</a>
        </p>
      </div>
      <div className="consent-notice-actions">
        <button type="button" className="consent-choice" onClick={() => choose(false)}>Recusar</button>
        <button type="button" className="consent-choice" onClick={() => choose(true)}>Aceitar métricas</button>
      </div>
    </section>
  }

  // Cada categoria é escolhida à parte; o aviso fecha sozinho quando as duas estiverem decididas.
  return <section className="consent-notice" aria-labelledby="consent-notice-title" data-consent-ui="">
    <h2 id="consent-notice-title" ref={heading} tabIndex={-1}>Cookies e métricas desta página</h2>
    <div className="consent-category" role="group" aria-labelledby="consent-analytics-title">
      <h3 id="consent-analytics-title">Métricas de uso</h3>
      <p>Utilizamos métricas opcionais para entender como nosso formulário é utilizado e melhorar sua experiência.
        Você pode aceitar ou recusar essas métricas sem impedir seu agendamento.</p>
      {analytics !== null && <p className="consent-current">Escolha atual: {analytics ? 'métricas aceitas' : 'métricas recusadas'}.</p>}
      <div className="consent-notice-actions">
        <button type="button" className="consent-choice" aria-pressed={analytics === false}
          onClick={() => setAnalyticsConsent(false)}>Recusar métricas</button>
        <button type="button" className="consent-choice" aria-pressed={analytics === true}
          onClick={() => setAnalyticsConsent(true)}>Aceitar métricas</button>
      </div>
    </div>
    <div className="consent-category" role="group" aria-labelledby="consent-marketing-title">
      <h3 id="consent-marketing-title">Cookies de marketing</h3>
      <p>Com sua autorização, utilizamos o Meta Pixel, tecnologia da Meta, para medir os resultados dos nossos anúncios
        e melhorar nossas campanhas. Nesse caso, a Meta recebe identificadores do seu navegador e o registro das visitas,
        cadastros e agendamentos feitos nestas páginas, sem seu nome, e-mail ou telefone. Você pode aceitar ou recusar
        esse rastreamento sem prejudicar o uso do formulário.</p>
      {marketing !== null && <p className="consent-current">Escolha atual: {marketing ? 'marketing aceito' : 'marketing recusado'}.</p>}
      <div className="consent-notice-actions">
        <button type="button" className="consent-choice" aria-pressed={marketing === false}
          onClick={() => setMarketingConsent(false)}>Recusar marketing</button>
        <button type="button" className="consent-choice" aria-pressed={marketing === true}
          onClick={() => setMarketingConsent(true)}>Aceitar marketing</button>
      </div>
    </div>
    <p className="consent-notice-links">
      <a href="/politica-de-cookies" target="_blank" rel="noopener noreferrer">Política de Cookies</a>
      {' · '}
      <a href="/politica-de-privacidade" target="_blank" rel="noopener noreferrer">Política de Privacidade</a>
      {analytics !== null && marketing !== null && <>{' · '}
        <button type="button" className="consent-preferences-button" onClick={() => setOpen(false)}>Fechar</button></>}
    </p>
  </section>
}

/** Botão do rodapé que reabre o aviso. */
export function ConsentPreferencesButton() {
  return <button type="button" className="consent-preferences-button" data-consent-ui="" onClick={openConsentPreferences}>
    Preferências de cookies
  </button>
}
