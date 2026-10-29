'use client'

import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { isMetaTrackedPath } from '@/lib/marketing/meta'
import {
  CONSENT_CHANGE_EVENT, CONSENT_OPEN_EVENT, CONSENT_SLOT_ID, clearMetaCookies, getConsent, setConsent,
} from '@/lib/marketing/meta-client'
import styles from './consent-banner.module.css'

/**
 * Ponto ÚNICO de instalação do Meta Pixel (montado no layout raiz).
 * - pixelId nulo (chave desligada) → nada é renderizado nem carregado.
 * - Só nas páginas públicas do funil (isMetaTrackedPath); nunca no CRM.
 * - Script e init uma única vez; PageView uma vez por página visitada.
 * - Sem consentimento de marketing → sem script, sem cookies da Meta.
 * - Correspondência avançada e eventos automáticos desligados.
 * - Aviso de cookies: sem opção pré-selecionada, "Recusar" e "Aceitar" com o mesmo destaque,
 *   exibido no FLUXO da página (ponto CONSENT_SLOT_ID), nunca por cima dos campos do formulário.
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
  const [slot, setSlot] = useState<HTMLElement | null>(null)
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

  // The booking page renders the slot; without it the notice falls back to a floating card.
  useEffect(() => {
    setSlot(tracked ? document.getElementById(CONSENT_SLOT_ID) : null)
  }, [tracked, pathname])

  // Reopened from "Preferências de cookies" (footer): bring the notice into view and focus it.
  useEffect(() => {
    if (!open || !bannerRef.current) return
    bannerRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' })
    bannerRef.current.querySelector('button')?.focus({ preventScroll: true })
  }, [open, slot])

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
  const banner = <div ref={bannerRef} className={slot ? styles.banner : styles.banner + ' ' + styles.floating}
    role="region" aria-label="Preferências de cookies">
    <p className={styles.text} id="cassiellos-consent-text">
      <strong>Cookies de marketing.</strong> Com a sua autorização, usaremos o Meta Pixel, da Meta, para medir
      e otimizar nossos anúncios; a Meta receberá identificadores do seu navegador. O formulário e o
      agendamento funcionam com qualquer escolha.{' '}
      <a href="/politica-de-cookies" target="_blank" rel="noopener noreferrer">Política de Cookies</a>
      {' · '}
      <a href="/politica-de-privacidade" target="_blank" rel="noopener noreferrer">Política de Privacidade</a>
    </p>
    {/* Same visual weight for both choices; nothing is pre-selected. */}
    <div className={styles.actions}>
      <button type="button" className={styles.choice} aria-describedby="cassiellos-consent-text"
        onClick={() => choose(false)}>Recusar</button>
      <button type="button" className={styles.choice} aria-describedby="cassiellos-consent-text"
        onClick={() => choose(true)}>Aceitar</button>
    </div>
  </div>
  return slot ? createPortal(banner, slot) : banner
}
