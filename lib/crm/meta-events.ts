import { isMetaDispatchAllowed } from './booking-mode'
import { isValidFbc, isValidFbp, metaEventNameFor, type MetaEventName } from '../marketing/meta'

/**
 * Montagem do evento de servidor da Meta Conversions API (este arquivo NÃO envia nada; o envio
 * controlado, desligado por padrão, fica em lib/crm/meta-capi.ts).
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
  /** cassiellos_teste só no envio de homologação (sempre com test_event_code). */
  custom_data: { content_name?: string; cassiellos_teste?: 'homologacao' }
}

export type MetaEventDecision =
  | { allowed: true; payload: MetaServerEvent }
  | { allowed: false; reason: 'unmapped_event' | 'test_or_unclassified' | 'no_marketing_consent' | 'invalid_event' }

export function buildMetaServerEvent(
  row: TrackingEventRow,
  consent: { granted: boolean } | null | undefined,
  browserIds: { fbp?: unknown; fbc?: unknown } = {},
): MetaEventDecision {
  if (!metaEventNameFor(row.event_name)) return { allowed: false, reason: 'unmapped_event' }
  if (!isMetaDispatchAllowed(row.metadata)) return { allowed: false, reason: 'test_or_unclassified' }
  if (consent?.granted !== true) return { allowed: false, reason: 'no_marketing_consent' }
  const payload = formatMetaServerEvent(row, browserIds)
  return payload ? { allowed: true, payload } : { allowed: false, reason: 'invalid_event' }
}

/**
 * Formatação pura do evento (SEM as travas de teste/consentimento): só para quem já aplicou as
 * próprias travas — buildMetaServerEvent (leads reais) e o envio de homologação com test_event_code
 * (lib/crm/meta-capi.ts). Devolve null para evento não mapeado, data inválida ou event_id fora do padrão.
 */
export function formatMetaServerEvent(
  row: TrackingEventRow,
  browserIds: { fbp?: unknown; fbc?: unknown } = {},
): MetaServerEvent | null {
  const eventName = metaEventNameFor(row.event_name)
  if (!eventName) return null
  const occurred = new Date(row.occurred_at).getTime()
  if (!Number.isFinite(occurred) || !/^[a-z0-9_]{6,120}$/.test(row.event_id)) return null
  const formSlug = row.metadata && typeof row.metadata === 'object' && 'formSlug' in row.metadata &&
    typeof (row.metadata as { formSlug: unknown }).formSlug === 'string'
    ? (row.metadata as { formSlug: string }).formSlug : undefined
  const sourceUrl = row.event_source_url && /^https:\/\/[^?#\s]+$/.test(row.event_source_url) ? row.event_source_url : undefined
  return {
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
  }
}
