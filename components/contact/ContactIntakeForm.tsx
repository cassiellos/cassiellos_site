'use client'

import { useEffect, useRef, useState } from 'react'
import { track } from '@vercel/analytics'
import { WHATSAPP_CONTACT_URL } from '@/lib/site-links'
import styles from './contact-intake-form.module.css'

type Locale = 'pt' | 'en'
type Errors = Record<string, string>
type SubmitState = 'idle' | 'sending' | 'success' | 'error'

const GOALS_PT = [
  'Atrair mais clientes',
  'Aumentar vendas',
  'Melhorar a presença da marca',
  'Produzir conteúdo com mais consistência',
  'Organizar o marketing',
  'Melhorar anúncios e campanhas',
  'Criar ou reposicionar a marca',
  'Criar site ou experiência digital',
  'Melhorar vídeos e conteúdo audiovisual',
  'Entender melhor os resultados',
  'Outro',
]

const GOALS_EN = [
  'Attract more customers',
  'Increase sales',
  'Improve brand presence',
  'Produce content more consistently',
  'Organize marketing',
  'Improve ads and campaigns',
  'Create or reposition the brand',
  'Create a website or digital experience',
  'Improve video and audiovisual content',
  'Understand results better',
  'Other',
]

const MARKETING_SETUP_PT = [
  'Temos equipe interna',
  'Trabalhamos com agência ou freelancers',
  'Produzimos internamente, mas sem uma estrutura definida',
  'Fazemos anúncios',
  'Produzimos conteúdo para redes sociais',
  'Temos site',
  'Temos CRM ou sistema comercial',
  'Ainda fazemos muito pouco marketing',
  'Não sei / quero ajuda para entender isso',
]

const MARKETING_SETUP_EN = [
  'We have an internal team',
  'We work with an agency or freelancers',
  'We produce internally without a defined structure',
  'We run ads',
  'We create social media content',
  'We have a website',
  'We have a CRM or sales system',
  'We still do very little marketing',
  'I am not sure / I want help understanding this',
]

const CHANNELS = ['Instagram', 'Facebook', 'TikTok', 'YouTube', 'Google', 'Meta Ads', 'Google Ads', 'WhatsApp', 'Site', 'E-mail', 'Loja física', 'Outro']
const CHANNELS_EN = ['Instagram', 'Facebook', 'TikTok', 'YouTube', 'Google', 'Meta Ads', 'Google Ads', 'WhatsApp', 'Website', 'Email', 'Physical store', 'Other']

const INVESTMENT_PT = [
  'Ainda não definimos',
  'Até R$ 2 mil/mês',
  'R$ 2 mil – R$ 5 mil/mês',
  'R$ 5 mil – R$ 10 mil/mês',
  'R$ 10 mil – R$ 20 mil/mês',
  'Acima de R$ 20 mil/mês',
  'Prefiro conversar sobre isso',
]

const INVESTMENT_EN = [
  'Not defined yet',
  'Up to R$ 2k/month',
  'R$ 2k – R$ 5k/month',
  'R$ 5k – R$ 10k/month',
  'R$ 10k – R$ 20k/month',
  'Above R$ 20k/month',
  'I prefer to discuss this',
]

const TIMING_PT = ['O quanto antes', 'Nas próximas semanas', 'Nos próximos 1–3 meses', 'Estou apenas pesquisando possibilidades']
const TIMING_EN = ['As soon as possible', 'In the next few weeks', 'In the next 1–3 months', 'I am only researching possibilities']

function ChipGroup({ name, legend, options, error, required = false }: { name: string; legend: string; options: string[]; error?: string; required?: boolean }) {
  const errorId = `${name}-error`
  return (
    <fieldset className={styles.choiceField} aria-describedby={error ? errorId : undefined} aria-invalid={Boolean(error)}>
      <legend>{legend}{required ? <span aria-hidden="true"> *</span> : null}</legend>
      <div className={styles.chips}>
        {options.map((option) => (
          <label className={styles.chip} key={option}>
            <input type="checkbox" name={name} value={option} />
            <span>{option}</span>
          </label>
        ))}
      </div>
      {error ? <p className={styles.errorText} id={errorId}>{error}</p> : null}
    </fieldset>
  )
}

