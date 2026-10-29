'use client'

import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { isMetaTrackedPath } from '@/lib/marketing/meta'
import {
  CONSENT_CHANGE_EVENT, CONSENT_OPEN_EVENT, clearMetaCookies, getConsent, setConsent,
} from '@/lib/marketing/meta-client'
import styles from './consent-banner.module.css'

/**
 * Ponto ÚNICO de instalação do Meta Pixel (montado no layout raiz).
 * - pixelId nulo (chave desligada) → nada é renderizado nem carregado.
 * - Só nas páginas públicas do funil (isMetaTrackedPath); nunca no CRM.
 * - Script e init uma única vez; PageView uma vez por página visitada.
 * - Sem consentimento de marketing → sem script, sem cookies da Meta.
 * - Correspondência avançada e eventos automáticos desligados.
 */

const SCRIPT_ID = 'meta-pixel-base'
const SCRIPT_SRC = 'https://connect.facebook.net/en_US/fbevents.js'
let initializedPixel: string | null = null
let lastPageView: string | null = null

function loadPixel(pixelId: string) {
  if (initializedPixel === pixelId && typeof window.fbq === 'function') return
  if (typeof window.fbq !== 'function') {
    // Official Meta base-code queue, without inline <script> or eval.
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
  window.fbq!('set', 'autoConfig', false, pixelId)
  window.fbq!('consent', 'grant')
  window.fbq!('init', pixelId)
  initializedPixel = pixelId
}

export default function MetaPixel({ pixelId }: { pixelId: string | null }) {
  const pathname = usePathname()
  const tracked = Boolean(pixelId) && isMetaTrackedPath(pathname)
  const [decided, setDecided] = useState<boolean | null>(null)
  const [granted, setGranted] = useState(false)
  const [open, setOpen] = useState(false)
  const bannerRef = useRef<HTMLDivElement>(null)

  const syncConsent = useCallback(() => {
    const consent = getConsent()
    setDecided(consent !== null)
    setGranted(consent?.marketing === true)
  }, [])

  useEffect(() => {
    syncConsent()
    const reopen = () => setOpen(true)
    window.addEventListener(CONSENT_CHANGE_EVENT, syncConsent)
    window.addEventListener(CONSENT_OPEN_EVENT, reopen)
    return () => {
      window.removeEventListener(CONSENT_CHANGE_EVENT, syncConsent)
      window.removeEventListener(CONSENT_OPEN_EVENT, reopen)
    }
  }, [syncConsent])

  useEffect(() => {
    if (!tracked || !pixelId || !granted) return
    loadPixel(pixelId)
    const key = pathname || ''
    if (lastPageView !== key) {
      lastPageView = key
      window.fbq?.('track', 'PageView')
    }
  }, [tracked, pixelId, granted, pathname])

  if (!tracked) return null
  const showBanner = open || decided === false

  function choose(marketing: boolean) {
    if (!marketing && typeof window.fbq === 'function') {
      window.fbq('consent', 'revoke')
      clearMetaCookies()
    }
    setConsent(marketing)
    setOpen(false)
  }

  if (!showBanner) return null
  return <div ref={bannerRef} className={styles.banner} role="dialog" aria-live="polite" aria-label="Preferências de cookies">
    <p className={styles.text}>
      Usamos cookies de marketing (Meta Pixel) para medir os resultados dos nossos anúncios.
      O agendamento funciona normalmente com qualquer escolha.{' '}
      <a href="/politica-de-cookies" target="_blank" rel="noopener noreferrer">Política de Cookies</a>
    </p>
    <div className={styles.actions}>
      <button type="button" className={styles.secondary} onClick={() => choose(false)}>Recusar</button>
      <button type="button" className={styles.primary} onClick={() => choose(true)}>Aceitar</button>
    </div>
  </div>
}
