'use client'

import InfinityMark from './infinity-mark'
import { usePathname } from 'next/navigation'

export default function SiteFooter() {
  const english = usePathname().startsWith('/en')
  return (
    <footer className="foot">
      <div className="wrap footin">
        <div className="footerBrand"><InfinityMark className="footerMark" /><strong>Cassiellos</strong></div>
        <nav className="footerLegal" aria-label={english ? 'Policies and terms' : 'Políticas e termos'}>
          <a href="/politica-de-privacidade">{english ? 'Privacy' : 'Privacidade'}</a>
          <a href="/termos-de-uso">{english ? 'Terms of Use' : 'Termos de Uso'}</a>
          <a href="/politica-de-cookies">Cookies</a>
        </nav>
        <div className="footerMeta">
          <span>{english ? 'Creative operations' : 'Operações criativas'} · Belo Horizonte / MG</span>
          <span>© 2026</span>
        </div>
      </div>
    </footer>
  )
}
