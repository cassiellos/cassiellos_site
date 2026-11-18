'use client'

import { useLayoutEffect, useEffect, useId, useMemo, useRef, useState, type PointerEvent } from 'react'
import type { FlowDefinition, FlowQuestion } from '@/lib/crm/form-builder/flow'
import { diagramModel, fitDiagramCamera, zoomDiagramCameraAt, NODE_WIDTH, PORT_TOP, PORT_HEIGHT, type DiagramPoint, type DiagramNode } from '@/lib/crm/form-builder/diagram'
import './forms-flow-canvas.css'

type PendingConnection = { source: string; answer: string | null; label: string }
type Camera = { x: number; y: number; zoom: number }
type Props = {
  flow: FlowDefinition
  selectedStep: string
  onSelect: (id: string) => void
  onMove: (id: string, point: DiagramPoint) => void
  onConnect: (sourceId: string, answer: string | null, targetId: string) => boolean
  onRemoveBranch: (sourceId: string, answer: string) => void
  onResetLayout: () => void
}
const MIN_ZOOM = .2
const MAX_ZOOM = 3
const WIDTH = NODE_WIDTH
const clamp = (value:number,min:number,max:number) => Math.min(max,Math.max(min,value))

function colorFor(label:string,kind:'default'|'branch') {
  if (/^sim$/i.test(label)) return '#4dd4a3'
  if (/^não$/i.test(label)) return '#ffbc7b'
  return kind === 'branch' ? '#f27689' : '#829cbb'
}
function shortLabel(name:string) {
  if(name.length <= 60) return name
  return name.slice(0,57).trimEnd()+'…'
}

