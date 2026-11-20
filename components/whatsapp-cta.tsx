'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { WHATSAPP_CONTACT_URL } from '@/lib/site-links'
import styles from './whatsapp-cta.module.css'

/** Ícone simplificado do WhatsApp (balão com telefone). */
export function WhatsappIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3a.5.5 0 0 0 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.4.8 3.2.6a2.8 2.8 0 0 0 1.8-1.3 2.3 2.3 0 0 0 .2-1.3c-.1-.1-.3-.2-.6-.3Z" />
    </svg>
  )
}

type Props = {
  /** Nome curto da seção, enviado à medição (data-cta-section). */
  section: string
  label: string
  variant?: 'solid' | 'ghost'
  className?: string
}

/** Botão para o WhatsApp da Cassiellos, presente em todas as seções. */
export default function WhatsappCta({ section, label, variant = 'solid', className }: Props) {
  return (
    <a
      className={`btn ${variant === 'ghost' ? 'ghost' : ''} ${styles.cta} ${className ?? ''}`}
      href={WHATSAPP_CONTACT_URL}
      target="_blank"
      rel="noopener noreferrer"
      data-cta-section={section}
    >
      <WhatsappIcon className={styles.icon} />
      {label}
    </a>
  )
}

/** Botão flutuante do WhatsApp, fixo no canto da tela em todas as páginas do site. */
export function WhatsappFloat() {
  const pathname = usePathname()
  const english = pathname.startsWith('/en')
  const label = english ? 'Chat on WhatsApp' : 'Fale no WhatsApp'
  // Some enquanto o formulário de contato estiver na tela, para não cobrir os botões dele.
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    const form = document.getElementById('contato')
    if (!form) {
      setHidden(false)
      return
    }
    const observer = new IntersectionObserver(([entry]) => setHidden(entry.isIntersecting), { threshold: 0.05 })
    observer.observe(form)
    return () => observer.disconnect()
  }, [pathname])
  return (
    <a
      className={`${styles.float} ${hidden ? styles.floatHidden : ''}`}
      aria-hidden={hidden}
      tabIndex={hidden ? -1 : undefined}
      href={WHATSAPP_CONTACT_URL}
      target="_blank"
      rel="noopener noreferrer"
      data-cta-section="flutuante"
      aria-label={label}
    >
      <WhatsappIcon className={styles.floatIcon} />
      <span>{label}</span>
    </a>
  )
}
