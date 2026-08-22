'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { usePathname } from 'next/navigation'
import { useLevi } from './levi-provider'
import { EASE_OUT } from '@/lib/scroll'
import type { LeviAIResponse } from '@/lib/levi-architecture'

type LeviPayload = LeviAIResponse & {
  mode: 'SUGGESTION'
  source: string
  toolsUsed: []
}

type Message = {
  id: number
  role: 'bot' | 'user'
  text: string
  diagnosis?: LeviPayload
}

const WHATSAPP =
  'https://wa.me/5531982988766?text=Ol%C3%A1!%20Fiz%20um%20pr%C3%A9-diagn%C3%B3stico%20com%20o%20Levi%20no%20site%20e%20quero%20conversar%20com%20a%20equipe%20Cassiellos.'

function greeting(english: boolean): Message {
  return {
    id: 0,
    role: 'bot',
    text: english
      ? "Hi, I'm Levi. I can conduct a free, no-obligation pre-diagnosis of your marketing, communication and operations. It takes just a few guided questions."
      : 'Olá, sou o Levi. Posso fazer um pré-diagnóstico gratuito e sem compromisso do seu marketing, comunicação e operação. São apenas algumas perguntas guiadas.',
  }
}

function initialReplies(english: boolean) {
  return english
    ? ['Start my pre-diagnosis', 'How does it work?', 'Talk to the team']
    : ['Começar meu pré-diagnóstico', 'Como funciona?', 'Falar com a equipe']
}

function sessionId() {
  const key = 'cassiellos-levi-session-v1'
  const current = window.localStorage.getItem(key)
  if (current && /^[a-zA-Z0-9_-]{8,72}$/.test(current)) return current
  const created = `levi_${crypto.randomUUID().replaceAll('-', '')}`
  window.localStorage.setItem(key, created)
  return created
}

function DiagnosisCard({ data, english }: { data: LeviPayload; english: boolean }) {
  const confidence = {
    LOW: english ? 'Initial' : 'Inicial',
    MEDIUM: english ? 'Useful' : 'Útil',
    HIGH: english ? 'Well supported' : 'Bem fundamentada',
  }[data.confidence]

  return (
    <div className="diagnosisCard">
      <div className="diagnosisTop">
        <span>{english ? 'Pre-diagnosis' : 'Pré-diagnóstico'}</span>
        <small>{confidence}</small>
      </div>

      {data.summary && <p className="diagnosisSummary">{data.summary}</p>}

      {data.findings.length > 0 && (
        <div className="diagnosisBlock">
          <b>{english ? 'Likely bottlenecks' : 'Gargalos prováveis'}</b>
          <ul>{data.findings.map((item) => <li key={item}>{item}</li>)}</ul>
        </div>
      )}

      {data.priorities.length > 0 && (
        <div className="diagnosisBlock">
          <b>{english ? 'Suggested priorities' : 'Prioridades sugeridas'}</b>
          <ol>{data.priorities.map((item) => <li key={item}>{item}</li>)}</ol>
        </div>
      )}

      {data.pending.length > 0 && (
        <div className="diagnosisPending">
          <b>{english ? 'What still needs validation' : 'O que ainda precisa ser validado'}</b>
          <span>{data.pending.join(' · ')}</span>
        </div>
      )}

      <div className="diagnosisMeta">
        <span>{english ? 'Mode: suggestion' : 'Modo: sugestão'}</span>
        <span>{english ? 'No internal access' : 'Sem acesso interno'}</span>
        <span>{english ? 'Source: Volume 07 v1.0' : 'Fonte: Volume 07 v1.0'}</span>
      </div>
    </div>
  )
}

