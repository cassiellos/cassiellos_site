'use client'

import { Analytics, type BeforeSendEvent } from '@vercel/analytics/next'
import { stripFunnelClickId } from '@/lib/marketing/meta'

/**
 * Vercel Web Analytics com redução de dados (decisão G2): nas páginas do funil de agendamento,
 * o identificador de clique da Meta (fbclid) é retirado da URL antes do envio do evento.
 * Nas demais páginas o comportamento não muda.
 */
function beforeSend(event: BeforeSendEvent): BeforeSendEvent {
  const url = stripFunnelClickId(event.url)
  return url === event.url ? event : { ...event, url }
}

export default function PrivacyAnalytics() {
  return <Analytics beforeSend={beforeSend} />
}
