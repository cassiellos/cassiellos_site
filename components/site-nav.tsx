'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import SiteControls from './site-controls'
import styles from './site-nav.module.css'
import { WHATSAPP_CONTACT_URL } from '@/lib/site-links'

const SECTION_LINKS = [
  { href: '#servicos', label: 'Serviços', en: 'Services' },
  { href: '#como-funciona', label: 'Como funciona', en: 'How it works' },
  { href: '#clientes', label: 'Clientes', en: 'Clients' },
  { href: '#cassiellos', label: 'cassiellOS', en: 'cassiellOS' },
  { href: '#levi', label: 'Levi', en: 'Levi' },
  { href: '#faq-title', label: 'FAQ', en: 'FAQ' },
] as const

type NavLink = {
  href: string
  label: string
  en: string
}

type NavGroup = {
  key: string
  label: string
  en: string
  primaryHref?: string
  links: NavLink[]
}

export default function SiteNav() {
  const pathname = usePathname()
  const english = pathname.startsWith('/en')
  const isHome = pathname === '/' || pathname === '/en'
  const homePrefix = english ? '/en/' : '/'
  const aboutHref = english ? '/en/sobre' : '/sobre'
  const resolveHref = (href: string) => (isHome ? href : `${homePrefix}${href}`)

  const groups: NavGroup[] = [
    {
      key: 'solutions',
      label: 'Soluções',
      en: 'Solutions',
      primaryHref: resolveHref('#servicos'),
      links: [SECTION_LINKS[0], SECTION_LINKS[1]].map((link) => ({ ...link, href: resolveHref(link.href) })),
    },
    {
      key: 'clients',
      label: 'Clientes',
      en: 'Clients',
      primaryHref: resolveHref('#clientes'),
      links: [{ ...SECTION_LINKS[2], href: resolveHref(SECTION_LINKS[2].href) }],
    },
    {
      key: 'technology',
      label: 'Tecnologia',
      en: 'Technology',
      primaryHref: resolveHref('#cassiellos'),
      links: [SECTION_LINKS[3], SECTION_LINKS[4]].map((link) => ({ ...link, href: resolveHref(link.href) })),
    },
    {
      key: 'company',
      label: 'Empresa',
      en: 'Company',
      primaryHref: aboutHref,
      links: [
        { href: aboutHref, label: 'A Empresa', en: 'Company' },
        { ...SECTION_LINKS[5], href: resolveHref(SECTION_LINKS[5].href) },
      ],
    },
  ]

  const [scrolled, setScrolled] = useState(false)
  const [active, setActive] = useState<string>('')
  const [mobileOpen, setMobileOpen] = useState(false)

  const labelFor = (item: { label: string; en: string }) => (english ? item.en : item.label)
  const isActive = (href: string) => active === href || (!isHome && href === pathname)
  const groupIsActive = (group: NavGroup) => group.links.some((link) => isActive(link.href))

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

  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  return (
    <header className="nav" data-scrolled={scrolled}>
      <div className="wrap navin">
        <a className="logo" href={isHome ? '#top' : english ? '/en' : '/'} aria-label="Cassiellos" onClick={() => setMobileOpen(false)}>
          <img src="/brand/cassiellos-symbol-signal-red.svg" alt="" aria-hidden="true" width="40" height="20" />
          <span>Cassiellos</span>
        </a>

        <nav className={styles.desktopMenu} aria-label={english ? 'Main navigation' : 'Navegação principal'}>
          {groups.map((group) => {
            if (group.links.length === 1) {
              const link = group.links[0]
              return (
                <a key={group.key} className={styles.directLink} href={link.href} data-active={isActive(link.href)}>
                  {labelFor(group)}
                </a>
              )
            }

            return (
              <div key={group.key} className={styles.group}>
                <a className={styles.groupTrigger} href={group.primaryHref} data-active={groupIsActive(group)}>
                  {labelFor(group)} <span className={styles.chevron} aria-hidden="true">⌄</span>
                </a>
                <div className={styles.dropdown}>
                  <small>{labelFor(group)}</small>
                  {group.links.map((link) => (
                    <a key={link.href} href={link.href} data-active={isActive(link.href)}>
                      {labelFor(link)}
                    </a>
                  ))}
                </div>
              </div>
            )
          })}
        </nav>

        <div className="desktopSiteControls"><SiteControls /></div>
        <a className="btn navCta" href={WHATSAPP_CONTACT_URL} target="_blank" rel="noopener noreferrer">
          {english ? 'Talk to Cassiellos' : 'Fale com a Cassiellos'}
        </a>

        <button
          type="button"
          className="mobileMenuToggle"
          aria-label={english ? 'Open navigation menu' : 'Abrir menu de navegação'}
          aria-controls="mobile-navigation"
          aria-expanded={mobileOpen}
          onClick={() => setMobileOpen((open) => !open)}
        >
          <span aria-hidden="true" />
          <span aria-hidden="true" />
          <span aria-hidden="true" />
        </button>
      </div>

      <div id="mobile-navigation" className="mobileNavPanel" data-open={mobileOpen} aria-hidden={!mobileOpen}>
        <div className={`${styles.mobileGroups} mobileNavLinks`} aria-label={english ? 'Mobile navigation' : 'Navegação mobile'}>
          {groups.map((group) => (
            <section key={`mobile-${group.key}`} className={styles.mobileGroup}>
              <span className={styles.mobileGroupTitle}>{labelFor(group)}</span>
              <div className={styles.mobileGroupLinks}>
                {group.links.map((link) => (
                  <a
                    key={`mobile-${link.href}`}
                    href={link.href}
                    data-active={isActive(link.href)}
                    onClick={() => setMobileOpen(false)}
                  >
                    {labelFor(link)}
                  </a>
                ))}
              </div>
            </section>
          ))}
        </div>
        <div className="mobileNavFooter">
          <SiteControls />
          <a className="btn" href={WHATSAPP_CONTACT_URL} target="_blank" rel="noopener noreferrer" onClick={() => setMobileOpen(false)}>
            {english ? 'Talk to Cassiellos' : 'Fale com a Cassiellos'}
          </a>
        </div>
      </div>
    </header>
  )
}
