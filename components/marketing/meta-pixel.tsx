'use client'

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { isMetaTrackedPath } from '@/lib/marketing/meta'
import { clearMetaCookies } from '@/lib/marketing/meta-client'
import { CONSENT_CHANGE_EVENT, marketingAllowed } from '@/lib/privacy/consent-client'

/**
 * Meta Pixel do funil de agendamento (montado só na página /agendar).
 * - pixelId nulo (META_PIXEL_ENABLED desligado) → nada é renderizado nem carregado.
 * - Só nas páginas públicas do funil (isMetaTrackedPath); nunca no painel do CRM nem no site institucional.
 * - Sem consentimento de MARKETING (lib/privacy, Etapa 3) → sem script, sem cookies da Meta.
 * - Script e init uma única vez; PageView uma vez por página (mudar a escolha não repete o PageView).
 * - Revogação: `consent revoke` na hora (a Meta descarta novas chamadas) e remoção de _fbp/_fbc.
 * - Correspondência avançada e eventos automáticos desligados: nenhum dado do formulário é lido pelo Pixel.
 */

const SCRIPT_ID = 'meta-pixel-base'
const SCRIPT_SRC = 'https://connect.facebook.net/en_US/fbevents.js'
let initializedPixel: string | null = null
let lastPageView: string | null = null

function loadPixel(pixelId: string) {
  if (typeof window.fbq !== 'function') {
    // Fila oficial do código-base da Meta, sem <script> inline nem eval.
    const queue: unknown[] = []
    const fbq = ((...args: unknown[]) => {
      if (fbq.callMethod) fbq.callMethod(...args)
      else queue.push(args)
    }) as NonNullable<Window['fbq']> & { push?: unknown; loaded?: boolean; version?: string }
    fbq.queue = queue
    fbq.push = fbq
    fbq.loaded = true
    fbq.version = '2.0'
    window.fbq = fbq
    if (!window._fbq) window._fbq = fbq
  }
  if (!document.getElementById(SCRIPT_ID)) {
    const script = document.createElement('script')
    script.id = SCRIPT_ID
    script.async = true
    script.src = SCRIPT_SRC
    document.head.appendChild(script)
  }
  window.fbq!('consent', 'grant')
  if (initializedPixel === pixelId) return
  window.fbq!('set', 'autoConfig', false, pixelId)
  window.fbq!('init', pixelId)
  initializedPixel = pixelId
}

export default function MetaPixel({ pixelId }: { pixelId: string | null }) {
  const pathname = usePathname()
  const tracked = Boolean(pixelId) && isMetaTrackedPath(pathname)
  const [granted, setGranted] = useState(false)

  useEffect(() => {
    if (!tracked) return
    const sync = () => {
      const allowed = marketingAllowed()
      if (!allowed && typeof window.fbq === 'function') {
        window.fbq('consent', 'revoke')
        clearMetaCookies()
      }
      setGranted(allowed)
    }
    sync()
    window.addEventListener(CONSENT_CHANGE_EVENT, sync)
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, sync)
  }, [tracked])

  useEffect(() => {
    if (!tracked || !pixelId || !granted) return
    loadPixel(pixelId)
    const key = pathname || ''
    if (lastPageView !== key) {
      lastPageView = key
      window.fbq?.('track', 'PageView')
    }
  }, [tracked, pixelId, granted, pathname])

  return null
}
