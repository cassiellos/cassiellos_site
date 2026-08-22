'use client'

import { useEffect, useState } from 'react'
import InfinityMark from './infinity-mark'

const LINKS = [
  { href: '#servicos', label: 'Serviços' },
  { href: '#metodo', label: 'Método' },
  { href: '#levi', label: 'Levi' },
] as const

export default function SiteNav() {
  const [scrolled, setScrolled] = useState(false)
  const [active, setActive] = useState<string>('')

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Destaque do item correspondente à seção em tela.
  useEffect(() => {
    const sections = LINKS.map((link) => document.querySelector(link.href)).filter(
      (el): el is HTMLElement => el instanceof HTMLElement,
    )
    if (!sections.length) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0]
        if (visible?.target.id) setActive(`#${visible.target.id}`)
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: [0, 0.25, 0.5, 1] },
    )

    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [])

  return (
    <header className="nav" data-scrolled={scrolled}>
      <div className="wrap navin">
        <a className="logo" href="#top">
          <InfinityMark />
          Cassiellos
        </a>

        <nav aria-label="Navegação principal">
          {LINKS.map((link) => (
            <a key={link.href} href={link.href} data-active={active === link.href}>
              {link.label}
            </a>
          ))}
        </nav>

        <a className="btn" href="#contato">
          Agende um diagnóstico
        </a>
      </div>
    </header>
  )
}
