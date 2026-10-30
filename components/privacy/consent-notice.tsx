'use client'

import { useEffect, useRef, useState } from 'react'
import {
  CONSENT_CHANGE_EVENT, CONSENT_OPEN_EVENT, getConsent, openConsentPreferences, setAnalyticsConsent,
} from '@/lib/privacy/consent-client'

/**
 * Aviso de métricas do funil de agendamento (escopo do CRM).
 * - Aparece enquanto não houver escolha registrada, ou quando reaberto por "Preferências de cookies".
 * - Fica no fluxo da página (não cobre campos nem botões) e não bloqueia o formulário: sem escolha,
 *   nada opcional é ativado.
 * - "Recusar" e "Aceitar métricas" têm o mesmo peso visual. A revogação vale imediatamente.
 * Texto factual sobre o funcionamento técnico; o texto jurídico das políticas depende de aprovação.
 */
export default function ConsentNotice() {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState<boolean | null>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const focusOnOpen = useRef(false)

  useEffect(() => {
    const sync = () => {
      const consent = getConsent()
      setCurrent(consent ? consent.analytics : null)
      return consent
    }
    if (!sync()) setOpen(true)
    const onOpen = () => { sync(); focusOnOpen.current = true; setOpen(true) }
    window.addEventListener(CONSENT_OPEN_EVENT, onOpen)
    window.addEventListener(CONSENT_CHANGE_EVENT, sync)
    return () => {
      window.removeEventListener(CONSENT_OPEN_EVENT, onOpen)
      window.removeEventListener(CONSENT_CHANGE_EVENT, sync)
    }
  }, [])

  useEffect(() => {
    if (open && focusOnOpen.current) {
      focusOnOpen.current = false
      heading.current?.focus()
    }
  }, [open])

  if (!open) return null

  const choose = (granted: boolean) => {
    setAnalyticsConsent(granted)
    setOpen(false)
  }

  return <section className="consent-notice" aria-labelledby="consent-notice-title" data-consent-ui="">
    <div>
      <h2 id="consent-notice-title" ref={heading} tabIndex={-1}>Métricas de uso desta página</h2>
      <p>Com a sua permissão, ativamos métricas de uso (Vercel Web Analytics, Vercel Speed Insights e o sistema
        de métricas da própria Cassiellos) para entender como o agendamento é utilizado. Essas métricas não
        recebem nome, e-mail, telefone nem respostas do formulário. O agendamento funciona normalmente com
        qualquer escolha, e você pode alterá-la a qualquer momento em “Preferências de cookies”, no rodapé.</p>
      <p className="consent-notice-links">
        {current !== null && <span>Escolha atual: {current ? 'métricas aceitas' : 'métricas recusadas'}. </span>}
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

/** Botão do rodapé que reabre o aviso. */
export function ConsentPreferencesButton() {
  return <button type="button" className="consent-preferences-button" data-consent-ui="" onClick={openConsentPreferences}>
    Preferências de cookies
  </button>
}
