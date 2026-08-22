'use client'

import { useEffect } from 'react'

declare global {
  interface Window {
    CassiellosAnalytics?: { init: (options: { clientId: string; consent: 'granted' | 'denied' }) => unknown }
  }
}

const SCRIPT_ID = 'cassiellos-analyticsflow-sdk'

function iniciar() {
  /* O site ainda não possui CMP conectada. Sem consentimento explícito, o SDK opera cookieless:
     mede página, origem e interação, mas não cria visitor_id nem session_id. */
  window.CassiellosAnalytics?.init({ clientId: 'cassiellos-site', consent: 'denied' })
}

export default function AnalyticsFlow() {
  useEffect(() => {
    const existente = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null
    if (existente) {
      if (window.CassiellosAnalytics) iniciar()
      else existente.addEventListener('load', iniciar, { once: true })
      return
    }
    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.type = 'module'
    script.src = '/analyticsflow.js'
    script.addEventListener('load', iniciar, { once: true })
    document.head.appendChild(script)
  }, [])

  return null
}
