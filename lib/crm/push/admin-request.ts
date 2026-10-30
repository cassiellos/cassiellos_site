import type { HandlerResponse } from '../booking-intake-request'
import {
  DEFAULT_WHATSAPP_TEMPLATE, WHATSAPP_TEMPLATE_LIMIT, WHATSAPP_VARIABLES, renderWhatsappMessage, validateWhatsappTemplate,
} from '../whatsapp-message'
import type { PushEnvStatus } from './config'
import {
  changePushSettings, dispatchNotifications, enqueueTestNotification, listDevices, listHistory, loadPushSettings,
  registerSubscription, revokeSubscription, subscriptionStatus, sweepPushQueue, type PushDeps,
} from './store'

/**
 * API do painel "Notificações" (sem dependências de framework). Mesmas regras das demais rotas do CRM:
 * somente Preview, sessão administrativa válida; alterações exigem origem do próprio CRM + JSON (CSRF).
 * Visitantes nunca conseguem inscrever aparelhos: não há rota pública de inscrição.
 * A chave VAPID privada e os endpoints completos dos aparelhos nunca saem do servidor.
 */

export type PushAdminRequest = {
  method: 'GET' | 'POST'
  vercelEnv: string | undefined
  sessionValid: boolean
  originAllowed: boolean
  contentType: string | null
  rawBody?: string
  actorRef: string
}

export type PushAdminDeps = PushDeps & {
  envStatus: () => PushEnvStatus
  audit?: (event: string, details: Record<string, unknown>) => void
}

const bad = (error: string, status = 400, extra: Record<string, unknown> = {}): HandlerResponse => ({ status, body: { error, ...extra } })

/** Reunião fictícia para a pré-visualização do modelo (nenhum dado real). */
function sampleMeeting() {
  const start = new Date(Math.ceil((Date.now() + 86_400_000) / 1_800_000) * 1_800_000)
  return { name: 'Maria Exemplo', company: 'Clínica Exemplo', startsAt: start, endsAt: new Date(start.getTime() + 1_800_000),
    meetingUrl: 'https://meet.google.com/exemplo-ficticio', meetingName: 'Diagnóstico estratégico' }
}

export async function handlePushAdmin(deps: PushAdminDeps, req: PushAdminRequest): Promise<HandlerResponse> {
  if (req.vercelEnv !== 'preview') return bad('NOT_FOUND', 404)
  if (!req.sessionValid) return bad('UNAUTHORIZED', 401)
  if (req.method === 'GET') return status(deps)
  if (!req.originAllowed) return bad('FORBIDDEN', 403)
  if (!req.contentType?.startsWith('application/json')) return bad('INVALID_REQUEST')
  let data: Record<string, unknown>
  try {
    const raw = req.rawBody ?? ''
    if (raw.length > 6_000) return bad('INVALID_REQUEST')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return bad('INVALID_REQUEST')
    data = parsed as Record<string, unknown>
  } catch { return bad('INVALID_REQUEST') }
  const audit = deps.audit ?? ((event: string, details: Record<string, unknown>) =>
    console.info(JSON.stringify({ scope: 'web_push_admin', event, ...details })))
  const actor = { actorRef: req.actorRef }

  try {
    switch (data.action) {
      case 'subscribe': {
        if (!deps.envStatus().vapidReady) return bad('VAPID_NOT_READY', 409)
        const sub = data.subscription as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } } | undefined
        const r = await registerSubscription(deps.pool, {
          endpoint: sub?.endpoint, p256dh: sub?.keys?.p256dh, auth: sub?.keys?.auth, label: data.label, actorRef: req.actorRef,
        })
        if (!r.ok) return bad(r.error, r.error === 'MIGRATION_PENDING' || r.error === 'TOO_MANY_DEVICES' ? 409 : 400)
        audit('device_registered', { ...actor, deviceId: r.id })
        return { status: 200, body: { ok: true, deviceId: r.id } }
      }
      case 'device_status': {
        const s = await subscriptionStatus(deps.pool, (data.endpoint as unknown) ?? null).catch(() => null)
        return { status: 200, body: { ok: true, status: s } }
      }
      case 'unsubscribe_self':
      case 'revoke': {
        const done = await revokeSubscription(deps.pool, data.action === 'revoke' ? { id: data.deviceId } : { endpoint: data.endpoint })
        audit('device_revoked', { ...actor, by: data.action })
        return done ? status(deps) : bad('NOT_FOUND', 404)
      }
      case 'test': {
        const queued = await enqueueTestNotification(deps, { subscriptionId: data.deviceId })
        if (!queued.ok) return bad(queued.error, queued.error === 'TEST_TOO_SOON' ? 429 : 409)
        const results = await dispatchNotifications(deps, queued.ids, { inlineRetries: 1 })
        const values = Object.values(results)
        audit('test', { ...actor, accepted: values.filter(v => v === 'accepted').length, total: values.length })
        return { status: 200, body: { ok: true, accepted: values.filter(v => v === 'accepted').length, total: values.length, results: values } }
      }
      case 'preferences':
      case 'save_template':
      case 'restore_template': {
        if (data.action === 'restore_template' && data.confirmed !== true) return bad('CONFIRMATION_REQUIRED')
        const change = data.action === 'preferences'
          ? { action: 'preferences' as const, notifyLeads: data.notifyLeads, notifyMeetings: data.notifyMeetings }
          : data.action === 'save_template' ? { action: 'save_template' as const, template: data.template } : { action: 'restore_template' as const }
        const r = await changePushSettings(deps.pool, change, req.actorRef)
        if (!r.ok) return bad(r.error, r.error === 'MIGRATION_PENDING' ? 409 : 400, { detail: r.detail })
        audit(String(data.action), actor)
        return status(deps)
      }
      case 'preview_template': {
        const checked = validateWhatsappTemplate(data.template ?? DEFAULT_WHATSAPP_TEMPLATE)
        if (!checked.ok) return bad(checked.error, 400, { detail: checked.detail })
        return { status: 200, body: { ok: true, text: renderWhatsappMessage(checked.value, sampleMeeting()) } }
      }
      case 'process_due': {
        const processed = await sweepPushQueue(deps, { limit: 10 })
        return { status: 200, body: { ok: true, processed } }
      }
      default:
        return bad('INVALID_ACTION')
    }
  } catch {
    return bad('PUSH_ADMIN_UNAVAILABLE', 503)
  }
}

async function status(deps: PushAdminDeps): Promise<HandlerResponse> {
  const env = deps.envStatus()
  try {
    const settings = await loadPushSettings(deps.pool)
    const [devices, history] = settings ? await Promise.all([listDevices(deps.pool), listHistory(deps.pool)]) : [[], []]
    return {
      status: 200,
      body: {
        ok: true, env, migrationPending: settings === null,
        settings: settings ?? { notifyLeads: true, notifyMeetings: true, whatsappTemplate: DEFAULT_WHATSAPP_TEMPLATE, templateCustomized: false, lastTestAt: null },
        defaults: { whatsappTemplate: DEFAULT_WHATSAPP_TEMPLATE }, limits: { whatsappTemplate: WHATSAPP_TEMPLATE_LIMIT },
        variables: WHATSAPP_VARIABLES, devices, history,
      },
    }
  } catch {
    return bad('PUSH_ADMIN_UNAVAILABLE', 503)
  }
}
