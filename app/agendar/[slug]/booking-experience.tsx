'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { BookingForm } from '@/lib/crm/booking-forms'
import TurnstileWidget, { type TurnstileState } from './turnstile-widget'
import { buildIcs, googleCalendarTemplateUrl } from '@/lib/crm/calendar-links'
import { daysAhead, type FunnelEventName, type FunnelMode } from '@/lib/crm/funnel-events'
import { emitFunnel } from '@/lib/crm/funnel-client'
import { isTestEmailDomain } from '@/lib/crm/booking-mode'
import { CONSENT_CHANGE_EVENT } from '@/lib/privacy/consent-client'
import { sanitizeUtmValue, UTM_KEYS } from '@/lib/privacy/url-sanitize'
import ConsentNotice, { ConsentPreferencesButton } from '@/components/privacy/consent-notice'
import { readMarketingConsent, trackMetaConversion } from '@/lib/marketing/meta-client'
import MetaPixel from '@/components/marketing/meta-pixel'
import { nextPhoneInput, validateBrazilianPhone, validateEmailAddress } from '@/lib/crm/contact-validation'

type Slot = { startAt: string; endAt: string; localTime: string }
/** Reunião confirmada pelo servidor. O link fica nesta tela mesmo quando o convite do Google Agenda foi pedido. */
type Confirmation = {
  bookingRequestId: string; startAt: string; endAt: string; meetUrl: string | null; title: string
  /** O Google aceitou o evento com o lead como participante (convite PEDIDO; entrega/aceite não são conhecidos). */
  invitationRequested: boolean
  /** Estado real do backend: 'confirmed' = evento com link do Meet; 'link_pending' = horário reservado, link em preparação. */
  state: 'confirmed' | 'link_pending'
}

const MEET_URL = /^https:\/\/meet\.google\.com\/[a-z0-9-]{3,64}(?:\?[^\s]*)?$/i
const timeFormat = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })
const dateFormat = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long' })

/** Baixa o .ics gerado no navegador (Blob + âncora fora do documento: não passa pelos rastreadores de clique). */
function downloadIcs(content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = 'reuniao-cassiellos.ics'
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}
type Attendee = { name: string; whatsapp: string; email: string; clinic: string; priority: string; units: string; revenue: string; instagram: string; budget: string }
type Question = {
  name: keyof Attendee
  label: string
  type: 'text' | 'select' | 'email' | 'tel'
  placeholder?: string
  options?: readonly string[]
  autoComplete?: string
}


const INITIAL_ATTENDEE: Attendee = {
  name: '', whatsapp: '', email: '', clinic: '', priority: '', units: '', revenue: '', instagram: '', budget: '',
}
const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

function localToday(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date())
  const val = (type: string) => parts.find(item => item.type === type)?.value || ''
  return val('year') + '-' + val('month') + '-' + val('day')
}

function plusDays(value: string, amount: number): string {
  const date = new Date(value + 'T12:00:00Z')
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

function shiftMonth(month: string, amount: number): string {
  const [year, num] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, num - 1 + amount, 1, 12))
  return date.toISOString().slice(0, 7)
}

function monthDays(month: string): (string | null)[] {
  const [year, num] = month.split('-').map(Number)
  const firstWeekday = (new Date(Date.UTC(year, num - 1, 1, 12)).getUTCDay() + 6) % 7
  const numberOfDays = new Date(Date.UTC(year, num, 0, 12)).getUTCDate()
  return [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: numberOfDays }, (_, i) => month + '-' + String(i + 1).padStart(2, '0')),
  ]
}

function workingDate(day: string, today: string): boolean {
  if (day < today || day > plusDays(today, 3)) return false
  const weekDay = new Date(day + 'T12:00:00Z').getUTCDay()
  return weekDay !== 0 && weekDay !== 6
}

/** Dias fechados vindos do servidor (feriados, políticas, bloqueios). Sem eles, vale a regra local. */
type ServerCalendar = { today: string; lastDate: string; closedDates: string[] }

function selectableDate(day: string, today: string, calendar: ServerCalendar | null): boolean {
  if (!calendar) return workingDate(day, today)
  return day >= calendar.today && day <= calendar.lastDate && !calendar.closedDates.includes(day)
}

function humanDate(day: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
  }).format(new Date(day + 'T12:00:00Z'))
}

function monthLabel(month: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(month + '-01T12:00:00Z'))
}

function Icon({ name }: { name: 'calendar' | 'clock' | 'video' | 'shield' | 'arrow' | 'check' | 'back' }) {
  const paths = {
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    video: <><rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3"/></>,
    shield: <><path d="m12 22 8-5V5l-8-3-8 3v12l8 5Z"/><path d="m9 12 2 2 4-4"/></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
    back: <path d="M19 12H5m6 6-6-6 6-6"/>,
    check: <path d="m5 12 4 4L19 6"/>,
  }
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
    stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">{paths[name]}</svg>
}

const TURNSTILE_ACTION = 'booking_lead'
/** Código de erro seguro para métricas: só os códigos do servidor/cliente (MAIÚSCULAS); o resto vira genérico. */
function errorCode(error: unknown, fallback: string): string {
  const code = error instanceof Error ? error.message : ''
  return /^[A-Z][A-Z_]{1,47}$/.test(code) ? code : fallback
}

