'use client'
import { useEffect, useMemo, useState } from 'react'
import type { FlowDefinition, FlowDocument, FlowQuestion, FlowResult, FlowStep } from '@/lib/crm/form-builder/flow'
import { validateFlow } from '@/lib/crm/form-builder/flow'
import FormsFlowCanvas from './forms-flow-canvas'
import type { DiagramPoint } from '@/lib/crm/form-builder/diagram'
import './forms-panel.css'

type ResponseData = { ok?: boolean; forms?: FlowDocument[]; form?: FlowDocument; error?: string; issues?: string[] }
const api = async (body?:Record<string,unknown>,id?:string):Promise<ResponseData>=>{
  const response=await fetch('/api/crm/forms'+(id?'?id='+encodeURIComponent(id):''),{
    method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',
    ...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),
  })
  const data=await response.json() as ResponseData
  if(!response.ok)throw new Error(data.error==='MIGRATION_PENDING'?'MIGRATION_PENDING':data.error==='CONFLICT'?'CONFLICT':
    data.error==='INVALID_FLOW'?(data.issues||[]).join(' | '):data.error||'FAILED')
  return data
}
const clone = <T,>(value:T):T=>JSON.parse(JSON.stringify(value)) as T
const slugify=(title:string)=>title.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)
const defaultErrors:Record<string,string>={
  MIGRATION_PENDING:'A migração 0020 precisa ser aplicada ao banco do CRM para habilitar o construtor. Nenhum formulário foi alterado.',
  CONFLICT:'Este formulário foi alterado em outra sessão. Recarregue antes de salvar para não sobrescrever mudanças.',
  FORMS_UNAVAILABLE:'Não foi possível carregar os formulários. Tente novamente.',
}
function errorText(e:unknown){const text=e instanceof Error?e.message:'FAILED';return defaultErrors[text]||text}

