import type { PoolClient } from 'pg'

/**
 * Gravação dos envios do formulário público de diagnóstico (Mini CRM Cassiellos).
 *
 * Regras de integridade (Fase 3 / item 2):
 * - E-mail normalizado (trim + minúsculas) e trava transacional por e-mail:
 *   envios simultâneos da mesma pessoa são serializados; nunca há lead duplicado.
 * - Lead NOVO: criado com a classificação real/teste recebida.
 * - Lead EXISTENTE: o formulário público NUNCA substitui nome, WhatsApp, empresa,
 *   segmento, classificação, etapa, reuniões, contratos ou consentimentos anteriores.
 *   Só preenche campos que estão realmente vazios.
 * - Cada envio guarda o que foi informado em form_submissions.answers (contact,
 *   questions, attribution, formSlug, niche) — o histórico nunca é apagado.
 * - Reenvio gera a atividade "form_resubmitted" com os NOMES dos campos que
 *   divergem/foram preenchidos (sem valores pessoais).
 * Edições administrativas usam outras rotas e não passam por aqui.
 */

export const LEAD_POLICY_VERSION = '2026-08-22'

export type MergeableLeadField = 'full_name' | 'whatsapp' | 'company' | 'segment'
const MERGEABLE_FIELDS: readonly MergeableLeadField[] = ['full_name', 'whatsapp', 'company', 'segment']

export type StoredLeadContact = Record<MergeableLeadField, string | null>

export type LeadMergePlan = {
  /** Somente campos vazios no cadastro que receberão o valor do novo envio. */
  updates: Partial<Record<MergeableLeadField, string>>
  filledFields: MergeableLeadField[]
  /** Campos já preenchidos cujo valor informado é diferente (preservados). */
  differingFields: MergeableLeadField[]
}

function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === ''
}

