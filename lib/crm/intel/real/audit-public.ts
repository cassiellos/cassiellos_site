/**
 * Whitelist of administrative audit metadata allowed in the CRM browser.
 *
 * The database keeps the complete audit event unchanged. Legacy or external
 * events can contain fields such as "authorization" (or worse, actual secrets):
 * never pass arbitrary JSONB details into assertNoSecretsInPayload.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const KINDS = new Set(['agency', 'client'])
const PROVIDERS = new Set(['google', 'meta'])
const STATUSES = new Set(['active', 'paused', 'archived', 'pending', 'confirmed', 'ended', 'revoked', 'expired', 'error', 'succeeded', 'partial', 'failed', 'skipped_locked'])
const CHANGED_FIELDS = new Set(['name', 'notes', 'status', 'finance_link'])

/** Fail closed: unknown fields, arbitrary strings and nested values are never exposed. */
export function publicAuditDetails(details: unknown): Record<string, unknown> {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return {}
  const raw = details as Record<string, unknown>
  const safe: Record<string, unknown> = {}

  if (typeof raw.kind === 'string' && KINDS.has(raw.kind)) safe.kind = raw.kind
  if (typeof raw.provider === 'string' && PROVIDERS.has(raw.provider)) safe.provider = raw.provider
  if (typeof raw.status === 'string' && STATUSES.has(raw.status)) safe.status = raw.status
  for (const key of ['assetId', 'clientId'] as const) {
    if (typeof raw[key] === 'string' && UUID.test(raw[key])) safe[key] = raw[key]
  }
  for (const key of ['financeLinked', 'shared', 'providersEnabled'] as const) {
    if (typeof raw[key] === 'boolean') safe[key] = raw[key]
  }
  for (const key of ['count', 'rows', 'endedAssociations'] as const) {
    if (typeof raw[key] === 'number' && Number.isSafeInteger(raw[key]) && raw[key] >= 0) safe[key] = raw[key]
  }
  if (Array.isArray(raw.changed)) {
    const changed = raw.changed.filter((v): v is string => typeof v === 'string' && CHANGED_FIELDS.has(v)).slice(0, 10)
    if (changed.length) safe.changed = changed
  }
  return safe
}

/** Retains audit event identity/timestamps; sanitizes only browser-facing details. */
export function auditForAdmin<T extends { details: Record<string, unknown> }>(event: T): T {
  return { ...event, details: publicAuditDetails(event.details) }
}