function FieldError({ name, error }: { name: string; error?: string }) {
  return error ? <p className={styles.errorText} id={`${name}-error`}>{error}</p> : null
}

export default function ContactIntakeForm({ lang = 'pt' }: { lang?: Locale }) {
  const en = lang === 'en'
  const formRef = useRef<HTMLFormElement>(null)
  const startedRef = useRef(false)
  const requestTokenRef = useRef<string>('')
  const [errors, setErrors] = useState<Errors>({})
  const [submitState, setSubmitState] = useState<SubmitState>('idle')

  useEffect(() => {
    requestTokenRef.current = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
    track('contact_form_view')
  }, [])

  const copy = en ? {
    eyebrow: 'NEXT MOVE',
    title: 'Tell us where your company is today.',
    body: 'Answer a few quick questions so Cassiellos can understand your business, what you want to improve and how we can start this conversation with more context.',
    time: 'Takes about 3 to 5 minutes.',
    prefer: 'Prefer to talk now?',
    whatsapp: 'I want to organize my marketing',
    submit: 'Send to Cassiellos',
    sending: 'Sending...',
    required: 'Required fields are marked with *.',
    groups: ['01 / YOU', '02 / YOUR COMPANY', '03 / CURRENT MOMENT', '04 / WHAT YOU WANT TO ACHIEVE'],
  } : {
    eyebrow: 'PRÓXIMO MOVIMENTO',
    title: 'Conte o momento da sua empresa.',
    body: 'Responda algumas perguntas rápidas para a Cassiellos entender seu negócio, o que você quer melhorar e como podemos começar essa conversa com mais contexto.',
    time: 'Leva cerca de 3 a 5 minutos.',
    prefer: 'Prefere falar agora?',
    whatsapp: 'Quero organizar meu marketing',
    submit: 'Enviar para a Cassiellos',
    sending: 'Enviando...',
    required: 'Campos obrigatórios estão marcados com *.',
    groups: ['01 / VOCÊ', '02 / SUA EMPRESA', '03 / O MOMENTO ATUAL', '04 / O QUE VOCÊ QUER ALCANÇAR'],
  }

  function markStarted() {
    if (startedRef.current) return
    startedRef.current = true
    track('contact_form_start')
  }

  function validate(data: FormData) {
    const next: Errors = {}
    const value = (name: string) => String(data.get(name) || '').trim()
    if (!value('name')) next.name = en ? 'Enter your name.' : 'Informe seu nome.'
    if (!value('whatsapp')) next.whatsapp = en ? 'Enter your WhatsApp number.' : 'Informe seu WhatsApp.'
    if (!value('company')) next.company = en ? 'Enter your company or brand.' : 'Informe sua empresa ou marca.'
    if (!value('segment')) next.segment = en ? 'Enter your business segment.' : 'Informe o segmento.'
    if (!value('location')) next.location = en ? 'Enter your city or region.' : 'Informe sua cidade ou região.'
    if (data.getAll('goals').length === 0) next.goals = en ? 'Select at least one priority.' : 'Selecione pelo menos uma prioridade.'
    if (!value('main_challenge')) next.main_challenge = en ? 'Briefly describe the main challenge.' : 'Conte brevemente qual é o principal desafio.'
    if (!value('success_definition')) next.success_definition = en ? 'Tell us what success would look like.' : 'Conte o que faria esse trabalho dar certo.'
    if (!data.get('privacy_consent')) next.privacy_consent = en ? 'Consent is required so we can contact you.' : 'É necessário concordar para que possamos entrar em contato.'
    const email = value('email')
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = en ? 'Enter a valid email.' : 'Informe um e-mail válido.'
    return next
  }

  function focusFirstError(next: Errors) {
    const first = Object.keys(next)[0]
    if (!first) return
    requestAnimationFrame(() => {
      const target = formRef.current?.querySelector<HTMLElement>(`[name="${first}"]`)
      target?.focus()
    })
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitState === 'sending') return

    const form = event.currentTarget
    const formData = new FormData(form)
    const nextErrors = validate(formData)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) {
      focusFirstError(nextErrors)
      return
    }

    setSubmitState('sending')
    track('contact_form_submit')

    const text = (name: string) => String(formData.get(name) || '').trim()
    const params = new URLSearchParams(window.location.search)
    const payload = {
      request_token: requestTokenRef.current,
      name: text('name'),
      role: text('role'),
      whatsapp: text('whatsapp'),
      email: text('email'),
      company: text('company'),
      segment: text('segment'),
      location: text('location'),
      website_or_instagram: text('website_or_instagram'),
      goals: formData.getAll('goals').map(String),
      main_challenge: text('main_challenge'),
      marketing_setup: formData.getAll('marketing_setup').map(String),
      channels: formData.getAll('channels').map(String),
      success_definition: text('success_definition'),
      investment_range: text('investment_range'),
      start_timing: text('start_timing'),
      additional_context: text('additional_context'),
      privacy_consent: formData.get('privacy_consent') === 'on',
      company_website_confirm: text('company_website_confirm'),
      locale: lang,
      page_url: window.location.href,
      utm_source: params.get('utm_source') || '',
      utm_medium: params.get('utm_medium') || '',
      utm_campaign: params.get('utm_campaign') || '',
      utm_content: params.get('utm_content') || '',
      utm_term: params.get('utm_term') || '',
    }

    try {
      const response = await fetch('/api/prospects/inbound', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await response.json().catch(() => null)
      if (!response.ok || result?.ok !== true || result?.effect !== 'COMPLETE') throw new Error('NO_WRITE')
      setSubmitState('success')
      track('contact_form_success')
    } catch {
      setSubmitState('error')
      track('contact_form_error')
    }
  }

  if (submitState === 'success') {
    return (
      <section className={styles.section} id="contato" aria-labelledby="contact-success-title">
        <div className={`wrap ${styles.successWrap}`}>
          <span className={`tag ${styles.eyebrow}`}>{copy.eyebrow}</span>
          <h2 id="contact-success-title">{en ? 'We received your context.' : 'Recebemos seu contexto.'}</h2>
          <p>{en ? 'Thank you. We now know a little more about your company and can continue the conversation without starting from zero.' : 'Obrigado. Agora já sabemos um pouco mais sobre sua empresa e podemos continuar a conversa sem começar do zero.'}</p>
          <a className="btn" href={WHATSAPP_CONTACT_URL} target="_blank" rel="noopener noreferrer">{en ? 'Continue on WhatsApp' : 'Continuar no WhatsApp'}</a>
        </div>
      </section>
    )
  }

  return (
    <section className={styles.section} id="contato" aria-labelledby="contact-intake-title">
      <div className={`wrap ${styles.grid}`}>
        <div className={styles.intro}>
          <span className={`tag ${styles.eyebrow}`}>{copy.eyebrow}</span>
          <h2 id="contact-intake-title">{copy.title}</h2>
          <p className={styles.lead}>{copy.body}</p>
          <p className={styles.time}>{copy.time}</p>
          <div className={styles.whatsappCard}>
            <span>{copy.prefer}</span>
            <a className="btn" href={WHATSAPP_CONTACT_URL} target="_blank" rel="noopener noreferrer">{copy.whatsapp}</a>
          </div>
        </div>

        <form ref={formRef} className={styles.form} onSubmit={onSubmit} onChange={markStarted} noValidate>
          <p className={styles.requiredNote}>{copy.required}</p>
          <div className={styles.honeypot} aria-hidden="true">
            <label htmlFor="company_website_confirm">Website confirmation</label>
            <input id="company_website_confirm" name="company_website_confirm" type="text" tabIndex={-1} autoComplete="off" />
          </div>

          <fieldset className={styles.group}>
            <legend>{copy.groups[0]}</legend>
            <div className={styles.twoCols}>
              <label className={styles.field}> <span>{en ? 'Name' : 'Nome'} *</span><input name="name" type="text" maxLength={100} autoComplete="name" aria-invalid={Boolean(errors.name)} aria-describedby={errors.name ? 'name-error' : undefined} /><FieldError name="name" error={errors.name} /></label>
              <label className={styles.field}> <span>{en ? 'Role / position' : 'Cargo / função'}</span><input name="role" type="text" maxLength={100} autoComplete="organization-title" /></label>
              <label className={styles.field}> <span>WhatsApp *</span><input name="whatsapp" type="tel" maxLength={40} inputMode="tel" autoComplete="tel" aria-invalid={Boolean(errors.whatsapp)} aria-describedby={errors.whatsapp ? 'whatsapp-error' : undefined} /><FieldError name="whatsapp" error={errors.whatsapp} /></label>
              <label className={styles.field}> <span>E-mail</span><input name="email" type="email" maxLength={254} inputMode="email" autoComplete="email" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? 'email-error' : undefined} /><FieldError name="email" error={errors.email} /></label>
            </div>
          </fieldset>

          <fieldset className={styles.group}>
            <legend>{copy.groups[1]}</legend>
            <div className={styles.twoCols}>
              <label className={styles.field}> <span>{en ? 'Company or brand name' : 'Nome da empresa ou marca'} *</span><input name="company" type="text" maxLength={150} autoComplete="organization" aria-invalid={Boolean(errors.company)} aria-describedby={errors.company ? 'company-error' : undefined} /><FieldError name="company" error={errors.company} /></label>
              <label className={styles.field}> <span>{en ? 'Segment' : 'Segmento'} *</span><input name="segment" type="text" maxLength={150} placeholder={en ? 'Example: education, retail, services...' : 'Ex.: educação, varejo, serviços...'} aria-invalid={Boolean(errors.segment)} aria-describedby={errors.segment ? 'segment-error' : undefined} /><FieldError name="segment" error={errors.segment} /></label>
              <label className={styles.field}> <span>{en ? 'City / region' : 'Cidade / região'} *</span><input name="location" type="text" maxLength={150} autoComplete="address-level2" aria-invalid={Boolean(errors.location)} aria-describedby={errors.location ? 'location-error' : undefined} /><FieldError name="location" error={errors.location} /></label>
              <label className={styles.field}> <span>{en ? 'Website or Instagram' : 'Site ou Instagram'}</span><input name="website_or_instagram" type="text" maxLength={500} inputMode="url" placeholder="https://" /></label>
            </div>
          </fieldset>

          <fieldset className={styles.group}>
            <legend>{copy.groups[2]}</legend>
            <ChipGroup name="marketing_setup" legend={en ? 'How does marketing work today?' : 'Como o marketing funciona hoje?'} options={en ? MARKETING_SETUP_EN : MARKETING_SETUP_PT} />
            <ChipGroup name="channels" legend={en ? 'Which channels do you use?' : 'Quais canais vocês usam?'} options={en ? CHANNELS_EN : CHANNELS} />
            <label className={styles.field}> <span>{en ? 'What is the main challenge today?' : 'Qual é o principal desafio hoje?'} *</span><textarea name="main_challenge" maxLength={1500} rows={4} placeholder={en ? 'Tell us what is happening today and what you would like to work better.' : 'Conte o que está acontecendo hoje e o que gostaria que funcionasse melhor.'} aria-invalid={Boolean(errors.main_challenge)} aria-describedby={errors.main_challenge ? 'main_challenge-error' : undefined} /><FieldError name="main_challenge" error={errors.main_challenge} /></label>
            <div className={styles.twoCols}>
              <label className={styles.field}><span>{en ? 'Is there a planned marketing budget?' : 'Hoje existe um orçamento ou faixa de investimento prevista para marketing?'}</span><select name="investment_range" defaultValue=""><option value="">{en ? 'Select if you want' : 'Selecione se quiser'}</option>{(en ? INVESTMENT_EN : INVESTMENT_PT).map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
              <label className={styles.field}><span>{en ? 'When would you like to start?' : 'Quando você gostaria de começar?'}</span><select name="start_timing" defaultValue=""><option value="">{en ? 'Select if you want' : 'Selecione se quiser'}</option>{(en ? TIMING_EN : TIMING_PT).map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
            </div>
          </fieldset>

          <fieldset className={styles.group}>
            <legend>{copy.groups[3]}</legend>
            <ChipGroup name="goals" legend={en ? 'What does your company most need to improve today?' : 'O que sua empresa mais precisa melhorar hoje?'} options={en ? GOALS_EN : GOALS_PT} error={errors.goals} required />
            <label className={styles.field}> <span>{en ? 'What would make you consider this work successful?' : 'O que faria você considerar que esse trabalho deu certo?'} *</span><textarea name="success_definition" maxLength={1500} rows={4} placeholder={en ? 'More leads? More sales? A more professional brand? More consistency? Less operational work?' : 'Mais leads? Mais vendas? Mais matrículas? Uma marca mais profissional? Mais consistência? Menos trabalho operacional?'} aria-invalid={Boolean(errors.success_definition)} aria-describedby={errors.success_definition ? 'success_definition-error' : undefined} /><FieldError name="success_definition" error={errors.success_definition} /></label>
            <label className={styles.field}> <span>{en ? 'Anything else we should know?' : 'Tem mais alguma coisa que deveríamos saber?'}</span><textarea name="additional_context" maxLength={2000} rows={4} placeholder={en ? 'An upcoming launch, a specific difficulty, a reference or any context that can help.' : 'Um lançamento próximo, dificuldade específica, referência, contexto da empresa ou qualquer informação que possa ajudar.'} /></label>
          </fieldset>

          <label className={`${styles.consent} ${errors.privacy_consent ? styles.consentError : ''}`}>
            <input name="privacy_consent" type="checkbox" aria-invalid={Boolean(errors.privacy_consent)} aria-describedby={errors.privacy_consent ? 'privacy_consent-error' : undefined} />
            <span>{en ? <>I have read and agree to the <a href="/politica-de-privacidade">Privacy Policy</a> and authorize Cassiellos to use this data to contact me about my request.</> : <>Li e concordo com a <a href="/politica-de-privacidade">Política de Privacidade</a> e autorizo a Cassiellos a usar estes dados para entrar em contato sobre minha solicitação.</>}</span>
          </label>
          <FieldError name="privacy_consent" error={errors.privacy_consent} />

          {submitState === 'error' ? (
            <div className={styles.statusError} role="alert" tabIndex={-1}>
              <strong>{en ? 'We could not send it right now.' : 'Não conseguimos enviar agora.'}</strong>
              <p>{en ? 'Your answers are still on this page. Try again or talk directly to Cassiellos on WhatsApp.' : 'Suas respostas continuam nesta página. Tente novamente ou fale diretamente com a Cassiellos pelo WhatsApp.'}</p>
              <a href={WHATSAPP_CONTACT_URL} target="_blank" rel="noopener noreferrer">{en ? 'Talk on WhatsApp' : 'Falar pelo WhatsApp'}</a>
            </div>
          ) : null}

          <div className={styles.submitRow}>
            <button className="btn" type="submit" disabled={submitState === 'sending'}>{submitState === 'sending' ? copy.sending : copy.submit}</button>
            <span aria-live="polite" className={styles.liveStatus}>{submitState === 'sending' ? copy.sending : submitState === 'error' ? (en ? 'Submission failed. Your answers were preserved.' : 'Falha no envio. Suas respostas foram preservadas.') : ''}</span>
          </div>
        </form>
      </div>
    </section>
  )
}
