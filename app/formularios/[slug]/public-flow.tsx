'use client'
import { useState, useRef, type FormEvent } from 'react'
import type { FlowDefinition, FlowStep, FlowResult } from '@/lib/crm/form-builder/flow'
import { TURNSTILE_BOOKING_ACTION } from '@/lib/crm/turnstile'
import TurnstileWidget from '@/app/agendar/[slug]/turnstile-widget'
import { validateBrazilianPhone } from '@/lib/crm/contact-validation'
import { isValidWebPresence } from '@/lib/crm/booking-forms'
import MetaPixel from '@/components/marketing/meta-pixel'
import ConsentNotice, { ConsentPreferencesButton } from '@/components/privacy/consent-notice'
import { readMarketingConsent, trackMetaConversion } from '@/lib/marketing/meta-client'

type Confirmation = Pick<FlowResult,'title'|'description'|'actionLabel'|'actionHref'|'outcome'>
type PublicFlowProps = {slug:string;title:string;description:string;version:number;flow:FlowDefinition;turnstileSiteKey:string|null;metaPixelId:string|null}
export default function PublicFlow({slug,title,description,version,flow,turnstileSiteKey,metaPixelId}:PublicFlowProps){
  const [visited,setVisited]=useState<string[]>([flow.start])
  const [coverOpen,setCoverOpen]=useState(Boolean(flow.cover))
  const [answers,setAnswers]=useState<Record<string,string>>({})
  const [freeText,setFreeText]=useState('')
  const [name,setName]=useState('')
  const [email,setEmail]=useState('')
  const [whatsapp,setWhatsapp]=useState('')
  const [token,setToken]=useState<string|null>(null)
  const [tokenState,setTokenState]=useState('loading')
  const [resetSignal,setResetSignal]=useState(0)
  const [status,setStatus]=useState<'ready'|'sending'|'complete'>('ready')
  const [error,setError]=useState('')
  const [complete,setComplete]=useState<Confirmation|null>(null)
  const [website,setWebsite]=useState('')
  const idempotencyKey=useRef<string>('')
  const current=flow.steps.find(x=>x.id===visited[visited.length-1])
  const canBack=visited.length>1&&status!=='sending'
  function next(step:Extract<FlowStep,{type:'question'}>,answer:string){
    if(step.required&&answer.trim().length<2){setError('Preencha esta resposta para continuar.');return}
    if(step.input==='select'&&!step.options.includes(answer)){setError('Selecione uma alternativa válida.');return}
    if(step.field==='phone'&&!validateBrazilianPhone(answer).ok){setError('Informe um telefone válido com DDD.');return}
    if(step.field==='website'&&!isValidWebPresence(answer)){setError('Informe o @ do Instagram ou um site válido.');return}
    const to=step.branches.find(b=>b.answer===answer)?.to||step.next
    if(!flow.steps.some(s=>s.id===to)||visited.includes(to)){
      setError('O caminho configurado está indisponível.');return
    }
    setAnswers(a=>({...a,[step.id]:answer.trim()}))
    if(step.field==='name')setName(answer.trim())
    if(step.field==='phone')setWhatsapp(answer.trim())
    setVisited(h=>[...h,to]);setFreeText('');setError('')
  }
  function back(){
    if(!canBack)return
    const removed=visited[visited.length-2]
    setVisited(h=>h.slice(0,-1))
    setAnswers(old=>{const a={...old};delete a[removed];return a})
    setFreeText('');setError('')
  }
  async function submit(e:FormEvent<HTMLFormElement>){
    e.preventDefault()
    if(!current||current.type!=='result'||status!=='ready')return
    if(!token||!turnstileSiteKey){setError('Conclua a verificação de segurança para continuar.');return}
    if(!idempotencyKey.current)idempotencyKey.current=crypto.randomUUID()
    setStatus('sending');setError('')
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
      const data=await response.json()
      if(!response.ok)throw Error(data.error==='FORM_UPDATED'?'Este formulário foi atualizado. Recarregue a página para continuar.':
        data.error==='TOO_MANY_REQUESTS'?'Muitas tentativas. Tente novamente mais tarde.':
        'Não foi possível enviar agora. Confira seus dados e tente novamente.')
      // Apenas o Lead novo e real devolvido pelo servidor. Pixel e CAPI usam o mesmo event_id.
      // O rastreamento também exige o consentimento de marketing atual no navegador.
      if(data?.reused!==true && data?.tracking?.lead?.eventName==='Lead'){
        trackMetaConversion('Lead',data.tracking.lead.eventId,{content_name:slug})
      }
      setComplete({title:data.title,description:data.description,outcome:data.outcome,
        actionLabel:data.actionLabel,actionHref:data.actionHref})
      setStatus('complete')
    }catch(e){
      setError(e instanceof Error?e.message:'Não foi possível enviar.')
      setStatus('ready')
      setToken(null);setResetSignal(n=>n+1)
    }
  }
  return <main className="cassiellos-public-flow" data-chronos={Boolean(flow.cover)}>
    <MetaPixel pixelId={metaPixelId}/>
    <header className="cpf-header"><a href="/" aria-label="Agência Cassiellos, início">
      <img src="/brand/cassiellos-symbol-signal-red.svg" alt=""/> <strong>Cassiellos</strong></a>
      <span>DIAGNÓSTICO ESTRATÉGICO</span>
    </header>
    <div className="cpf-shell">
      <div className="cpf-topline"><span>{flow.cover?'DIAGNÓSTICO PARA HAMBURGUERIAS':'FORMULÁRIO PERSONALIZADO'}</span><span>{coverOpen?'INÍCIO':status==='complete'?'Concluído':String(visited.length).padStart(2,'0')+' / '+String(flow.steps.length).padStart(2,'0')}</span></div>
      <div className="cpf-progress"><span style={{width:(status==='complete'?100:coverOpen?0:Math.min(95,visited.length/flow.steps.length*100))+'%'}}/></div>
      <ConsentNotice marketingEnabled={Boolean(metaPixelId)}/>
      <section className="cpf-card" aria-live="polite">
        {coverOpen&&flow.cover?<div className="cpf-cover">
          <h1>{flow.cover.headline}</h1>
          <ul>{flow.cover.bullets.map((bullet,i)=><li key={i}>{bullet}</li>)}</ul>
          <p className="cpf-cover-qualifier"><em>→ {flow.cover.qualifier.replace(/^→\s*/, '')}</em></p>
          <button type="button" className="cpf-primary" onClick={()=>setCoverOpen(false)}>{flow.cover.cta} →</button>
        </div>:status==='complete'&&complete?<div className="cpf-result">
          <div className="cpf-success">✓ Envio recebido</div>
          <h1>{complete.title}</h1><p>{complete.description}</p>
          {complete.actionHref&&complete.actionLabel&&<a className="cpf-primary" href={complete.actionHref}>{complete.actionLabel}</a>}
          <p className="cpf-footnote">Seus dados foram registrados para atendimento conforme nossa Política de Privacidade.</p>
        </div>:current?.type==='question'?<div className="cpf-question" key={current.id}>
          <div className="cpf-eyebrow">{title}</div>
          <h1>{current.title}</h1><p>{current.description||description}</p>
          {current.input==='select'?<div className="cpf-options">{current.options.map(option=>
            <button type="button" className="cpf-option" key={option} onClick={()=>next(current,option)}>{option}<span aria-hidden="true">→</span></button>)}</div>:
            <form onSubmit={e=>{e.preventDefault();next(current,freeText)}}>
              <label className="cpf-label">Sua resposta<input required={current.required} autoComplete={current.field==='name'?'name':current.field==='phone'?'tel':'off'} type={current.field==='phone'?'tel':'text'} inputMode={current.field==='phone'?'tel':undefined} value={freeText}
                minLength={2} maxLength={160} placeholder={current.field==='name'?'Digite seu nome':current.field==='phone'?'WhatsApp com DDD':current.field==='website'?'@hamburgueria ou site':'Digite sua resposta'} onChange={e=>setFreeText(e.target.value)}/></label>
              <button className="cpf-primary" type="submit">Continuar →</button>
            </form>}
        </div>:current?.type==='result'?<div className="cpf-contact">
          <div className="cpf-eyebrow">ÚLTIMA ETAPA</div>
          <h1>{current.title}</h1><p>{current.description}</p>
          <form onSubmit={submit} noValidate>
            {!flow.steps.some(step=>step.type==='question'&&step.field==='name')?<label className="cpf-label">Nome completo<input required minLength={2} maxLength={120} autoComplete="name" value={name} onChange={e=>setName(e.target.value)}/></label>:<p className="cpf-contact-already">Nome: <strong>{name}</strong></p>}
            <label className="cpf-label">E-mail<input required type="email" maxLength={254} autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)}/></label>
            {!flow.steps.some(step=>step.type==='question'&&step.field==='phone')?<label className="cpf-label">WhatsApp com DDD<input required type="tel" maxLength={24} autoComplete="tel" placeholder="(31) 99999-9999" value={whatsapp} onChange={e=>setWhatsapp(e.target.value)}/></label>:<p className="cpf-contact-already">WhatsApp: <strong>{whatsapp}</strong></p>}
            <label className="cpf-trap" aria-hidden="true">Site<input tabIndex={-1} autoComplete="off" value={website} onChange={e=>setWebsite(e.target.value)}/></label>
            <p className="cpf-privacy">Ao enviar, você solicita nosso contato sobre o diagnóstico. Leia a <a href="/politica-de-privacidade" target="_blank" rel="noopener noreferrer">Política de Privacidade</a>. O envio não concede autorização automática para campanhas de marketing.</p>
            {turnstileSiteKey?<TurnstileWidget siteKey={turnstileSiteKey} action={TURNSTILE_BOOKING_ACTION} resetSignal={resetSignal}
              onToken={setToken} onStateChange={setTokenState}/>:
              <p className="cpf-security">Verificação de segurança indisponível. O envio ficará bloqueado.</p>}
            <button className="cpf-primary" type="submit" disabled={!token||status==='sending'||!name.trim()||!email.trim()||!whatsapp.trim()}>
              {status==='sending'?'Enviando…':'Enviar meus dados →'}</button>
            {tokenState==='error'&&<p className="cpf-security">Não foi possível validar a proteção. Recarregue a página.</p>}
          </form>
        </div>:<h1>Esta etapa está indisponível.</h1>}
        {error&&<div className="cpf-error" role="alert">{error}</div>}
        {canBack&&!coverOpen&&status!=='complete'&&<button type="button" className="cpf-back" onClick={back}>← Voltar à pergunta anterior</button>}
      </section>
      <footer className="cpf-footer"><span>© Agência Cassiellos · {new Date().getFullYear()}</span><span><ConsentPreferencesButton/> · <a href="/politica-de-privacidade">Privacidade</a></span></footer>
    </div>
  </main>
}
