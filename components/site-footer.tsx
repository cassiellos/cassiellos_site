'use client'

import { usePathname } from 'next/navigation'
import { displayFont } from '@/lib/display-font'
import { SHOW_PLACEHOLDERS, SOCIALS } from '@/lib/home-proof'
import { WHATSAPP_CONTACT_URL } from '@/lib/site-links'
import styles from './site-footer.module.css'

const WORDMARK = 'CASSIELLOS'
const DEPTH = 9

export default function SiteFooter() {
  const pathname = usePathname()
  const english = pathname.startsWith('/en')
  const home = english ? '/en' : '/'
  const socials = SOCIALS.filter((item) => item.href)

  return (
    <footer className={`foot ${styles.footer} ${displayFont.variable}`}>
      <div className={`wrap ${styles.top}`}>
        <div className={styles.brandCol}>
          <div className={styles.brand}>
            <img src="/brand/cassiellos-symbol-signal-red.svg" alt="" aria-hidden="true" width="36" height="18" />
            <strong>Cassiellos</strong>
          </div>
          <p>{english ? 'Strategy, creative and operations for companies that want to grow with organized marketing.' : 'Estratégia, criação e operação para empresas que querem crescer com marketing organizado.'}</p>
          <a className="btn" href={WHATSAPP_CONTACT_URL} target="_blank" rel="noopener noreferrer">
            {english ? 'Talk to Cassiellos' : 'Fale com a Cassiellos'}
          </a>
        </div>

        <nav className={styles.col} aria-label={english ? 'Site' : 'Site'}>
          <span>{english ? 'Navigate' : 'Navegue'}</span>
          <a href={`${home}#servicos`}>{english ? 'Services' : 'Serviços'}</a>
          <a href={`${home}#como-funciona`}>{english ? 'How it works' : 'Como funciona'}</a>
          <a href={`${home}#clientes`}>{english ? 'Clients' : 'Clientes'}</a>
          <a href={english ? '/en/sobre' : '/sobre'}>{english ? 'Company' : 'A Empresa'}</a>
        </nav>

        <div className={styles.col}>
          <span>{english ? 'Contact' : 'Contato'}</span>
          <a href={WHATSAPP_CONTACT_URL} target="_blank" rel="noopener noreferrer">WhatsApp</a>
          <a href={`${home}#contato`}>{english ? 'Pre-diagnostic' : 'Pré-diagnóstico'}</a>
          <p>Belo Horizonte / MG</p>
        </div>

        <div className={styles.col}>
          <span>{english ? 'Social' : 'Redes'}</span>
          {socials.map((item) => (
            <a key={item.name} href={item.href ?? undefined} target="_blank" rel="noopener noreferrer">{item.name}</a>
          ))}
          {socials.length === 0 && SHOW_PLACEHOLDERS && (
            <p className={styles.todo}>{english ? 'To be filled: official social links (Instagram, LinkedIn…).' : 'A preencher: links oficiais das redes (Instagram, LinkedIn…).'}</p>
          )}
        </div>
      </div>

      <div className={styles.stage} aria-hidden="true">
        <div className={styles.wordmark}>
          {WORDMARK.split('').map((letter, index) => (
            <span className={styles.block} key={index} style={{ ['--i' as string]: index }}>
              {Array.from({ length: DEPTH }, (_, layer) => (
                <i key={layer} className={layer === DEPTH - 1 ? styles.face : styles.side} style={{ ['--z' as string]: layer }}>{letter}</i>
              ))}
            </span>
          ))}
        </div>
      </div>
      <p className={styles.srOnly}>Cassiellos</p>

      <div className={`wrap ${styles.bottom}`}>
        <span>{english ? 'Creative operations' : 'Operações criativas'} · Belo Horizonte / MG · © 2026 Cassiellos</span>
        <nav aria-label={english ? 'Policies and terms' : 'Políticas e termos'}>
          <a href="/politica-de-privacidade">{english ? 'Privacy' : 'Privacidade'}</a>
          <a href="/termos-de-uso">{english ? 'Terms of Use' : 'Termos de Uso'}</a>
          <a href="/politica-de-cookies">Cookies</a>
        </nav>
      </div>
    </footer>
  )
}