export default function LeviWidget() {
  const english = usePathname().startsWith('/en')
  const { open, openChat, closeChat } = useLevi()
  const reduced = useReducedMotion()

  const [messages, setMessages] = useState<Message[]>(() => [greeting(english)])
  const [quickReplies, setQuickReplies] = useState<string[]>(() => initialReplies(english))
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const nextId = useRef(1)

  const labels = {
    title: english ? 'Free pre-diagnosis' : 'Pré-diagnóstico gratuito',
    subtitle: english ? 'Public Levi · suggestion mode' : 'Levi público · modo sugestão',
    placeholder: english ? 'Tell me about your company…' : 'Conte sobre sua empresa…',
    unavailable: english
      ? 'Levi is temporarily unavailable. You can still talk directly to our team.'
      : 'O Levi está temporariamente indisponível. Você ainda pode conversar diretamente com a nossa equipe.',
  }

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => inputRef.current?.focus(), 80)
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeChat()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, closeChat])

  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [messages, typing])

  const send = async (value: string) => {
    const text = value.trim()
    if (!text || typing) return

    const userMessage: Message = { id: nextId.current++, role: 'user', text }
    const conversation = [...messages, userMessage]
    setMessages(conversation)
    setDraft('')
    setQuickReplies([])
    setTyping(true)

    try {
      const response = await fetch('/api/levi', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          locale: english ? 'en' : 'pt',
          sessionId: sessionId(),
          messages: conversation.slice(-12).map((message) => ({
            role: message.role === 'bot' ? 'assistant' : 'user',
            content: message.text,
          })),
        }),
      })

      const result = await response.json()
      if (!response.ok) throw new Error('levi_unavailable')

      const payload = result as LeviPayload
      setMessages((current) => [
        ...current,
        {
          id: nextId.current++,
          role: 'bot',
          text: payload.answer,
          diagnosis: payload.stage === 'PRE_DIAGNOSIS' || payload.stage === 'HANDOFF' ? payload : undefined,
        },
      ])
      setQuickReplies(payload.quickReplies)
    } catch {
      setMessages((current) => [
        ...current,
        { id: nextId.current++, role: 'bot', text: labels.unavailable },
      ])
      setQuickReplies([english ? 'Talk to the team' : 'Falar com a equipe'])
    } finally {
      setTyping(false)
    }
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    void send(draft)
  }

  const restart = () => {
    setMessages([greeting(english)])
    setQuickReplies(initialReplies(english))
    setDraft('')
    nextId.current = 1
  }

  return (
    <>
      <button className="launcher" aria-label={english ? 'Open Levi' : 'Abrir Levi'} aria-expanded={open} onClick={openChat}>
        <i className="lr a" />
        <i className="lr b" />
        <i className="lc" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.section
            className="chat"
            aria-label={english ? 'Levi pre-diagnosis' : 'Pré-diagnóstico com o Levi'}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.96 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.97 }}
            transition={{ duration: 0.36, ease: EASE_OUT }}
          >
            <header className="chatHead">
              <div className="lid">
                <i className="miniOrb" />
                <div>
                  <b>Levi <small>by CASSIELLOS</small></b>
                  <span>{labels.title}</span>
                </div>
              </div>
              <div className="chatHeadActions">
                <button className="restart" onClick={restart} aria-label={english ? 'Restart' : 'Recomeçar'} title={english ? 'Restart' : 'Recomeçar'}>↻</button>
                <button className="close" onClick={closeChat} aria-label={english ? 'Close Levi' : 'Fechar Levi'}>×</button>
              </div>
            </header>

            <div className="leviMode"><i />{labels.subtitle}</div>

            <div className="messages" ref={listRef} aria-live="polite" data-lenis-prevent>
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  className={`messageWrap ${message.role}`}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: EASE_OUT }}
                >
                  <div className={`bubble ${message.role}`}>{message.text}</div>
                  {message.diagnosis && <DiagnosisCard data={message.diagnosis} english={english} />}
                </motion.div>
              ))}

              {typing && (
                <div className="messageWrap bot">
                  <div className="bubble bot">
                    <span className="typing" aria-label={english ? 'Levi is analyzing' : 'Levi está analisando'}>
                      <i /><i /><i />
                    </span>
                  </div>
                </div>
              )}

              {!typing && quickReplies.length > 0 && (
                <div className="quick">
                  {quickReplies.map((label) => {
                    const isHandoff = /equipe|team/i.test(label)
                    return isHandoff ? (
                      <a key={label} href={WHATSAPP} target="_blank" rel="noopener noreferrer">{label}</a>
                    ) : (
                      <button key={label} onClick={() => void send(label)} type="button">{label}</button>
                    )
                  })}
                </div>
              )}
            </div>

            <form className="form" onSubmit={onSubmit}>
              <input
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value.slice(0, 800))}
                placeholder={labels.placeholder}
                autoComplete="off"
                aria-label={english ? 'Message to Levi' : 'Mensagem para o Levi'}
                disabled={typing}
              />
              <button type="submit" aria-label={english ? 'Send' : 'Enviar'} disabled={typing || !draft.trim()}>↑</button>
            </form>
            <footer className="chatPrivacy">
              {english ? 'Do not share passwords or sensitive data.' : 'Não compartilhe senhas ou dados sensíveis.'}
            </footer>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  )
}
