import assert from 'node:assert/strict'
import { after,before,beforeEach,describe,it } from 'node:test'
import type { Pool } from 'pg'
import { openLocalPool, REAL_DB_SKIP } from '../intel/vault/test-db'
import { createFlowDocument,changeFlowDocument,getPublishedFlow,getFlowDocument,listFlowDocuments,FlowStoreError } from './store'
import { validateFlow } from './flow'

// TESTE LOCAL DESCARTÁVEL: exige migração 0020 aplicada neste mesmo banco crm_local_*.
describe('construtor de formulários — PostgreSQL local e descartável', { skip:REAL_DB_SKIP },()=>{
  let db:Pool
  before(async()=>{db=await openLocalPool()})
  beforeEach(async()=>{await db.query('TRUNCATE crm.form_flow_audit,crm.form_flows RESTART IDENTITY CASCADE')})
  after(async()=>{await db?.end()})
  it('criar rascunho, editar, publicar e manter snapshot público estável',async()=>{
    let form=await createFlowDocument(db,'Formulário Escolas','escolas')
    assert.equal(form.status,'draft')
    assert.equal((await listFlowDocuments(db)).length,1)
    assert.equal((await getPublishedFlow(db,'escolas')),null)
    assert.equal(validateFlow(form.draft).ok,true)
    form=await changeFlowDocument(db,{id:form.id,revision:form.revision,action:'publish'})
    assert.equal(form.status,'published')
    assert.equal(form.publishedVersion,1)
    const publicBefore=(await getPublishedFlow(db,'escolas'))!
    assert.equal(publicBefore.published?.steps[0].title,'Qual é o nome do seu negócio?')
    const revised=structuredClone(form.draft)
    revised.steps[0].title='Qual é o nome da sua escola?'
    form=await changeFlowDocument(db,{id:form.id,revision:form.revision,action:'save',
      title:form.title,slug:form.slug,description:'Campanha de captação para escolas',draft:revised})
    assert.equal(form.draft.steps[0].title,'Qual é o nome da sua escola?')
    assert.equal((await getPublishedFlow(db,'escolas'))?.published?.steps[0].title,'Qual é o nome do seu negócio?')
    await assert.rejects(changeFlowDocument(db,{id:form.id,revision:form.revision,action:'save',
      title:form.title,slug:'outro-endereco',description:form.description,draft:form.draft}),
      (e:unknown)=>e instanceof FlowStoreError&&e.code==='INVALID')
    form=await changeFlowDocument(db,{id:form.id,revision:form.revision,action:'publish'})
    assert.equal(form.publishedVersion,2)
    assert.equal((await getPublishedFlow(db,'escolas'))?.published?.steps[0].title,'Qual é o nome da sua escola?')
    form=await changeFlowDocument(db,{id:form.id,revision:form.revision,action:'unpublish'})
    assert.equal(form.status,'draft')
    assert.equal(form.publishedVersion,2,'histórico de versões preservado')
    assert.equal(await getPublishedFlow(db,'escolas'),null)
    const audit=await db.query('SELECT action FROM crm.form_flow_audit ORDER BY id')
    assert.deepEqual(audit.rows.map(r=>r.action),['created','published','draft_saved','published','unpublished'])
  })
  it('evita sobrescrita simultânea por revisão otimista e slugs duplicados',async()=>{
    const form=await createFlowDocument(db,'Formulário Escolas','escolas')
    await assert.rejects(createFlowDocument(db,'Outro Formulário','escolas'),
      (e:unknown)=>e instanceof FlowStoreError&&e.code==='CONFLICT')
    await changeFlowDocument(db,{id:form.id,revision:form.revision,action:'publish'})
    await assert.rejects(changeFlowDocument(db,{id:form.id,revision:form.revision,action:'unpublish'}),
      (e:unknown)=>e instanceof FlowStoreError&&e.code==='CONFLICT')
    assert.equal((await getFlowDocument(db,form.id)).status,'published')
  })
})