export default function BookingExperience({
  form, bookingEnabled, bookingRestricted = false, invitesEnabled = false, turnstileSiteKey, analyticsMode, metaPixelId = null, metaHomologation = null,
}: {
  form: BookingForm; bookingEnabled: boolean; bookingRestricted?: boolean; invitesEnabled?: boolean; turnstileSiteKey: string | null; analyticsMode: FunnelMode; metaPixelId?: string | null
  /** Homologação do Meta Pixel ativa no Pixel comercial (1 Lead e 1 Schedule de teste; lib/marketing/homologation.ts). */
  metaHomologation?: { expiresAt: string } | null
}) {
  // Meta Pixel habilitado no servidor (META_PIXEL_ENABLED + META_PIXEL_ID). Desligado: nada de marketing nesta página.
  const marketingEnabled = Boolean(metaPixelId)
  const [attendee, setAttendee] = useState<Attendee>(INITIAL_ATTENDEE)
  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4>(0)
  const [questionIndex, setQuestionIndex] = useState(0)
  // Browser and server calculate current date in the same timezone, not user's machine timezone.
  const [today, setToday] = useState('')
  const [month, setMonth] = useState('')
  const [date, setDate] = useState('')
  const [slots, setSlots] = useState<Slot[]>([])
  const [chosen, setChosen] = useState<Slot | null>(null)
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  const [privacyAccepted, setPrivacyAccepted] = useState(false)
  const [savingLead, setSavingLead] = useState(false)
  const [saveError, setSaveError] = useState('')
  // Erro de formato de um campo (telefone ou e-mail), exibido junto ao próprio campo.
  const [fieldError, setFieldError] = useState<{ name: keyof Attendee; message: string } | null>(null)
  const [leadSaved, setLeadSaved] = useState(false)
  const [bookingToken, setBookingToken] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [confirmationError, setConfirmationError] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [availabilityError, setAvailabilityError] = useState('')
  const [serverCalendar, setServerCalendar] = useState<ServerCalendar | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileState, setTurnstileState] = useState<TurnstileState>('loading')
  const [turnstileReset, setTurnstileReset] = useState(0)
  const submissionKey = useRef<string | null>(null)
  // Marketing choice last recorded in the CRM for this booking session (null = nothing saved yet).
  const syncedMarketingConsent = useRef<boolean | null>(null)

  // "Preferências de cookies" changed AFTER the form was sent, with this page still open:
  // record the new choice (revocation or new authorization) in the CRM through the signed
  // booking session. Best effort: the privacy channel remains available if it fails.
  useEffect(() => {
    if (!marketingEnabled || !bookingToken) return
    function sync() {
      const now = readMarketingConsent()
      if (!now.decided || syncedMarketingConsent.current === now.consent) return
      const previous = syncedMarketingConsent.current
      syncedMarketingConsent.current = now.consent
      fetch('/api/booking/consent', {
        method: 'POST', cache: 'no-store', credentials: 'same-origin', keepalive: true,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingToken, marketing: now.consent }),
      }).then(response => { if (!response.ok) syncedMarketingConsent.current = previous })
        .catch(() => { syncedMarketingConsent.current = previous })
    }
    window.addEventListener(CONSENT_CHANGE_EVENT, sync)
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, sync)
  }, [marketingEnabled, bookingToken])

  /** Marco do funil (lib/crm/funnel-events): só com consentimento, sem dados pessoais e sem duplicidade. */
  function funnel(name: FunnelEventName, extra: Record<string, unknown> = {}, ref?: string | null) {
    // Em modo real, um e-mail de domínio de teste nunca vira conversão (a marca final é do servidor: is_test).
    const mode = analyticsMode === 'live' && attendee.email && isTestEmailDomain(attendee.email) ? 'test' : analyticsMode
    emitFunnel(name, { form: form.slug, mode, ...extra }, ref)
  }

  useEffect(() => {
    const current = localToday()
    setToday(current)
    setMonth(current.slice(0, 7))
  }, [])

  // Visualização do formulário: ao carregar ou, se o consentimento vier depois, no momento do aceite.
  useEffect(() => {
    const view = () => emitFunnel('booking_form_view', { form: form.slug, mode: analyticsMode })
    view()
    window.addEventListener(CONSENT_CHANGE_EVENT, view)
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, view)
  }, [form.slug, analyticsMode])

  useEffect(() => {
    if (step !== 2 || !bookingToken) return
    const controller = new AbortController()
    fetch('/api/booking/calendar?form=' + encodeURIComponent(form.slug), {
      cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
      headers: { 'X-Booking-Session': bookingToken },
    })
      .then(response => response.ok ? response.json() : null)
      .then((data: unknown) => {
        if (!data || typeof data !== 'object') return
        const value = data as Record<string, unknown>
        const isDay = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x)
        if (!isDay(value.today) || !isDay(value.lastDate) || !Array.isArray(value.closedDates)) return
        setServerCalendar({ today: value.today, lastDate: value.lastDate, closedDates: value.closedDates.filter(isDay) })
      })
      // Falha: mantém a regra local; o servidor continua recusando dias fechados.
      .catch(() => undefined)
    return () => controller.abort()
  }, [step, form.slug, bookingToken])

  useEffect(() => {
    if (step !== 2 || !date) return
    const controller = new AbortController()
    let active = true
    setLoading(true)
    setFailed(false)
    setAvailabilityError('')
    setSlots([])
    setChosen(null)

    fetch('/api/booking/availability?form=' + encodeURIComponent(form.slug) +
      '&date=' + encodeURIComponent(date), {
      cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
      headers: bookingToken ? { 'X-Booking-Session': bookingToken } : {},
    })
      .then(async response => {
        if (!response.ok) {
          const data: unknown = await response.json().catch(() => null)
          const code = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string'
            ? data.error : 'UNAVAILABLE'
          throw new Error(code)
        }
        const data: unknown = await response.json()
        if (!data || typeof data !== 'object' || !('slots' in data) ||
          !Array.isArray(data.slots)) throw new Error('INVALID_RESPONSE')
        return data.slots.filter((item): item is Slot =>
          item !== null && typeof item === 'object' &&
          typeof item.localTime === 'string' &&
          typeof item.startAt === 'string' && typeof item.endAt === 'string')
      })
      .then(items => { if (active) setSlots(items) })
      .catch((error: unknown) => {
        if (!active) return
        const code = error instanceof Error ? error.message : ''
        const messages: Record<string, string> = {
          BOOKING_SESSION_EXPIRED: 'Sua sessão de agendamento expirou. Volte e envie o formulário novamente.',
          CONTACT_HAS_ACTIVE_MEETING: 'Já existe uma reunião para este contato. Para remarcar, fale com nossa equipe.',
          BOOKING_LIMIT_REACHED: 'Não foi possível concluir o agendamento online para este contato. Fale com nossa equipe.',
          TOO_MANY_REQUESTS: 'Muitas consultas em pouco tempo. Aguarde alguns minutos e tente novamente.',
        }
        setAvailabilityError(messages[code] ?? '')
        setFailed(true)
        funnel('booking_form_error', { stage: 'availability', code: errorCode(error, 'AVAILABILITY_FAILED') })
      })
      .finally(() => { if (active) setLoading(false) })

    return () => { active = false; controller.abort() }
  }, [step, date, retry, form.slug, bookingToken])

  const questions = useMemo<Question[]>(() => [
    { name: 'name', label: 'Qual é o seu nome?', type: 'text',
      placeholder: 'Seu nome', autoComplete: 'name' },
    { name: 'whatsapp', label: 'Qual é o seu telefone?', type: 'tel',
      placeholder: '(31) 99999-9999', autoComplete: 'tel' },
    ...form.fields.map(field => ({
      name: field.name, label: field.label, type: field.type,
      placeholder: field.placeholder, options: field.options,
    })),
    { name: 'email', label: 'Qual é o seu melhor e-mail?', type: 'email',
      placeholder: 'seu@email.com', autoComplete: 'email' },
  ], [form.fields])
  const question = questions[questionIndex]
  // Same behaviour as autoFocus, but without scrolling the page: on small screens the jump
  // used to push the page header and the cookie notice out of view before any choice.
  const focusWithoutScroll = (input: HTMLInputElement | null) => {
    if (input && document.activeElement !== input) input.focus({ preventScroll: true })
  }
  const totalStages = questions.length + 3
  const progress = step === 0 ? 0 : (step === 1 ? questionIndex + 1 : step === 2 ? questions.length + 2 : totalStages) / totalStages
  const days = useMemo(() => month ? monthDays(month) : [], [month])
  // Nenhuma data da janela tem horário (fim de semana, feriado, bloqueio ou antecedência): mensagem aprovada (R-2).
  const windowClosed = Boolean(serverCalendar) && (() => {
    for (let day = serverCalendar!.today; day <= serverCalendar!.lastDate; day = plusDays(day, 1)) {
      if (!serverCalendar!.closedDates.includes(day)) return false
    }
    return true
  })()
  const maxMonth = serverCalendar ? serverCalendar.lastDate.slice(0, 7) : today ? plusDays(today, 3).slice(0, 7) : ''
  const firstMonth = today ? today.slice(0, 7) : ''

  function update(name: keyof Attendee, value: string) {
    if (leadSaved) {
      setLeadSaved(false)
      setBookingToken(null)
      submissionKey.current = null
    }
    setAttendee(current => ({ ...current, [name]: name === 'whatsapp' ? nextPhoneInput(current.whatsapp, value) : value }))
    setSaveError('')
    setFieldError(current => current?.name === name ? null : current)
    if (value) funnel('booking_form_start')
  }

  /**
   * Mesmas regras do servidor (lib/crm/contact-validation.ts e o mínimo de 2 caracteres das respostas). O formulário
   * usa noValidate: a mensagem aparece junto ao campo, sem o balão nativo do navegador.
   */
  function contactError(name: keyof Attendee): string | null {
    if (name === 'whatsapp') { const r = validateBrazilianPhone(attendee.whatsapp); return r.ok ? null : r.message }
    if (name === 'email') { const r = validateEmailAddress(attendee.email); return r.ok ? null : r.message }
    if (name === 'instagram') {
      const value = attendee.instagram.trim()
      return /^@[a-zA-Z0-9._]{2,30}$/.test(value) || /^https:\/\/(?:www\.)?instagram\.com\/[a-zA-Z0-9._]{2,30}\/?$/.test(value)
        ? null : 'Informe um @ do Instagram válido ou a URL do perfil.'
    }
    const question = questions.find(item => item.name === name)
    if (question && question.type !== 'select' && attendee[name].trim().length < 2) {
      return name === 'name' ? 'Revise o nome informado.' : 'Revise a resposta informada.'
    }
    return null
  }

  /** Volta à pergunta do campo inválido (o campo recebe o foco ao abrir) com a mensagem junto a ele. */
  function showFieldError(name: keyof Attendee, message: string) {
    const index = questions.findIndex(item => item.name === name)
    if (index >= 0) setQuestionIndex(index)
    setFieldError({ name, message })
  }

  function next(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!question || !attendee[question.name].trim()) return
    const invalid = contactError(question.name)
    if (invalid) {
      setFieldError({ name: question.name, message: invalid })
      funnel('booking_form_error', { stage: 'question', code: question.name === 'email' ? 'INVALID_EMAIL' : question.name === 'whatsapp' ? 'INVALID_WHATSAPP' : 'INVALID_ANSWER' })
      document.getElementById('question-' + question.name)?.focus({ preventScroll: true })
      return
    }
    funnel('booking_step_completed', { step: question.name, step_index: questionIndex + 1 })
    if (questionIndex < questions.length - 1) {
      setQuestionIndex(index => index + 1)
    } else {
      setQuestionIndex(questions.length)
    }
  }

  async function submitLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!privacyAccepted || savingLead) return
    if (leadSaved) { setStep(2); return }
    if (!turnstileSiteKey) {
      setSaveError('A verificação de segurança está indisponível no momento. Tente novamente mais tarde.')
      return
    }
    if (!turnstileToken) {
      setSaveError('Aguarde a conclusão da verificação de segurança e tente novamente.')
      return
    }
    for (const question of questions) {
      if (!attendee[question.name].trim()) {
        setQuestionIndex(questions.findIndex(item => item.name === question.name))
        setSaveError('Confira as respostas obrigatórias antes de continuar.')
        return
      }
      const invalid = contactError(question.name)
      if (invalid) { showFieldError(question.name, invalid); return }
    }

    setSavingLead(true)
    setSaveError('')
    try {
      if (!submissionKey.current) submissionKey.current = window.crypto.randomUUID()
      const marketingChoice = readMarketingConsent()
      funnel('booking_form_submit', {}, submissionKey.current)
      // Atribuição do cadastro (padrão UTM: docs/marketing/padrao-utm.md). UTM com aparência de e-mail é
      // descartado; o servidor repete a higienização. fbclid só com consentimento de marketing
      // (decisão G2; o servidor confere de novo).
      const attribution: Record<string, string> = {}
      const params = new URLSearchParams(window.location.search)
      for (const key of UTM_KEYS) {
        const value = sanitizeUtmValue(params.get(key)).slice(0, 180)
        if (value) attribution[key] = value
      }
      const fbclid = params.get('fbclid')
      if (fbclid && marketingChoice.consent) attribution.fbclid = fbclid.slice(0, 180)
      const answers: Record<string, string> = {}
      for (const field of form.fields) answers[field.name] = attendee[field.name]
      const response = await fetch('/api/booking/leads', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formSlug: form.slug, idempotencyKey: submissionKey.current,
          name: attendee.name, email: attendee.email.trim(), whatsapp: attendee.whatsapp,
          answers, attribution, privacyAccepted, turnstileToken,
          // Only the yes/no cookie choice; fbp/fbc never reach the CRM (decision C2).
          marketing: marketingChoice,
        }),
      })
      // Each Turnstile token is single-use: always request a fresh one afterwards.
      setTurnstileToken(null)
      const result: unknown = await response.json()
      if (!response.ok) {
        const code = result && typeof result === 'object' && 'error' in result && typeof result.error === 'string'
          ? result.error : 'SAVE'
        throw new Error(code)
      }
      if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true) {
        throw new Error('SAVE')
      }
      if (!('bookingToken' in result) || typeof result.bookingToken !== 'string' ||
        !result.bookingToken) throw new Error('INVALID_RESPONSE')
      syncedMarketingConsent.current = marketingChoice.consent
      setBookingToken(result.bookingToken)
      // Meta "Lead": só quando o backend registrou um lead NOVO e REAL (event_id do CRM); reenvio, reaproveitamento
      // e teste não recebem `tracking`. Nunca no modo de teste.
      // Na homologação, o lead de teste só recebe `tracking` do servidor com a liberação válida (uma vez por liberação);
      // o evento vai ao Pixel comercial com a marca `cassiellos_teste`.
      if ((analyticsMode === 'live' || metaHomologation) && 'tracking' in result && result.tracking && typeof result.tracking === 'object' &&
        'lead' in result.tracking && result.tracking.lead && typeof result.tracking.lead === 'object' &&
        'eventId' in result.tracking.lead) {
        trackMetaConversion('Lead', result.tracking.lead.eventId, { content_name: form.slug, homologation: Boolean(metaHomologation) })
      }
      setLeadSaved(true)
      setStep(2)
      // Um lead por contato: a deduplicação usa o id do lead (resposta idempotente ou reenvio não contam de novo).
      const leadRef = 'leadId' in result && typeof result.leadId === 'string' ? result.leadId : null
      funnel('booking_lead_registered', {}, leadRef)
    } catch (error) {
      funnel('booking_form_error', { stage: 'lead', code: errorCode(error, 'SAVE') })
      const code = error instanceof Error ? error.message : ''
      const messages: Record<string, string> = {
        INVALID_NAME: 'Revise o nome informado.',
        INVALID_EMAIL: 'Confira o endereço de e-mail informado.',
        INVALID_WHATSAPP: 'Confira o número informado.',
        INVALID_FORM_ANSWERS: 'Revise as respostas do formulário. Uma delas pode estar incompleta.',
        PRIVACY_NOT_ACCEPTED: 'Confirme a Política de Privacidade para continuar.',
        TOO_MANY_REQUESTS: 'Muitas tentativas. Tente novamente mais tarde.',
        SECURITY_CHECK_REQUIRED: 'Aguarde a conclusão da verificação de segurança e tente novamente.',
        SECURITY_CHECK_EXPIRED: 'A verificação de segurança expirou. Ela foi renovada; envie novamente.',
        SECURITY_CHECK_FAILED: 'Não foi possível confirmar a verificação de segurança. Ela foi renovada; tente novamente.',
        SECURITY_CHECK_UNAVAILABLE: 'A verificação de segurança está indisponível no momento. Tente novamente em instantes.',
        FORBIDDEN: 'A página de testes perdeu a autorização de origem. Atualize a página e tente novamente.',
        NOT_FOUND: 'O ambiente de testes não está disponível. Não envie dados reais.',
      }
      // O servidor recusou o formato do contato: volta ao campo, com os dados preservados.
      if (code === 'INVALID_EMAIL' || code === 'INVALID_WHATSAPP') showFieldError(code === 'INVALID_EMAIL' ? 'email' : 'whatsapp', messages[code])
      else setSaveError(messages[code] ?? 'Não foi possível registrar suas informações no momento. Tente novamente.')
      setTurnstileReset(value => value + 1)
    } finally {
      setSavingLead(false)
    }
  }

  async function confirmBooking() {
    if (!bookingEnabled || !bookingToken || !chosen || confirming) return
    setConfirming(true)
    setConfirmationError('')
    try {
      const response = await fetch('/api/booking/confirm', {
        method: 'POST', credentials: 'same-origin', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingToken, startAt: chosen.startAt }),
      })
      const data: unknown = await response.json()
      if (!data || typeof data !== 'object') throw new Error('BOOKING_UNAVAILABLE')
      if (!response.ok) {
        const code = 'error' in data && typeof data.error === 'string' ? data.error : 'BOOKING_UNAVAILABLE'
        throw new Error(code)
      }
      if (!('ok' in data) || data.ok !== true) throw new Error('BOOKING_UNAVAILABLE')
      const value = data as Record<string, unknown>
      // Confirmação repetida sem reunião ativa registrada: não exibir sucesso nem horário presumido.
      if (value.alreadyConfirmed === true && typeof value.startAt !== 'string') throw new Error('BOOKING_ALREADY_REGISTERED')
      const startAt = typeof value.startAt === 'string' ? value.startAt : chosen.startAt
      const endAt = typeof value.endAt === 'string' ? value.endAt : chosen.endAt
      const meetUrl = typeof value.googleMeetUrl === 'string' && MEET_URL.test(value.googleMeetUrl) ? value.googleMeetUrl : null
      setConfirmation({
        bookingRequestId: typeof value.bookingRequestId === 'string' ? value.bookingRequestId : '',
        startAt, endAt, meetUrl,
        title: typeof value.meetingTitle === 'string' ? value.meetingTitle : form.meetingName,
        invitationRequested: value.invitationRequested === true,
        state: meetUrl ? 'confirmed' : 'link_pending',
      })
      // Meta "Schedule": só quando o backend confirmou a reunião (evento válido no Google) de um lead REAL —
      // o servidor só devolve `tracking` nesse caso; a repetição idempotente não devolve. Nunca no modo de teste.
      const schedule = (value.tracking as { schedule?: { eventId?: unknown } } | undefined)?.schedule
      if ((analyticsMode === 'live' || metaHomologation) && value.alreadyConfirmed !== true && schedule) {
        trackMetaConversion('Schedule', schedule.eventId, { content_name: form.slug, homologation: Boolean(metaHomologation) })
      }
      setStep(4)
      // Somente reunião confirmada pelo backend (id da reserva presente). A repetição idempotente
      // ("alreadyConfirmed") mostra a mesma reunião, mas não conta outra conversão.
      if (typeof value.bookingRequestId === 'string' && value.bookingRequestId && value.alreadyConfirmed !== true) {
        funnel('booking_meeting_confirmed', { state: meetUrl ? 'confirmed' : 'link_pending' }, value.bookingRequestId)
      }
    } catch (error) {
      funnel('booking_form_error', { stage: 'confirm', code: errorCode(error, 'BOOKING_UNAVAILABLE') })
      const code = error instanceof Error ? error.message : ''
      const messages: Record<string, string> = {
        SLOT_UNAVAILABLE: 'Esse horário acabou de ficar indisponível. Escolha outro no calendário.',
        INVALID_SLOT: 'Não foi possível validar o horário escolhido. Escolha novamente no calendário.',
        BOOKING_SESSION_EXPIRED: 'Sua sessão de agendamento expirou. Preencha novamente o formulário.',
        TEST_EMAIL_NOT_ALLOWED: 'Neste teste, só é possível agendar com o e-mail de teste autorizado.',
        BOOKING_ALREADY_PROCESSING: 'Já existe um agendamento em processamento. Não tente novamente: contate a equipe para conferir.',
        CONTACT_HAS_ACTIVE_MEETING: 'Já existe uma reunião para este contato. Para remarcar, fale com nossa equipe.',
        BOOKING_LIMIT_REACHED: 'Não foi possível concluir o agendamento online para este contato. Fale com nossa equipe.',
        BOOKING_REQUIRES_REVIEW: 'O agendamento precisa de verificação manual. Não tente novamente para evitar duplicidade.',
        BOOKING_DISABLED: 'A confirmação ainda não foi habilitada neste ambiente.',
        BOOKING_ALREADY_REGISTERED: 'Já existe um agendamento registrado para esta inscrição. Para conferir, fale com nossa equipe.',
      }
      setConfirmationError(messages[code] || 'Não foi possível confirmar agora. Contate a equipe antes de tentar novamente.')
    } finally {
      setConfirming(false)
    }
  }

  function backQuestion() {
    setQuestionIndex(index => Math.max(0, index - 1))
  }

  function goMonth(delta: number) {
    setMonth(current => shiftMonth(current, delta))
    setDate('')
    setSlots([])
    setChosen(null)
  }

  return <div id="cassiellos-booking" data-screen={step === 0 ? 'intro' : step === 1 ? 'question' : step === 2 ? 'calendar' : step === 4 ? 'success' : 'review'}>
    <MetaPixel pixelId={metaPixelId}/>
    <header className="booking-header">
      {step !== 0 && step !== 4 && <button type="button" className="booking-nav-back"
        aria-label="Voltar" onClick={() => {
          if (step === 1) {
            if (questionIndex > 0) setQuestionIndex(index => index - 1)
            else setStep(0)
          } else if (step === 2) {
            setStep(1)
            setQuestionIndex(questions.length)
          } else if (step === 3) setStep(2)
        }}>‹</button>}
      <div className="booking-brand">
        <img src="/brand/cassiellos-symbol-signal-red.svg" alt="" width="47" height="34"/>
        <span><strong>Cassiellos</strong><small>AGÊNCIA CASSIELLOS</small></span>
      </div>

    </header>

    <main className="booking-shell">
      {step === 0 && <section className="booking-intro">
        <div className="booking-hero-copy">
          <h1>{form.headline}</h1>
          <ul className="booking-hero-points">
            <li><span aria-hidden="true">✦</span><span>Método testado e comprovado <em>(depoimentos)</em></span></li>
            <li><span aria-hidden="true">✦</span><span>Exclusivo para <em>(perfil de cliente ideal)</em></span></li>
            <li><span aria-hidden="true">✦</span><span><em>(resultado ou diferencial comprovado)</em></span></li>
          </ul>
          <p>Uma conversa direta para entender seu negócio e as oportunidades de crescimento.</p>
        </div>
        <button type="button" className="booking-hero-cta" onClick={() => setStep(1)}>
          Quero vender mais <span aria-hidden="true">→</span>
        </button>
      </section>}
      {step !== 0 &&       <section className="booking-card" aria-label="Formulário e calendário de agendamento">
        <div className="booking-card-inside">
          {step !== 4 && <div className="booking-step-meter booking-global-meter" role="progressbar"
            aria-label="Progresso do formulário" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: progress * 100 + '%' }}/>
          </div>}
          {step === 1 && question && <form className="booking-form booking-question-form"
            onSubmit={next} key={question.name} noValidate>
            <div className="booking-card-heading booking-question-heading">
              <h2 id="booking-question-label">{question.label}<span className="booking-required" aria-label="obrigatório"> *</span></h2>
              {question.name === 'whatsapp' && <p>Não queremos te encher de spam, apenas facilitar a comunicação :)</p>}
              {question.name === 'instagram' && <p>Queremos analisar sua presença digital antes da conversa.</p>}
              {question.name === 'revenue' && <p>Responda com base na média dos últimos 6 meses.</p>}
            </div>
            <div className="booking-inputs booking-question-inputs">
              {question.type === 'select' ? <div className="booking-choices" role="group"
                  aria-labelledby="booking-question-label">
                {question.options?.map((option, optionIndex) => <button
                  type="button" key={option}
                  className="booking-choice"
                  data-selected={attendee[question.name] === option}
                  aria-pressed={attendee[question.name] === option}
                  onClick={() => update(question.name, option)}>
                  <span className="booking-choice-label"><span className="booking-choice-key">{String.fromCharCode(65 + optionIndex)}</span>{option}</span>
                  <span className="booking-choice-indicator" aria-hidden="true">{attendee[question.name] === option ? '✓' : ''}</span>
                </button>)}
              </div> : <label className="booking-question-field" htmlFor={'question-' + question.name}>
                <span className="booking-visually-hidden">{question.label}</span>
                <input id={'question-' + question.name} required
                  type={question.type} autoComplete={question.autoComplete}
                  inputMode={question.type === 'tel' ? 'tel' : question.type === 'email' ? 'email' : undefined}
                  autoCapitalize={question.type === 'email' || question.type === 'tel' ? 'none' : undefined}
                  autoCorrect={question.type === 'email' ? 'off' : undefined}
                  spellCheck={question.type === 'email' || question.type === 'tel' ? false : undefined}
                  ref={focusWithoutScroll}
                  aria-invalid={fieldError?.name === question.name ? true : undefined}
                  aria-describedby={fieldError?.name === question.name ? 'question-field-error' : undefined}
                  maxLength={question.type === 'email' ? 180 : question.type === 'tel' ? 24 : 120}
                  placeholder={question.placeholder} value={attendee[question.name]}
                  onChange={event => update(question.name, event.target.value)}/>
              </label>}
              {fieldError?.name === question.name && <p id="question-field-error" className="booking-field-error"
                aria-live="polite">{fieldError.message}</p>}
            </div>
            {saveError && <p role="alert" className="booking-save-error">{saveError}</p>}
            <div className="booking-question-footer">

              <button className="booking-primary" type="submit"
                disabled={!attendee[question.name].trim()}>
                Continuar
                <Icon name="arrow"/>
              </button>
            </div>

          </form>}

          {step === 1 && !question && <form className="booking-form booking-question-form"
            onSubmit={submitLead}>
            <div className="booking-card-heading booking-question-heading">
              <h2>Antes de escolher o horário</h2>
              <p>Para continuar, confirme que podemos usar suas respostas para entrar em contato.</p>
            </div>
            <label className="booking-consent">
              <input type="checkbox" required checked={privacyAccepted}
                onChange={event => setPrivacyAccepted(event.target.checked)} />
              <span>Li a <a href="/politica-de-privacidade" target="_blank" rel="noopener noreferrer">Política de Privacidade</a>
                {' '}e autorizo a Cassiellos a utilizar meus dados para responder à solicitação deste diagnóstico.</span>
            </label>
            <p className="booking-test-warning">Ambiente de testes: os dados informados serão armazenados no banco Neon Preview. Não utilize dados pessoais reais nesta prévia.</p>
            {!leadSaved && (turnstileSiteKey
              ? <TurnstileWidget siteKey={turnstileSiteKey} action={TURNSTILE_ACTION}
                  resetSignal={turnstileReset} onToken={setTurnstileToken} onStateChange={setTurnstileState}/>
              : null)}
            {!leadSaved && <p className="booking-security-status" role="status" data-state={
              !turnstileSiteKey ? 'error' : turnstileToken ? 'ready' : turnstileState}>
              <Icon name="shield"/>
              <span>{!turnstileSiteKey
                ? 'Verificação de segurança indisponível no momento. O envio está temporariamente bloqueado.'
                : turnstileToken ? 'Verificação de segurança concluída.'
                : turnstileState === 'error' ? 'Não foi possível carregar a verificação de segurança. Recarregue a página ou desative bloqueadores para este site.'
                : turnstileState === 'expired' ? 'Renovando a verificação de segurança…'
                : 'Verificando a segurança do envio…'}
                {' '}Proteção por Cloudflare Turnstile (<a href="/politica-de-privacidade" target="_blank" rel="noopener noreferrer">privacidade</a>).</span>
            </p>}
            {saveError && <p role="alert" className="booking-save-error">{saveError}</p>}
            <div className="booking-question-footer">
              <button className="booking-primary" type="submit"
                disabled={!privacyAccepted || savingLead || (!leadSaved && !turnstileToken)}>
                {savingLead ? 'Registrando...' : 'Continuar'} <Icon name="arrow"/>
              </button>
            </div>
          </form>}

          {step === 2 && <div className="booking-schedule">

            <div className="booking-card-heading">
              <h2>Escolha o melhor horário para o seu diagnóstico</h2>
              <p>{form.durationMinutes} minutos para entender o seu negócio e mostrar oportunidades de crescimento.</p>
            </div>
            <div className="booking-month-row">
              <strong>{month ? monthLabel(month) : 'Carregando calendário'}</strong>
              <div className="booking-month-controls">
                <button type="button" aria-label="Mês anterior" onClick={() => goMonth(-1)}
                  disabled={!firstMonth || month <= firstMonth}>‹</button>
                <button type="button" aria-label="Próximo mês" onClick={() => goMonth(1)}
                  disabled={!maxMonth || month >= maxMonth}>›</button>
              </div>
            </div>
            <div className="booking-calendar-grid">
              {WEEKDAYS.map(item => <span className="booking-weekday" key={item}>{item}</span>)}
              {days.map((day, index) => day ? (
                <button type="button" className="booking-day" key={day}
                  data-active={date === day} data-today={day === today}
                  disabled={!today || !selectableDate(day, today, serverCalendar)}
                  onClick={() => { setDate(day); setChosen(null) }}
                  aria-pressed={date === day}
                  aria-label={humanDate(day)}>
                  {Number(day.slice(-2))}
                </button>
              ) : <span key={'empty-'+index} className="booking-empty-day"/>)}
            </div>
            <div className="booking-slots" aria-live="polite">
              <div className="booking-slots-heading">
                <strong>{date ? humanDate(date) : windowClosed ? 'Sem horários disponíveis' : 'Selecione um dia'}</strong>
                <small>Horário de Brasília · 30 minutos</small>
              </div>
              {windowClosed && <p className="booking-calendar-hint" role="status">Não encontramos horários disponíveis nos próximos 3 dias. Volte em breve para consultar novas datas.</p>}
              {!date && !windowClosed && <p className="booking-calendar-hint">Escolha uma data destacada no calendário para consultar os horários.</p>}
              {loading && <p className="booking-calendar-hint">Consultando disponibilidade real…</p>}
              {failed && <div className="booking-availability-error" role="alert">
                {availabilityError || 'Não foi possível consultar a agenda agora.'}
                {!availabilityError && <button type="button" onClick={() => setRetry(v => v + 1)}>Tentar novamente</button>}
              </div>}
              {!loading && !failed && date && slots.length === 0 &&
                <p className="booking-calendar-hint">Não há horários disponíveis para esta data. Escolha outro dia.</p>}
              {!loading && !failed && slots.length > 0 &&
                <div className="booking-time-grid">
                  {slots.map(slot => <button type="button" key={slot.startAt}
                    data-selected={chosen?.startAt === slot.startAt}
                    aria-pressed={chosen?.startAt === slot.startAt}
                    onClick={() => {
                      setChosen(slot)
                      const ahead = daysAhead(today, date)
                      funnel('booking_slot_selected', ahead === null ? {} : { days_ahead: ahead }, slot.startAt)
                    }}>{slot.localTime}</button>)}
                </div>}
            </div>
            {chosen && <div className="booking-selected-summary"><Icon name="check"/><span>{date && humanDate(date)}, às {chosen.localTime} · {form.durationMinutes} minutos</span></div>}
            <div className="booking-calendar-contact"><small>SEUS DADOS</small><p><strong>{attendee.name}</strong></p><p>{attendee.email}</p><p>{attendee.whatsapp}</p></div>
            {confirmationError && <p role="alert" className="booking-save-error">{confirmationError}</p>}
            <div className="booking-actions">
              <button type="button" className="booking-primary" disabled={!chosen || loading || failed || !bookingEnabled || !bookingToken || confirming}
                onClick={confirmBooking}>{confirming ? 'Confirmando…' : 'Agendar horário'} <Icon name="check"/></button>
            </div>
          </div>}

          {step === 3 && <div className="booking-review">
            <div className="booking-card-heading">
              <div className="booking-step-label">ETAPA 03 DE 03</div>
              <h2>Confira sua seleção.</h2>
              <p>{bookingEnabled ? 'Confirme os dados antes de concluir o ' + (bookingRestricted ? 'agendamento de teste' : 'agendamento') + '. O link do Google Meet é disponibilizado na confirmação do agendamento.' : 'Este é um resumo visual para validar a experiência. Ainda não cria um compromisso real.'}</p>
            </div>
            <div className="booking-review-list">
              <div><small>DIAGNÓSTICO</small><strong>{form.meetingName}</strong></div>
              <div><small>DATA</small><strong>{date && humanDate(date)}</strong></div>
              <div><small>HORÁRIO</small><strong>{chosen?.localTime} · Brasília · {form.durationMinutes} minutos</strong></div>
              <div><small>PARTICIPANTE</small><strong>{attendee.name}</strong></div>
              <div><small>CLÍNICA</small><strong>{attendee.clinic}</strong></div>
            </div>
            <div className="booking-demo-confirm"><Icon name="shield"/>
              <span>{bookingEnabled
                ? (bookingRestricted ? 'Teste controlado: a' : 'A') + (invitesEnabled
                  ? ' confirmação cria a reunião na agenda da Cassiellos e o Google Agenda envia um convite para ' + attendee.email + '.'
                  : ' confirmação cria a reunião na agenda da Cassiellos e não envia convite por e-mail.')
                : 'Prévia de interface. A confirmação real permanece bloqueada até autorizarmos um teste controlado com e-mail real.'}</span>
            </div>
            <button type="button" className="booking-secondary booking-back-full"
              onClick={() => setStep(2)}><Icon name="back"/> Escolher outro horário</button>
            {confirmationError && <p className="booking-save-error" role="alert">{confirmationError}</p>}
            <button className="booking-primary" type="button" disabled={!bookingEnabled || confirming || !bookingToken}
              onClick={confirmBooking}>
              {confirming ? 'Confirmando no Google Calendar…' :
                bookingEnabled ? (bookingRestricted ? 'Confirmar reunião de teste' : 'Confirmar reunião') : 'Confirmar reunião (em desenvolvimento)'}
              <Icon name="check"/>
            </button>
          </div>}

          {step === 4 && <div className="booking-review booking-confirmed" role="status"
            data-state={confirmation?.state ?? 'confirmed'}>
            {confirmation?.state === 'link_pending' ? <div className="booking-card-heading">
              <h2>Seu horário foi reservado!</h2>
              <p>O link da reunião ainda está sendo preparado. Nossa equipe entrará em contato pelo WhatsApp informado
                para enviar as instruções de acesso.</p>
            </div> : <div className="booking-card-heading">
              <h2>Obrigado pelo envio!</h2>
              <p>Sua reunião foi registrada com sucesso.</p>
              {confirmation?.invitationRequested
                ? <p>Pedimos ao Google Agenda que envie o convite para <strong>{attendee.email}</strong>. Ele pode levar alguns
                  minutos para chegar — confira também as pastas de spam e promoções. O link e os botões abaixo continuam
                  disponíveis caso prefira salvar a reunião agora.</p>
                : <p>Guarde o link abaixo. <strong>Não enviamos convite automático por e-mail</strong>: se quiser, use os
                  botões para salvar a reunião na sua agenda.</p>}
            </div>}
            <div className="booking-review-list">
              <div><small>DATA</small><strong>{confirmation ? dateFormat.format(new Date(confirmation.startAt)) : date && humanDate(date)}</strong></div>
              <div><small>HORÁRIO</small><strong>{confirmation ? timeFormat.format(new Date(confirmation.startAt)) : chosen?.localTime} · Brasília · {form.durationMinutes} minutos</strong></div>
              <div><small>PARTICIPANTE</small><strong>{attendee.name}</strong></div>
            </div>
            {confirmation?.meetUrl ? <>
              <div className="booking-meet-link">
                <small>LINK DA REUNIÃO (GOOGLE MEET)</small>
                <input readOnly value={confirmation.meetUrl} aria-label="Link do Google Meet"
                  onFocus={event => event.currentTarget.select()}/>
              </div>
              <div className="booking-confirmed-actions">
                <button type="button" className="booking-secondary" onClick={async () => {
                  try { await navigator.clipboard.writeText(confirmation.meetUrl!); setCopyState('copied') }
                  catch { setCopyState('failed') }
                }}><Icon name="check"/>{copyState === 'copied' ? 'Link copiado' : 'Copiar link'}</button>
                <a className="booking-secondary" href={confirmation.meetUrl} target="_blank" rel="noopener noreferrer"
                  referrerPolicy="no-referrer"><Icon name="video"/>Abrir Google Meet</a>
              </div>
              {copyState === 'failed' && <p className="booking-calendar-hint" role="alert">Não foi possível copiar automaticamente.
                Selecione o link acima e copie manualmente.</p>}
            </> : null}
            {confirmation && <div className="booking-confirmed-actions" aria-label="Adicionar à minha agenda">
              <a className="booking-secondary" target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer"
                href={googleCalendarTemplateUrl({ title: confirmation.title, startAt: confirmation.startAt,
                  endAt: confirmation.endAt, meetUrl: confirmation.meetUrl })}>
                <Icon name="calendar"/>Adicionar ao Google Agenda</a>
              <button type="button" className="booking-secondary" onClick={() => downloadIcs(buildIcs({
                uid: confirmation.bookingRequestId || confirmation.startAt, title: confirmation.title,
                startAt: confirmation.startAt, endAt: confirmation.endAt, meetUrl: confirmation.meetUrl,
              }))}><Icon name="calendar"/>Baixar para Apple / Outlook (.ics)</button>
            </div>}
            {bookingRestricted && <p className="booking-privacy">Esta confirmação ocorreu apenas no ambiente de teste autorizado.</p>}
          </div>}
        </div>
      </section>}
    </main>
    <div className="booking-cookie-notice"><ConsentNotice marketingEnabled={marketingEnabled}/></div>
    <details className="booking-preview-details">
      <summary>Informações sobre este ambiente de testes</summary>
      <div className="booking-preview-banner"><strong>PRÉVIA EM DESENVOLVIMENTO</strong> · Cadastros são salvos no Neon Preview; {bookingEnabled ? (bookingRestricted ? 'agendamentos reais habilitados apenas para o e-mail de teste.' : 'agendamentos reais habilitados.') : 'nenhuma reunião será criada.'}</div>
      {metaHomologation && <div className="booking-preview-banner booking-homologation-banner" role="status"><strong>HOMOLOGAÇÃO META PIXEL</strong> · Ativa até {new Date(metaHomologation.expiresAt).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}.</div>}
    </details>
    <footer className="booking-footer"><span>© Cassiellos · Experiência em desenvolvimento</span>
      <span className="booking-footer-links"><a href="/politica-de-privacidade" target="_blank" rel="noopener noreferrer">Privacidade</a>
        <a href="/politica-de-cookies" target="_blank" rel="noopener noreferrer">Cookies</a>
        <ConsentPreferencesButton/></span>
      <span>Ambiente Preview · {form.niche}</span></footer>
  </div>
}
