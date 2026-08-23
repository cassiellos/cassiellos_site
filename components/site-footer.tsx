'use client'

import { usePathname } from 'next/navigation'

export default function SiteFooter() {
  const english = usePathname().startsWith('/en')
  return (
    <footer className="foot">
      <div className="wrap footin">
        <div className="footerIdentity">
          <div className="footerBrand">
            <img
              src="/brand/cassiellos-symbol-signal-red.svg"
              alt=""
              aria-hidden="true"
              width="36"
              height="18"
            />
            <strong>Cassiellos</strong>
          </div>
          <div className="footerMeta">
            <span>{english ? 'Creative operations' : 'Operações criativas'} · Belo Horizonte / MG · © 2026</span>
          </div>
        </div>
        <nav className="footerLegal" aria-label={english ? 'Policies and terms' : 'Políticas e termos'}>
          <a href="/politica-de-privacidade">{english ? 'Privacy' : 'Privacidade'}</a>
          <a href="/termos-de-uso">{english ? 'Terms of Use' : 'Termos de Uso'}</a>
          <a href="/politica-de-cookies">Cookies</a>
        </nav>
      </div>
    </footer>
  )
}
