/**
 * Atribuição de marketing por LEAD (somente leitura; nada é gravado nem alterado).
 *
 * Um lead pode enviar vários formulários. A origem não pode "sumir" quando um envio posterior chega sem UTM:
 *  - PRINCIPAL = a PRIMEIRA origem de marketing válida do lead (primeiro envio, em ordem cronológica, que trouxe
 *    utm_source, utm_medium ou utm_campaign preenchidos). É a atribuição usada na listagem e no Dashboard.
 *  - MAIS RECENTE = a origem válida mais recente, mantida separadamente para consulta.
 *  - Envios sem UTM nunca substituem uma origem conhecida. Sem nenhum envio com UTM → origem não identificada.
 *
 * Os registros (form_submissions.answers.attribution, datas) permanecem exatamente como estão: a regra é aplicada
 * na leitura, pela mesma definição em SQL (consultas do CRM) e em TypeScript (testes e exibição).
 */

export type LeadAttribution = {
  source: string | null
  medium: string | null
  campaign: string | null
  content: string | null
  term: string | null
  /** Data do envio que trouxe esta origem. */
  at: string | null
}

export type SubmissionAttributionInput = {
  id: string
  submittedAt: string | Date
  attribution: Record<string, unknown> | null | undefined
}

const text = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed : null
}

/** Origem de marketing válida = utm_source, utm_medium ou utm_campaign preenchido (utm_content/utm_term sozinhos não bastam). */
export function hasMarketingOrigin(attribution: Record<string, unknown> | null | undefined): boolean {
  if (!attribution || typeof attribution !== 'object') return false
  return Boolean(text(attribution.utm_source) || text(attribution.utm_medium) || text(attribution.utm_campaign))
}

function toAttribution(s: SubmissionAttributionInput): LeadAttribution {
  const a = (s.attribution ?? {}) as Record<string, unknown>
  return {
    source: text(a.utm_source), medium: text(a.utm_medium), campaign: text(a.utm_campaign),
    content: text(a.utm_content), term: text(a.utm_term),
    at: new Date(s.submittedAt).toISOString(),
  }
}

/** Mesma ordem do SQL: submitted_at e, em empate, id. */
function compare(a: SubmissionAttributionInput, b: SubmissionAttributionInput): number {
  const d = new Date(a.submittedAt).getTime() - new Date(b.submittedAt).getTime()
  return d !== 0 ? d : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Resolve a atribuição principal (primeira válida) e a mais recente válida de um lead. */
export function resolveLeadAttribution(submissions: readonly SubmissionAttributionInput[]): {
  primary: LeadAttribution | null
  latest: LeadAttribution | null
} {
  const valid = submissions.filter(s => hasMarketingOrigin(s.attribution)).sort(compare)
  return {
    primary: valid.length ? toAttribution(valid[0]) : null,
    latest: valid.length ? toAttribution(valid[valid.length - 1]) : null,
  }
}

const VALID_ORIGIN_SQL = `(nullif(btrim(f.answers #>> '{attribution,utm_source}'), '') IS NOT NULL
      OR nullif(btrim(f.answers #>> '{attribution,utm_medium}'), '') IS NOT NULL
      OR nullif(btrim(f.answers #>> '{attribution,utm_campaign}'), '') IS NOT NULL)`

/**
 * Junções laterais (somente leitura) que expõem, para o lead `l`, a atribuição principal (`first_attr`) e a mais
 * recente (`latest_attr`), cada uma com `attribution` (jsonb) e `submitted_at`. Mesma regra de resolveLeadAttribution.
 */
export const LEAD_ATTRIBUTION_JOINS = `
  LEFT JOIN LATERAL (
    SELECT f.answers -> 'attribution' AS attribution, f.submitted_at
    FROM crm.form_submissions f
    WHERE f.lead_id = l.id AND ${VALID_ORIGIN_SQL}
    ORDER BY f.submitted_at ASC, f.id ASC LIMIT 1
  ) first_attr ON true
  LEFT JOIN LATERAL (
    SELECT f.answers -> 'attribution' AS attribution, f.submitted_at
    FROM crm.form_submissions f
    WHERE f.lead_id = l.id AND ${VALID_ORIGIN_SQL}
    ORDER BY f.submitted_at DESC, f.id DESC LIMIT 1
  ) latest_attr ON true`

/** Colunas selecionáveis a partir de LEAD_ATTRIBUTION_JOINS. */
export const LEAD_ATTRIBUTION_COLUMNS = `
  nullif(btrim(first_attr.attribution ->> 'utm_source'), '') AS utm_source,
  nullif(btrim(first_attr.attribution ->> 'utm_medium'), '') AS utm_medium,
  nullif(btrim(first_attr.attribution ->> 'utm_campaign'), '') AS utm_campaign,
  first_attr.submitted_at AS attribution_at,
  nullif(btrim(latest_attr.attribution ->> 'utm_source'), '') AS latest_utm_source,
  nullif(btrim(latest_attr.attribution ->> 'utm_medium'), '') AS latest_utm_medium,
  nullif(btrim(latest_attr.attribution ->> 'utm_campaign'), '') AS latest_utm_campaign,
  latest_attr.submitted_at AS latest_attribution_at`

export type LeadAttributionRow = {
  utm_source: string | null; utm_medium: string | null; utm_campaign: string | null; attribution_at: Date | null
  latest_utm_source: string | null; latest_utm_medium: string | null; latest_utm_campaign: string | null; latest_attribution_at: Date | null
}

/** Formato da API: `source/medium/campaign` = principal (primeira válida); `latest*` = origem mais recente. */
export function attributionFields(row: LeadAttributionRow) {
  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null)
  return {
    source: row.utm_source, medium: row.utm_medium, campaign: row.utm_campaign, attributedAt: iso(row.attribution_at),
    latestSource: row.latest_utm_source, latestMedium: row.latest_utm_medium, latestCampaign: row.latest_utm_campaign,
    latestAttributedAt: iso(row.latest_attribution_at),
  }
}
