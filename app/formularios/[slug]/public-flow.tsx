'use client'
import { useState, useRef, useEffect, useMemo, type FormEvent } from 'react'
import type { FlowDefinition, FlowStep, FlowResult } from '@/lib/crm/form-builder/flow'
import { TURNSTILE_BOOKING_ACTION } from '@/lib/crm/turnstile'
import TurnstileWidget from '@/app/agendar/[slug]/turnstile-widget'
import { nextPhoneInput, validateBrazilianMobilePhone, validateEmailAddress, nationalPhoneDigits } from '@/lib/crm/contact-validation'
import { isValidWebPresence } from '@/lib/crm/booking-forms'
import MetaPixel from '@/components/marketing/meta-pixel'
import InlineBookingCalendar from './inline-booking-calendar'
import ConsentNotice from '@/components/privacy/consent-notice'
import ConsentEntryBanner from '@/components/privacy/consent-entry-banner'
import { readMarketingConsent, trackMetaConversion } from '@/lib/marketing/meta-client'
import GoogleTagManager from '@/components/tracking/google-tag-manager'
import { CONSENT_CHANGE_EVENT } from '@/lib/privacy/consent-client'
import { isTestEmailDomain } from '@/lib/crm/booking-mode'
import { pushTrackingEvent } from '@/lib/tracking/datalayer-client'
import { DEFAULT_FUNNEL_STAGE, flowStepOrder, formVersionLabel, type TrackingEventName, type TrackingMode } from '@/lib/tracking/funnel-contract'