function comparable(field: MergeableLeadField, value: string): string {
  if (field === 'whatsapp') return value.replace(/\D/g, '')
  return value.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Plano de mesclagem "preencher apenas vazios" para um lead existente. */
export function planLeadMerge(existing: StoredLeadContact, incoming: StoredLeadContact): LeadMergePlan {
  const plan: LeadMergePlan = { updates: {}, filledFields: [], differingFields: [] }
  for (const field of MERGEABLE_FIELDS) {
    const current = existing[field]
    const next = incoming[field]
    if (isBlank(next)) continue
    if (isBlank(current)) {
      plan.updates[field] = (next as string).trim()
      plan.filledFields.push(field)
    } else if (comparable(field, current as string) !== comparable(field, next as string)) {
      plan.differingFields.push(field)
    }
  }
  return plan
}

export function normalizeLeadEmail(email: string): string {
  return email.trim().toLowerCase()
}

export type LeadSubmissionInput = {
  idempotencyKey: string
  name: string
  email: string
  phone: string
  formSlug: string
  formVersion: string
  niche: string
  answers: Record<string, string>
  attribution: Record<string, string>
  /** Classificação aplicada SOMENTE se o lead for criado agora. */
  newLeadIsTest: boolean
  bookingMode: string
}

export type LeadSubmissionResult = {
  leadId: string
  submissionId: string
  reused: boolean
  resubmitted: boolean
}

type ConnectablePool = { connect(): Promise<PoolClient> }

export async function saveLeadSubmission(
  pool: ConnectablePool,
  input: LeadSubmissionInput,
): Promise<LeadSubmissionResult> {
  const email = normalizeLeadEmail(input.email)
  const company = input.answers.clinic?.trim() || null
  const client = await pool.connect()
  let committed = false
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL statement_timeout = 6000')
    // Serialize duplicate submissions for this person across simultaneous requests.
    await client.query('SELECT pg_advisory_xact_lock(241023, hashtext($1))', [email])

    const submitted = await client.query<{ lead_id: string; id: string }>(
      'SELECT lead_id, id FROM crm.form_submissions WHERE idempotency_key = $1',
      [input.idempotencyKey],
    )
    if (submitted.rows[0]) {
      await client.query('COMMIT')
      committed = true
      return { leadId: submitted.rows[0].lead_id, submissionId: submitted.rows[0].id, reused: true, resubmitted: false }
    }

    const existing = await client.query<{
      id: string; is_test: boolean
      full_name: string | null; whatsapp: string | null; company: string | null; segment: string | null
    }>(
      `SELECT id, is_test, full_name, whatsapp, company, segment
         FROM crm.leads WHERE lower(email) = $1 LIMIT 1 FOR UPDATE`,
      [email],
    )

    let leadId: string
    let isTest: boolean
    let plan: LeadMergePlan | null = null
    if (existing.rows[0]) {
      // Existing leads keep classification, stage, history and every filled field.
      const row = existing.rows[0]
      leadId = row.id
      isTest = row.is_test
      plan = planLeadMerge(
        { full_name: row.full_name, whatsapp: row.whatsapp, company: row.company, segment: row.segment },
        { full_name: input.name, whatsapp: input.phone, company, segment: input.niche },
      )
      const fields = Object.keys(plan.updates) as MergeableLeadField[]
      if (fields.length) {
        // Column names come only from the fixed MERGEABLE_FIELDS whitelist.
        const assignments = fields.map((field, index) => field + ' = $' + (index + 2)).join(', ')
        await client.query(
          'UPDATE crm.leads SET ' + assignments + ', updated_at = now() WHERE id = $1',
          [leadId, ...fields.map(field => plan!.updates[field])],
        )
      }
    } else {
      isTest = input.newLeadIsTest
      const result = await client.query<{ id: string }>(
        `INSERT INTO crm.leads (full_name, email, whatsapp, company, segment, stage, is_test)
         VALUES ($1,$2,$3,$4,$5,'new',$6) RETURNING id`,
        [input.name, email, input.phone, company, input.niche, isTest],
      )
      leadId = result.rows[0].id
    }

    // What the visitor informed in THIS submission (history; nothing is overwritten).
    const submission = await client.query<{ id: string }>(
      `INSERT INTO crm.form_submissions
       (lead_id, form_version, answers, idempotency_key, status)
       VALUES ($1,$2,$3::jsonb,$4,'validated') RETURNING id`,
      [leadId, input.formVersion,
        JSON.stringify({
          niche: input.niche, formSlug: input.formSlug,
          contact: { name: input.name, email, whatsapp: input.phone },
          questions: input.answers, attribution: input.attribution,
        }), input.idempotencyKey],
    )
    const submissionId = submission.rows[0].id
    // Consent of this submission is appended; previous consents are never touched.
    await client.query(
      `INSERT INTO crm.consents
       (lead_id, purpose, legal_basis, granted, policy_version)
       VALUES ($1,'diagnostic_contact','consent',true,$2)`,
      [leadId, LEAD_POLICY_VERSION],
    )
    const baseDetails = {
      submissionId, formSlug: input.formSlug, formVersion: input.formVersion,
      environment: 'preview', bookingMode: input.bookingMode, isTest,
    }
    await client.query(
      `INSERT INTO crm.lead_activities (lead_id, activity_kind, performed_by, details)
       VALUES ($1, $2, 'public_booking', $3::jsonb)`,
      plan
        ? [leadId, 'form_resubmitted', JSON.stringify({
          ...baseDetails, filledFields: plan.filledFields, differingFields: plan.differingFields,
        })]
        : [leadId, 'form_completed', JSON.stringify(baseDetails)],
    )
    await client.query('COMMIT')
    committed = true
    return { leadId, submissionId, reused: false, resubmitted: Boolean(plan) }
  } finally {
    if (!committed) await client.query('ROLLBACK').catch(() => undefined)
    client.release(committed ? undefined : true)
  }
}
