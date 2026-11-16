'use client'

import { useEffect, useId, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import type { FlowDefinition, FlowQuestion } from '@/lib/crm/form-builder/flow'
import { diagramModel, NODE_WIDTH, PORT_TOP, PORT_HEIGHT, type DiagramPoint, type DiagramNode } from '@/lib/crm/form-builder/diagram'
import './forms-flow-canvas.css'

type PendingConnection = { source: string; answer: string | null; label: string }
type Camera = { x: number; y: number; zoom: number }
type Props = {
  flow: FlowDefinition
  selectedStep: string
  onSelect: (id: string) => void
  onMove: (id: string, point: DiagramPoint) => void
  onConnect: (sourceId: string, answer: string | null, targetId: string) => boolean
  onResetLayout: () => void
}
const MIN_ZOOM = .3
const MAX_ZOOM = 1.6
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

export default function FormsFlowCanvas({flow,selectedStep,onSelect,onMove,onConnect,onResetLayout}:Props) {
  const model = useMemo(()=>diagramModel(flow),[flow])
  const stage = useRef<HTMLDivElement>(null)
  const [size,setSize] = useState({w:930,h:650})
  const [camera,setCamera] = useState<Camera>({x:26,y:28,zoom:.8})
  const [pending,setPending] = useState<PendingConnection|null>(null)
  const [temp,setTemp] = useState<Record<string,DiagramPoint>>({})
  const [notice,setNotice] = useState('')
  const pointerPan = useRef<{x:number;y:number;originX:number;originY:number}|null>(null)
  const dragging = useRef<{id:string;startX:number;startY:number;originX:number;originY:number;moved:boolean}|null>(null)
  const moveCache = useRef<Record<string,DiagramPoint>>({})
  const svgId = useId().replace(/:/g,'')
  const nodesById = useMemo(()=>new Map(model.nodes.map(node=>[node.id,node])),[model.nodes])
  const positions = useMemo(()=>new Map(model.nodes.map(n=>[n.id,{...n,...(temp[n.id]||{})}])),[model.nodes,temp])

  useEffect(()=>{
    const node=stage.current
    if(!node)return
    const measure=()=>setSize({w:Math.max(300,node.clientWidth),h:Math.max(300,node.clientHeight)})
    measure()
    if(typeof ResizeObserver==='undefined')return
    const obs=new ResizeObserver(measure)
    obs.observe(node)
    return ()=>obs.disconnect()
  },[])

  const fit=()=>{
    const zoom=clamp(Math.min((size.w-74)/model.width,(size.h-68)/model.height),MIN_ZOOM,1)
    setCamera({zoom,x:(size.w-model.width*zoom)/2-model.minX*zoom,
      y:(size.h-model.height*zoom)/2-model.minY*zoom})
  }
  // Refit when the editor opens or a new step is added, but never when someone types
  // into a question or repositions a card.
  useEffect(()=>{
    const zoom=clamp(Math.min((size.w-74)/model.width,(size.h-68)/model.height),MIN_ZOOM,1)
    setCamera({zoom,x:(size.w-model.width*zoom)/2-model.minX*zoom,
      y:(size.h-model.height*zoom)/2-model.minY*zoom})
  },[flow.start,flow.steps.length,size.w,size.h])

  function zoomAt(amount:number){
    setCamera(prev=>{
      const next=clamp(prev.zoom*amount,MIN_ZOOM,MAX_ZOOM)
      const x=(size.w/2-prev.x)/prev.zoom
      const y=(size.h/2-prev.y)/prev.zoom
      return {zoom:next,x:size.w/2-next*x,y:size.h/2-next*y}
    })
  }
  function onWheel(e:WheelEvent<HTMLDivElement>){
    e.preventDefault()
    if(e.ctrlKey||e.metaKey){
      const rect=stage.current?.getBoundingClientRect()
      const px=e.clientX-(rect?.left||0)
      const py=e.clientY-(rect?.top||0)
      setCamera(prev=>{
        const zoom=clamp(prev.zoom*Math.exp(-e.deltaY*.008),MIN_ZOOM,MAX_ZOOM)
        return {zoom,x:px-(px-prev.x)/prev.zoom*zoom,y:py-(py-prev.y)/prev.zoom*zoom}
      })
    }else{
      setCamera(prev=>({...prev,x:prev.x-e.deltaX,y:prev.y-e.deltaY}))
    }
  }
  function startPan(e:PointerEvent<HTMLDivElement>){
    if(e.button!==0)return
    if((e.target as Element).closest('.cvf-node'))return
    if((e.target as Element).closest('.cvf-tool'))return
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
    const isBack=x2<x1+30
    const path=isBack
      ? `M ${x1} ${y1} C ${x1+bend} ${y1} ${x2-bend} ${y2} ${x2} ${y2}`
      : `M ${x1} ${y1} C ${x1+bend} ${y1} ${x2-bend} ${y2} ${x2} ${y2}`
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
          setTemp({});moveCache.current={};onResetLayout();fit()
        }}>Organizar</button>
      </div>
    </div>
    {pending&&<div className="cvf-connect-banner" role="status">
      <span>Conectando: <strong>{pending.label}</strong>. Clique no cartão de destino.</span>
      <button type="button" onClick={()=>{setPending(null);setNotice('')}}>Cancelar ligação ×</button>
    </div>}
    {notice&&!pending&&<div className="cvf-notice" role="status">{notice}</div>}
    <div ref={stage} className="cvf-stage" tabIndex={0}
      onPointerDown={startPan} onPointerMove={panMove} onPointerUp={finishPan} onPointerCancel={finishPan}
      onWheel={onWheel} aria-label="Área do fluxograma. Arraste o fundo para navegar; Ctrl mais rolagem para zoom.">
      <div className="cvf-world" style={{width:model.width,height:model.height,
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
          const used=new Set(question?.branches.map(b=>b.answer)||[])
          const unbranched=question?.input==='select'?question.options.filter(x=>!used.has(x)):[]
          return <div key={node.id} className="cvf-node" style={{left:pos.x,top:pos.y,width:node.w,height:node.h}}
            data-selected={isSelected} data-result={step.type==='result'} data-unreachable={isOrphan}
            data-connecting={Boolean(pending)} onClick={()=>chooseNode(node.id)}
            role="group" aria-label={step.title}>
            <button className="cvf-node-drag" type="button" aria-label={'Selecionar ou arrastar: '+step.title}
              title="Clique para editar ou arraste para mover no mapa"
              onClick={e=>e.stopPropagation()}
              onPointerDown={e=>startMove(e,node)}
              onPointerMove={moveNode} onPointerUp={finishMove} onPointerCancel={finishMove}>
              <span className="cvf-node-number">{String(i+1).padStart(2,'0')}{flow.start===node.id?' · INÍCIO':''}</span>
              <span className="cvf-node-kind">{step.type==='question'?'PERGUNTA':'FINALIZAÇÃO'}</span>
              <strong>{shortLabel(step.title)}</strong>
            </button>
            {question?<div className="cvf-node-ports">
              {node.ports.map(port=><button key={port.key} type="button" className="cvf-node-port"
                style={{'--cvf-color':colorFor(port.label,port.kind)} as React.CSSProperties}
                aria-label={'Conectar resposta '+port.label+' a outra etapa'}
                title={port.kind==='default'?'Alterar o destino padrão para as respostas não bifurcadas':'Alterar o destino da resposta '+port.label}
                onClick={e=>portStart(e,{source:node.id,answer:port.answer,label:port.label})}>
                <span>{port.label}</span><i aria-hidden="true"/>
              </button>)}
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
              <span className={'cvf-result-pill cvf-result-'+step.outcome}>
                {step.outcome==='qualified'?'Orçamento compatível':step.outcome==='limited'?'Orçamento limitado':'Outro resultado'}
              </span>
              <span>Etapa final do caminho</span>
            </div>}
            {isOrphan&&<div className="cvf-orphan">Etapa desconectada</div>}
          </div>
        })}
      </div>
      <div className="cvf-stage-tip">Arraste os cartões · Arraste o fundo · Clique na saída e depois no destino · Ctrl/⌘ + rolar para ampliar</div>
    </div>
    <div className="cvf-legend"><span><i className="cvf-green"/> Resposta Sim</span><span><i className="cvf-amber"/> Resposta Não</span><span><i className="cvf-slate"/> Caminho padrão</span><span className="cvf-foot-tip">As mudanças só afetam o rascunho até você publicar.</span></div>
  </div>
}