export default function FormsFlowCanvas({flow,selectedStep,onSelect,onMove,onConnect,onRemoveBranch,onResetLayout}:Props) {
  const model = useMemo(()=>diagramModel(flow),[flow])
  const modelRef=useRef(model)
  modelRef.current=model
  const stage = useRef<HTMLDivElement>(null)
  const [size,setSize] = useState({w:0,h:0})
  const [camera,setCamera] = useState<Camera>({x:26,y:28,zoom:1})
  const [measured,setMeasured] = useState(false)
  const cameraTouched = useRef(false)
  const [pending,setPending] = useState<PendingConnection|null>(null)
  const [temp,setTemp] = useState<Record<string,DiagramPoint>>({})
  const [notice,setNotice] = useState('')
  const pointerPan = useRef<{x:number;y:number;originX:number;originY:number}|null>(null)
  const dragging = useRef<{id:string;startX:number;startY:number;originX:number;originY:number;moved:boolean}|null>(null)
  const moveCache = useRef<Record<string,DiagramPoint>>({})
  const svgId = useId().replace(/:/g,'')
  const nodesById = useMemo(()=>new Map(model.nodes.map(node=>[node.id,node])),[model.nodes])
  const positions = useMemo(()=>new Map(model.nodes.map(n=>[n.id,{...n,...(temp[n.id]||{})}])),[model.nodes,temp])

  // Initial fit only after the stage has a measurable rendered box. A zero-width or
  // temporary hidden viewport must never set the initial camera or mark fit complete.
  // Observe actual layout, not the guessed 930px initial state.
  const stepStructure = flow.start+'|'+flow.steps.map(s=>s.id).join('|')
  useLayoutEffect(()=>{
    const el=stage.current
    if(!el)return
    let disposed=false
    let raf=0
    let lastW=0,lastH=0
    const measure=()=>{
      cancelAnimationFrame(raf)
      raf=requestAnimationFrame(()=>{
        if(disposed)return
        const rect=el.getBoundingClientRect()
        const w=Math.round(rect.width),h=Math.round(rect.height)
        if(w<80||h<80)return
        if(w===lastW&&h===lastH)return
        lastW=w;lastH=h
        setSize({w,h})
        if(!cameraTouched.current){
          setCamera(fitDiagramCamera(modelRef.current,{w,h},flow.start,MIN_ZOOM))
        }
        setMeasured(true)
      })
    }
    // Both observers cover lazy-mounted tabs and first-paint layout shifts.
    measure()
    const observer=typeof ResizeObserver!=='undefined'?new ResizeObserver(measure):null
    observer?.observe(el)
    const visibility=typeof IntersectionObserver!=='undefined'?new IntersectionObserver(entries=>{
      if(entries.some(e=>e.isIntersecting))measure()
    }):null
    visibility?.observe(el)
    return ()=>{disposed=true;cancelAnimationFrame(raf);observer?.disconnect();visibility?.disconnect()}
  },[stepStructure])

  const fit=()=>{
    const rect=stage.current?.getBoundingClientRect()
    const actual={w:Math.round(rect?.width||size.w),h:Math.round(rect?.height||size.h)}
    if(actual.w<80||actual.h<80)return
    cameraTouched.current=true
    setSize(actual)
    setCamera(fitDiagramCamera(model,actual,flow.start,MIN_ZOOM))
    setMeasured(true)
  }
  function zoomAt(amount:number){
    cameraTouched.current=true
    const rect=stage.current?.getBoundingClientRect()
    const w=rect?.width??size.w
    const h=rect?.height??size.h
    setCamera(prev=>zoomDiagramCameraAt(prev,amount,{x:w/2,y:h/2},MIN_ZOOM,MAX_ZOOM))
  }

  // React 19 delegates wheel listeners as passive on the root. Calling preventDefault()
  // in React onWheel does NOT prevent Chromium/macOS from enlarging the entire browser
  // page when a trackpad pinch arrives as Ctrl+wheel. The native non-passive listener
  // must be attached to the canvas itself and removed on unmount.
  useEffect(()=>{
    const el=stage.current
    if(!el)return

    const zoomFromCursor=(factor:number,clientX:number,clientY:number)=>{
      const rect=el.getBoundingClientRect()
      // Safari gesture coordinates can be absent: anchor at the canvas center.
      const valid=Number.isFinite(clientX)&&Number.isFinite(clientY) && (clientX!==0||clientY!==0)
      const x=valid?clamp(clientX-rect.left,0,rect.width):rect.width/2
      const y=valid?clamp(clientY-rect.top,0,rect.height):rect.height/2
      setCamera(prev=>zoomDiagramCameraAt(prev,factor,{x,y},MIN_ZOOM,MAX_ZOOM))
    }

    const wheel=(event:globalThis.WheelEvent)=>{
      if(event.cancelable)event.preventDefault()
      cameraTouched.current=true
      const lineFactor=event.deltaMode===1?16:event.deltaMode===2?el.clientHeight:1
      if(event.ctrlKey||event.metaKey){
        // Trackpad pinch: only the diagram changes; never the browser zoom.
        zoomFromCursor(Math.exp(-event.deltaY*lineFactor*.008),event.clientX,event.clientY)
      }else{
        // Two-finger scroll still pans the map inside the clipped canvas.
        setCamera(prev=>({...prev,
          x:prev.x-event.deltaX*lineFactor,
          y:prev.y-event.deltaY*lineFactor,
        }))
      }
    }

    // Safari uses gesturestart/gesturechange for a pinch instead of Ctrl+wheel.
    type SafariGesture=Event & {scale?:number;clientX?:number;clientY?:number}
    let previousScale=1
    const startGesture=(event:Event)=>{
      if(event.cancelable)event.preventDefault()
      previousScale=1
    }
    const changeGesture=(event:Event)=>{
      if(event.cancelable)event.preventDefault()
      const gesture=event as SafariGesture
      const nextScale=gesture.scale
      if(!Number.isFinite(nextScale)||!nextScale||nextScale<=0)return
      cameraTouched.current=true
      zoomFromCursor(nextScale/previousScale,gesture.clientX??NaN,gesture.clientY??NaN)
      previousScale=nextScale
    }
    const endGesture=(event:Event)=>{
      if(event.cancelable)event.preventDefault()
      previousScale=1
    }

    el.addEventListener('wheel',wheel,{passive:false})
    el.addEventListener('gesturestart',startGesture,{passive:false})
    el.addEventListener('gesturechange',changeGesture,{passive:false})
    el.addEventListener('gestureend',endGesture,{passive:false})
    return ()=>{
      el.removeEventListener('wheel',wheel)
      el.removeEventListener('gesturestart',startGesture)
      el.removeEventListener('gesturechange',changeGesture)
      el.removeEventListener('gestureend',endGesture)
    }
  },[])

  function startPan(e:PointerEvent<HTMLDivElement>){
    if(e.button!==0)return
    if((e.target as Element).closest('.cvf-node'))return
    if((e.target as Element).closest('.cvf-tool'))return
    cameraTouched.current=true
    pointerPan.current={x:e.clientX,y:e.clientY,originX:camera.x,originY:camera.y}
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function panMove(e:PointerEvent<HTMLDivElement>){
    if(!pointerPan.current)return
    const p=pointerPan.current
    setCamera(prev=>({...prev,x:p.originX+e.clientX-p.x,y:p.originY+e.clientY-p.y}))
  }
  function finishPan(){pointerPan.current=null}

  function startMove(e:PointerEvent<HTMLButtonElement>,node:DiagramNode){
    if(e.button!==0 || pending)return
    cameraTouched.current=true
    e.stopPropagation()
    dragging.current={id:node.id,startX:e.clientX,startY:e.clientY,
      originX:positions.get(node.id)?.x??node.x,originY:positions.get(node.id)?.y??node.y,moved:false}
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  function moveNode(e:PointerEvent<HTMLButtonElement>){
    const d=dragging.current
    if(!d)return
    const dx=(e.clientX-d.startX)/camera.zoom
    const dy=(e.clientY-d.startY)/camera.zoom
    if(Math.abs(dx)+Math.abs(dy)>4)d.moved=true
    if(!d.moved)return
    const point={x:clamp(Math.round(d.originX+dx),-2500,6500),y:clamp(Math.round(d.originY+dy),-2500,6500)}
    moveCache.current[d.id]=point
    setTemp(prev=>({...prev,[d.id]:point}))
  }
  function finishMove(e:PointerEvent<HTMLButtonElement>){
    if(!dragging.current)return
    const d=dragging.current
    dragging.current=null
    if(d.moved){
      const point=moveCache.current[d.id]
      if(point)onMove(d.id,point)
    } else {
      chooseNode(d.id)
    }
    // Suppress the synthetic click produced by the pointer capture.
    e.stopPropagation()
  }

  function chooseNode(id:string){
    if(!pending){onSelect(id);return}
    if(pending.source===id){setNotice('Escolha outra etapa como destino.');return}
    if(onConnect(pending.source,pending.answer,id)){
      setNotice('Ligação atualizada no rascunho. Salve para persistir a alteração.')
      setPending(null)
    }else{
      setNotice('Ligação não aplicada: confira os avisos de validação acima do fluxograma.')
    }
  }

  function portStart(e:React.MouseEvent<HTMLButtonElement>,from:PendingConnection){
    e.stopPropagation()
    setPending(old=>old?.source===from.source&&old.answer===from.answer?null:from)
    setNotice('Clique no cartão que deverá receber "'+from.label+'". Nenhuma alteração é feita até selecionar o destino.')
  }
  const [freshBranch,setFreshBranch]=useState<Record<string,string>>({})
  function nodePosition(n:DiagramNode){return positions.get(n.id)||n}
  const orderedEdges=model.ports.map(port=>{
    const src=positions.get(port.source)
    const dst=positions.get(port.target)
    const origin=model.nodes.find(n=>n.id===port.source)
    if(!src||!dst||!origin)return null
    const portIndex=origin.ports.findIndex(p=>p.key===port.key)
    const x1=src.x+WIDTH
    const y1=src.y+PORT_TOP+PORT_HEIGHT*portIndex+PORT_HEIGHT/2
    const x2=dst.x
    const y2=dst.y+(dst.step.type==='result'?77:75)
    const bend=Math.max(55,Math.abs(x2-x1)*.42)
    const path=`M ${x1} ${y1} C ${x1+bend} ${y1} ${x2-bend} ${y2} ${x2} ${y2}`
    return {key:port.key,path,color:colorFor(port.label,port.kind),label:port.label}
  }).filter((x):x is NonNullable<typeof x>=>Boolean(x))

  return <div className="cvf-shell" aria-label="Editor visual de fluxograma">
    <div className="cvf-toolbar">
      <div className="cvf-toolbar-intro">
        <strong>FLUXOGRAMA INTERATIVO</strong>
        <small>{model.nodes.length} etapas · {model.ports.length} caminhos visíveis</small>
      </div>
      <div className="cvf-controls">
        <button className="cvf-tool" type="button" title="Reduzir zoom" aria-label="Reduzir zoom" onClick={()=>zoomAt(.82)}>−</button>
        <span className="cvf-zoom">{Math.round(camera.zoom*100)}%</span>
        <button className="cvf-tool" type="button" title="Ampliar zoom" aria-label="Ampliar zoom" onClick={()=>zoomAt(1.22)}>+</button>
        <button className="cvf-tool cvf-fit" type="button" onClick={fit}>Centralizar</button>
        <button className="cvf-tool cvf-reset" type="button" onClick={()=>{
          if(Object.keys(flow.layout||{}).length&&!window.confirm('Restaurar a organização automática dos cartões? A mudança ficará no rascunho até você salvar.'))return
          const auto=diagramModel({...flow,layout:undefined})
          const rect=stage.current?.getBoundingClientRect()
          const actual={w:Math.round(rect?.width||size.w),h:Math.round(rect?.height||size.h)}
          setTemp({});moveCache.current={};onResetLayout()
          if(actual.w>=80&&actual.h>=80){cameraTouched.current=true;setCamera(fitDiagramCamera(auto,actual,flow.start,MIN_ZOOM))}
        }}>Organizar</button>
      </div>
    </div>
    {pending&&<div className="cvf-connect-banner" role="status">
      <span>Conectando: <strong>{pending.label}</strong>. Clique no cartão de destino.</span>
      <button type="button" onClick={()=>{setPending(null);setNotice('')}}>Cancelar ligação ×</button>
    </div>}
    {notice&&!pending&&<div className="cvf-notice" role="status">{notice}</div>}
    <div ref={stage} className="cvf-stage" tabIndex={0} data-measured={measured}
      onPointerDown={startPan} onPointerMove={panMove} onPointerUp={finishPan} onPointerCancel={finishPan}
      aria-label="Área do fluxograma. Pinça do touchpad ou Ctrl mais rolagem amplia o mapa sem alterar a página; arraste o fundo para navegar.">
      <div className="cvf-world" style={{visibility:measured?'visible':'hidden',width:model.width,height:model.height,
        transform:`translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`}}>
        <svg aria-hidden="true" className="cvf-lines" width="100%" height="100%"
          style={{position:'absolute',left:0,top:0,overflow:'visible',pointerEvents:'none'}}>
          <defs>
            <marker id={svgId+'-arrow'} markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M 0 0 L 8 4.5 L 0 9 z" fill="#b5c5d9"/>
            </marker>
          </defs>
          {orderedEdges.map(edge=><path key={edge.key} d={edge.path}
            fill="none" stroke={edge.color} strokeWidth="2.6" strokeLinecap="round" opacity=".9"
            markerEnd={`url(#${svgId}-arrow)`}/>)}
        </svg>
        {model.nodes.map((node,i)=>{
          const pos=nodePosition(node)
          const step=node.step
          const isSelected=selectedStep===node.id
          const isOrphan=!model.reachable.has(node.id)
          const question=step.type==='question'?step:null
          const outcome=step.type==='result'?step.outcome:null
          const used=new Set(question?.branches.map(b=>b.answer)||[])
          const unbranched=question?.input==='select'?question.options.filter(x=>!used.has(x)):[]
          return <div key={node.id} className="cvf-node" style={{left:pos.x,top:pos.y,width:node.w,height:node.h}}
            data-selected={isSelected} data-result={step.type==='result'} data-unreachable={isOrphan}
            data-connecting={Boolean(pending)} onClick={()=>chooseNode(node.id)}
            role="group" aria-label={step.title}>
            <button className="cvf-node-drag" type="button" aria-label={'Selecionar ou arrastar: '+step.title}
              title="Clique para editar ou arraste para mover no mapa"
              onClick={e=>{e.stopPropagation();if(e.detail===0)chooseNode(node.id)}}
              onPointerDown={e=>startMove(e,node)}
              onPointerMove={moveNode} onPointerUp={finishMove} onPointerCancel={finishMove}>
              <span className="cvf-node-number">{String(i+1).padStart(2,'0')}{flow.start===node.id?' · INÍCIO':''}</span>
              <span className="cvf-node-kind">{step.type==='question'?'PERGUNTA':'FINALIZAÇÃO'}</span>
              <strong>{shortLabel(step.title)}</strong>
            </button>
            {question?<div className="cvf-node-ports">
              {node.ports.map(port=><div className="cvf-port-row" key={port.key}>
                <button type="button" className="cvf-node-port"
                  style={{'--cvf-color':colorFor(port.label,port.kind)} as React.CSSProperties}
                  aria-label={'Conectar resposta '+port.label+' a outra etapa'}
                  title={port.kind==='default'?'Alterar o destino padrão para as respostas não bifurcadas':'Alterar o destino da resposta '+port.label}
                  onClick={e=>portStart(e,{source:node.id,answer:port.answer,label:port.label})}>
                  <span>{port.label}</span><i aria-hidden="true"/>
                </button>
                {port.kind==='branch'&&port.answer&&<button type="button" className="cvf-port-delete"
                  title={'Retirar bifurcação da resposta '+port.answer}
                  aria-label={'Retirar bifurcação da resposta '+port.answer}
                  onClick={e=>{e.stopPropagation();onRemoveBranch(node.id,port.answer!)}}>×</button>}
              </div>)}
              {unbranched.length>0&&question.input==='select'&&<div className="cvf-add-branch" onClick={e=>e.stopPropagation()}>
                <select aria-label={'Criar bifurcação em '+step.title} value={freshBranch[node.id]||''}
                  onChange={e=>{
                    const answer=e.target.value
                    if(!answer)return
                    setFreshBranch(prev=>({...prev,[node.id]:''}))
                    setPending({source:node.id,answer,label:answer})
                    setNotice('Selecione o cartão de destino para criar o desvio "'+answer+'".')
                  }}>
                  <option value="">+ Separar resposta</option>
                  {unbranched.map(answer=><option key={answer} value={answer}>{answer}</option>)}
                </select>
              </div>}
            </div>:<div className="cvf-node-final">
              <span className={'cvf-result-pill cvf-result-'+outcome}>
                {outcome==='qualified'?'Orçamento compatível':outcome==='limited'?'Orçamento limitado':'Outro resultado'}
              </span>
              <span>Etapa final do caminho</span>
            </div>}
            {isOrphan&&<div className="cvf-orphan">Etapa desconectada</div>}
          </div>
        })}
      </div>
      {!measured&&<div className="cvf-stage-loading" role="status">Preparando visualização do fluxograma…</div>}
      <div className="cvf-stage-tip">Arraste os cartões · Arraste o fundo · Clique na saída e depois no destino · Pinça/⌘ + rolar: zoom só no mapa</div>
    </div>
    <div className="cvf-legend"><span><i className="cvf-green"/> Resposta Sim</span><span><i className="cvf-amber"/> Resposta Não</span><span><i className="cvf-slate"/> Caminho padrão</span><span className="cvf-foot-tip">As mudanças só afetam o rascunho até você publicar.</span></div>
  </div>
}
