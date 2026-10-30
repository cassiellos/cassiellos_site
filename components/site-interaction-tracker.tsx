'use client'

import { useEffect } from 'react'
import { track } from '@vercel/analytics'
import { requiresAnalyticsConsent } from '@/lib/privacy/analytics-policy'
import { CONSENT_CHANGE_EVENT, analyticsAllowed } from '@/lib/privacy/consent-client'
import { trackAnalyticsFlow } from '@/lib/privacy/flow-client'

/** Site institucional: sempre (comportamento atual). Escopo do CRM: só com consentimento de métricas. */
function allowedHere() {
  return !requiresAnalyticsConsent(window.location.pathname) || analyticsAllowed()
}

/*
 * Eventos de intenção do site institucional. Não incluímos rótulos, buscas ou
 * valores de formulário: só o tipo da ação e a página onde ela aconteceu.
 */
function kindOfLink(anchor: HTMLAnchorElement) {
  const raw = anchor.getAttribute('href') || ''
  if (raw.startsWith('#')) return { kind: 'anchor', destination: raw || '#' }
  if (raw.startsWith('mailto:')) return { kind: 'email', destination: 'mailto' }
  if (raw.startsWith('tel:')) return { kind: 'phone', destination: 'tel' }

  try {
    const url = new URL(raw, window.location.href)
    if (/^(wa\.me|api\.whatsapp\.com)$/i.test(url.hostname)) {
      return { kind: 'whatsapp', destination: 'whatsapp' }
    }
    if (url.origin === window.location.origin) {
      return { kind: 'internal', destination: url.pathname || '/' }
    }
    return { kind: 'external', destination: url.hostname }
  } catch {
    return { kind: 'other', destination: 'unknown' }
  }
}

export default function SiteInteractionTracker() {
  useEffect(() => {
    // page_view: uma vez por carregamento. No escopo do CRM, só depois do consentimento (inclusive se ele for
    // dado nesta mesma página).
    let pageViewSent = false
    const sendPageView = () => {
      if (pageViewSent || !allowedHere()) return
      pageViewSent = true
      trackAnalyticsFlow('page_view')
    }
    sendPageView()

    const onClick = (event: MouseEvent) => {
      if (!allowedHere()) return
      const target = event.target
      if (!(target instanceof Element)) return
      // Os controles de consentimento não são medidos (nem o clique que revoga).
      if (target.closest('[data-consent-ui]')) return

      const anchor = target.closest('a')
      if (anchor instanceof HTMLAnchorElement) {
        const { kind, destination } = kindOfLink(anchor)
        track('site_link_click', { kind, destination, page: window.location.pathname })
        trackAnalyticsFlow(kind === 'whatsapp' ? 'whatsapp_click' : 'cta_click', `link:${kind}:${destination}`)
        return
      }

      const button = target.closest('button')
      if (!(button instanceof HTMLButtonElement) || button.disabled || button.closest('form')) return
      // No /agendar o progresso é medido pelos eventos do funil; cliques de interface (calendário, horários) não.
      if (window.location.pathname.startsWith('/agendar')) return
      track('site_button_click', {
        kind: button.classList.contains('btn') ? 'cta' : 'interface',
        page: window.location.pathname,
      })
      trackAnalyticsFlow('cta_click', button.classList.contains('btn') ? 'button:cta' : 'button:interface')
    }

    const onSubmit = (event: Event) => {
      // O funil /agendar tem uma pergunta por <form>: o envio real é registrado pelos eventos do funil
      // (lib/crm/funnel-events), não a cada pergunta respondida.
      if (window.location.pathname.startsWith('/agendar')) return
      if (event.target instanceof HTMLFormElement && allowedHere()) trackAnalyticsFlow('form_submit', 'form:site')
    }

    document.addEventListener('click', onClick, { capture: true })
    document.addEventListener('submit', onSubmit, { capture: true })
    window.addEventListener(CONSENT_CHANGE_EVENT, sendPageView)
    return () => {
      document.removeEventListener('click', onClick, { capture: true })
      document.removeEventListener('submit', onSubmit, { capture: true })
      window.removeEventListener(CONSENT_CHANGE_EVENT, sendPageView)
    }
  }, [])

  return null
}
