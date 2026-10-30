import {
  createECDH, createHmac, createCipheriv, createPrivateKey, generateKeyPairSync, randomBytes, sign,
} from 'node:crypto'

/**
 * Web Push nativo, sem serviço pago e sem biblioteca externa (só node:crypto):
 * - RFC 8291 (Message Encryption for Web Push, codificação aes128gcm da RFC 8188);
 * - RFC 8292 (VAPID: identificação do servidor de aplicação com JWT ES256).
 *
 * O conteúdo é cifrado de ponta a ponta para o aparelho: o serviço de push do navegador
 * (Google, Apple, Mozilla, Microsoft) só transporta bytes que não consegue ler.
 */

export const b64url = {
  encode: (buf: Buffer | Uint8Array) => Buffer.from(buf).toString('base64url'),
  decode: (value: string) => Buffer.from(value, 'base64url'),
}

const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest()
const RECORD_SIZE = 4096

/** RFC 8291 §3.4 + RFC 8188: corpo completo (cabeçalho + registro único cifrado). */
export function encryptWebPushPayload(
  plaintext: Buffer,
  subscriberPublicKey: Buffer, // ua_public: ponto P-256 não comprimido (65 bytes)
  authSecret: Buffer, // 16 bytes
  testing: { senderPrivateKey?: Buffer; salt?: Buffer } = {},
): Buffer {
  if (subscriberPublicKey.length !== 65 || subscriberPublicKey[0] !== 0x04) throw new Error('INVALID_P256DH')
  if (authSecret.length !== 16) throw new Error('INVALID_AUTH_SECRET')
  if (plaintext.length > RECORD_SIZE - 17 - 86) throw new Error('PAYLOAD_TOO_LARGE')
  const ecdh = createECDH('prime256v1')
  if (testing.senderPrivateKey) ecdh.setPrivateKey(testing.senderPrivateKey)
  else ecdh.generateKeys()
  const senderPublicKey = ecdh.getPublicKey() // as_public, 65 bytes
  const sharedSecret = ecdh.computeSecret(subscriberPublicKey)
  const salt = testing.salt ?? randomBytes(16)

  // IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const prkKey = hmac(authSecret, sharedSecret)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), subscriberPublicKey, senderPublicKey])
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]))
  // CEK e NONCE (RFC 8188 §2.2/§2.3)
  const prk = hmac(salt, ikm)
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16)
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12)

  // Registro único: texto || 0x02 (delimitador do último registro), sem preenchimento extra.
  const cipher = createCipheriv('aes-128-gcm', cek, nonce)
  const encrypted = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()])
  const header = Buffer.alloc(16 + 4 + 1)
  salt.copy(header, 0)
  header.writeUInt32BE(RECORD_SIZE, 16)
  header.writeUInt8(senderPublicKey.length, 20)
  return Buffer.concat([header, senderPublicKey, encrypted])
}

export type VapidKeys = { publicKey: string; privateKey: string } // base64url: 65 bytes / 32 bytes

/** Gera um par VAPID novo (P-256). A chave privada deve ir só para variável protegida do servidor. */
export function generateVapidKeys(): VapidKeys {
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
  const jwk = privateKey.export({ format: 'jwk' }) as { d: string; x: string; y: string }
  return {
    publicKey: b64url.encode(Buffer.concat([Buffer.from([4]), b64url.decode(jwk.x), b64url.decode(jwk.y)])),
    privateKey: jwk.d,
  }
}

export function validVapidKeys(keys: Partial<VapidKeys>): keys is VapidKeys {
  try {
    if (!keys.publicKey || !keys.privateKey) return false
    const pub = b64url.decode(keys.publicKey)
    const priv = b64url.decode(keys.privateKey)
    if (pub.length !== 65 || pub[0] !== 4 || priv.length !== 32) return false
    // A chave privada precisa corresponder à pública.
    const ecdh = createECDH('prime256v1')
    ecdh.setPrivateKey(priv)
    return ecdh.getPublicKey().equals(pub)
  } catch { return false }
}

