import type { ConnectablePool } from './booking-reservation'

/**
 * Limite da homologação do Meta Pixel no Pixel comercial: no máximo UM Lead e UM Schedule por liberação
 * administrativa (lib/marketing/homologation.ts). A reserva fica na linha do tempo do lead de teste
 * (crm.lead_activities, `meta_homologation_event`) — sem tabela nova e sem dados pessoais nos detalhes: só a
 * referência aleatória da liberação, o evento, o event_id do CRM e a referência não reversível da sessão.
 * A classificação do lead (is_test) nunca é alterada.
 */
export const HOMOLOGATION_ACTIVITY = 'meta_homologation_event'
export type HomologationEvent = 'Lead' | 'Schedule'

export async function claimHomologationEvent(pool: ConnectablePool, input: {
  nonce: string; actorRef: string; event: HomologationEvent; leadId: string; eventId: string
}): Promise<boolean> {
  if (!/^[a-f0-9]{16}$/.test(input.nonce) || !/^[a-z0-9_]{6,120}$/.test(input.eventId)) return false
  const client = await pool.connect()
  let committed = false
  try {
    await client.query('BEGIN')
    await client.query('SET LOCAL statement_timeout = 5000')
    // Serializa as reservas da mesma liberação (duas abas ou cliques simultâneos).
    await client.query('SELECT pg_advisory_xact_lock(241031, hashtext($1))', [input.nonce])
    const used = await client.query(
      `SELECT 1 FROM crm.lead_activities
        WHERE activity_kind = $1 AND details->>'grant' = $2 AND details->>'event' = $3 LIMIT 1`,
      [HOMOLOGATION_ACTIVITY, input.nonce, input.event],
    )
    if (used.rowCount) {
      await client.query('COMMIT')
      committed = true
      return false
    }
    // Só lead de TESTE (a homologação nunca usa um lead real).
    const lead = await client.query<{ is_test: boolean }>('SELECT is_test FROM crm.leads WHERE id = $1', [input.leadId])
    if (lead.rows[0]?.is_test !== true) {
      await client.query('COMMIT')
      committed = true
      return false
    }
    await client.query(
      `INSERT INTO crm.lead_activities (lead_id, activity_kind, performed_by, details)
       VALUES ($1, $2, 'meta_homologation', $3::jsonb)`,
      [input.leadId, HOMOLOGATION_ACTIVITY, JSON.stringify({
        grant: input.nonce, event: input.event, eventId: input.eventId, sessionRef: input.actorRef,
        pixel: 'commercial', isTest: true,
      })],
    )
    await client.query('COMMIT')
    committed = true
    return true
  } finally {
    if (!committed) await client.query('ROLLBACK').catch(() => undefined)
    client.release()
  }
}
