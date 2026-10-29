import type { BookingForm } from './booking-forms'
import type { LeadSubmissionInput, LeadSubmissionResult } from './lead-intake'
import { sanitizeMarketingConsent } from '../marketing/meta'
import {
  TURNSTILE_BOOKING_ACTION, publicTurnstileError,
  type TurnstileConfig, type TurnstileFailure, type TurnstileResult,
} from './turnstile'

/**
 * Cadastro do formulário público (POST /api/booking/leads), sem dependências de
 * framework para poder ser testado. Ordem fixa e segura:
 *   1. validação barata do conteúdo (sem rede e sem banco);
 *   2. Turnstile validado no servidor — falha fechada, nada é gravado antes;
 *   3. limite por IP (preservado: 10 envios/hora);
 *   4. gravação protegida do lead (Fase 3 / item 2) + sessão de agendamento.
 */

const ATTRIBUTION_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid'] as const

export function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim().replace(/[\u0000-\u001f\u007f]/g, ' ')
  return v && v.length <= max ? v : null
}
export function validatedName(value: unknown): string | null {
  const name = clean(value, 120)
  return name && name.length >= 2 ? name : null
}
export function validatedEmail(value: unknown): string | null {
  const email = clean(value, 180)?.toLowerCase()
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) ? email : null
}
export function validatedPhone(value: unknown): string | null {
  const phone = clean(value, 24)
  if (!phone) return null
  const digits = phone.replace(/\D/g, '')
  return digits.length >= 10 && digits.length <= 13 ? digits : null
}
function configuredAnswers(form: BookingForm, raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const answers: Record<string, string> = {}
  for (const field of form.fields) {
    const rawValue = (raw as Record<string, unknown>)[field.name]
    const value = clean(rawValue, 120)
    if (field.required && (!value || value.length < 2)) return null
    if (value && field.type === 'select' && !field.options?.includes(value)) return null
    if (value) answers[field.name] = value
  }
  return answers
}

export type IntakeDeps = {
  getForm: (slug: string) => BookingForm | null
  turnstileConfig: TurnstileConfig
  expectedHostnames: readonly string[]
  verifyTurnstile: (input: { token: unknown; secretKey: string; remoteIp: string | null }) => Promise<TurnstileResult>
  consumeIpQuota: () => Promise<boolean>
  saveLead: (input: LeadSubmissionInput) => Promise<LeadSubmissionResult>
  createGrant: (data: { leadId: string; submissionId: string; formSlug: string }) => string
  classifyNewLeadAsTest: (email: string) => boolean
  bookingMode: string
  /** Origem pública do funil (ex.: https://crm.cassiellos.com.br) para o evento Lead. */
  publicOrigin?: string
  /** Somente códigos e motivos — nunca token, IP, e-mail ou segredo. */
  log?: (event: string, details: { reason?: TurnstileFailure | string; codes?: string[] }) => void
}

export type HandlerResponse = { status: number; body: Record<string, unknown> }

export async function handleLeadIntake(
  deps: IntakeDeps,
  input: { value: Record<string, unknown>; remoteIp: string | null },
): Promise<HandlerResponse> {
  const value = input.value
  if (value.website) return { status: 400, body: { error: 'INVALID_REQUEST' } } // hidden bot trap
  const formSlug = clean(value.formSlug, 80)
  const form = formSlug ? deps.getForm(formSlug) : null
  if (!form) return { status: 400, body: { error: 'UNKNOWN_FORM' } }
  const idempotencyKey = clean(value.idempotencyKey, 50)
  if (!idempotencyKey || !/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(idempotencyKey))
    return { status: 400, body: { error: 'INVALID_REQUEST_KEY' } }
  const name = validatedName(value.name)
  const email = validatedEmail(value.email)
  const phone = validatedPhone(value.whatsapp)
  const answers = configuredAnswers(form, value.answers)
  if (!name) return { status: 400, body: { error: 'INVALID_NAME' } }
  if (!email) return { status: 400, body: { error: 'INVALID_EMAIL' } }
  if (!phone) return { status: 400, body: { error: 'INVALID_WHATSAPP' } }
  if (!answers) return { status: 400, body: { error: 'INVALID_FORM_ANSWERS' } }
  if (value.privacyAccepted !== true) return { status: 400, body: { error: 'PRIVACY_NOT_ACCEPTED' } }

  const attribution: Record<string, string> = {}
  const rawAttribution = value.attribution
  if (rawAttribution && typeof rawAttribution === 'object' && !Array.isArray(rawAttribution)) {
    for (const key of ATTRIBUTION_KEYS) {
      const safe = clean((rawAttribution as Record<string, unknown>)[key], 180)
      if (safe) attribution[key] = safe
    }
  }

  // Anti-abuse check happens on the server before ANY database write.
  if (deps.turnstileConfig.status !== 'ready') {
    deps.log?.('security_check_not_configured', { reason: deps.turnstileConfig.status })
    return { status: 503, body: { error: 'SECURITY_CHECK_UNAVAILABLE' } }
  }
  const check = await deps.verifyTurnstile({
    token: value.turnstileToken, secretKey: deps.turnstileConfig.secretKey, remoteIp: input.remoteIp,
  })
  if (!check.ok) {
    deps.log?.(check.reason === 'unavailable' || check.reason === 'misconfigured'
      ? 'security_check_unavailable' : 'security_check_rejected', { reason: check.reason, codes: check.codes })
    const failure = publicTurnstileError(check.reason)
    return { status: failure.status, body: { error: failure.error } }
  }
  if (!deps.expectedHostnames.includes(check.hostname) || check.action !== TURNSTILE_BOOKING_ACTION) {
    // verifyTurnstile already enforces both; kept as a second, explicit guard.
    return { status: 403, body: { error: 'SECURITY_CHECK_FAILED' } }
  }

  try {
    if (!(await deps.consumeIpQuota())) return { status: 429, body: { error: 'TOO_MANY_REQUESTS' } }
    // Only the yes/no marketing choice reaches the CRM; fbp/fbc are discarded (decision C2).
    const marketing = sanitizeMarketingConsent(value.marketing)
    const result = await deps.saveLead({
      idempotencyKey, name, email, phone, formSlug: form.slug,
      formVersion: form.version, niche: form.niche, answers, attribution,
      newLeadIsTest: deps.classifyNewLeadAsTest(email), bookingMode: deps.bookingMode,
      protection: { turnstile: 'verified', action: check.action, hostname: check.hostname, challengeTs: check.challengeTs },
      marketing,
      eventSourceUrl: deps.publicOrigin ? deps.publicOrigin + '/agendar/' + encodeURIComponent(form.slug) : null,
    })
    // Browser Lead event only for a NEW, REAL lead (never tests, reuses or resubmissions).
    const leadEvent = !result.reused && !result.resubmitted && result.isTest === false && result.leadEventId
      ? { lead: { eventName: 'Lead', eventId: result.leadEventId } } : null
    return {
      status: result.reused ? 200 : 201,
      body: {
        ok: true,
        leadId: result.leadId,
        submissionId: result.submissionId,
        bookingToken: deps.createGrant({
          leadId: result.leadId, submissionId: result.submissionId, formSlug: form.slug,
        }),
        reused: result.reused, environment: 'preview',
        ...(leadEvent ? { tracking: leadEvent } : {}),
      },
    }
  } catch {
    // No user input, SQL or credentials should ever appear in logs or error responses.
    return { status: 503, body: { error: 'LEAD_INTAKE_UNAVAILABLE' } }
  }
}