/** RFC 8292: Authorization: vapid t=<JWT ES256>, k=<chave pública>. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const pub = b64url.decode(keys.publicKey)
  const key = createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: keys.privateKey, x: b64url.encode(pub.subarray(1, 33)), y: b64url.encode(pub.subarray(33, 65)) },
    format: 'jwk',
  })
  const header = b64url.encode(Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  // exp de 1 hora (a RFC aceita até 24 h; serviços como o da Apple recusam prazos longos).
  const claims = b64url.encode(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: nowSeconds + 3600, sub: subject })))
  const signature = sign('sha256', Buffer.from(header + '.' + claims), { key, dsaEncoding: 'ieee-p1363' })
  return 'vapid t=' + header + '.' + claims + '.' + b64url.encode(signature) + ', k=' + keys.publicKey
}

/**
 * Serviços de push aceitos (evita que um endpoint forjado faça o servidor chamar endereços internos).
 * Chrome/Android/Edge-Chromium/Samsung/Opera: FCM · Firefox: Mozilla · Safari/iPhone: Apple · Edge legado: WNS.
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^push\.services\.mozilla\.com$/,
  /^web\.push\.apple\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/]

export function pushHostOf(endpoint: unknown): string | null {
  if (typeof endpoint !== 'string' || endpoint.length > 1024) return null
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'https:' || url.port || url.username || url.password) return null
    return PUSH_HOSTS.some(rule => rule.test(url.hostname)) ? url.hostname : null
  } catch { return null }
}

export type PushTarget = { endpoint: string; p256dh: string; auth: string }

export type FetchLike = (url: string, init: {
  method: string; headers: Record<string, string>; body: Buffer; signal: AbortSignal
}) => Promise<{ status: number; headers: { get(name: string): string | null } }>

/**
 * accepted: o serviço de push ACEITOU a mensagem (HTTP 201/202). Isso NÃO significa que o aparelho
 *           recebeu ou exibiu — esse estado vem depois, pelo recibo do service worker.
 * gone:     inscrição expirada ou cancelada (404/410) → o aparelho deve ser marcado como expirado.
 * retry:    pode tentar de novo (429, 5xx, rede, tempo esgotado). Repetir é seguro: a notificação
 *           usa uma "tag" fixa, então o aparelho substitui em vez de duplicar.
 * failed:   recusa definitiva (400, 401/403 = chave VAPID diferente da usada na inscrição, 413...).
 */
export type PushOutcome =
  | { kind: 'accepted'; status: number }
  | { kind: 'gone'; status: number }
  | { kind: 'retry'; status: number | null; code: string; retryAfterSeconds: number }
  | { kind: 'failed'; status: number; code: string }

export async function sendWebPush(
  fetchImpl: FetchLike, target: PushTarget, payload: object, vapid: { keys: VapidKeys; subject: string },
  opts: { ttlSeconds?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; timeoutMs?: number } = {},
): Promise<PushOutcome> {
  if (!pushHostOf(target.endpoint)) return { kind: 'failed', status: 0, code: 'ENDPOINT_NOT_ALLOWED' }
  let body: Buffer
  try {
    body = encryptWebPushPayload(Buffer.from(JSON.stringify(payload)), b64url.decode(target.p256dh), b64url.decode(target.auth))
  } catch { return { kind: 'failed', status: 0, code: 'INVALID_SUBSCRIPTION_KEYS' } }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 8_000)
  try {
    const res = await fetchImpl(target.endpoint, {
      method: 'POST',
      headers: {
        Authorization: vapidAuthorization(target.endpoint, vapid.keys, vapid.subject),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(opts.ttlSeconds ?? 43_200),
        Urgency: opts.urgency ?? 'high',
      },
      body,
      signal: controller.signal,
    })
    const status = res.status
    if (status === 201 || status === 202 || status === 200) return { kind: 'accepted', status }
    if (status === 404 || status === 410) return { kind: 'gone', status }
    if (status === 429 || status >= 500) {
      const after = Number(res.headers.get('retry-after'))
      return { kind: 'retry', status, code: status === 429 ? 'RATE_LIMITED' : 'PUSH_SERVICE_ERROR',
        retryAfterSeconds: Number.isFinite(after) && after > 0 ? Math.min(after, 3600) : status === 429 ? 30 : 5 }
    }
    if (status === 401 || status === 403) return { kind: 'failed', status, code: 'VAPID_REJECTED' }
    if (status === 413) return { kind: 'failed', status, code: 'PAYLOAD_TOO_LARGE' }
    return { kind: 'failed', status, code: 'PUSH_REJECTED_' + String(status).slice(0, 3) }
  } catch {
    return { kind: 'retry', status: null, code: controller.signal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR', retryAfterSeconds: 5 }
  } finally {
    clearTimeout(timer)
  }
}
