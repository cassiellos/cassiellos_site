import type { PoolClient } from 'pg'
import { LEGAL_POLICY_VERSION } from '../legal/policy'
import type { ConnectablePool } from './booking-reservation'

/**
 * Consentimento de marketing (Meta Pixel) no CRM — estado auditável e revogação.
 *
 * - Fonte da verdade: crm.consents (purpose = 'marketing_measurement'). Nada é apagado:
 *   a revogação marca revoked_at nas autorizações ativas e acrescenta um registro
 *   granted = false; uma nova autorização acrescenta outro registro granted = true.
 * - O estado atual é o registro mais recente. A futura Conversions API deve consultar
 *   readMarketingConsentState NO MOMENTO DO ENVIO: consentimento revogado = nada é enviado.
 * - Revogar NÃO altera dados comerciais do lead (cadastro, reuniões, contratos, linha do tempo).
 * - Decisão G2: na revogação (ou recusa explícita) o identificador de clique da Meta (fbclid)
 *   guardado nos envios do lead é APAGADO — ele só existia por causa do consentimento. Os demais
 *   parâmetros de campanha (utm_*) e as respostas do formulário são preservados. A atividade
 *   registra só a quantidade removida, nunca o valor.
 * - Toda mudança gera uma atividade na linha do tempo do lead (quem/como/quando).
 * - O administrador só pode REVOGAR (pedido do titular pelo canal de privacidade);
 *   autorização só vem do próprio visitante (formulário ou "Preferências de cookies").
 */

export const MARKETING_PURPOSE = 'marketing_measurement'

export type MarketingConsentSource =
  | 'form_submission' // escolha registrada no envio do formulário
  | 'visitor_preferences' // "Preferências de cookies" com a página do agendamento aberta
  | 'privacy_request' // pedido do titular atendido pelo administrador

export type MarketingConsentState = {
  granted: boolean
  /** Data do registro mais recente (autorização ou revogação). */
  recordedAt: string | null
  policyVersion: string | null
}

type Queryable = Pick<PoolClient, 'query'>

export async function readMarketingConsentState(db: Queryable, leadId: string): Promise<MarketingConsentState> {
  const result = await db.query<{ granted: boolean; recorded_at: Date; revoked_at: Date | null; policy_version: string }>(
    `SELECT granted, recorded_at, revoked_at, policy_version FROM crm.consents
      WHERE lead_id = $1 AND purpose = $2
      ORDER BY recorded_at DESC, granted ASC LIMIT 1`,
    [leadId, MARKETING_PURPOSE],
  )
  const row = result.rows[0]
  if (!row) return { granted: false, recordedAt: null, policyVersion: null }
  return {
    granted: row.granted === true && row.revoked_at === null,
    recordedAt: new Date(row.revoked_at ?? row.recorded_at).toISOString(),
    policyVersion: row.policy_version,
  }
}

export type MarketingConsentChange = {
  leadId: string
  granted: boolean
  source: MarketingConsentSource
  /** Referência não reversível da sessão administrativa (só para privacy_request). */
  adminSessionRef?: string | null
  policyVersion?: string
}

export type MarketingConsentChangeResult =
  | { outcome: 'changed' | 'unchanged'; state: MarketingConsentState; clickIdsRemoved: number }
  | { outcome: 'not_allowed' }

/** Apaga o fbclid das atribuições guardadas do lead (somente essa chave). Devolve quantos envios mudaram. */
export async function removeStoredClickIds(db: Queryable, leadId: string): Promise<number> {
  const result = await db.query(
    `UPDATE crm.form_submissions
        SET answers = jsonb_set(answers, '{attribution}', (answers->'attribution') - 'fbclid')
      WHERE lead_id = $1
        AND jsonb_typeof(answers->'attribution') = 'object'
        AND (answers->'attribution') ? 'fbclid'`,
    [leadId],
  )
  return result.rowCount ?? 0
}

/** Aplica a mudança dentro de uma transação já aberta (o chamador trava o lead). */
export async function applyMarketingConsentChange(
  client: Queryable,
  input: MarketingConsentChange,
): Promise<MarketingConsentChangeResult> {
  // Consent can only be GIVEN by the visitor; an administrator may only record a revocation.
  if (input.granted && input.source === 'privacy_request') return { outcome: 'not_allowed' }
  const current = await readMarketingConsentState(client, input.leadId)
  const policyVersion = input.policyVersion ?? LEGAL_POLICY_VERSION
  // Refusal/revocation always erases stored click ids (also legacy ones stored before G2).
  const clickIdsRemoved = input.granted ? 0 : await removeStoredClickIds(client, input.leadId)
  if (current.granted === input.granted) {
    if (clickIdsRemoved > 0) {
      await client.query(
        `INSERT INTO crm.lead_activities (lead_id, activity_kind, performed_by, details)
         VALUES ($1, 'marketing_identifiers_removed', $2, $3::jsonb)`,
        [input.leadId, input.source === 'privacy_request' ? 'crm_admin' : 'visitor',
          JSON.stringify({ source: input.source, clickIdsRemoved,
            ...(input.adminSessionRef ? { sessionRef: input.adminSessionRef } : {}) })],
      )
    }
    return { outcome: 'unchanged', state: current, clickIdsRemoved }
  }
  if (!input.granted) {
    await client.query(
      `UPDATE crm.consents SET revoked_at = clock_timestamp()
        WHERE lead_id = $1 AND purpose = $2 AND granted AND revoked_at IS NULL`,
      [input.leadId, MARKETING_PURPOSE],
    )
  }
  await client.query(
    `INSERT INTO crm.consents (lead_id, purpose, legal_basis, granted, policy_version, recorded_at)
     VALUES ($1, $2, 'consent', $3, $4, clock_timestamp())`,
    [input.leadId, MARKETING_PURPOSE, input.granted, policyVersion],
  )
  await client.query(
    `INSERT INTO crm.lead_activities (lead_id, activity_kind, performed_by, details)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [input.leadId, input.granted ? 'marketing_consent_granted' : 'marketing_consent_revoked',
      input.source === 'privacy_request' ? 'crm_admin' : 'visitor',
      JSON.stringify({
        source: input.source, policyVersion,
        ...(input.granted ? {} : { clickIdsRemoved }),
        ...(input.adminSessionRef ? { sessionRef: input.adminSessionRef } : {}),
      })],
  )
  return { outcome: 'changed', state: await readMarketingConsentState(client, input.leadId), clickIdsRemoved }
}

/** Transação própria com trava do lead. Lead inexistente → 'not_found'. */
export async function changeMarketingConsent(
  pool: ConnectablePool,
  input: MarketingConsentChange,
): Promise<MarketingConsentChangeResult | { outcome: 'not_found' }> {
  const client = await pool.connect()
  let committed = false
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL statement_timeout = 5000')
    const lead = await client.query('SELECT id FROM crm.leads WHERE id = $1 FOR UPDATE', [input.leadId])
    if (!lead.rows[0]) {
      await client.query('ROLLBACK')
      committed = true
      return { outcome: 'not_found' }
    }
    const result = await applyMarketingConsentChange(client, input)
    await client.query('COMMIT')
    committed = true
    return result
  } finally {
    if (!committed) await client.query('ROLLBACK').catch(() => undefined)
    client.release()
  }
}
