import { validateFlow, type FlowDefinition, type FlowQuestion, type FlowResult, type FlowStep } from './flow'

/**
 * Alterações atômicas do editor. Só mudam memória no navegador.
 * A persistência continua exclusiva de "Salvar rascunho".
 */
export type FlowEditPlan =
  | { ok: true; flow: FlowDefinition; focusId: string; message: string }
  | { ok: false; reason: string }

const copy = (flow: FlowDefinition): FlowDefinition => JSON.parse(JSON.stringify(flow)) as FlowDefinition
const find = (flow: FlowDefinition, id: string) => flow.steps.find(step => step.id === id)
const outgoing = (step: FlowQuestion, answer: string | null) =>
  answer === null ? step.next : step.branches.find(branch => branch.answer === answer)?.to ?? step.next

function validateEdit(flow: FlowDefinition, focusId: string, message: string): FlowEditPlan {
  const result = validateFlow(flow)
  if (!result.ok) return { ok: false, reason: 'Esta alteração deixaria caminhos desconectados ou inválidos: ' +
    result.issues.join(' ') + ' Revise as conexões ou escolha outra saída.' }
  return { ok: true, flow: result.flow, focusId, message }
}

function replaceIncoming(flow: FlowDefinition, targetId: string, replacementId: string): void {
  if (flow.start === targetId) flow.start = replacementId
  for (const item of flow.steps) {
    if (item.type !== 'question' || item.id === targetId) continue
    if (item.next === targetId) item.next = replacementId
    for (const b of item.branches) if (b.to === targetId) b.to = replacementId
  }
}

/** Insere pergunta no caminho escolhido. Se a finalização estiver selecionada, insere ANTES dela. */
export function insertQuestionAt(flow: FlowDefinition, selectedId: string, newId: string, answer: string | null = null): FlowEditPlan {
  if (flow.steps.length >= 24) return { ok: false, reason: 'O limite é de 24 etapas.' }
  if (find(flow, newId)) return { ok: false, reason: 'Identificador de pergunta já utilizado.' }
  const index = flow.steps.findIndex(step => step.id === selectedId)
  if (index < 0) return { ok: false, reason: 'Selecione uma etapa antes de inserir.' }
  const next = copy(flow)
  const selected = next.steps[index]
  let target: string
  if (selected.type === 'result') {
    target = selected.id
  } else {
    if (answer !== null && (selected.input !== 'select' || !selected.options.includes(answer))) {
      return { ok: false, reason: 'Esta resposta não pertence à pergunta selecionada.' }
    }
    if (answer === null && selected.input === 'select' &&
      selected.options.every(option => selected.branches.some(b => b.answer === option))) {
      return { ok: false, reason: 'Todas as respostas têm saída própria. Escolha uma resposta específica para inserir a pergunta.' }
    }
    target = outgoing(selected, answer)
  }
  const question: FlowQuestion = {
    id: newId, type: 'question', title: 'Nova pergunta', description: '', input: 'text', required: true,
    options: [], branches: [], next: target,
  }
  if (selected.type === 'result') {
    // Todas as rotas que chegavam à finalização passam pela pergunta criada.
    replaceIncoming(next, selected.id, newId)
    next.steps.splice(index, 0, question)
  } else {
    if (answer === null) selected.next = newId
    else {
      const link = selected.branches.find(b => b.answer === answer)
      if (link) link.to = newId
      else selected.branches.push({ answer, to: newId })
    }
    next.steps.splice(index + 1, 0, question)
  }
  return validateEdit(next, newId, selected.type === 'result'
    ? 'Pergunta inserida antes da finalização selecionada.'
    : 'Pergunta inserida no caminho selecionado, preservando o destino que já existia.')
}

/**
 * Uma finalização nova deve criar um caminho novo, SEM substituir o caminho atual.
 * Para perguntas de seleção, adiciona alternativa editável; para finalização, usa
 * uma pergunta de múltipla escolha que já apontava para ela.
 */
export function insertResultAt(flow: FlowDefinition, selectedId: string, newId: string): FlowEditPlan {
  if (flow.steps.length >= 24) return { ok: false, reason: 'O limite é de 24 etapas.' }
  if (find(flow, newId)) return { ok: false, reason: 'Identificador de finalização já utilizado.' }
  const next = copy(flow)
  const selected = find(next, selectedId)
  if (!selected) return { ok: false, reason: 'Selecione uma pergunta para adicionar uma finalização.' }
  let source: FlowQuestion | undefined
  if (selected.type === 'question') source = selected
  else source = next.steps.find((step): step is FlowQuestion =>
    step.type === 'question' && step.input === 'select' &&
    (step.next === selected.id || step.branches.some(branch => branch.to === selected.id)))
  if (!source || source.input !== 'select') {
    return { ok: false, reason: 'Selecione uma pergunta de múltipla escolha. Uma finalização precisa estar ligada a uma resposta para não criar etapas soltas.' }
  }
  if (source.options.length >= 12) return { ok: false, reason: 'Esta pergunta já possui 12 alternativas. Remova uma alternativa antes de criar outra saída.' }
  let answer = 'Nova alternativa'
  let n = 2
  while (source.options.includes(answer)) answer = 'Nova alternativa ' + n++
  source.options.push(answer)
  source.branches.push({ answer, to: newId })
  const result: FlowResult = {
    id: newId, type: 'result', title: 'Nova finalização', description: 'Personalize esta mensagem.',
    outcome: 'other', actionLabel: '', actionHref: '',
  }
  next.steps.splice(next.steps.findIndex(step => step.id === source!.id) + 1, 0, result)
  return validateEdit(next, newId, 'Finalização conectada à pergunta "' + source.title +
    '" pela resposta "' + answer + '". Edite o texto dessa alternativa no painel da pergunta.')
}

/**
 * Excluir sem quebrar os links: pergunta -> próximo padrão; finalização ->
 * outra finalização escolhida pelo usuário. Nunca elimina outras etapas automaticamente.
 */
export function removeStepAndReconnect(flow: FlowDefinition, selectedId: string, replacementId?: string): FlowEditPlan {
  if (flow.steps.length <= 2) return { ok: false, reason: 'O fluxo precisa manter ao menos duas etapas.' }
  const selected = find(flow, selectedId)
  if (!selected) return { ok: false, reason: 'Selecione uma etapa para excluir.' }
  let replacement: string
  if (selected.type === 'question') replacement = selected.next
  else {
    const other = replacementId && find(flow, replacementId)
    if (!other || other.type !== 'result' || other.id === selected.id) {
      return { ok: false, reason: 'Para excluir essa finalização, escolha outra finalização como destino dos caminhos ligados a ela.' }
    }
    replacement = other.id
  }
  const next = copy(flow)
  replaceIncoming(next, selectedId, replacement)
  next.steps = next.steps.filter(step => step.id !== selectedId)
  if (next.layout) delete next.layout[selectedId]
  return validateEdit(next, replacement, 'Etapa excluída. Os caminhos de entrada foram redirecionados para "' +
    (find(next, replacement)?.title ?? replacement) + '".')
}
