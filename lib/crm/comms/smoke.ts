import { timingSafeEqual } from 'node:crypto'

/** One-time CRM Resend smoke test. Never use a live lead's address. */
export const SMOKE_RECIPIENT = 'cassiellosagencia@gmail.com'
export const SMOKE_DEDUPE_KEY = 'crm-resend-smoke-20261119-single'
export const SMOKE_FROM = 'Agência Cassiellos <agendamentos@cassiellos.com.br>'

type SmokeAuth = {
  serverToken?: string
  authorization?: string | null
  environment?: string
  activeAutomations?: boolean
}

/** Token is held only in Vercel's Sensitive Production environment. */
export function authorizeSmoke(input: SmokeAuth): boolean {
  if (input.environment !== 'production' || input.activeAutomations) return false
  const server = input.serverToken
  const header = input.authorization ?? ''
  if (!server || server.length < 32 || !header.startsWith('Bearer ')) return false
  const provided = header.slice('Bearer '.length)
  const a = Buffer.from(server, 'utf8')
  const b = Buffer.from(provided, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}