export default function FormsPanel(){
  const [forms,setForms]=useState<FlowDocument[]>([])
  const [viewMode,setViewMode]=useState<'flow'|'steps'>('flow')
  const [selected,setSelected]=useState<FlowDocument|null>(null)
  const [draft,setDraft]=useState<FlowDefinition|null>(null)
  const [title,setTitle]=useState('')
  const [slug,setSlug]=useState('')
  const [description,setDescription]=useState('')
  const [selectedStep,setSelectedStep]=useState('')
  const [newTitle,setNewTitle]=useState('')
  const [message,setMessage]=useState('')
  const [busy,setBusy]=useState(false)
  const [dirty,setDirty]=useState(false)
  const [preview,setPreview]=useState(false)
  const [previewAnswers,setPreviewAnswers]=useState<Record<string,string>>({})
  const [previewStep,setPreviewStep]=useState<string>('')
  const [finish,setFinish]=useState('')
  const [loading,setLoading]=useState(true)
  const validation=useMemo(()=>draft?validateFlow(draft):null,[draft])
  const active=draft?.steps.find(s=>s.id===selectedStep)
  const targetOptions=draft?.steps.filter(s=>s.id!==active?.id)||[]
  function fromDoc(doc:FlowDocument){
    setSelected(doc);setDraft(clone(doc.draft));setTitle(doc.title);setSlug(doc.slug);setDescription(doc.description)
    setSelectedStep(doc.draft.start);setDirty(false);setMessage('');setPreview(false);setPreviewAnswers({});setFinish('')
  }
  async function refresh(){
    setLoading(true)
    try{const data=await api();setForms(data.forms||[]);setMessage('')}
    catch(e){setMessage(errorText(e))}
    finally{setLoading(false)}
  }
  useEffect(()=>{void refresh()},[])
  async function open(id:string){
    try{const data=await api(undefined,id);if(data.form)fromDoc(data.form)}
    catch(e){setMessage(errorText(e))}
  }
  function edit(fn:(flow:FlowDefinition)=>void){
    if(!draft)return
    const next=clone(draft);fn(next);setDraft(next);setDirty(true);setFinish('')
  }
  function updateStep(patch:Partial<FlowStep>){edit(d=>{const i=d.steps.findIndex(s=>s.id===selectedStep);if(i>=0)d.steps[i]={...d.steps[i],...patch} as FlowStep})}
  function updateQuestion(patch:Partial<FlowQuestion>){updateStep(patch)}
  function updateResult(patch:Partial<FlowResult>){updateStep(patch)}
  function connectSteps(sourceId:string,answer:string|null,targetId:string):boolean{
    if(!draft||sourceId===targetId)return false
    const next=clone(draft)
    const source=next.steps.find(s=>s.id===sourceId)
    if(!source||source.type!=='question'||!next.steps.some(s=>s.id===targetId))return false
    if(answer===null)source.next=targetId
    else if(source.input==='select'&&source.options.includes(answer)){
      source.branches=[...source.branches.filter(b=>b.answer!==answer),{answer,to:targetId}]
    }else return false
    const checked=validateFlow(next)
    if(!checked.ok){setMessage('Conexão não aplicada: '+checked.issues.join(' | '));return false}
    setDraft(next);setDirty(true);setFinish('');setMessage('');setSelectedStep(targetId)
    return true
  }
  function moveNode(id:string,point:DiagramPoint){
    edit(d=>{d.layout={...d.layout,[id]:point}})
  }
  function resetLayout(){
    if(!draft?.layout||Object.keys(draft.layout).length===0)return
    edit(d=>{delete d.layout})
  }
  function addQuestion(){
    if(!draft)return
    const id='question_'+Math.random().toString(36).slice(2,9)
    const step:FlowQuestion={id,type:'question',title:'Nova pergunta',description:'',input:'select',required:true,options:['Sim','Não'],next:'',branches:[]}
    edit(d=>{
      const base=d.steps.find(s=>s.id===selectedStep)
      if(base?.type==='question'){
        step.next=base.next;base.next=id
        const index=d.steps.findIndex(s=>s.id===base.id);d.steps.splice(index+1,0,step)
      }else{
        step.next=d.start;d.start=id;d.steps.unshift(step)
      }
    })
    setSelectedStep(id)
  }
  function addResult(){
    if(!draft)return
    const id='result_'+Math.random().toString(36).slice(2,9)
    const step:FlowResult={id,type:'result',title:'Nova finalização',description:'Personalize a mensagem.',outcome:'other',actionLabel:'',actionHref:''}
    edit(d=>{
      d.steps.push(step)
      const current=d.steps.find(s=>s.id===selectedStep)
      if(current?.type==='question'&&current.input==='select'){
        const unlinked=current.options.find(v=>!current.branches.some(b=>b.answer===v))
        if(unlinked)current.branches.push({answer:unlinked,to:id})
      }
    })
    setSelectedStep(id)
  }
  function removeStep(){
    if(!draft||draft.steps.length<=2||!active)return
    const removed=active
    const incoming:string[]=[]
    for(const s of draft.steps){
      if(s.type!=='question'||s.id===removed.id)continue
      if(s.next===removed.id)incoming.push('destino padrão de "'+s.title+'"')
      for(const b of s.branches)if(b.to===removed.id)incoming.push('resposta "'+b.answer+'" de "'+s.title+'"')
    }
    if(incoming.length){
      setMessage('Exclusão bloqueada: esta etapa recebe '+incoming.length+
        ' conexão(ões). Redirecione-as antes de excluir: '+incoming.join('; ')+'. Nenhum destino foi alterado.')
      return
    }
    const replacement=removed.type==='question'?removed.next:null
    if(removed.id===draft.start && (!replacement||!draft.steps.some(s=>s.id===replacement))){
      setMessage('Esta é a etapa inicial. Configure um próximo destino válido antes de excluí-la.')
      return
    }
    const explanation=removed.id===draft.start
      ? 'Excluir a etapa inicial? A nova primeira etapa será "'+
        (draft.steps.find(s=>s.id===replacement)?.title||replacement)+'".'
      : 'Excluir a etapa "'+removed.title+'"? As conexões existentes não serão redirecionadas automaticamente.'
    if(!window.confirm(explanation))return
    edit(d=>{
      d.steps=d.steps.filter(s=>s.id!==removed.id)
      if(d.layout)delete d.layout[removed.id]
      if(d.start===removed.id&&replacement)d.start=replacement
    })
    setSelectedStep(removed.id===draft.start?replacement!:draft.start)
    setMessage('Etapa excluída do rascunho. Revise a jornada antes de salvar.')
  }
  async function create(){
    if(!newTitle.trim())return
    setBusy(true);setMessage('')
    try{
      const title=newTitle.trim()
      const data=await api({action:'create',title,slug:slugify(title)})
      if(data.form){setForms(old=>[data.form!,...old]);fromDoc(data.form);setNewTitle('')}
    }catch(e){setMessage(errorText(e))}
    finally{setBusy(false)}
  }
  async function save(){
    if(!selected||!draft||!validation?.ok)return
    setBusy(true);setMessage('')
    try{
      const data=await api({action:'save',id:selected.id,revision:selected.revision,title,slug,description,draft})
      if(data.form){fromDoc(data.form);setForms(old=>[data.form!,...old.filter(x=>x.id!==data.form!.id)]);setMessage('Rascunho salvo. A versão pública não foi alterada.')}
    }catch(e){setMessage(errorText(e))}
    finally{setBusy(false)}
  }
  async function publish(action:'publish'|'unpublish'){
    if(!selected||dirty||!validation?.ok)return
    if(!window.confirm(action==='publish'?'Publicar a versão salva? O link público passará a usar esta versão.':'Despublicar? O link público ficará indisponível.'))return
    setBusy(true);setMessage('')
    try{
      const data=await api({action,id:selected.id,revision:selected.revision})
      if(data.form){fromDoc(data.form);setForms(old=>[data.form!,...old.filter(x=>x.id!==data.form!.id)]);setMessage(action==='publish'?'Versão publicada.':'Formulário retirado do ar.')}
    }catch(e){setMessage(errorText(e))}
    finally{setBusy(false)}
  }
  function beginPreview(){if(!draft)return;setPreview(true);setPreviewAnswers({});setPreviewStep(draft.start);setFinish('')}
  function answerPreview(value:string){
    if(!draft)return
    const step=draft.steps.find(s=>s.id===previewStep)
    if(!step||step.type!=='question')return
    const next={...previewAnswers,[step.id]:value}
    setPreviewAnswers(next)
    setPreviewStep(step.branches.find(b=>b.answer===value)?.to||step.next)
  }
  const liveStep=draft?.steps.find(s=>s.id===previewStep)
  return <section className="crm-forms" aria-label="Construtor de formulários">
    <div className="crm-forms-heading">
      <div><strong>FORMULÁRIOS INTELIGENTES</strong><p>Crie jornadas diferentes para cada nicho, configure bifurcações e publique quando estiver pronto. O /agendar atual permanece independente.</p></div>
      {selected&&<button type="button" className="crm-btn" onClick={()=>{setSelected(null);setDraft(null);setMessage('')}}>← Todos os formulários</button>}
    </div>
    {message&&<div className="crm-forms-message" role="status">{message}</div>}
    {loading&&<div className="crm-card crm-forms-loading">Carregando seus formulários…</div>}
    {!loading&&!selected&&<>
      <div className="crm-card crm-forms-create">
        <label>Nome do novo formulário<input placeholder="Ex.: Formulário Escolas" value={newTitle} maxLength={120} onChange={e=>setNewTitle(e.target.value)}/></label>
        <button type="button" className="crm-btn crm-forms-primary" disabled={!newTitle.trim()||busy} onClick={create}>+ Criar formulário</button>
        <span>Uma jornada-modelo de 5 etapas será criada como rascunho, com dois finais separados.</span>
      </div>
      <div className="crm-forms-list">
        {forms.map(f=><button type="button" className="crm-card crm-forms-list-card" key={f.id} onClick={()=>void open(f.id)}>
          <span className="crm-forms-pill">{f.status==='published'?'Publicado':'Rascunho'}</span>
          <strong>{f.title}</strong><small>/formularios/{f.slug}</small><span>{f.draft.steps.length} etapas · edição #{f.revision}</span>
        </button>)}
        {!forms.length&&<div className="crm-card crm-forms-loading">Ainda não existem formulários. Crie o primeiro acima.</div>}
      </div>
    </>}
    {!loading&&selected&&draft&&<>
      <div className="crm-card crm-forms-meta">
        <div className="crm-forms-fields">
          <label>Nome<input value={title} maxLength={120} onChange={e=>{setTitle(e.target.value);setDirty(true)}}/></label>
          <label>URL amigável<input value={slug} disabled={selected.status==='published'} title={selected.status==='published'?'Despublique antes de alterar o endereço público.':undefined} maxLength={70} onChange={e=>{setSlug(e.target.value);setDirty(true)}}/></label>
          <label className="crm-forms-wide">Descrição curta<input value={description} maxLength={400} onChange={e=>{setDescription(e.target.value);setDirty(true)}}/></label>
        </div>
        <div className="crm-forms-toolbar">
          <span className="crm-forms-pill">{selected.status==='published'?'Publicado · versão '+selected.publishedVersion:'Somente rascunho'}</span>
          {dirty&&<span className="crm-forms-dirty">Alterações não salvas</span>}
          <button type="button" className="crm-btn" onClick={beginPreview}>Simular jornada</button>
          <button type="button" className="crm-btn crm-forms-primary" disabled={busy||!dirty||!validation?.ok} onClick={()=>void save()}>Salvar rascunho</button>
          <button type="button" className="crm-btn" disabled={busy||dirty||!validation?.ok} onClick={()=>void publish('publish')}>Publicar versão salva</button>
          {selected.status==='published'&&<button type="button" className="crm-btn" disabled={busy||dirty} onClick={()=>void publish('unpublish')}>Retirar do ar</button>}
        </div>
        {selected.status==='published'&&<p><a href={'/formularios/'+selected.slug} target="_blank" rel="noopener noreferrer">Abrir versão publicada ↗</a> · Alterações no rascunho não afetam este link até publicar novamente.</p>}
      </div>
      {validation&&!validation.ok&&<div className="crm-forms-invalid" role="alert"><strong>Revise o fluxo antes de salvar:</strong><ul>{validation.issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul></div>}
      <div className="crm-forms-view-tabs" role="group" aria-label="Modo de visualização do construtor">
        <button type="button" data-active={viewMode==='flow'} aria-pressed={viewMode==='flow'} onClick={()=>setViewMode('flow')}>◈ Fluxograma interativo</button>
        <button type="button" data-active={viewMode==='steps'} aria-pressed={viewMode==='steps'} onClick={()=>setViewMode('steps')}>☷ Lista de etapas</button>
        <small>As duas visualizações editam o mesmo rascunho.</small>
      </div>
      <div className={'crm-forms-workspace'+(viewMode==='flow'?' crm-forms-workspace-flow':'')}>
        {viewMode==='flow'&&<FormsFlowCanvas flow={draft} selectedStep={selectedStep}
          onSelect={id=>{setSelectedStep(id);setPreview(false)}}
          onMove={moveNode} onConnect={connectSteps} onResetLayout={resetLayout}/>}
        {viewMode==='steps'&&<div className="crm-card crm-forms-map">
          <div className="crm-forms-map-head"><strong>MAPA DO FUNIL</strong><span>{draft.steps.length} etapas</span></div>
          {draft.steps.map((s,i)=><button key={s.id} type="button" className="crm-forms-node" data-selected={selectedStep===s.id} onClick={()=>{setSelectedStep(s.id);setPreview(false)}}>
            <span className="crm-forms-node-index">{String(i+1).padStart(2,'0')}</span>
            <span><strong>{s.title}</strong><small>{s.type==='question'?(s.branches.length?'Bifurcação: '+s.branches.map(b=>b.answer+' → '+b.to).join(', '):'Próximo: '+s.next):'Resultado: '+s.outcome}</small></span>
            <span>›</span>
          </button>)}
          <div className="crm-forms-map-actions">
            <button type="button" className="crm-btn" onClick={addQuestion} disabled={draft.steps.length>=24}>+ Pergunta</button>
            <button type="button" className="crm-btn" onClick={addResult} disabled={draft.steps.length>=24}>+ Resultado final</button>
          </div>
        </div>}
        <div className="crm-card crm-forms-editor">
          {active&&<>
            <div className="crm-forms-editor-header"><div><span>EDITOR DA ETAPA</span><h3>{active.type==='question'?'Pergunta':'Página final'}</h3></div>
              <button type="button" className="crm-forms-remove" onClick={removeStep}>Excluir etapa</button></div>
            <label>Título da etapa<input value={active.title} maxLength={160} onChange={e=>updateStep({title:e.target.value})}/></label>
            <label>Texto de apoio<textarea rows={3} maxLength={500} value={active.description} onChange={e=>updateStep({description:e.target.value})}/></label>
            {active.type==='question'?<>
              <div className="crm-forms-columns">
                <label>Tipo de resposta<select value={active.input} onChange={e=>updateQuestion({input:e.target.value as 'text'|'select',options:e.target.value==='select'?['Sim','Não']:[],branches:[]})}>
                  <option value="select">Múltipla escolha</option><option value="text">Texto curto</option></select></label>
                <label className="crm-forms-check"><input type="checkbox" checked={active.required} onChange={e=>updateQuestion({required:e.target.checked})}/>Obrigatória</label>
              </div>
              {active.input==='select'&&<label>Alternativas (uma por linha)<textarea key={active.id} rows={4} defaultValue={active.options.join('\n')} onChange={e=>{
                const options=e.target.value.split('\n').map(x=>x.trim()).filter(Boolean)
                updateQuestion({options,branches:active.branches.filter(b=>options.includes(b.answer))})}}/>
                <small className="crm-forms-option-hint">Uma alternativa por linha. Edite livremente com Enter, selecionar tudo ou colar; linhas vazias são ignoradas ao salvar.</small></label>}
              <label>Próxima etapa padrão<select value={active.next} onChange={e=>updateQuestion({next:e.target.value})}>
                {targetOptions.map(s=><option key={s.id} value={s.id}>{s.title} ({s.id})</option>)}</select></label>
              {active.input==='select'&&<div className="crm-forms-branches">
                <strong>Bifurcações por resposta</strong><p>Escolha o destino de cada alternativa. Se não houver regra, segue a etapa padrão.</p>
                {active.options.map(option=><label key={option}><span>{option}</span><select value={active.branches.find(b=>b.answer===option)?.to||''} onChange={e=>{
                  updateQuestion({branches:[...active.branches.filter(b=>b.answer!==option),...(e.target.value?[{answer:option,to:e.target.value}]:[])]})}}>
                  <option value="">Seguir etapa padrão</option>{targetOptions.map(s=><option key={s.id} value={s.id}>{s.title} ({s.id})</option>)}
                  </select></label>)}
              </div>}
            </>:<>
              <label>Classificação do resultado<select value={active.outcome} onChange={e=>updateResult({outcome:e.target.value as FlowResult['outcome']})}>
                <option value="qualified">Orçamento compatível</option><option value="limited">Orçamento limitado</option><option value="other">Outra finalização</option></select></label>
              <label>Texto do botão após cadastro<input value={active.actionLabel} maxLength={100} onChange={e=>updateResult({actionLabel:e.target.value})}/></label>
              <label>Destino interno do botão<input value={active.actionHref} placeholder="/agendar" onChange={e=>updateResult({actionHref:e.target.value})}/></label>
            </>}
          </>}
        </div>
      </div>
      {viewMode==='flow'&&<div className="crm-forms-flow-actions">
        <button type="button" className="crm-btn" onClick={addQuestion} disabled={draft.steps.length>=24}>+ Adicionar pergunta</button>
        <button type="button" className="crm-btn" onClick={addResult} disabled={draft.steps.length>=24}>+ Adicionar finalização</button>
        <small>Adicionar pergunta após a etapa selecionada liga automaticamente o caminho padrão à nova pergunta. As bifurcações existentes são preservadas.</small>
      </div>}
      {preview&&<div className="crm-card crm-forms-preview">
        <div className="crm-forms-editor-header"><div><span>PRÉVIA SEM GRAVAÇÃO</span><h3>Simulação da jornada</h3></div>
          <button type="button" className="crm-btn" onClick={beginPreview}>Reiniciar</button></div>
        {!validation?.ok?<p>Corrija o mapa para simular.</p>:liveStep?.type==='question'?<>
          <h3>{liveStep.title}</h3><p>{liveStep.description}</p>
          {liveStep.input==='select'?<div className="crm-forms-preview-choices">{liveStep.options.map(value=>
            <button type="button" className="crm-btn" key={value} onClick={()=>answerPreview(value)}>{value}</button>)}</div>:
            <form onSubmit={e=>{e.preventDefault();const value=(new FormData(e.currentTarget)).get('preview_answer');if(typeof value==='string'&&value.trim().length>=2)answerPreview(value.trim())}}>
              <input name="preview_answer" required minLength={2} maxLength={160}/><button className="crm-btn" type="submit">Próximo</button>
            </form>}
        </>:liveStep?.type==='result'?<div><strong>{liveStep.title}</strong><p>{liveStep.description}</p>
          <p>Resultado: {liveStep.outcome==='limited'?'Orçamento limitado':liveStep.outcome==='qualified'?'Orçamento compatível':'Outro'}.</p>
          <p>Na versão pública, os dados de contato serão solicitados aqui antes da finalização.</p>
          <button className="crm-btn" type="button" onClick={()=>setFinish('Simulação concluída, sem salvar leads.')}>Concluir simulação</button>
          {finish&&<p>{finish}</p>}</div>:<p>Etapa não encontrada.</p>}
      </div>}
    </>}
  </section>
}
