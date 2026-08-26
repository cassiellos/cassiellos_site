'use client'

import { useEffect } from 'react'
import { track } from '@vercel/analytics'

const ANALYTICS_FLOW_ENDPOINT = '/api/analyticsflow/events'
const ANALYTICS_FLOW_CLIENT = 'cassiellos-site'

function safePageUrl() {
  const url = new URL(window.location.href)
  return `${url.origin}${url.pathname}`
}

function safeReferrer() {
  if (!document.referrer) return null
  try {
    const url = new URL(document.referrer)
    return `${url.origin}${url.pathname}`
  } catch {
    return null
  }
}

function attribution() {
  const params = new URLSearchParams(window.location.search)
  return Object.fromEntries(['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'gclid', 'fbclid']
    .map((key) => [key, params.get(key) || null]))
}

function trackAnalyticsFlow(eventType: 'page_view' | 'cta_click' | 'whatsapp_click' | 'form_submit', contentId?: string) {
  const payload = JSON.stringify({
    event_id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    client_id: ANALYTICS_FLOW_CLIENT,
    event_type: eventType,
    url: safePageUrl(),
    referrer: safeReferrer(),
    content_id: contentId || null,
    ...attribution(),
  })
  void fetch(ANALYTICS_FLOW_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload,
    keepalive: true,
    credentials: 'same-origin',
  }).catch(() => undefined)
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
    trackAnalyticsFlow('page_view')

    const onClick = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return

      const anchor = target.closest('a')
      if (anchor instanceof HTMLAnchorElement) {
        const { kind, destination } = kindOfLink(anchor)
        track('site_link_click', { kind, destination, page: window.location.pathname })
        trackAnalyticsFlow(kind === 'whatsapp' ? 'whatsapp_click' : 'cta_click', `link:${kind}:${destination}`)
        return
      }

      const button = target.closest('button')
      if (!(button instanceof HTMLButtonElement) || button.disabled || button.closest('form')) return
      track('site_button_click', {
        kind: button.classList.contains('btn') ? 'cta' : 'interface',
        page: window.location.pathname,
      })
      trackAnalyticsFlow('cta_click', button.classList.contains('btn') ? 'button:cta' : 'button:interface')
    }

    const onSubmit = (event: Event) => {
      if (event.target instanceof HTMLFormElement) trackAnalyticsFlow('form_submit', 'form:site')
    }

    document.addEventListener('click', onClick, { capture: true })
    document.addEventListener('submit', onSubmit, { capture: true })
    return () => {
      document.removeEventListener('click', onClick, { capture: true })
      document.removeEventListener('submit', onSubmit, { capture: true })
    }
  }, [])

  return null
}
