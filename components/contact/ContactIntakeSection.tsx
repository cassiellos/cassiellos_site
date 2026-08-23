'use client'

import ContactIntakeForm from './ContactIntakeForm'
import { WHATSAPP_CONTACT_URL } from '@/lib/site-links'
import styles from './contact-intake-section.module.css'

type Locale = 'pt' | 'en'

export default function ContactIntakeSection({ lang = 'pt' }: { lang?: Locale }) {
  const en = lang === 'en'
  return (
    <div className={styles.intakeMount}>
      <ContactIntakeForm lang={lang} />
      <aside className={styles.mobileWhatsapp} aria-label={en ? 'WhatsApp alternative' : 'Alternativa pelo WhatsApp'}>
        <div className="wrap">
          <span>{en ? 'Prefer to talk now?' : 'Prefere falar agora?'}</span>
          <a className="btn" href={WHATSAPP_CONTACT_URL} target="_blank" rel="noopener noreferrer">
            {en ? 'I want to organize my marketing' : 'Quero organizar meu marketing'}
          </a>
        </div>
      </aside>
    </div>
  )
}
