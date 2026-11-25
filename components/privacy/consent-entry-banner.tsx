'use client'

import { useEffect, useRef, useState } from 'react'
import type { ConsentState } from '@/lib/privacy/consent'
import { CONSENT_CHANGE_EVENT, getConsent, setConsentChoices } from '@/lib/privacy/consent-client'
import { entryConsentChoices, entryConsentPending, type EntryConsentAction } from '@/lib/privacy/consent-entry'
import ConsentNotice from './consent-notice'

/**
 * Primeira camada do consentimento do formulário público (/formularios): aparece na primeira visita, em formato compacto
 * (uma faixa baixa, sem título), com dois botões de mesmo peso — "Recusar" e "Aceitar métricas" — e um link de preferências. Nada é pré-selecionado e nada é gravado sem clique.
 *
 * - Não bloqueia: não é um modal, não rouba o foco e não cobre o formulário de forma permanente (fica "grudado" no fim
 *   da tela e, ao rolar até o fim, assume seu lugar normal depois do rodapé). O formulário funciona com qualquer escolha.
 * - Métricas e marketing são separados: "Aceitar métricas" nunca liga marketing. Marketing (Meta Pixel e API de Conversões,
 *   quando existirem na página) só é decidido nas preferências de cookies, acessíveis pelo aviso ou pelo rodapé.
 * - O link de preferências abre o aviso detalhado (uma categoria por vez).
 * - Depois de decidido nunca reabre sozinho; as preferências podem ser alteradas ou revogadas no rodapé, com efeito imediato.
 * - Texto proposto, sujeito à aprovação jurídica (o aviso detalhado e as políticas continuam sendo os textos aprovados).
 */
export default function ConsentEntryBanner({ marketingEnabled = false, suppressed = false }: { marketingEnabled?: boolean; suppressed?: boolean }) {
  const [consent, setConsent] = useState<ConsentState | null | undefined>(undefined)
  const [customizing, setCustomizing] = useState(false)
  const noticeRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const sync = () => setConsent(getConsent())
    sync()
    window.addEventListener(CONSENT_CHANGE_EVENT, sync)
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, sync)
  }, [])

  // Reserva o espaço do aviso na altura mínima das telas do formulário enquanto ele está visível, para que ele nunca
  // cubra o botão da capa nem as respostas. Só mede e publica uma variável de CSS; nada é lido, gravado ou enviado.
  useEffect(() => {
    const notice = noticeRef.current
    const root = notice?.closest<HTMLElement>('.cassiellos-public-flow')
    if (!notice || !root) return
    const apply = () => root.style.setProperty('--cpf-entry-notice-h', `${Math.ceil(notice.getBoundingClientRect().height) + 8}px`)
    apply()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(apply)
    observer?.observe(notice)
    return () => { observer?.disconnect(); root.style.removeProperty('--cpf-entry-notice-h') }
  }, [consent, customizing, suppressed])

  // `undefined` = ainda não leu o cookie (render do servidor/hidratação): nada aparece, sem salto de layout.
  if (suppressed || consent === undefined) return null

  // Nas preferências o aviso detalhado é quem decide quando fechar (só depois de métricas E marketing decididos, ou
  // só de métricas quando a página não tem Meta Pixel): decidir métricas primeiro não pode fazer o painel sumir antes
  // de o visitante ver a escolha de marketing.
  if (customizing) {
    return <div className="cpf-entry-consent" data-consent-ui="" data-consent-layer="details">
      <ConsentNotice marketingEnabled={marketingEnabled} />
    </div>
  }

  if (!entryConsentPending(consent)) return null

  const choose = (action: EntryConsentAction) => setConsentChoices(entryConsentChoices(action, marketingEnabled))

  return <section ref={noticeRef} className="cpf-entry-consent" role="region" aria-label="Privacidade nesta página" data-consent-ui="" data-consent-layer="entry">
    <div className="cpf-entry-consent-text">
      <p>
        Usamos cookies opcionais de métricas para melhorar este formulário
        {marketingEnabled ? '; marketing só se você autorizar nas preferências' : ''}.
        {' '}Recusar não impede o formulário nem o agendamento.{' '}
        <a href="/politica-de-cookies" target="_blank" rel="noopener noreferrer">Cookies</a>
        {' · '}
        <a href="/politica-de-privacidade" target="_blank" rel="noopener noreferrer">Privacidade</a>
        {' · '}
        <button type="button" className="cpf-entry-preferences-link" data-choice="customize" onClick={() => setCustomizing(true)}>Preferências de cookies</button>
      </p>
    </div>
    <div className="cpf-entry-consent-actions">
      <button type="button" className="cpf-entry-choice" data-choice="reject" onClick={() => choose('reject')}>Recusar</button>
      <button type="button" className="cpf-entry-choice" data-choice="metrics" onClick={() => choose('accept-metrics')}>Aceitar métricas</button>
    </div>
  </section>
}
