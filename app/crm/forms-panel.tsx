'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { FlowDefinition, FlowDocument, FlowQuestion, FlowResult, FlowStep } from '@/lib/crm/form-builder/flow'
import { validateFlow } from '@/lib/crm/form-builder/flow'
import FormsFlowCanvas from './forms-flow-canvas'
import type { DiagramPoint } from '@/lib/crm/form-builder/diagram'
import { insertQuestionAt, insertResultAt, removeStepAndReconnect, type FlowEditPlan } from '@/lib/crm/form-builder/editor-actions'
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
type EditSnapshot={draft:FlowDefinition;title:string;slug:string;description:string;selectedStep:string}
const MAX_HISTORY=80
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
  const [undoStack,setUndoStack]=useState<EditSnapshot[]>([])
  const [redoStack,setRedoStack]=useState<EditSnapshot[]>([])
  const lastHistory=useRef<{group:string;time:number}|null>(null)
  const [selectedOutput,setSelectedOutput]=useState('')
  const [redirectFinal,setRedirectFinal]=useState('')
  const [focusStep,setFocusStep]=useState<{id:string;key:number}|null>(null)
  const [fieldResetVersion,setFieldResetVersion]=useState(0)
  const focusIndex=useRef(0)
  const rootRef=useRef<HTMLElement|null>(null)
  const validation=useMemo(()=>draft?validateFlow(draft):null,[draft])
  const active=draft?.steps.find(s=>s.id===selectedStep)
  const targetOptions=draft?.steps.filter(s=>s.id!==active?.id)||[]
  const finalOptions=draft?.steps.filter(s=>s.type==='result'&&s.id!==active?.id)||[]
  const validRedirect=finalOptions.some(x=>x.id===redirectFinal)?redirectFinal:finalOptions[0]?.id||''
  function fromDoc(doc:FlowDocument){
    setSelected(doc);setDraft(clone(doc.draft));setTitle(doc.title);setSlug(doc.slug);setDescription(doc.description)
    setSelectedStep(doc.draft.start);setDirty(false);setMessage('');setPreview(false);setPreviewAnswers({});setFinish('')
    setUndoStack([]);setRedoStack([]);lastHistory.current=null;setSelectedOutput('');setRedirectFinal('');setFieldResetVersion(n=>n+1)
  }

  // Histórico só em memória. Nenhuma operação persiste antes de "Salvar rascunho".
  const snapshot=():EditSnapshot=>({draft:clone(draft!),title,slug,description,selectedStep})
  const changedSinceSaved=(value:EditSnapshot)=>Boolean(selected)&&(
    value.title!==selected!.title||value.slug!==selected!.slug||
    value.description!==selected!.description||JSON.stringify(value.draft)!==JSON.stringify(selected!.draft)
  )
  function recordUndo(group:string){
    if(!draft||!selected)return
    const now=Date.now()
    // Agrupa digitação contínua no mesmo campo: um Ctrl+Z volta ao início da edição.
    const grouped=lastHistory.current?.group===group&&now-lastHistory.current.time<900
    if(!grouped)setUndoStack(old=>[...old.slice(-(MAX_HISTORY-1)),snapshot()])
    setRedoStack([])
    lastHistory.current={group,time:now}
  }
  function focus(id:string){setFocusStep({id,key:++focusIndex.current})}
  function applySnapshot(value:EditSnapshot,label:string){
    setDraft(clone(value.draft));setTitle(value.title);setSlug(value.slug);setDescription(value.description)
    setSelectedStep(value.selectedStep);setSelectedOutput('');setPreview(false);setFieldResetVersion(n=>n+1)
    setDirty(changedSinceSaved(value));setMessage(label);focus(value.selectedStep)
    lastHistory.current=null
  }
  function undo(){
    if(busy||!draft||!undoStack.length)return
    const previous=undoStack[undoStack.length-1]
    setUndoStack(old=>old.slice(0,-1));setRedoStack(old=>[...old,snapshot()])
    applySnapshot(previous,'Última alteração desfeita. Nada foi salvo.')
  }
  function redo(){
    if(busy||!draft||!redoStack.length)return
    const upcoming=redoStack[redoStack.length-1]
    setRedoStack(old=>old.slice(0,-1));setUndoStack(old=>[...old,snapshot()])
    applySnapshot(upcoming,'Alteração refeita. Nada foi salvo.')
  }
  function discard(){
    if(!selected||busy)return
    if(dirty&&!window.confirm('Descartar todas as mudanças não salvas e recuperar a última versão salva deste formulário?'))return
    fromDoc(selected);setMessage('Versão salva restaurada. Alterações locais descartadas.')
  }
  useEffect(()=>{
    if(!dirty)return
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue=''}
    window.addEventListener('beforeunload',warn)
    return ()=>window.removeEventListener('beforeunload',warn)
  },[dirty])
  useEffect(()=>{
    const handler=(event:KeyboardEvent)=>{
      if(!selected||!rootRef.current||!rootRef.current.contains(document.activeElement))return
      if(!(event.ctrlKey||event.metaKey)||event.altKey)return
      // Em campos editáveis, Ctrl+Z mantém o comportamento nativo de digitação.
      const target=event.target as HTMLElement|null
      if(target?.closest('input,textarea,[contenteditable="true"]'))return
      const key=event.key.toLowerCase()
      if(key==='z'&&!event.shiftKey){if(undoStack.length){event.preventDefault();undo()}return}
      if((key==='z'&&event.shiftKey)||key==='y'){if(redoStack.length){event.preventDefault();redo()}}
    }
    document.addEventListener('keydown',handler)
    return ()=>document.removeEventListener('keydown',handler)
  },[selected,undoStack,redoStack,draft,title,slug,description,selectedStep,busy])
  async function refresh(){
    setLoading(true)
    try{
      const data=await api()
      const available=data.forms||[]
      setForms(available);setMessage('')
      // Link direto para um rascunho específico sem publicar o formulário.
      // Ex.: /crm?view=formularios&form=hamburguerias
      const requested=new URLSearchParams(window.location.search).get('form')
      const target=requested?available.find(doc=>doc.slug===requested):null
      if(target)fromDoc(target)
    }
    catch(e){setMessage(errorText(e))}
    finally{setLoading(false)}
  }
  useEffect(()=>{void refresh()},[])
  async function open(id:string){
    if(dirty&&!window.confirm('Descartar as alterações não salvas para abrir outro formulário?'))return
    try{const data=await api(undefined,id);if(data.form)fromDoc(data.form)}
    catch(e){setMessage(errorText(e))}
  }
  function edit(fn:(flow:FlowDefinition)=>void,group='flow:'+selectedStep){
    if(!draft)return
    const next=clone(draft);fn(next)
    if(JSON.stringify(next)===JSON.stringify(draft))return
    recordUndo(group);setDraft(next)
    setDirty(changedSinceSaved({...snapshot(),draft:next}));setFinish('')
  }
  function updateStep(patch:Partial<FlowStep>){edit(d=>{const i=d.steps.findIndex(s=>s.id===selectedStep);if(i>=0)d.steps[i]={...d.steps[i],...patch} as FlowStep},'step:'+selectedStep+':'+Object.keys(patch).join(','))}
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
    recordUndo('link:'+sourceId+':'+(answer||'default'))
    setDraft(checked.flow);setDirty(true);setFinish('');setMessage('');setSelectedStep(targetId);focus(targetId)
    return true
  }
  function removeBranch(sourceId:string,answer:string){
    if(!draft)return
    const source=draft.steps.find(s=>s.id===sourceId)
    if(!source||source.type!=='question')return
    const rule=source.branches.find(b=>b.answer===answer)
    if(!rule)return
    const previous=draft.steps.find(s=>s.id===rule.to)?.title||rule.to
    const fallback=draft.steps.find(s=>s.id===source.next)?.title||source.next
    const notice='Remover o desvio de "'+answer+'"? A resposta deixará de ir para "'+
      previous+'" e passará a seguir o destino padrão "'+fallback+'". '+
      'Se uma etapa ficar desconectada, você precisará corrigi-la antes de salvar ou publicar.'
    if(!window.confirm(notice))return
    edit(d=>{
      const changed=d.steps.find(s=>s.id===sourceId)
      if(changed?.type==='question')changed.branches=changed.branches.filter(b=>b.answer!==answer)
    })
    setSelectedStep(sourceId)
    setMessage('Desvio removido somente do rascunho. Confira o novo percurso e eventuais etapas desconectadas.')
  }
  function moveNode(id:string,point:DiagramPoint){
    edit(d=>{d.layout={...d.layout,[id]:point}})
  }
  function resetLayout(){
    if(!draft?.layout||Object.keys(draft.layout).length===0)return
    edit(d=>{delete d.layout})
  }
  function applyPlan(plan:FlowEditPlan){
    if(!plan.ok){setMessage(plan.reason);return}
    recordUndo('structure:'+Date.now())
    setDraft(plan.flow);setDirty(changedSinceSaved({...snapshot(),draft:plan.flow}))
    setSelectedStep(plan.focusId);focus(plan.focusId);setSelectedOutput('')
    setPreview(false);setFinish('');setMessage(plan.message+' Salve o rascunho para persistir.')
  }
  function addQuestion(){
    if(!draft||!active)return
    const id='question_'+crypto.randomUUID().replaceAll('-','').slice(0,14)
    const answer=active.type==='question'&&selectedOutput.startsWith('answer:')
      ?selectedOutput.slice('answer:'.length):null
    applyPlan(insertQuestionAt(draft,active.id,id,answer))
  }
  function addResult(){
    if(!draft||!active)return
    const id='result_'+crypto.randomUUID().replaceAll('-','').slice(0,14)
    applyPlan(insertResultAt(draft,active.id,id))
  }
  function removeStep(){
    if(!draft||!active)return
    const target=active.type==='result'?validRedirect:undefined
    let plan=removeStepAndReconnect(draft,active.id,target)
    if(!plan.ok && plan.orphanSteps?.length){
      const names=plan.orphanSteps.map(s=>'• '+s.title).join('\n')
      if(!window.confirm('A etapa "'+active.title+'" possui caminhos que ficarão inacessíveis:\n\n'+
        names+'\n\nExcluir também essas '+plan.orphanSteps.length+
        ' etapa(s)? Isso não será salvo automaticamente e poderá ser desfeito.'))return
      plan=removeStepAndReconnect(draft,active.id,target,true)
    }
    if(!plan.ok){setMessage(plan.reason);return}
    const incoming=draft.steps.filter(s=>s.type==='question'&&s.id!==active.id&&
      (s.next===active.id||s.branches.some(b=>b.to===active.id))).length
    const prompt='Excluir "'+active.title+'"? '+(incoming?
      incoming+' etapa(s) que levam a ela serão redirecionadas para "'+
      (plan.flow.steps.find(s=>s.id===plan.focusId)?.title||plan.focusId)+'". ':
      'As demais etapas serão preservadas. ')+
      'A exclusão ficará apenas no editor até você clicar em Salvar rascunho. Você pode desfazer.'
    if(!window.confirm(prompt))return
    applyPlan(plan)
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
  return <section ref={rootRef} className="crm-forms" aria-label="Construtor de formulários">
    <div className="crm-forms-heading">
      <div><strong>FORMULÁRIOS INTELIGENTES</strong><p>Crie jornadas diferentes para cada nicho, configure bifurcações e publique quando estiver pronto. O /agendar atual permanece independente.</p></div>
      {selected&&<button type="button" className="crm-btn" onClick={()=>{
        if(dirty&&!window.confirm('Sair do editor e descartar todas as alterações não salvas?'))return
        setSelected(null);setDraft(null);setMessage('');setUndoStack([]);setRedoStack([])
      }}>← Todos os formulários</button>}
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
          <label>Nome<input value={title} maxLength={120} onChange={e=>{recordUndo('meta:title');setTitle(e.target.value);setDirty(true)}}/></label>
          <label>URL amigável<input value={slug} disabled={selected.status==='published'} title={selected.status==='published'?'Despublique antes de alterar o endereço público.':undefined} maxLength={70} onChange={e=>{recordUndo('meta:slug');setSlug(e.target.value);setDirty(true)}}/></label>
          <label className="crm-forms-wide">Descrição curta<input value={description} maxLength={400} onChange={e=>{recordUndo('meta:description');setDescription(e.target.value);setDirty(true)}}/></label>
        </div>
        <div className="crm-forms-toolbar">
          <span className="crm-forms-pill">{selected.status==='published'?'Publicado · versão '+selected.publishedVersion:'Somente rascunho'}</span>
          <span className="crm-forms-help">Alterações só entram no banco ao clicar em <strong>Salvar rascunho</strong>.</span>
          {dirty&&<span className="crm-forms-dirty">Alterações não salvas</span>}
          <div className="crm-forms-history" role="group" aria-label="Histórico de alterações">
            <button type="button" className="crm-btn" title="Desfazer alteração (Ctrl/⌘ + Z fora dos campos)" aria-label="Desfazer alteração" disabled={!undoStack.length||busy} onClick={undo}>↶ Desfazer</button>
            <button type="button" className="crm-btn" title="Refazer alteração (Ctrl/⌘ + Shift + Z)" aria-label="Refazer alteração" disabled={!redoStack.length||busy} onClick={redo}>↷ Refazer</button>
            <button type="button" className="crm-btn crm-forms-discard" title="Recuperar a última versão salva" disabled={!dirty||busy} onClick={discard}>Descartar alterações</button>
          </div>
          <button type="button" className="crm-btn" onClick={beginPreview}>Simular jornada</button>
          <button type="button" className="crm-btn crm-forms-primary" disabled={busy||!dirty||!validation?.ok} onClick={()=>void save()}>Salvar rascunho</button>
          <button type="button" className="crm-btn" disabled={busy||dirty||!validation?.ok} onClick={()=>void publish('publish')}>Publicar versão salva</button>
          {selected.status==='published'&&<button type="button" className="crm-btn" disabled={busy||dirty} onClick={()=>void publish('unpublish')}>Retirar do ar</button>}
        </div>
        {selected.status==='published'&&<p><a href={'/formularios/'+selected.slug} target="_blank" rel="noopener noreferrer">Abrir versão publicada ↗</a> · Alterações no rascunho não afetam este link até publicar novamente.</p>}
      </div>
      {draft.cover&&<div className="crm-card crm-forms-cover-editor">
        <div className="crm-forms-cover-heading"><strong>CAPA DO FORMULÁRIO · MODELO CHRONOS</strong><small>Esta apresentação aparece antes da primeira pergunta.</small></div>
        <label>Headline<input maxLength={160} value={draft.cover.headline} onChange={e=>edit(d=>{if(d.cover)d.cover.headline=e.target.value})}/></label>
        <div className="crm-forms-cover-bullets">{draft.cover.bullets.map((bullet,i)=><label key={i}>Destaque {i+1}
          <input maxLength={100} value={bullet} onChange={e=>edit(d=>{if(d.cover)d.cover.bullets[i]=e.target.value})}/>
        </label>)}</div>
        <label>Filtro de qualificação (rodapé em itálico)<textarea rows={2} maxLength={240} value={draft.cover.qualifier} onChange={e=>edit(d=>{if(d.cover)d.cover.qualifier=e.target.value})}/></label>
        <label>Botão da capa<input maxLength={60} value={draft.cover.cta} onChange={e=>edit(d=>{if(d.cover)d.cover.cta=e.target.value})}/></label>
      </div>}
      {validation&&!validation.ok&&<div className="crm-forms-invalid" role="alert"><strong>Revise o fluxo antes de salvar:</strong><ul>{validation.issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul></div>}
      <div className="crm-forms-view-tabs" role="group" aria-label="Modo de visualização do construtor">
        <button type="button" data-active={viewMode==='flow'} aria-pressed={viewMode==='flow'} onClick={()=>setViewMode('flow')}>◈ Fluxograma interativo</button>
        <button type="button" data-active={viewMode==='steps'} aria-pressed={viewMode==='steps'} onClick={()=>setViewMode('steps')}>☷ Lista de etapas</button>
        <small>As duas visualizações editam o mesmo rascunho.</small>
      </div>
      <div className={'crm-forms-workspace'+(viewMode==='flow'?' crm-forms-workspace-flow':'')}>
        {viewMode==='flow'&&<FormsFlowCanvas flow={draft} selectedStep={selectedStep}
          onSelect={id=>{setSelectedStep(id);setSelectedOutput('');setPreview(false)}}
          onMove={moveNode} onConnect={connectSteps} onRemoveBranch={removeBranch} onResetLayout={resetLayout}
          focusStep={focusStep}/>}
        {viewMode==='steps'&&<div className="crm-card crm-forms-map">
          <div className="crm-forms-map-head"><strong>MAPA DO FUNIL</strong><span>{draft.steps.length} etapas</span></div>
          {draft.steps.map((s,i)=><button key={s.id} type="button" className="crm-forms-node" data-selected={selectedStep===s.id} onClick={()=>{setSelectedStep(s.id);setSelectedOutput('');setPreview(false)}}>
            <span className="crm-forms-node-index">{String(i+1).padStart(2,'0')}</span>
            <span><strong>{s.title}</strong><small>{s.type==='question'?(s.branches.length?'Bifurcação: '+s.branches.map(b=>b.answer+' → '+b.to).join(', '):'Próximo: '+s.next):'Resultado: '+s.outcome}</small></span>
            <span>›</span>
          </button>)}
          <div className="crm-forms-map-actions">
            <button type="button" className="crm-btn" onClick={addQuestion} disabled={draft.steps.length>=24}>+ Pergunta aqui</button>
            <button type="button" className="crm-btn" onClick={addResult} disabled={draft.steps.length>=24}>+ Finalização aqui</button>
          </div>
        </div>}
        <div className="crm-card crm-forms-editor">
          {active&&<>
            <div className="crm-forms-editor-header"><div><span>EDITOR DA ETAPA</span><h3>{active.type==='question'?'Pergunta':'Página final'}</h3></div>
              <button type="button" className="crm-forms-remove" disabled={busy} onClick={removeStep}>Excluir etapa</button></div>
            {active.type==='result'&&<label className="crm-forms-delete-destination">Ao excluir esta finalização, enviar as conexões para:
              <select value={validRedirect} onChange={e=>setRedirectFinal(e.target.value)}>
                {finalOptions.map(s=><option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
              <small>A confirmação mostra quais caminhos serão alterados. Você poderá desfazer antes de salvar.</small>
            </label>}
            <label>Título da etapa<input value={active.title} maxLength={160} onChange={e=>updateStep({title:e.target.value})}/></label>
            <label>Texto de apoio<textarea rows={3} maxLength={500} value={active.description} onChange={e=>updateStep({description:e.target.value})}/></label>
            {active.type==='question'?<>
              <div className="crm-forms-columns">
                <label>Tipo de resposta<select value={active.input} onChange={e=>updateQuestion({input:e.target.value as 'text'|'select',field:undefined,options:e.target.value==='select'?['Sim','Não']:[],branches:[]})}>
                  <option value="select">Múltipla escolha</option><option value="text">Texto curto</option></select></label>
                <label className="crm-forms-check"><input type="checkbox" checked={active.required} onChange={e=>updateQuestion({required:e.target.checked})}/>Obrigatória</label>
              </div>
              {active.input==='text'&&<label>Formato da resposta<select value={active.field||''} onChange={e=>updateQuestion({field:e.target.value?e.target.value as FlowQuestion['field']:undefined})}>
                <option value="">Texto livre</option><option value="name">Nome da pessoa</option><option value="phone">Telefone com DDD</option><option value="website">Instagram ou site</option>
              </select></label>}
              {active.input==='select'&&<label>Alternativas (uma por linha)<textarea key={active.id+'-'+fieldResetVersion} rows={4} defaultValue={active.options.join('\n')} onChange={e=>{
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
        <div className="crm-forms-insert-where">
          <strong>Inserir no cartão selecionado:</strong>
          <span>{active?.title||'Selecione uma etapa no mapa'}</span>
          {active?.type==='question'&&active.input==='select'&&
            <label>Caminho para inserir pergunta
              <select value={selectedOutput} onChange={e=>setSelectedOutput(e.target.value)}>
                <option value="">Caminho padrão (respostas sem desvio)</option>
                {active.options.map(answer=><option key={answer} value={'answer:'+answer}>Resposta: {answer}</option>)}
              </select>
            </label>}
        </div>
        <button type="button" className="crm-btn" onClick={addQuestion} disabled={busy||draft.steps.length>=24}>+ Inserir pergunta aqui</button>
        <button type="button" className="crm-btn" onClick={addResult} disabled={busy||draft.steps.length>=24}>+ Criar finalização aqui</button>
        <small>A pergunta entra na saída escolhida ou antes da finalização selecionada. A nova finalização cria uma resposta própria, sem substituir o caminho atual. Tudo pode ser desfeito antes de salvar.</small>
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
