import { isMetaDispatchAllowed } from './booking-mode'
import { isValidFbc, isValidFbp, metaEventNameFor, type MetaEventName } from '../marketing/meta'

/**
 * Preparação da Meta Conversions API (NÃO envia nada; não há token nem rotina de envio).
 *
 * Monta o evento de servidor a partir de um registro de crm.tracking_events, com as
 * mesmas regras que o futuro envio deverá respeitar:
 * - só eventos mapeados (Lead → Lead, Chronos_Scheduled → Schedule);
 * - só leads REAIS (metadata.isTest === false);
 * - só com consentimento de marketing VIGENTE no momento do envio: o chamador passa o estado
 *   atual de crm.consents (readMarketingConsentState); consentimento revogado = nada sai;
 * - mesmo event_name e event_id usados pelo Pixel (deduplicação);
 * - sem e-mail, telefone ou nome (correspondência avançada desligada nesta etapa);
 * - decisão C2: o CRM NÃO guarda fbp/fbc. Se a CAPI for autorizada, a origem desses
 *   identificadores (e retenção/revogação) será reavaliada; aqui eles só entram se forem
 *   passados no momento do envio, e são validados.
 */

export type TrackingEventRow = {
  event_id: string
  event_name: string
  occurred_at: Date | string
  event_source_url: string | null
  metadata: unknown
}

export type MetaServerEvent = {
  event_name: MetaEventName
  event_time: number
  event_id: string
  action_source: 'website'
  event_source_url?: string
  user_data: { fbp?: string; fbc?: string }
  custom_data: { content_name?: string }
}

export type MetaEventDecision =
  | { allowed: true; payload: MetaServerEvent }
  | { allowed: false; reason: 'unmapped_event' | 'test_or_unclassified' | 'no_marketing_consent' | 'invalid_event' }

export function buildMetaServerEvent(
  row: TrackingEventRow,
  consent: { granted: boolean } | null | undefined,
  browserIds: { fbp?: unknown; fbc?: unknown } = {},
): MetaEventDecision {
  const eventName = metaEventNameFor(row.event_name)
  if (!eventName) return { allowed: false, reason: 'unmapped_event' }
  if (!isMetaDispatchAllowed(row.metadata)) return { allowed: false, reason: 'test_or_unclassified' }
  if (consent?.granted !== true) return { allowed: false, reason: 'no_marketing_consent' }
  const occurred = new Date(row.occurred_at).getTime()
  if (!Number.isFinite(occurred) || !/^[a-z0-9_]{6,120}$/.test(row.event_id)) return { allowed: false, reason: 'invalid_event' }
  const formSlug = row.metadata && typeof row.metadata === 'object' && 'formSlug' in row.metadata &&
    typeof (row.metadata as { formSlug: unknown }).formSlug === 'string'
    ? (row.metadata as { formSlug: string }).formSlug : undefined
  const sourceUrl = row.event_source_url && /^https:\/\/[^?#\s]+$/.test(row.event_source_url) ? row.event_source_url : undefined
  return {
    allowed: true,
    payload: {
      event_name: eventName,
      event_time: Math.floor(occurred / 1000),
      event_id: row.event_id,
      action_source: 'website',
      ...(sourceUrl ? { event_source_url: sourceUrl } : {}),
      user_data: {
        ...(isValidFbp(browserIds.fbp) ? { fbp: browserIds.fbp } : {}),
        ...(isValidFbc(browserIds.fbc) ? { fbc: browserIds.fbc } : {}),
      },
      custom_data: formSlug ? { content_name: formSlug } : {},
    },
  }
}