type Confirmation = Pick<FlowResult,'title'|'description'|'actionLabel'|'actionHref'|'outcome'>
type PublicFlowProps = {slug:string;title:string;description:string;version:number;flow:FlowDefinition;turnstileSiteKey:string|null;metaPixelId:string|null;customScheduleEnabled?:boolean;previewOnly?:boolean;trackingMode?:'live'|'test';gtmContainerId?:string|null}
// Apenas apresentação: preserva os textos do CRM, destacando a promessa como na referência.
function coverHeadline(text: string) {
  const match=text.match(/^(.*?)(vender mais!?)(\s*)$/iu)
  if(!match)return text
  return <>{match[1]}<strong>{match[2]}</strong>{match[3]}</>
}
function coverCtaLabel(text: string) {
  return text.toLocaleLowerCase('pt-BR').replace(/(^|\s)(\p{L})/gu,(_,prefix: string,letter: string)=>
    prefix+letter.toLocaleUpperCase('pt-BR'))
}
export default function PublicFlow({slug,title,description,version,flow,turnstileSiteKey,metaPixelId,customScheduleEnabled=false,previewOnly=false,trackingMode='test',gtmContainerId=null}:PublicFlowProps){
  const [visited,setVisited]=useState<string[]>([flow.start])
  const [coverOpen,setCoverOpen]=useState(Boolean(flow.cover))
  // Mesmo padrão aprovado no /agendar: nunca interromper a primeira pergunta com avisos de cookies.
  // Sem opção explícita, Analytics e Meta Pixel continuam desligados (consent-gated).
  const [showPrivacyPreferences,setShowPrivacyPreferences]=useState(false)
  const [answers,setAnswers]=useState<Record<string,string>>({})
  const [freeText,setFreeText]=useState('')
  const [name,setName]=useState('')
  const [email,setEmail]=useState('')
  const [whatsapp,setWhatsapp]=useState('')
  const [token,setToken]=useState<string|null>(null)
  const [tokenState,setTokenState]=useState('loading')
  const [resetSignal,setResetSignal]=useState(0)
  const [status,setStatus]=useState<'ready'|'sending'|'calendar'|'complete'>('ready')
  const [bookingToken,setBookingToken]=useState<string|null>(null)
  const [bookingEnabled,setBookingEnabled]=useState(true)
  const [error,setError]=useState('')
  const [complete,setComplete]=useState<Confirmation|null>(null)
  const [website,setWebsite]=useState('')
  const idempotencyKey=useRef<string>('')
  // Mensuração do funil (dataLayer). Modo: prévia nunca emite; "live" só vale para e-mail que não seja de teste e,
  // depois do cadastro, segue a classificação do servidor (leadMode = crm.leads.is_test).
  const [leadMode,setLeadMode]=useState<'live'|'test'|null>(null)
  const mode:TrackingMode=previewOnly?'preview':leadMode??(trackingMode==='live'&&email&&isTestEmailDomain(email)?'test':trackingMode)
  // Posição fixa de cada etapa no desenho do fluxo (igual para todos, mesmo com ramificações): entra como `step_order`
  // sempre que o evento traz um `step_id`, para o relatório ordenar o funil sem depender do caminho de cada visitante.
  const stepOrder=useMemo(()=>flowStepOrder(flow.start,flow.steps),[flow])
  function track(name:TrackingEventName,extra:Record<string,unknown>={},ref?:string|null){
    // A mensuração nunca pode atrapalhar o preenchimento nem o envio.
    try{
      const order=typeof extra.step_id==='string'?stepOrder[extra.step_id]:undefined
      pushTrackingEvent(name,{form_id:slug,form_version:formVersionLabel(version),flow_variant:flow.cover?'cover':'plain',
        environment_mode:mode,funnel_stage:DEFAULT_FUNNEL_STAGE[name],...(order===undefined?{}:{step_order:order}),...extra},ref)
    }catch{/* sem efeito sobre o formulário */}
  }
  const current=flow.steps.find(x=>x.id===visited[visited.length-1])
  const totalSteps=flow.steps.filter(s=>s.type==='question').length+1
  const currentStep=Math.min(visited.length,totalSteps)
  const phoneEntry=current?.type==='question'&&current.field==='phone'
  const phoneCompleted=phoneEntry&&validateBrazilianMobilePhone(freeText).ok
  const canBack=visited.length>1&&status==='ready'
  // form_view: ao carregar ou, se o consentimento vier depois, no momento do aceite (a deduplicação evita repetição).
  useEffect(()=>{
    const view=()=>track('form_view',flow.cover?{step_type:'cover'}:{})
    view()
    window.addEventListener(CONSENT_CHANGE_EVENT,view)
    return ()=>window.removeEventListener(CONSENT_CHANGE_EVENT,view)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[])
  // form_step_view: cada pergunta (e a etapa de contato) realmente exibida, uma vez por etapa e sessão.
  useEffect(()=>{
    if(coverOpen||status!=='ready'||!current)return
    const questionStep=current.type==='question'
    const view=()=>track('form_step_view',{step_id:current.id,step_index:visited.length-1,
      step_type:questionStep?'question':'contact',funnel_stage:questionStep?'questions':'capture'})
    view()
    window.addEventListener(CONSENT_CHANGE_EVENT,view)
    return ()=>window.removeEventListener(CONSENT_CHANGE_EVENT,view)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[current?.id,coverOpen,status])
  function next(step:Extract<FlowStep,{type:'question'}>,answer:string){
    // Só ids técnicos da etapa e códigos de erro vão para a mensuração; a resposta nunca.
    const at={step_id:step.id,step_index:visited.length-1,step_type:'question',funnel_stage:'questions'}
    const invalid=(code:string,message:string)=>{track('form_validation_error',{...at,validation_error_code:code});setError(message)}
    track('form_start',at)
    if(step.required&&answer.trim().length<2){invalid('REQUIRED','Preencha esta resposta para continuar.');return}
    if(step.input==='select'&&!step.options.includes(answer)){invalid('INVALID_OPTION','Selecione uma alternativa válida.');return}
    if(step.field==='phone'){
      const phone=validateBrazilianMobilePhone(answer)
      if(!phone.ok){invalid('INVALID_PHONE',phone.message);return}
    }
    if(step.field==='website'&&!isValidWebPresence(answer)){invalid('INVALID_WEBSITE','Informe o @ do Instagram ou um site válido.');return}
    const to=step.branches.find(b=>b.answer===answer)?.to||step.next
    if(!flow.steps.some(s=>s.id===to)||visited.includes(to)){
      invalid('PATH_UNAVAILABLE','O caminho configurado está indisponível.');return
    }
    track('form_step_complete',at)
    setAnswers(a=>({...a,[step.id]:answer.trim()}))
    if(step.field==='name')setName(answer.trim())
    if(step.field==='phone')setWhatsapp(nextPhoneInput('',answer.trim()))
    setVisited(h=>[...h,to]);setFreeText('');setError('')
  }
  function back(){
    if(!canBack)return
    track('form_step_back',{step_id:visited[visited.length-1],step_index:visited.length-1,
      step_type:current?.type==='question'?'question':'contact',funnel_stage:current?.type==='question'?'questions':'capture'})
    const removed=visited[visited.length-2]
    setVisited(h=>h.slice(0,-1))
    setAnswers(old=>{const a={...old};delete a[removed];return a})
    setFreeText(answers[removed]||'');setError('')
  }
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault()
    if(!current||current.type!=='result'||status!=='ready')return
    // A prévia usa o próprio componente visual, mas nunca envia dados ou eventos.
    if(previewOnly){
      // Permite conferir o calendário no editor sem criar lead ou reunião.
      if(current.outcome==='qualified'){
        setStatus('calendar');setError('');return
      }
      setComplete({title:current.title,description:current.description,outcome:current.outcome,
        actionLabel:current.actionLabel,actionHref:current.actionHref})
      setStatus('complete');setError('');return
    }
    const contactAt={step_id:current.id,step_index:visited.length-1,step_type:'contact',funnel_stage:'capture'}
    const invalid=(code:string,message:string)=>{track('form_validation_error',{...contactAt,validation_error_code:code});setError(message)}
    if(!token||!turnstileSiteKey){invalid('SECURITY_CHECK_PENDING','Conclua a verificação de segurança para continuar.');return}
    const emailResult=validateEmailAddress(email)
    if(!emailResult.ok){invalid('INVALID_EMAIL',emailResult.message);return}
    const phoneResult=validateBrazilianMobilePhone(whatsapp)
    if(!phoneResult.ok){invalid('INVALID_PHONE',phoneResult.message);return}
    if(!idempotencyKey.current)idempotencyKey.current=crypto.randomUUID()
    // Uma tentativa por inscrição (a chave de idempotência é a mesma em novas tentativas).
    track('lead_submit_attempt',contactAt,idempotencyKey.current)
    setStatus('sending');setError('')
    let failureCode='NETWORK_ERROR'
    try{
      const marketing=readMarketingConsent()
      const attribution:Record<string,string>={}
      const params=new URLSearchParams(window.location.search)
      for(const key of ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','gclid','fbclid']){
        const value=params.get(key)
        if(value && (key!=='fbclid' || marketing.consent))attribution[key]=value
      }
      const response=await fetch('/api/public/forms/'+encodeURIComponent(slug),{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name,email,whatsapp,answers,version,turnstileToken:token,
          idempotencyKey:idempotencyKey.current,contactRequest:true,attribution,marketing,website}),
      })
      failureCode='INVALID_RESPONSE'
      const data=await response.json()
      if(!response.ok){failureCode=typeof data?.error==='string'?data.error:'HTTP_'+response.status}
      if(!response.ok)throw Error(data.error==='FORM_UPDATED'?'Este formulário foi atualizado. Recarregue a página para continuar.':
        data.error==='TOO_MANY_REQUESTS'?'Muitas tentativas. Tente novamente mais tarde.':
        'Não foi possível enviar agora. Confira seus dados e tente novamente.')
      // Apenas o Lead novo e real devolvido pelo servidor. Pixel e CAPI usam o mesmo event_id.
      // O rastreamento também exige o consentimento de marketing atual no navegador.
      if(data?.reused!==true && data?.tracking?.lead?.eventName==='Lead'){
        trackMetaConversion('Lead',data.tracking.lead.eventId,{content_name:slug})
      }
      // generate_lead: SÓ depois da resposta positiva do servidor e apenas para cadastro novo (reenvio não conta).
      const serverMode=data?.leadMode==='live'||data?.leadMode==='test'?data.leadMode as 'live'|'test':null
      if(serverMode)setLeadMode(serverMode)
      if(data?.ok===true&&data?.reused!==true)track('generate_lead',{...contactAt,environment_mode:previewOnly?'preview':serverMode??mode},idempotencyKey.current)
      if(data.outcome==='qualified'&&data.inlineBooking===true){
        // Inscrição já salva e validada. A próxima tela é o calendário nesta MESMA página.
        // O token assinado vale só para o lead/submissão atuais, sem repetir cadastro.
        setBookingToken(typeof data.bookingToken==='string'?data.bookingToken:null)
        setBookingEnabled(data.bookingEnabled===true)
        setStatus('calendar')
      }else{
        setComplete({title:data.title,description:data.description,outcome:data.outcome,
          actionLabel:data.actionLabel,actionHref:data.actionHref})
        setStatus('complete')
      }
    }catch(e){
      track('lead_submit_error',{...contactAt,validation_error_code:failureCode})
      setError(e instanceof Error?e.message:'Não foi possível enviar.')
      setStatus('ready')
      setToken(null);setResetSignal(n=>n+1)
    }
  }
  return <main className="cassiellos-public-flow" data-chronos={Boolean(flow.cover)} data-screen={coverOpen?'cover':status==='calendar'?'calendar':status==='complete'?'complete':current?.type==='result'?'contact':'question'}>
    {!previewOnly&&<MetaPixel pixelId={metaPixelId}/>}
    {!previewOnly&&<GoogleTagManager containerId={gtmContainerId}/>}
    <header className="cpf-header">{previewOnly
      ? <div className="cpf-brand"><img src="/brand/cassiellos-symbol-signal-red.svg" alt=""/> <strong>Cassiellos</strong></div>
      : <a href="/" aria-label="Agência Cassiellos, início"><img src="/brand/cassiellos-symbol-signal-red.svg" alt=""/> <strong>Cassiellos</strong></a>}
      <span>DIAGNÓSTICO ESTRATÉGICO</span>
    </header>
    <div className="cpf-shell">
      <div className="cpf-topline"><span>{flow.cover?'DIAGNÓSTICO PARA HAMBURGUERIAS':'FORMULÁRIO PERSONALIZADO'}</span><span>{coverOpen?'INÍCIO':status==='complete'?'CONCLUÍDO':String(currentStep).padStart(2,'0')+' / '+String(totalSteps).padStart(2,'0')}</span></div>
      <div className="cpf-progress"><span style={{width:(status==='complete'?100:coverOpen?0:Math.min(99,currentStep/totalSteps*100))+'%'}}/></div>
      {/* A escolha de cookies fica no aviso de entrada (fim do componente) e em "Preferências de cookies" no rodapé. */}
      <section className="cpf-card" aria-live="polite">
        {status==='calendar'?<InlineBookingCalendar formSlug={slug}
          bookingToken={bookingToken} email={email} bookingEnabled={bookingEnabled}
          previewOnly={previewOnly} customScheduleEnabled={!previewOnly && customScheduleEnabled}
          trackingMode={mode} formVersion={formVersionLabel(version)} flowVariant={flow.cover?'cover':'plain'}/>:
        coverOpen&&flow.cover?<div className="cpf-cover">
          <h1>{coverHeadline(flow.cover.headline)}</h1>
          <ul>{flow.cover.bullets.map((bullet,i)=><li key={i}>{bullet}</li>)}</ul>
          <p className="cpf-cover-qualifier"><em>{flow.cover.qualifier.replace(/^→\s*/, '')}</em></p>
          <button type="button" className="cpf-primary" onClick={()=>{track('form_cover_cta_click',{step_type:'cover'});track('form_start',{step_type:'cover'});setCoverOpen(false)}}>{coverCtaLabel(flow.cover.cta)} <span aria-hidden="true">→</span></button>
        </div>:status==='complete'&&complete?<div className="cpf-result">
          <div className="cpf-success">{previewOnly?'✓ Simulação concluída':'✓ Envio recebido'}</div>
          <h1>{complete.title}</h1><p>{complete.description}</p>
          {complete.actionHref&&complete.actionLabel&&(previewOnly
            ? <span className="cpf-primary cpf-preview-disabled-cta" aria-label="Botão ilustrativo, desativado na prévia">{complete.actionLabel}</span>
            : <a className="cpf-primary" href={complete.actionHref}>{complete.actionLabel}</a>)}
          <p className="cpf-footnote">{previewOnly
            ? 'Esta foi apenas uma simulação. Nenhuma resposta ou dado pessoal foi enviado ou salvo.'
            : 'Seus dados foram registrados para atendimento conforme nossa Política de Privacidade.'}</p>
        </div>:current?.type==='question'?<div className="cpf-question" key={current.id}>
          <div className="cpf-step-marker" aria-label={'Etapa '+currentStep+' de '+totalSteps}>
            <span>{currentStep}</span><i aria-hidden="true">*</i>
          </div>
          <h1>{current.title}</h1>{(current.description||(!flow.cover&&description))&&<p>{current.description||description}</p>}
          {current.input==='select'?<div className="cpf-options">{current.options.map((option,index)=>
            <button type="button" className="cpf-option" key={option} onClick={()=>next(current,option)}>
              <span className="cpf-option-index" aria-hidden="true">{String.fromCharCode(65+index)}</span>
              <span className="cpf-option-label">{option}</span><span className="cpf-option-arrow" aria-hidden="true">→</span>
            </button>)}</div>:
            <form onSubmit={e=>{e.preventDefault();next(current,freeText)}}>
              <label className="cpf-label"><span className="cpf-sr-only">{phoneEntry?'Seu WhatsApp com DDD':'Sua resposta'}</span>
                <input required={current.required} autoComplete={current.field==='name'?'name':current.field==='phone'?'tel-national':'off'}
                  type={current.field==='phone'?'tel':'text'} inputMode={current.field==='phone'?'numeric':undefined}
                  value={freeText} minLength={2} maxLength={current.field==='phone'?24:160}
                  aria-invalid={phoneEntry&&error?true:undefined} aria-describedby={phoneEntry?'cpf-phone-help':undefined}
                  placeholder={current.field==='name'?'Digite seu nome':current.field==='phone'?'(31) 99999-9999':current.field==='website'?'@hamburgueria ou site':'Digite sua resposta'}
                  onChange={e=>{setFreeText(previous=>current.field==='phone'?nextPhoneInput(previous,e.target.value):e.target.value);if(error)setError('')}}/>
              </label>
              {phoneEntry&&<small className="cpf-phone-help" id="cpf-phone-help">
                DDD válido + 9 dígitos. Ex.: (31) 99876-5432. {nationalPhoneDigits(freeText).length}/11 dígitos.
              </small>}
              <button className="cpf-primary" type="submit" disabled={Boolean(phoneEntry&&!phoneCompleted)}>Continuar <span aria-hidden="true">→</span></button>
              <span className="cpf-enter-hint">ou pressione Enter ↵</span>
            </form>}
        </div>:current?.type==='result'?<div className="cpf-contact">
          <div className="cpf-step-marker" aria-label={'Última etapa, '+currentStep+' de '+totalSteps}>
            <span>{currentStep}</span><i aria-hidden="true">*</i>
          </div>
          <h1>{current.title}</h1><p>{current.description}</p>
          <form onSubmit={submit} noValidate>
            {!flow.steps.some(step=>step.type==='question'&&step.field==='name')?<label className="cpf-label">Nome completo<input required minLength={2} maxLength={120} autoComplete="name" value={name} onChange={e=>setName(e.target.value)}/></label>:<p className="cpf-contact-already">Nome: <strong>{name}</strong></p>}
            <label className="cpf-label">E-mail<input required type="email" maxLength={180} autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
            {!flow.steps.some(step=>step.type==='question'&&step.field==='phone')?<label className="cpf-label">WhatsApp com DDD<input required type="tel" inputMode="numeric" maxLength={24} autoComplete="tel-national" placeholder="(31) 99999-9999" value={whatsapp} onChange={e=>setWhatsapp(previous=>nextPhoneInput(previous,e.target.value))}/></label>:<p className="cpf-contact-already">WhatsApp: <strong>{whatsapp}</strong></p>}
            <label className="cpf-trap" aria-hidden="true">Site<input tabIndex={-1} autoComplete="off" value={website} onChange={e=>setWebsite(e.target.value)}/></label>
            <p className="cpf-privacy">Ao enviar, você solicita nosso contato sobre o diagnóstico. Leia a <a href="/politica-de-privacidade" target="_blank" rel="noopener noreferrer">Política de Privacidade</a>. O envio não concede autorização automática para campanhas de marketing.</p>
            {previewOnly?<p className="cpf-preview-note">Prévia privada: envio e verificação de segurança desativados. Você pode simular a conclusão sem registrar um lead.</p>
              :turnstileSiteKey?<TurnstileWidget siteKey={turnstileSiteKey} action={TURNSTILE_BOOKING_ACTION} resetSignal={resetSignal}
                onToken={setToken} onStateChange={setTokenState}/>:
                <p className="cpf-security">Verificação de segurança indisponível. O envio ficará bloqueado.</p>}
            <button className="cpf-primary" type="submit" disabled={!previewOnly&&(!token||status==='sending'||!name.trim()||!validateEmailAddress(email).ok||!validateBrazilianMobilePhone(whatsapp).ok)}>
              {previewOnly?'Simular conclusão (sem enviar) →':status==='sending'?'Enviando…':'Enviar meus dados →'}</button>
            {!previewOnly&&tokenState==='error'&&<p className="cpf-security">Não foi possível validar a proteção. Recarregue a página.</p>}
          </form>
        </div>:<h1>Esta etapa está indisponível.</h1>}
        {error&&<div className="cpf-error" role="alert">{error}</div>}
        {canBack&&!coverOpen&&<button type="button" className="cpf-back" onClick={back}>← Voltar à pergunta anterior</button>}
      </section>
      <footer className="cpf-footer">
        <span>© Agência Cassiellos · {new Date().getFullYear()}</span>
        <span className="cpf-privacy-links">
          <a href="/politica-de-privacidade" target="_blank" rel="noopener noreferrer">Privacidade</a>
          {!previewOnly&&<>
            <span aria-hidden="true"> · </span>
            <button type="button" className="cpf-privacy-toggle" data-consent-ui=""
              aria-expanded={showPrivacyPreferences} aria-controls="cpf-privacy-preferences"
              onClick={()=>setShowPrivacyPreferences(current=>!current)}>
              Preferências de cookies
            </button>
          </>}
        </span>
      </footer>
      {!previewOnly&&<aside className="cpf-privacy-minimal" id="cpf-privacy-preferences" aria-label="Preferências de privacidade">
        {showPrivacyPreferences&&<ConsentNotice marketingEnabled={Boolean(metaPixelId)}/>}
      </aside>}
    </div>
    {/* Escolha clara ao entrar (LGPD): primeira camada com Recusar tudo / Escolher / Aceitar tudo, sem bloquear o formulário. */}
    {!previewOnly&&<ConsentEntryBanner marketingEnabled={Boolean(metaPixelId)} suppressed={showPrivacyPreferences}/>}
  </main>
}
