'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { usePathname } from 'next/navigation'
import { useLevi } from './levi-provider'
import { EASE_OUT, scrollToId } from '@/lib/scroll'

type Message = {
  id: number
  role: 'bot' | 'user'
  text: string
  target?: string
}

const GREETING: Message = {
  id: 0,
  role: 'bot',
  text: 'Olá! Sou o Levi. Posso explicar o que a Cassiellos faz, apresentar nossos serviços ou levar você para a área certa do site.',
}

const QUICK = [
  { query: 'serviços', label: 'Como vocês atuam?' },
  { query: 'método', label: 'Conhecer o método' },
  { query: 'contato', label: 'Falar com a equipe' },
] as const

/** Mesma árvore de respostas do site original. */
function reply(question: string, english = false): [string, string | undefined] {
  const q = question.toLowerCase()
  if (q.includes('servi'))
    return [english ? 'We connect strategic direction, creative in motion and continuous operations.' : 'Conectamos direção estratégica, criação em movimento e operação contínua.', '#atuacao']
  if (q.includes('método') || q.includes('metodo') || q.includes('processo') || q.includes('method'))
    return [english ? 'Our method connects diagnosis, direction, production, approval and learning.' : 'Nosso método conecta diagnóstico, direção, produção, aprovação e aprendizado.', '#metodo']
  if (q.includes('levi'))
    return [
      english ? 'I am the cassiellOS conversational interface. Here, I answer questions and help you navigate.' : 'Sou a interface conversacional do cassiellOS. Aqui, respondo dúvidas e ajudo na navegação.',
      '#levi',
    ]
  if (q.includes('contato') || q.includes('falar') || q.includes('contact') || q.includes('talk'))
    return [english ? "I'll take you to our team contact." : 'Vou levar você para o contato da equipe.', '#contato']
  return [
    english ? 'I can help with our expertise, method, Levi or contact.' : 'Posso ajudar com nossa atuação, método, Levi ou contato.',
    undefined,
  ]
}

export default function LeviWidget() {
  const english = usePathname().startsWith('/en')
  const { open, openChat, closeChat } = useLevi()
  const reduced = useReducedMotion()

  const [messages, setMessages] = useState<Message[]>([english ? { ...GREETING, text: "Hi! I'm Levi. I can explain what Cassiellos does, introduce our services or take you to the right area of the site." } : GREETING])
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')

  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const nextId = useRef(1)

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

  const send = (value: string) => {
    const text = value.trim()
    if (!text) return

    setMessages((current) => [...current, { id: nextId.current++, role: 'user', text }])
    setTyping(true)

    const [answer, target] = reply(text, english)
    setTimeout(() => {
      setTyping(false)
      setMessages((current) => [
        ...current,
        { id: nextId.current++, role: 'bot', text: answer, target },
      ])
    }, 520)
  }

  const onSubmit = (event: FormEvent) => {
    event.preventDefault()
    send(draft)
    setDraft('')
  }

  const go = (target: string) => {
    closeChat()
    setTimeout(() => scrollToId(target), 120)
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
            aria-label={english ? 'Levi assistant' : 'Assistente Levi'}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 18, scale: 0.96 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 14, scale: 0.97 }}
            transition={{ duration: 0.36, ease: EASE_OUT }}
          >
            <header className="chatHead">
              <div className="lid">
                <i className="miniOrb" />
                <div>
                  <b>Levi</b>
                  <small>{english ? 'Cassiellos assistant' : 'Assistente da Cassiellos'}</small>
                </div>
              </div>
              <button className="close" onClick={closeChat} aria-label={english ? 'Close Levi' : 'Fechar Levi'}>
                ×
              </button>
            </header>

            <div className="messages" ref={listRef} aria-live="polite" data-lenis-prevent>
              {messages.map((message) => (
                <motion.div
                  key={message.id}
                  className={`bubble ${message.role === 'bot' ? 'bot' : 'user'}${
                    message.target ? ' bubbleLink' : ''
                  }`}
                  initial={reduced ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: EASE_OUT }}
                  onClick={message.target ? () => go(message.target as string) : undefined}
                >
                  {message.text}
                </motion.div>
              ))}

              {typing && (
                <div className="bubble bot">
                  <span className="typing" aria-label={english ? 'Levi is typing' : 'Levi está digitando'}>
                    <i />
                    <i />
                    <i />
                  </span>
                </div>
              )}

              <div className="quick">
                {(english ? [{ query: 'services', label: 'How do you work?' }, { query: 'method', label: 'Explore the method' }, { query: 'contact', label: 'Talk to the team' }] : QUICK).map((item) => (
                  <button key={item.query} onClick={() => send(item.query)} type="button">
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <form className="form" onSubmit={onSubmit}>
              <input
                ref={inputRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={english ? 'Type your question…' : 'Digite sua dúvida…'}
                autoComplete="off"
                aria-label={english ? 'Message to Levi' : 'Mensagem para o Levi'}
              />
              <button type="submit" aria-label={english ? 'Send' : 'Enviar'}>
                ↑
              </button>
            </form>
          </motion.section>
        )}
      </AnimatePresence>
    </>
  )
}
