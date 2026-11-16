import type { Pool } from 'pg'
import { newFlowTemplate, validFlowSlug, validateFlow, type FlowDefinition, type FlowDocument } from './flow'

export class FlowStoreError extends Error {
  constructor(readonly code: 'INVALID' | 'CONFLICT' | 'NOT_FOUND' | 'MIGRATION_PENDING') { super(code) }
}
type DbRow = { id: string; title: string; slug: string; description: string; status: 'draft'|'published';
  revision: number; published_version: number; draft: FlowDefinition; published: FlowDefinition | null;
  created_at: Date | string; updated_at: Date | string }
const SELECT = 'id,title,slug,description,status,revision,published_version,draft,published,created_at,updated_at'
const normalize = (r: DbRow): FlowDocument => ({
  id: r.id,title: r.title,slug: r.slug,description: r.description,status: r.status,
  revision: r.revision,publishedVersion: r.published_version,draft: r.draft,published: r.published,
  createdAt: new Date(r.created_at).toISOString(),updatedAt: new Date(r.updated_at).toISOString(),
})
function mapped(error: unknown): never {
  if ((error as { code?: string })?.code === '42P01') throw new FlowStoreError('MIGRATION_PENDING')
  if ((error as { code?: string })?.code === '23505') throw new FlowStoreError('CONFLICT')
  throw error
}
const titleValid = (v: unknown): v is string => typeof v === 'string' && v.trim().length >= 2 && v.length <= 120
const descriptionValid = (v: unknown): v is string => typeof v === 'string' && v.length <= 400
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i
export const validFlowId = (id: unknown): id is string => typeof id === 'string' && uuid.test(id)

export async function listFlowDocuments(db: Pool): Promise<FlowDocument[]> {
  try { const r = await db.query<DbRow>(`SELECT ${SELECT} FROM crm.form_flows ORDER BY updated_at DESC LIMIT 100`)
    return r.rows.map(normalize) } catch (e) { return mapped(e) }
}
export async function getFlowDocument(db: Pool,id: string): Promise<FlowDocument> {
  if (!validFlowId(id)) throw new FlowStoreError('INVALID')
  try { const r = await db.query<DbRow>(`SELECT ${SELECT} FROM crm.form_flows WHERE id=$1`,[id])
    if (!r.rows[0]) throw new FlowStoreError('NOT_FOUND')
    return normalize(r.rows[0]) } catch (e) { return mapped(e) }
}
export async function getPublishedFlow(db: Pool,slug: string): Promise<FlowDocument | null> {
  if (!validFlowSlug(slug)) return null
  try {
    const r = await db.query<DbRow>(`SELECT ${SELECT} FROM crm.form_flows WHERE slug=$1 AND status='published' AND published IS NOT NULL`,[slug])
    return r.rows[0] ? normalize(r.rows[0]) : null
  } catch (e) { if ((e as {code?:string})?.code === '42P01') return null; throw e }
}
export async function createFlowDocument(db: Pool,title: string,slug: string): Promise<FlowDocument> {
  if (!titleValid(title)||!validFlowSlug(slug)) throw new FlowStoreError('INVALID')
  const flow = newFlowTemplate(title.trim())
  const validation = validateFlow(flow)
  if (!validation.ok) throw new FlowStoreError('INVALID')
  const client = await db.connect(); let done = false
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL statement_timeout=5000')
    const inserted = await client.query<DbRow>(`INSERT INTO crm.form_flows(title,slug,draft)
       VALUES($1,$2,$3::jsonb) RETURNING ${SELECT}`,[title.trim(),slug,JSON.stringify(flow)])
    const doc = normalize(inserted.rows[0])
    await client.query(`INSERT INTO crm.form_flow_audit(flow_id,action,to_revision) VALUES($1,'created',1)`,[doc.id])
    await client.query('COMMIT');done=true;return doc
  } catch(e) { return mapped(e) } finally {
    if(!done)await client.query('ROLLBACK').catch(()=>undefined);client.release(done?undefined:true)
  }
}
export async function changeFlowDocument(db: Pool,input:{id:string;revision:number;action:'save'|'publish'|'unpublish';
  title?:unknown;slug?:unknown;description?:unknown;draft?:unknown}):Promise<FlowDocument> {
  if(!validFlowId(input.id)||!Number.isSafeInteger(input.revision)||input.revision<1)throw new FlowStoreError('INVALID')
  const client=await db.connect();let done=false
  try{
    await client.query('BEGIN')
    await client.query('SET LOCAL statement_timeout=5000')
    const selected=await client.query<DbRow>(`SELECT ${SELECT} FROM crm.form_flows WHERE id=$1 FOR UPDATE`,[input.id])
    const current=selected.rows[0]
    if(!current)throw new FlowStoreError('NOT_FOUND')
    if(current.revision!==input.revision)throw new FlowStoreError('CONFLICT')
    const nextRevision=current.revision+1
    let after: DbRow
    let auditAction:'draft_saved'|'published'|'unpublished'
    if(input.action==='save'){
      if(!titleValid(input.title)||!descriptionValid(input.description)||!validFlowSlug(input.slug)||
         (current.status==='published'&&input.slug!==current.slug))throw new FlowStoreError('INVALID')
      const parsed=validateFlow(input.draft)
      if(!parsed.ok)throw new FlowStoreError('INVALID')
      const updated=await client.query<DbRow>(`UPDATE crm.form_flows SET title=$2,slug=$3,description=$4,draft=$5::jsonb,revision=$6,
        updated_at=now() WHERE id=$1 RETURNING ${SELECT}`,[input.id,input.title.trim(),input.slug,input.description,JSON.stringify(parsed.flow),nextRevision])
      after=updated.rows[0];auditAction='draft_saved'
    }else if(input.action==='publish'){
      const validation=validateFlow(current.draft)
      if(!validation.ok)throw new FlowStoreError('INVALID')
      const updated=await client.query<DbRow>(`UPDATE crm.form_flows SET status='published',published=draft,published_version=published_version+1,
        published_at=now(),revision=$2,updated_at=now() WHERE id=$1 RETURNING ${SELECT}`,[input.id,nextRevision])
      after=updated.rows[0];auditAction='published'
    }else if(input.action==='unpublish'){
      const updated=await client.query<DbRow>(`UPDATE crm.form_flows SET status='draft',published=NULL,published_at=NULL,
        revision=$2,updated_at=now() WHERE id=$1 RETURNING ${SELECT}`,[input.id,nextRevision])
      after=updated.rows[0];auditAction='unpublished'
    }else throw new FlowStoreError('INVALID')
    await client.query(`INSERT INTO crm.form_flow_audit(flow_id,action,from_revision,to_revision) VALUES($1,$2,$3,$4)`,
      [input.id,auditAction,current.revision,nextRevision])
    await client.query('COMMIT');done=true;return normalize(after)
  }catch(e){return mapped(e)}finally{
    if(!done)await client.query('ROLLBACK').catch(()=>undefined);client.release(done?undefined:true)
  }
}
