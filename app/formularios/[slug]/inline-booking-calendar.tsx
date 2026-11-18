'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CONSENT_CHANGE_EVENT } from '@/lib/privacy/consent-client'
import { readMarketingConsent, trackMetaConversion } from '@/lib/marketing/meta-client'
import { buildIcs, googleCalendarTemplateUrl } from '@/lib/crm/calendar-links'

type Slot = { startAt: string; endAt: string; localTime: string }
type CalendarWindow = { today: string; lastDate: string; closedDates: string[] }
type Meeting = {
  bookingRequestId: string
  startAt: string
  endAt: string
  title: string
  googleMeetUrl: string | null
  invitationRequested: boolean
}
type Props = {
  formSlug: string
  bookingToken: string | null
  email: string
  previewOnly?: boolean
  bookingEnabled?: boolean
}

const WEEKDAYS = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']
const MEET_URL = /^https:\/\/meet\.google\.com\/[a-z0-9-]{3,64}(?:\?[^\s]*)?$/i
const isDay = (day: unknown): day is string => typeof day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(day)
const toNoonUTC = (day: string) => new Date(day + 'T12:00:00Z')
const dateLabel = (day: string) => new Intl.DateTimeFormat('pt-BR',
  { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(toNoonUTC(day))
const monthLabel = (month: string) => new Intl.DateTimeFormat('pt-BR',
  { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(toNoonUTC(month + '-01'))
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const isSlot = (value: unknown): value is Slot => isRecord(value) &&
  typeof value.startAt === 'string' && typeof value.endAt === 'string' &&
  typeof value.localTime === 'string'

export function shiftCalendarMonth(month: string, delta: number): string {
  const [year, number] = month.split('-').map(Number)
  const date = new Date(Date.UTC(year, number - 1 + delta, 1, 12))
  return date.toISOString().slice(0, 7)
}
export function calendarDays(month: string): (string | null)[] {
  if (!/^\d{4}-\d{2}$/.test(month)) return []
  const [year, number] = month.split('-').map(Number)
  const offset = (new Date(Date.UTC(year, number - 1, 1, 12)).getUTCDay() + 6) % 7
  const total = new Date(Date.UTC(year, number, 0, 12)).getUTCDate()
  return [...Array.from({ length: offset }, () => null),
    ...Array.from({ length: total }, (_, i) => month + '-' + String(i + 1).padStart(2, '0'))]
}

/**
 * A etapa é renderizada DENTRO do formulário de Hamburguerias após o cadastro.
 * Reutiliza as APIs oficiais /api/booking/calendar, /availability e /confirm,
 * a sessão assinada emitida na mesma inscrição e as travas anti-duplicação do CRM.
 * Nenhum dado de contato é pedido outra vez.
 */
export default function InlineBookingCalendar({
  formSlug, bookingToken, email, previewOnly = false, bookingEnabled = true,
}: Props) {
  const [calendar, setCalendar] = useState<CalendarWindow | null>(null)
  const [month, setMonth] = useState('')
  const [day, setDay] = useState('')
  const [slots, setSlots] = useState<Slot[]>([])
  const [chosen, setChosen] = useState<Slot | null>(null)
  const [loadingCalendar, setLoadingCalendar] = useState(true)
  const [loadingSlots, setLoadingSlots] = useState(false)
  const [calendarError, setCalendarError] = useState('')
  const [slotsError, setSlotsError] = useState('')
  const [confirmError, setConfirmError] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [mustReview, setMustReview] = useState(false)
  const [confirmed, setConfirmed] = useState<Meeting | null>(null)
  const [reloadCalendar, setReloadCalendar] = useState(0)
  const [reloadSlots, setReloadSlots] = useState(0)
  const inFlight = useRef(false)
  const lastConsent = useRef<boolean | null>(null)
  const days = useMemo(() => calendarDays(month), [month])

  useEffect(() => {
    const controller = new AbortController()
    setLoadingCalendar(true); setCalendarError('')
    fetch('/api/booking/calendar?form=' + encodeURIComponent(formSlug), {
      cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw Error('CALENDAR_UNAVAILABLE')
      const result: unknown = await response.json()
      if (!isRecord(result) || !isDay(result.today) || !isDay(result.lastDate) ||
        !Array.isArray(result.closedDates)) throw Error('CALENDAR_UNAVAILABLE')
      return { today: result.today, lastDate: result.lastDate,
        closedDates: result.closedDates.filter(isDay) }
    }).then(result => {
      if (controller.signal.aborted) return
      setCalendar(result);setMonth(result.today.slice(0, 7))
    }).catch(() => {
      if (!controller.signal.aborted) setCalendarError('Não foi possível carregar a agenda. Tente novamente.')
    }).finally(() => {
      if (!controller.signal.aborted) setLoadingCalendar(false)
    })
    return () => controller.abort()
  }, [formSlug, reloadCalendar])

  useEffect(() => {
    if (!day || !calendar) return
    const controller = new AbortController()
    setLoadingSlots(true);setSlotsError('');setSlots([]);setChosen(null)
    fetch('/api/booking/availability?form=' + encodeURIComponent(formSlug) +
      '&date=' + encodeURIComponent(day), {
      cache:'no-store',credentials:'same-origin',signal:controller.signal,
    }).then(async response => {
      if (!response.ok) {
        const value: unknown = await response.json().catch(() => null)
        throw Error(isRecord(value) && typeof value.error === 'string' ? value.error : 'UNAVAILABLE')
      }
      const data: unknown = await response.json()
      if (!isRecord(data) || !Array.isArray(data.slots)) throw Error('UNAVAILABLE')
      return data.slots.filter(isSlot)
    }).then(list => {
      if (!controller.signal.aborted) setSlots(list)
    }).catch((error: unknown) => {
      if (controller.signal.aborted) return
      setSlotsError(error instanceof Error && error.message === 'TOO_MANY_REQUESTS'
        ? 'Muitas consultas em sequência. Aguarde alguns minutos e tente novamente.'
        : 'Não foi possível consultar os horários. Tente novamente.')
    }).finally(() => {
      if (!controller.signal.aborted) setLoadingSlots(false)
    })
    return () => controller.abort()
  }, [formSlug, day, calendar, reloadSlots])

  // Consentimento escolhido depois do envio é sincronizado com a sessão assinada;
  // a CAPI seguirá exigindo consentimento vigente do contato no CRM.
  useEffect(() => {
    if (previewOnly || !bookingToken) return
    const sync = () => {
      const choice = readMarketingConsent()
      if (!choice.decided || lastConsent.current === choice.consent) return
      const previous = lastConsent.current
      lastConsent.current = choice.consent
      fetch('/api/booking/consent', {
        method: 'POST', cache:'no-store', credentials:'same-origin', keepalive:true,
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({bookingToken, marketing: choice.consent}),
      }).then(response => {
        if (!response.ok) lastConsent.current = previous
      }).catch(() => { lastConsent.current = previous })
    }
    window.addEventListener(CONSENT_CHANGE_EVENT, sync)
    return () => window.removeEventListener(CONSENT_CHANGE_EVENT, sync)
  }, [previewOnly, bookingToken])

  async function confirmBooking() {
    if (previewOnly || !bookingEnabled || !bookingToken || !chosen ||
      confirming || inFlight.current || confirmed || mustReview) return
    inFlight.current = true
    setConfirming(true);setConfirmError('')
    try {
      const response = await fetch('/api/booking/confirm', {
        method:'POST',cache:'no-store',credentials:'same-origin',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({bookingToken,startAt:chosen.startAt}),
      })
      const value: unknown = await response.json().catch(() => null)
      if (!isRecord(value)) throw Error('BOOKING_UNAVAILABLE')
      if (!response.ok) throw Error(typeof value.error === 'string' ? value.error : 'BOOKING_UNAVAILABLE')
      if (value.ok !== true || typeof value.startAt !== 'string' ||
        typeof value.endAt !== 'string' || typeof value.bookingRequestId !== 'string') {
        throw Error('BOOKING_ALREADY_REGISTERED')
      }
      const meetUrl = typeof value.googleMeetUrl === 'string' && MEET_URL.test(value.googleMeetUrl)
        ? value.googleMeetUrl : null
      const meeting = {
        bookingRequestId:value.bookingRequestId,startAt:value.startAt,endAt:value.endAt,
        title:typeof value.meetingTitle==='string'?value.meetingTitle:'Diagnóstico estratégico para hamburguerias',
        googleMeetUrl:meetUrl,invitationRequested:value.invitationRequested===true,
      }
      setConfirmed(meeting)
      const schedule = isRecord(value.tracking) && isRecord(value.tracking.schedule) ? value.tracking.schedule : null
      if (value.alreadyConfirmed !== true && schedule && schedule.eventName === 'Schedule') {
        trackMetaConversion('Schedule',schedule.eventId,{content_name:formSlug})
      }
    } catch (error) {
      const code = error instanceof Error?error.message:'BOOKING_UNAVAILABLE'
      const messages:Record<string,string>={
        SLOT_UNAVAILABLE:'Esse horário acabou de ser reservado. Escolha outro dia ou horário.',
        INVALID_SLOT:'Não foi possível validar o horário. Escolha novamente.',
        BOOKING_SESSION_EXPIRED:'Sua sessão expirou. Reabra o formulário para solicitar outro agendamento.',
        TEST_EMAIL_NOT_ALLOWED:'O agendamento está limitado aos e-mails de teste autorizados.',
        CONTACT_HAS_ACTIVE_MEETING:'Já existe uma reunião ativa para este contato. Consulte sua confirmação.',
        BOOKING_LIMIT_REACHED:'Este contato atingiu o limite de agendamentos. Fale com a equipe.',
        BOOKING_ALREADY_PROCESSING:'Existe uma reserva em processamento. Não tente novamente para evitar duplicidades.',
        BOOKING_REQUIRES_REVIEW:'Seu pedido precisa de verificação manual. Não tente novamente para evitar reservas duplicadas.',
        BOOKING_ALREADY_REGISTERED:'Já existe uma reserva registrada para este cadastro. Fale com a equipe.',
        BOOKING_DISABLED:'A agenda não está disponível neste momento.',
      }
      setConfirmError(messages[code] ?? 'Não foi possível confirmar o horário. Consulte nossa equipe antes de tentar novamente.')
      if (code === 'SLOT_UNAVAILABLE' || code === 'INVALID_SLOT') {
        setChosen(null);setReloadSlots(n=>n+1)
      } else {
        // Falha após tentativa com Google pode ser ambígua. Não emitir outra criação.
        setMustReview(true)
      }
    } finally {
      inFlight.current = false;setConfirming(false)
    }
  }

  const pickable = (value: string) => Boolean(calendar &&
    value >= calendar.today && value <= calendar.lastDate &&
    !calendar.closedDates.includes(value))
  const firstMonth = calendar?.today.slice(0,7) ?? ''
  const lastMonth = calendar?.lastDate.slice(0,7) ?? ''

  if (confirmed) {
    return <div className="cpf-schedule-confirmed" role="status" aria-live="polite">
      <div className="cpf-schedule-success">✓ Agendamento confirmado</div>
      <h1>Sua reunião está marcada!</h1>
      <p>{dateLabel(confirmed.startAt.slice(0,10))} · {new Intl.DateTimeFormat('pt-BR',
        {timeZone:'America/Sao_Paulo',hour:'2-digit',minute:'2-digit'}).format(new Date(confirmed.startAt))} · Horário de Brasília</p>
      <p>Diagnóstico estratégico para hamburguerias com a Cassiellos, por Google Meet.</p>
      {confirmed.googleMeetUrl
        ? <a className="cpf-schedule-confirm-link" href={confirmed.googleMeetUrl}
            target="_blank" rel="noopener noreferrer">Abrir Google Meet</a>
        : <p>O horário está reservado. O link do Meet está sendo preparado.</p>}
      <p className="cpf-schedule-small">{confirmed.invitationRequested
        ? 'Solicitamos o envio do convite para seu e-mail. Confira também a caixa de spam.'
        : 'Guarde estas informações para consultar seu compromisso.'}</p>
      <div className="cpf-schedule-confirm-actions">
        <a href={googleCalendarTemplateUrl({
          title:confirmed.title,startAt:confirmed.startAt,endAt:confirmed.endAt,
          meetUrl:confirmed.googleMeetUrl,
        })} target="_blank" rel="noopener noreferrer">Adicionar ao Google Agenda</a>
        <button type="button" onClick={()=>{
          const content=buildIcs({uid:confirmed.bookingRequestId,title:confirmed.title,
            startAt:confirmed.startAt,endAt:confirmed.endAt,meetUrl:confirmed.googleMeetUrl})
          const url=URL.createObjectURL(new Blob([content],{type:'text/calendar;charset=utf-8'}))
          const anchor=document.createElement('a')
          anchor.href=url;anchor.download='diagnostico-cassiellos.ics';anchor.click()
          window.setTimeout(()=>URL.revokeObjectURL(url),1000)
        }}>Salvar na agenda do celular (.ics)</button>
      </div>
    </div>
  }

  return <div className="cpf-scheduling" aria-label="Escolha de data e horário para o diagnóstico">
    <div className="cpf-schedule-heading">
      <span className="cpf-schedule-eyebrow">ÚLTIMA ETAPA · AGENDAMENTO</span>
      <h1>Agora escolha sua data e horário</h1>
      <p>Seus dados já foram recebidos. Selecione um horário disponível para uma conversa de 30 minutos com a equipe Cassiellos.</p>
      <span className="cpf-schedule-contact">Agendamento para: {email}</span>
    </div>
    {!previewOnly&&!bookingEnabled&&
      <p className="cpf-schedule-error" role="alert">A agenda está temporariamente indisponível. Seu contato já foi registrado; nossa equipe poderá dar continuidade.</p>}
    {loadingCalendar&&<p className="cpf-schedule-note" role="status">Carregando calendário...</p>}
    {calendarError&&<div className="cpf-schedule-error" role="alert">{calendarError}
      <button type="button" onClick={()=>setReloadCalendar(n=>n+1)}>Tentar novamente</button>
    </div>}
    {calendar&&<div className="cpf-calendar-layout">
      <div className="cpf-calendar-panel">
        <div className="cpf-calendar-toolbar">
          <strong>{monthLabel(month)}</strong>
          <div className="cpf-calendar-arrows">
            <button type="button" aria-label="Mês anterior" disabled={month<=firstMonth}
              onClick={()=>{setMonth(m=>shiftCalendarMonth(m,-1));setDay('');setChosen(null)}}>‹</button>
            <button type="button" aria-label="Próximo mês" disabled={month>=lastMonth}
              onClick={()=>{setMonth(m=>shiftCalendarMonth(m,1));setDay('');setChosen(null)}}>›</button>
          </div>
        </div>
        <div className="cpf-calendar-days">
          {WEEKDAYS.map(label=><span className="cpf-calendar-weekday" key={label}>{label}</span>)}
          {days.map((date,index)=>date
            ? <button key={date} type="button" className="cpf-calendar-day"
                disabled={!pickable(date)||confirming} aria-label={dateLabel(date)}
                aria-pressed={date===day} data-selected={date===day}
                onClick={()=>{setDay(date);setChosen(null);setConfirmError('')}}>
                {Number(date.slice(-2))}
              </button>
            : <span key={'blank-'+index} aria-hidden="true"/>)}
        </div>
      </div>
      <div className="cpf-calendar-times" aria-live="polite">
        <h2>{day?dateLabel(day):'Selecione uma data'}</h2>
        <p>Horário de Brasília · 30 minutos</p>
        {!day&&<p className="cpf-schedule-note">Escolha um dia disponível no calendário.</p>}
        {loadingSlots&&<p className="cpf-schedule-note">Consultando horários disponíveis...</p>}
        {slotsError&&<div className="cpf-schedule-error" role="alert">{slotsError}
          <button type="button" onClick={()=>setReloadSlots(n=>n+1)}>Tentar novamente</button>
        </div>}
        {day&&!loadingSlots&&!slotsError&&slots.length===0&&
          <p className="cpf-schedule-note">Não há horários disponíveis neste dia. Selecione outra data.</p>}
        {slots.length>0&&!loadingSlots&&<div className="cpf-calendar-slot-list">
          {slots.map(slot=><button key={slot.startAt} type="button"
            disabled={confirming||mustReview||!bookingEnabled} data-selected={chosen?.startAt===slot.startAt}
            aria-pressed={chosen?.startAt===slot.startAt}
            onClick={()=>{setChosen(slot);setConfirmError('')}}>{slot.localTime}</button>)}
        </div>}
      </div>
    </div>}
    {chosen&&<div className="cpf-calendar-submit">
      <p>✓ {dateLabel(day)} às {chosen.localTime} · 30 minutos</p>
      {previewOnly
        ? <p className="cpf-schedule-note">Prévia: os horários são apenas para visualização. Nenhuma reunião será criada.</p>
        : <button type="button" className="cpf-primary"
            disabled={!bookingEnabled||confirming||mustReview||!bookingToken}
            onClick={()=>void confirmBooking()}>
            {confirming?'Confirmando com o Google Agenda...':'Confirmar meu agendamento'}
          </button>}
    </div>}
    {confirmError&&<p className="cpf-schedule-error" role="alert">{confirmError}</p>}
    {mustReview&&<p className="cpf-schedule-note">Se o horário não foi confirmado, nossa equipe poderá verificar o pedido. Não é necessário preencher o formulário outra vez.</p>}
  </div>
}
