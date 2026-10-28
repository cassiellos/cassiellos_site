'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { BookingForm } from '@/lib/crm/booking-forms'

type Slot = { startAt: string; endAt: string; localTime: string }
type Attendee = { name: string; whatsapp: string; email: string; clinic: string; priority: string; units: string; revenue: string }
type Question = {
  name: keyof Attendee
  label: string
  type: 'text' | 'select' | 'email' | 'tel'
  placeholder?: string
  options?: readonly string[]
  autoComplete?: string
}


const INITIAL_ATTENDEE: Attendee = {
  name: '', whatsapp: '', email: '', clinic: '', priority: '', units: '', revenue: '',
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
  if (day < today || day > plusDays(today, 30)) return false
  const weekDay = new Date(day + 'T12:00:00Z').getUTCDay()
  return weekDay !== 0 && weekDay !== 6
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

export default function BookingExperience({ form }: { form: BookingForm }) {
  const [attendee, setAttendee] = useState<Attendee>(INITIAL_ATTENDEE)
  const [step, setStep] = useState<1 | 2 | 3>(1)
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
  const [leadSaved, setLeadSaved] = useState(false)
  const submissionKey = useRef<string | null>(null)

  useEffect(() => {
    const current = localToday()
    setToday(current)
    setMonth(current.slice(0, 7))
  }, [])

  useEffect(() => {
    if (step !== 2 || !date) return
    const controller = new AbortController()
    let active = true
    setLoading(true)
    setFailed(false)
    setSlots([])
    setChosen(null)

    fetch('/api/booking/availability?form=' + encodeURIComponent(form.slug) +
      '&date=' + encodeURIComponent(date), {
      cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
    })
      .then(async response => {
        if (!response.ok) throw new Error('UNAVAILABLE')
        const data: unknown = await response.json()
        if (!data || typeof data !== 'object' || !('slots' in data) ||
          !Array.isArray(data.slots)) throw new Error('INVALID_RESPONSE')
        return data.slots.filter((item): item is Slot =>
          item !== null && typeof item === 'object' &&
          typeof item.localTime === 'string' &&
          typeof item.startAt === 'string' && typeof item.endAt === 'string')
      })
      .then(items => { if (active) setSlots(items) })
      .catch(() => { if (active) setFailed(true) })
      .finally(() => { if (active) setLoading(false) })

    return () => { active = false; controller.abort() }
  }, [step, date, retry, form.slug])

  const questions = useMemo<Question[]>(() => [
    ...form.fields.map(field => ({
      name: field.name,
      label: field.label,
      type: field.type,
      placeholder: field.placeholder,
      options: field.options,
    })),
    { name: 'name', label: 'Como podemos chamar você?', type: 'text',
      placeholder: 'Seu nome completo', autoComplete: 'name' },
    { name: 'whatsapp', label: 'Qual é o seu WhatsApp?', type: 'tel',
      placeholder: '(31) 99999-9999', autoComplete: 'tel' },
    { name: 'email', label: 'Qual é seu melhor e-mail?', type: 'email',
      placeholder: 'voce@clinica.com.br', autoComplete: 'email' },
  ], [form.fields])
  const question = questions[questionIndex]
  const totalStages = questions.length + 3
  const progress = (step === 1 ? questionIndex + 1 : step === 2 ? questions.length + 2 : totalStages) / totalStages
  const days = useMemo(() => month ? monthDays(month) : [], [month])
  const maxMonth = today ? plusDays(today, 30).slice(0, 7) : ''
  const firstMonth = today ? today.slice(0, 7) : ''

  function update(name: keyof Attendee, value: string) {
    if (leadSaved) {
      setLeadSaved(false)
      submissionKey.current = null
    }
    setAttendee(current => ({ ...current, [name]: value }))
    setSaveError('')
  }

  function next(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!question || !attendee[question.name].trim()) return
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
    for (const question of questions) {
      if (!attendee[question.name].trim()) {
        setQuestionIndex(questions.findIndex(item => item.name === question.name))
        setSaveError('Confira as respostas obrigatórias antes de continuar.')
        return
      }
    }

    setSavingLead(true)
    setSaveError('')
    try {
      if (!submissionKey.current) submissionKey.current = window.crypto.randomUUID()
      const attribution: Record<string, string> = {}
      const params = new URLSearchParams(window.location.search)
      for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid']) {
        const value = params.get(key)
        if (value) attribution[key] = value.slice(0, 180)
      }
      const answers: Record<string, string> = {}
      for (const field of form.fields) answers[field.name] = attendee[field.name]
      const response = await fetch('/api/booking/leads', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          formSlug: form.slug, idempotencyKey: submissionKey.current,
          name: attendee.name, email: attendee.email, whatsapp: attendee.whatsapp,
          answers, attribution, privacyAccepted,
        }),
      })
      if (!response.ok) throw new Error(response.status === 429 ? 'LIMIT' : 'SAVE')
      const result: unknown = await response.json()
      if (!result || typeof result !== 'object' || !('ok' in result) || result.ok !== true) {
        throw new Error('SAVE')
      }
      setLeadSaved(true)
      setStep(2)
    } catch (error) {
      setSaveError(error instanceof Error && error.message === 'LIMIT' ?
        'Muitas tentativas. Tente novamente mais tarde.' :
        'Não foi possível registrar suas informações. Tente novamente.')
    } finally {
      setSavingLead(false)
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

  return <div id="cassiellos-booking">
    <header className="booking-header">
      <div className="booking-brand">
        <img src="/brand/cassiellos-symbol-signal-red.svg" alt="" width="47" height="34"/>
        <span><strong>Cassiellos</strong><small>DIAGNÓSTICO ESTRATÉGICO</small></span>
      </div>
      <span className="booking-header-tag">EXPERIÊNCIA DE AGENDAMENTO</span>
    </header>

    <main className="booking-shell">
      <section className="booking-intro">
        <div className="booking-kicker"><span className="booking-kicker-dot"/> {form.eyebrow}</div>
        <h1>{form.headline}</h1>
        <p className="booking-lead">{form.description}</p>
        <div className="booking-highlights">
          <span><Icon name="clock"/> {form.durationMinutes} minutos</span>
          <span><Icon name="video"/> Reunião online</span>
          <span><Icon name="calendar"/> Horários em Brasília</span>
        </div>
        <div className="booking-note">
          <Icon name="shield"/>
          <p>Uma conversa direta para entender seu momento, objetivos e próximos passos.</p>
        </div>
      </section>

      <section className="booking-card" aria-label="Formulário e calendário de agendamento">
        <div className="booking-preview-banner"><strong>PRÉVIA EM DESENVOLVIMENTO</strong> · Use apenas dados fictícios. O cadastro será salvo no Neon Preview; nenhuma reunião será criada.</div>
        <div className="booking-card-inside">
          <div className="booking-progress">
            <span className={step >= 1 ? 'is-current' : ''}>01 <span>Seus dados</span></span>
            <i/>
            <span className={step >= 2 ? 'is-current' : ''}>02 <span>Horário</span></span>
            <i/>
            <span className={step >= 3 ? 'is-current' : ''}>03 <span>Revisão</span></span>
          </div>

          {step === 1 && question && <form className="booking-form booking-question-form"
            onSubmit={next} key={question.name}>
            <div className="booking-question-topline">
              <span>PERGUNTA {String(questionIndex + 1).padStart(2,'0')} DE {String(questions.length).padStart(2,'0')}</span>
              <span>{Math.round(progress * 100)}% concluído</span>
            </div>
            <div className="booking-step-meter" aria-label={Math.round(progress * 100) + '% do formulário concluído'}>
              <span style={{ width: progress * 100 + '%' }}/>
            </div>
            <div className="booking-card-heading booking-question-heading">
              <div className="booking-step-label">DIAGNÓSTICO / {form.niche.toUpperCase()}</div>
              <h2 id="booking-question-label">{question.label}</h2>
              <p>Uma resposta por vez. É rápido e você pode voltar quando quiser.</p>
            </div>
            <div className="booking-inputs booking-question-inputs">
              {question.type === 'select' ? <div className="booking-choices" role="group"
                  aria-labelledby="booking-question-label">
                {question.options?.map(option => <button
                  type="button" key={option}
                  className="booking-choice"
                  data-selected={attendee[question.name] === option}
                  aria-pressed={attendee[question.name] === option}
                  onClick={() => update(question.name, option)}>
                  <span>{option}</span><span className="booking-choice-indicator" aria-hidden="true">
                    {attendee[question.name] === option ? '✓' : ''}</span>
                </button>)}
              </div> : <label className="booking-question-field" htmlFor={'question-' + question.name}>
                <span className="booking-visually-hidden">{question.label}</span>
                <input id={'question-' + question.name} required
                  minLength={question.name === 'whatsapp' ? 10 : question.name === 'email' ? 5 : 2}
                  type={question.type} autoComplete={question.autoComplete}
                  autoFocus maxLength={question.type === 'email' ? 180 : question.type === 'tel' ? 24 : 120}
                  placeholder={question.placeholder} value={attendee[question.name]}
                  onChange={event => update(question.name, event.target.value)}/>
              </label>}
            </div>
            <div className="booking-question-footer">
              {questionIndex > 0 ? <button className="booking-secondary" type="button"
                onClick={backQuestion}><Icon name="back"/> Voltar</button> :
                <span className="booking-first-question-note">Primeiro passo</span>}
              <button className="booking-primary" type="submit"
                disabled={!attendee[question.name].trim()}>
                {questionIndex === questions.length - 1 ? 'Ver horários disponíveis' : 'Continuar'}
                <Icon name="arrow"/>
              </button>
            </div>
            <p className="booking-privacy">Prévia em desenvolvimento: suas respostas ficam apenas nesta tela e não são enviadas ao servidor. <a href="/politica-de-privacidade" target="_blank" rel="noreferrer">Política de Privacidade</a>.</p>
          </form>}

          {step === 2 && <div className="booking-schedule">
            <div className="booking-card-heading">
              <div className="booking-step-label">ETAPA 02 DE 03</div>
              <h2>Escolha seu melhor horário.</h2>
              <p>Selecione uma data e veja os horários disponíveis no Google Calendar.</p>
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
                  disabled={!today || !workingDate(day, today)}
                  onClick={() => { setDate(day); setChosen(null) }}
                  aria-pressed={date === day}
                  aria-label={humanDate(day)}>
                  {Number(day.slice(-2))}
                </button>
              ) : <span key={'empty-'+index} className="booking-empty-day"/>)}
            </div>
            <div className="booking-slots" aria-live="polite">
              <div className="booking-slots-heading">
                <strong>{date ? humanDate(date) : 'Selecione um dia'}</strong>
                <small>Horário de Brasília · 30 minutos</small>
              </div>
              {!date && <p className="booking-calendar-hint">Escolha uma data destacada no calendário para consultar os horários.</p>}
              {loading && <p className="booking-calendar-hint">Consultando disponibilidade real…</p>}
              {failed && <div className="booking-availability-error" role="alert">
                Não foi possível consultar a agenda agora.
                <button type="button" onClick={() => setRetry(v => v + 1)}>Tentar novamente</button>
              </div>}
              {!loading && !failed && date && slots.length === 0 &&
                <p className="booking-calendar-hint">Não há horários disponíveis para esta data. Escolha outro dia.</p>}
              {!loading && !failed && slots.length > 0 &&
                <div className="booking-time-grid">
                  {slots.map(slot => <button type="button" key={slot.startAt}
                    data-selected={chosen?.startAt === slot.startAt}
                    aria-pressed={chosen?.startAt === slot.startAt}
                    onClick={() => setChosen(slot)}>{slot.localTime}</button>)}
                </div>}
            </div>
            <div className="booking-actions">
              <button type="button" className="booking-secondary" onClick={() => { setStep(1); setQuestionIndex(questions.length - 1); setChosen(null) }}>
                <Icon name="back"/> Voltar
              </button>
              <button type="button" className="booking-primary" disabled={!chosen || loading || failed}
                onClick={() => setStep(3)}>Revisar agendamento <Icon name="arrow"/></button>
            </div>
          </div>}

          {step === 3 && <div className="booking-review">
            <div className="booking-card-heading">
              <div className="booking-step-label">ETAPA 03 DE 03</div>
              <h2>Confira sua seleção.</h2>
              <p>Este é um resumo visual para validar a experiência. Ainda não cria um compromisso real.</p>
            </div>
            <div className="booking-review-list">
              <div><small>DIAGNÓSTICO</small><strong>{form.meetingName}</strong></div>
              <div><small>DATA</small><strong>{date && humanDate(date)}</strong></div>
              <div><small>HORÁRIO</small><strong>{chosen?.localTime} · Brasília · {form.durationMinutes} minutos</strong></div>
              <div><small>PARTICIPANTE</small><strong>{attendee.name}</strong></div>
              <div><small>CLÍNICA</small><strong>{attendee.clinic}</strong></div>
            </div>
            <div className="booking-demo-confirm"><Icon name="shield"/>
              <span>Prévia de interface. O botão de confirmação real será ativado somente após implementarmos a criação de eventos, a prevenção de conflitos e os registros no Neon.</span>
            </div>
            <button type="button" className="booking-secondary booking-back-full"
              onClick={() => setStep(2)}><Icon name="back"/> Escolher outro horário</button>
            <button className="booking-primary" type="button" disabled>
              Confirmar reunião (em desenvolvimento) <Icon name="check"/>
            </button>
          </div>}
        </div>
      </section>
    </main>
    <footer className="booking-footer"><span>© Cassiellos · Experiência em desenvolvimento</span>
      <span>Ambiente Preview · {form.niche}</span></footer>
  </div>
}
