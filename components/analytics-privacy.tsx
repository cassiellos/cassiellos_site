'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Analytics } from '@vercel/analytics/next'
import { SpeedInsights } from '@vercel/speed-insights/next'
import { requiresAnalyticsConsent } from '@/lib/privacy/analytics-policy'
import { CONSENT_CHANGE_EVENT, analyticsAllowed } from '@/lib/privacy/consent-client'
import { speedInsightsBeforeSend, vercelBeforeSend } from '@/lib/privacy/vercel-client'

/**
 * Vercel Analytics e Speed Insights com a política de privacidade por escopo (lib/privacy):
 * - site institucional: comportamento atual (sem mudança);
 * - escopo do CRM: o script NÃO é carregado sem consentimento; com consentimento, URLs minimizadas
 *   (sem gclid/fbclid). O beforeSend relê o consentimento a cada evento, então a revogação interrompe
 *   novas coletas mesmo com o script já carregado.
 */
export default function AnalyticsPrivacy() {
  const pathname = usePathname() || '/'
  const [consented, setConsented] = useState(false)

  useEffect(() => {
    const sync = () => setConsented(analyticsAllowed())
    sync()
    window.addEventListener(CONSENT_CHANGE_EVENT, sync)
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, sync)
  }, [])

  if (requiresAnalyticsConsent(pathname) && !consented) return null
  return <>
    <Analytics beforeSend={vercelBeforeSend} />
    <SpeedInsights beforeSend={speedInsightsBeforeSend} />
  </>
}
