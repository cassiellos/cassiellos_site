import assert from 'node:assert/strict'
import { after,before,beforeEach,describe,it } from 'node:test'
import { Pool } from 'pg'
import { createFlowDocument,changeFlowDocument,getPublishedFlow } from './store'
import { routeFlow } from './flow'
import { saveLeadSubmission } from '../lead-intake'

// Banco separado, LOCAL e descartável. Não compartilha dados com outras suítes.
const url=process.env.CRM_FORM_FLOW_DATABASE_URL
const skip=!url?'CRM_FORM_FLOW_DATABASE_URL não definida':false
const id=(n:number)=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')

describe('Formulários visuais — jornada pública, captação real e isolamento', { skip },()=>{
  let db:Pool
  before(async()=>{
    db=new Pool({connectionString:url,max:3,ssl:false})
    const check=await db.query('SELECT current_database() AS name,host(inet_server_addr()) AS host')
    assert.match(check.rows[0].name,/^crm_local_/)
    assert.ok([null,'127.0.0.1','::1'].includes(check.rows[0].host))
  })
  after(async()=>{await db?.end()})
  beforeEach(async()=>{
    await db.query('TRUNCATE crm.form_flow_audit,crm.form_flows RESTART IDENTITY CASCADE')
    // Independent test DB with synthetic-only records.
    await db.query('TRUNCATE crm.form_submissions,crm.lead_activities,crm.tracking_events,crm.consents,crm.leads RESTART IDENTITY CASCADE')
  })
  async function save(outcome:'qualified'|'limited',n:number,email:string){
    let form=await createFlowDocument(db,'Escolas '+n,'escolas-'+n)
    form=await changeFlowDocument(db,{id:form.id,revision:form.revision,action:'publish'})
    const live=await getPublishedFlow(db,'escolas-'+n)
    assert.ok(live?.published)
    const routed=routeFlow(live.published,{clinic:'Escola do Vale',revenue:'Até R$ 10 mil',budget:outcome==='qualified'?'Sim':'Não'})
    assert.ok(routed)
    const input={
      idempotencyKey:id(n),name:'Contato Teste',email,phone:'31999990000',
      formSlug:live.slug,formVersion:'flow-v'+live.publishedVersion,niche:live.title,
      answers:routed.answers,attribution:{utm_source:'google'},newLeadIsTest:true,bookingMode:'test',
      flow:{id:live.id,version:live.publishedVersion,outcome:routed.result.outcome,path:routed.path},
    }
    return {input,saved:await saveLeadSubmission(db,input)}
  }
  it('Sim cria lead qualificado com histórico da jornada e sem duplicar reenvio',async()=>{
    const {input,saved}=await save('qualified',1,'qualificado@example.com')
    const lead=await db.query('SELECT stage,is_test FROM crm.leads WHERE id=$1',[saved.leadId])
    assert.equal(lead.rows[0].stage,'qualified')
    assert.equal(lead.rows[0].is_test,true)
    const sub=await db.query('SELECT answers FROM crm.form_submissions WHERE id=$1',[saved.submissionId])
    assert.equal(sub.rows[0].answers.journey.outcome,'qualified')
    assert.deepEqual(sub.rows[0].answers.journey.path,['clinic','revenue','budget','qualified'])
    const audit=await db.query("SELECT activity_kind FROM crm.lead_activities WHERE lead_id=$1 AND activity_kind='form_flow_qualified'",[saved.leadId])
    assert.equal(audit.rowCount,1)
    const again=await saveLeadSubmission(db,input)
    assert.equal(again.reused,true)
    const count=await db.query("SELECT count(*)::int n FROM crm.lead_activities WHERE lead_id=$1 AND activity_kind='form_flow_qualified'",[saved.leadId])
    assert.equal(count.rows[0].n,1)
  })
  it('Não mantém interessado com etiqueta orçamento limitado, nunca desqualifica automaticamente',async()=>{
    const {saved}=await save('limited',2,'limitado@example.com')
    const lead=await db.query('SELECT stage FROM crm.leads WHERE id=$1',[saved.leadId])
    assert.equal(lead.rows[0].stage,'new')
    const record=await db.query("SELECT answers #>> '{journey,outcome}' AS result FROM crm.form_submissions WHERE id=$1",[saved.submissionId])
    assert.equal(record.rows[0].result,'limited')
    const event=await db.query(`SELECT activity_kind FROM crm.lead_activities WHERE lead_id=$1 AND activity_kind='form_flow_budget_limited' LIMIT 1`,[saved.leadId])
    assert.equal(event.rows[0].activity_kind,'form_flow_budget_limited')
  })
  it('lead existente preserva classificação e etapa, mesmo após mudar a resposta sobre verba',async()=>{
    const first=await save('limited',3,'existente@example.com')
    await db.query("UPDATE crm.leads SET stage='contacted' WHERE id=$1",[first.saved.leadId])
    const second=await save('qualified',4,'existente@example.com')
    assert.equal(second.saved.leadId,first.saved.leadId,'e-mail normalizado impede novos cadastros')
    const lead=await db.query('SELECT stage FROM crm.leads WHERE id=$1',[first.saved.leadId])
    assert.equal(lead.rows[0].stage,'contacted','um formulário público não sobrescreve a etapa existente')
    const submissions=await db.query("SELECT count(*)::int n FROM crm.form_submissions WHERE lead_id=$1",[first.saved.leadId])
    assert.equal(submissions.rows[0].n,2)
  })
})
