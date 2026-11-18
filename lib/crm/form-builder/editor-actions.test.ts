import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { newFlowTemplate, routeFlow, validateFlow } from './flow'
import { insertQuestionAt, insertResultAt, removeStepAndReconnect } from './editor-actions'

describe('Editor intuitivo — inserir, excluir e manter conexões válidas', () => {
  it('insere pergunta depois da etapa clicada, sem perder a conexão anterior', () => {
    const original = newFlowTemplate('Hamburguerias')
    const before = JSON.stringify(original)
    const inserted = insertQuestionAt(original, 'clinic', 'new_question')
    assert.equal(inserted.ok, true)
    if (inserted.ok) {
      const clinic = inserted.flow.steps.find(s => s.id === 'clinic')
      const question = inserted.flow.steps.find(s => s.id === 'new_question')
      assert.equal(clinic?.type === 'question' && clinic.next, 'new_question')
      assert.equal(question?.type === 'question' && question.next, 'revenue')
      assert.equal(validateFlow(inserted.flow).ok, true)
      assert.equal(inserted.focusId, 'new_question')
    }
    assert.equal(JSON.stringify(original), before, 'não modifica o formulário original')
  })

  it('insere pergunta ANTES da finalização selecionada, mantendo os dois resultados', () => {
    const flow = newFlowTemplate('Hamburguerias')
    const change = insertQuestionAt(flow, 'qualified', 'before_final')
    assert.equal(change.ok, true)
    if (change.ok) {
      const budget = change.flow.steps.find(s => s.id === 'budget')
      assert.equal(budget?.type === 'question' && budget.next, 'before_final')
      assert.equal(change.flow.steps.find(s => s.id === 'before_final')?.type, 'question')
      assert.equal(routeFlow(change.flow, { clinic: 'Loja X', revenue: 'Acima de R$ 100 mil', budget: 'Não' })?.result.outcome,'limited')
    }
  })

  it('insere pergunta numa resposta específica, preservando a outra bifurcação', () => {
    const flow = newFlowTemplate('Hamburguerias')
    const change = insertQuestionAt(flow, 'budget', 'after_no', 'Não')
    assert.equal(change.ok, true)
    if (change.ok) {
      const budget = change.flow.steps.find(s => s.id === 'budget')
      assert.equal(budget?.type === 'question' && budget.branches.find(b => b.answer === 'Não')?.to, 'after_no')
      assert.equal(change.flow.steps.find(s => s.id === 'after_no')?.type === 'question'
        && (change.flow.steps.find(s => s.id === 'after_no') as { next: string }).next, 'limited')
      assert.equal(budget?.type === 'question' && budget.next, 'qualified')
    }
  })

  it('nova finalização cria alternativa real no ponto escolhido sem deixar etapas soltas', () => {
    const flow = newFlowTemplate('Hamburguerias')
    const change = insertResultAt(flow, 'budget', 'new_result')
    assert.equal(change.ok, true)
    if (change.ok) {
      const budget = change.flow.steps.find(s => s.id === 'budget')
      assert.equal(budget?.type === 'question' && budget.options.includes('Nova alternativa'), true)
      assert.equal(budget?.type === 'question' && budget.branches.find(b => b.answer === 'Nova alternativa')?.to, 'new_result')
      assert.equal(routeFlow(change.flow, { clinic: 'Loja X', revenue: 'Acima de R$ 100 mil', budget: 'Não' })?.result.outcome, 'limited')
      assert.equal(validateFlow(change.flow).ok, true)
    }
  })

  it('selecionar finalização cria uma finalização irmã no mesmo ponto de decisão', () => {
    const flow = newFlowTemplate('Hamburguerias')
    const plan = insertResultAt(flow, 'qualified', 'sibling')
    assert.equal(plan.ok, true)
    if (plan.ok) {
      const budget = plan.flow.steps.find(s => s.id === 'budget')
      assert.equal(budget?.type === 'question' && budget.branches.some(b => b.to === 'sibling'), true)
    }
  })

  it('excluir pergunta central reconecta entradas ao próximo passo, sem apagar os demais', () => {
    const flow = newFlowTemplate('Hamburguerias')
    const result = removeStepAndReconnect(flow, 'revenue')
    assert.equal(result.ok, true)
    if (result.ok) {
      assert.equal(result.flow.steps.length,4)
      const clinic = result.flow.steps.find(s => s.id === 'clinic')
      assert.equal(clinic?.type === 'question' && clinic.next,'budget')
      assert.equal(validateFlow(result.flow).ok,true)
    }
    assert.equal(flow.steps.length,5)
  })

  it('excluir finalização só com substituta explícita, sem perder os caminhos comerciais', () => {
    const flow = newFlowTemplate('Hamburguerias')
    const denied = removeStepAndReconnect(flow, 'limited')
    assert.equal(denied.ok,false)
    const plan = removeStepAndReconnect(flow, 'limited', 'qualified')
    assert.equal(plan.ok,true)
    if (plan.ok) {
      assert.equal(plan.flow.steps.some(step=>step.id==='limited'),false)
      assert.equal(routeFlow(plan.flow,{clinic:'Loja X',revenue:'Até R$ 10 mil',budget:'Não'})?.result.outcome,'qualified')
    }
  })

  it('recusa eliminar rotas secundárias ainda necessárias e preserva o rascunho', () => {
    const flow = newFlowTemplate('Hamburguerias')
    const plan = removeStepAndReconnect(flow, 'budget')
    assert.equal(plan.ok,false, 'o resultado limited ficaria sem ligação')
    assert.equal(flow.steps.length,5)
    assert.equal(validateFlow(flow).ok,true)
  })

  it('permite remover a etapa com ramificações se o usuário confirmar também os órfãos', () => {
    const flow=newFlowTemplate('Hamburguerias')
    const cautious=removeStepAndReconnect(flow,'budget')
    assert.equal(cautious.ok,false)
    if(!cautious.ok){
      assert.deepEqual(cautious.orphanSteps?.map(s=>s.id),['limited'])
      assert.match(cautious.reason,/Confirme a exclusão/)
    }
    const confirmed=removeStepAndReconnect(flow,'budget',undefined,true)
    assert.equal(confirmed.ok,true)
    if(confirmed.ok){
      assert.equal(confirmed.flow.steps.some(s=>s.id==='budget'||s.id==='limited'),false)
      assert.equal(confirmed.flow.steps.length,3)
      assert.equal(routeFlow(confirmed.flow,{clinic:'Loja X',revenue:'Até R$ 10 mil'})?.result.outcome,'qualified')
      assert.equal(validateFlow(confirmed.flow).ok,true)
    }
    assert.equal(flow.steps.length,5,'não afeta o original enquanto não salvar')
  })
  it('exclui pergunta inicial e faz a próxima assumir o início da jornada', () => {
    const flow = newFlowTemplate('Hamburguerias')
    const plan = removeStepAndReconnect(flow,'clinic')
    assert.equal(plan.ok,true)
    if(plan.ok)assert.equal(plan.flow.start,'revenue')
  })
})
