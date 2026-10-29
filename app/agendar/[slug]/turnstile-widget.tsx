'use client'

import { useEffect, useRef } from 'react'

/**
 * Cloudflare Turnstile (renderização explícita). O token só é usado no servidor;
 * nenhuma chave secreta existe no navegador. O widget aparece apenas quando a
 * Cloudflare precisa de interação (appearance: interaction-only) e renova
 * automaticamente tokens expirados (refresh-expired: auto).
 */

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string
  reset: (widgetId: string) => void
  remove: (widgetId: string) => void
}

declare global {
  interface Window { turnstile?: TurnstileApi }
}

const SCRIPT_ID = 'cf-turnstile-api'
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

let scriptPromise: Promise<TurnstileApi> | null = null

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile)
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const done = () => window.turnstile ? resolve(window.turnstile) : reject(new Error('TURNSTILE_UNAVAILABLE'))
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    const script = existing ?? document.createElement('script')
    script.addEventListener('load', done, { once: true })
    script.addEventListener('error', () => { scriptPromise = null; reject(new Error('TURNSTILE_BLOCKED')) }, { once: true })
    if (!existing) {
      script.id = SCRIPT_ID
      script.src = SCRIPT_SRC
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }
  })
  return scriptPromise
}

export type TurnstileState = 'loading' | 'verifying' | 'ready' | 'expired' | 'error'

export default function TurnstileWidget({
  siteKey, action, resetSignal, onToken, onStateChange,
}: {
  siteKey: string
  action: string
  /** Incrementar para descartar o token atual e gerar outro. */
  resetSignal: number
  onToken: (token: string | null) => void
  onStateChange: (state: TurnstileState) => void
}) {
  const container = useRef<HTMLDivElement>(null)
  const widgetId = useRef<string | null>(null)
  const callbacks = useRef({ onToken, onStateChange })
  callbacks.current = { onToken, onStateChange }

  useEffect(() => {
    let cancelled = false
    callbacks.current.onStateChange('loading')
    loadTurnstile().then(api => {
      if (cancelled || !container.current) return
      callbacks.current.onStateChange('verifying')
      widgetId.current = api.render(container.current, {
        sitekey: siteKey,
        action,
        theme: 'dark',
        size: 'flexible',
        appearance: 'interaction-only',
        language: 'pt-br',
        'refresh-expired': 'auto',
        'refresh-timeout': 'auto',
        retry: 'auto',
        'response-field': false,
        callback: (token: string) => { callbacks.current.onToken(token); callbacks.current.onStateChange('ready') },
        'expired-callback': () => { callbacks.current.onToken(null); callbacks.current.onStateChange('expired') },
        'timeout-callback': () => { callbacks.current.onToken(null); callbacks.current.onStateChange('verifying') },
        'error-callback': () => { callbacks.current.onToken(null); callbacks.current.onStateChange('error') },
      })
    }).catch(() => {
      if (!cancelled) { callbacks.current.onToken(null); callbacks.current.onStateChange('error') }
    })
    return () => {
      cancelled = true
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current)
      widgetId.current = null
    }
  }, [siteKey, action])

  useEffect(() => {
    if (resetSignal === 0 || !widgetId.current || !window.turnstile) return
    callbacks.current.onToken(null)
    callbacks.current.onStateChange('verifying')
    window.turnstile.reset(widgetId.current)
  }, [resetSignal])

  return <div className="booking-turnstile" ref={container} />
}
