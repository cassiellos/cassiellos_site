import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { getMetaPixelConfig } from './meta'

/**
 * Homologação do Meta Pixel (Lead/Schedule) no Pixel COMERCIAL — SOMENTE no Preview.
 *
 * - Não há dataset separado: os eventos vão ao Pixel comercial (META_PIXEL_ID), marcados com
 *   `cassiellos_teste=homologacao`, e PODEM aparecer nas métricas agregadas do conjunto de dados.
 * - O modo só existe com META_HOMOLOGATION_ENABLED=true no Preview e o Pixel comercial ligado. Desligar a chave
 *   (e publicar) elimina o modo por completo.
 * - Liberação administrativa explícita (sessão do CRM) e temporária (no máximo 30 min), num cookie assinado e
 *   HttpOnly do navegador do administrador. Ninguém mais é afetado.
 * - Cada liberação permite no máximo UM Lead e UM Schedule (reserva no banco por liberação:
 *   lib/crm/meta-homologation-claims.ts), sempre depois da resposta real do backend (lead novo registrado; reunião
 *   confirmada com evento criado no Google) e com consentimento de marketing; o mesmo event_id do CRM é usado.
 * - Nenhuma regra comercial muda: leads de teste continuam de teste (is_test), a allowlist continua ativa e, sem a
 *   liberação, nada de teste é enviado à Meta.
 */

export const HOMOLOGATION_MAX_MINUTES = 30
export const HOMOLOGATION_MIN_MINUTES = 5
const PIXEL_ID = /^\d{10,20}$/
const SECRET = /^[a-f0-9]{64,}$/i

export function homologationCookieName(env: Record<string, string | undefined> = process.env): string {
  return env.NODE_ENV === 'production' ? '__Host-cassiellos_meta_homolog' : 'cassiellos_meta_homolog'
}

export type HomologationConfig = { pixelId: string }

/** Disponível só no Preview, com a chave explícita e o Pixel COMERCIAL ligado (é nele que os eventos chegam). */
export function getHomologationConfig(env: Record<string, string | undefined> = process.env): HomologationConfig | null {
  if (env.VERCEL_ENV?.trim() !== 'preview') return null
  if (env.META_HOMOLOGATION_ENABLED?.trim() !== 'true') return null
  const pixel = getMetaPixelConfig(env)
  if (!pixel.enabled || !PIXEL_ID.test(pixel.pixelId)) return null
  return { pixelId: pixel.pixelId }
}

function signingKey(secretHex: string | undefined): Buffer | null {
  if (!secretHex || !SECRET.test(secretHex) || secretHex.length % 2) return null
  // Chave própria (separação de domínio): uma sessão do CRM nunca vale como liberação, e vice-versa.
  return createHmac('sha256', Buffer.from(secretHex, 'hex')).update('cassiellos:meta-homologation:v1').digest()
}

type GrantPayload = { v: 1; kind: 'meta_homologation'; iat: number; exp: number; ref: string; n: string }
/** `nonce`: identificador aleatório da liberação (não pessoal), usado para limitar 1 Lead e 1 Schedule por liberação. */
export type HomologationGrant = { actorRef: string; expiresAt: string; nonce: string }

export function issueHomologationGrant(
  secretHex: string | undefined,
  input: { minutes: number; actorRef: string; now?: Date },
): { token: string; maxAgeSeconds: number; grant: HomologationGrant } {
  const key = signingKey(secretHex)
  if (!key) throw new Error('META_HOMOLOGATION_NOT_CONFIGURED')
  if (!/^[a-f0-9]{8,64}$/.test(input.actorRef)) throw new Error('META_HOMOLOGATION_INVALID_ACTOR')
  const minutes = Math.min(HOMOLOGATION_MAX_MINUTES, Math.max(HOMOLOGATION_MIN_MINUTES, Math.floor(input.minutes) || HOMOLOGATION_MAX_MINUTES))
  const iat = Math.floor((input.now ?? new Date()).getTime() / 1000)
  const payload: GrantPayload = { v: 1, kind: 'meta_homologation', iat, exp: iat + minutes * 60, ref: input.actorRef, n: randomBytes(8).toString('hex') }
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const token = encoded + '.' + createHmac('sha256', key).update(encoded).digest('base64url')
  return {
    token, maxAgeSeconds: minutes * 60,
    grant: { actorRef: input.actorRef, expiresAt: new Date(payload.exp * 1000).toISOString(), nonce: payload.n },
  }
}

export function verifyHomologationGrant(token: string | null | undefined, secretHex: string | undefined, now: Date = new Date()): HomologationGrant | null {
  const key = signingKey(secretHex)
  if (!key || !token || token.length > 600) return null
  const [encoded, signed, extra] = token.split('.')
  if (!encoded || !signed || extra !== undefined) return null
  try {
    const actual = Buffer.from(signed, 'base64url')
    const expected = createHmac('sha256', key).update(encoded).digest()
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null
    const data = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<GrantPayload>
    const t = Math.floor(now.getTime() / 1000)
    if (data.v !== 1 || data.kind !== 'meta_homologation' || typeof data.iat !== 'number' || typeof data.exp !== 'number') return null
    if (typeof data.ref !== 'string' || data.exp <= t || data.iat > t + 30 || data.exp - data.iat > HOMOLOGATION_MAX_MINUTES * 60) return null
    if (typeof data.n !== 'string' || !/^[a-f0-9]{16}$/.test(data.n)) return null
    return { actorRef: data.ref, expiresAt: new Date(data.exp * 1000).toISOString(), nonce: data.n }
  } catch {
    return null
  }
}

function readCookie(cookieHeader: string, name: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return rest.join('=')
  }
  return null
}

export type ActiveHomologation = HomologationConfig & HomologationGrant

/** Modo ativo para ESTA requisição: Preview + chave ligada + Pixel comercial ligado + liberação válida e não expirada. */
export function activeHomologation(
  cookieHeader: string | null | undefined,
  env: Record<string, string | undefined> = process.env,
  now: Date = new Date(),
): ActiveHomologation | null {
  const config = getHomologationConfig(env)
  if (!config) return null
  const grant = verifyHomologationGrant(readCookie(cookieHeader || '', homologationCookieName(env)), env.CRM_SESSION_SECRET, now)
  return grant ? { ...config, ...grant } : null
}
