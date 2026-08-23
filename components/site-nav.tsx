'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import SiteControls from './site-controls'
import { WHATSAPP_CONTACT_URL } from '@/lib/site-links'

const SECTION_LINKS = [
  { href: '#servicos', label: 'Serviços' },
  { href: '#como-funciona', label: 'Como funciona' },
  { href: '#trabalhos', label: 'Trabalhos' },
  { href: '#levi', label: 'Levi' },
] as const

export default function SiteNav() {
  const pathname = usePathname()
  const english = pathname.startsWith('/en')
  const isHome = pathname === '/' || pathname === '/en'
  const aboutHref = english ? '/en/sobre' : '/sobre'
  const links = [
    ...SECTION_LINKS.map((link) => ({ ...link, href: isHome ? link.href : `${english ? '/en' : ''}/${link.href}` })),
    { href: aboutHref, label: english ? 'Company' : 'A Empresa' },
  ]
  const [scrolled, setScrolled] = useState(false)
  const [active, setActive] = useState<string>('')

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!isHome) return
    const sections = SECTION_LINKS.map((link) => document.querySelector(link.href)).filter(
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
  }, [isHome])

  return (
    <header className="nav" data-scrolled={scrolled}>
      <div className="wrap navin">
        <a className="logo" href={isHome ? '#top' : english ? '/en' : '/'} aria-label="Cassiellos">
          <img src="/brand/cassiellos-symbol-signal-red.svg" alt="" aria-hidden="true" width="40" height="20" />
          <span>Cassiellos</span>
        </a>

        <nav aria-label={english ? 'Main navigation' : 'Navegação principal'}>
          {links.map((link) => (
            <a key={link.href} href={link.href} data-active={active === link.href || (!isHome && link.href === pathname)}>
              {english
                ? ({ Serviços: 'Services', 'Como funciona': 'How it works', Trabalhos: 'Work', Levi: 'Levi', Company: 'Company' } as Record<string, string>)[link.label]
                : link.label}
            </a>
          ))}
        </nav>

        <SiteControls />
        <a className="btn navCta" href={WHATSAPP_CONTACT_URL} target="_blank" rel="noopener noreferrer">
          {english ? 'Talk to Cassiellos' : 'Fale com a Cassiellos'}
        </a>
      </div>
    </header>
  )
}
