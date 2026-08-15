'use client'

import { useEffect } from 'react'
import Lenis from 'lenis'
import { registerLenis, scrollToId } from '@/lib/scroll'

/**
 * Rolagem suave global (Lenis) + interceptação de âncoras internas.
 * Desliga por completo quando o sistema pede movimento reduzido.
 */
export default function SmoothScroll() {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let lenis: Lenis | null = null
    let frame = 0

    if (!reduced) {
      lenis = new Lenis({
        duration: 1.15,
        easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
        smoothWheel: true,
        touchMultiplier: 1.7,
        wheelMultiplier: 1,
      })
      registerLenis(lenis)

      const loop = (time: number) => {
        lenis?.raf(time)
        frame = requestAnimationFrame(loop)
      }
      frame = requestAnimationFrame(loop)
    }

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey) return
      const anchor = (event.target as HTMLElement | null)?.closest?.('a[href^="#"]')
      if (!anchor) return

      const href = anchor.getAttribute('href')
      if (!href || href === '#') return

      const target = document.querySelector(href)
      if (!target) return

      event.preventDefault()
      scrollToId(href)
      history.replaceState(null, '', href)
    }

    document.addEventListener('click', onClick)

    return () => {
      document.removeEventListener('click', onClick)
      cancelAnimationFrame(frame)
      lenis?.destroy()
      registerLenis(null)
    }
  }, [])

  return null
}
