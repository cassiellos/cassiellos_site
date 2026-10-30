import { createDecipheriv, createHmac, type ECDH } from 'node:crypto'

/**
 * Lado do APARELHO da RFC 8291 (decifrar aes128gcm). Usado só nos testes automatizados para provar
 * que o conteúdo enviado ao serviço de push é cifrado e que o aviso não carrega dados pessoais.
 */
export function decryptWebPushPayload(body: Buffer, subscriber: ECDH, authSecret: Buffer): Buffer {
  const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest()
  const salt = body.subarray(0, 16)
  const idlen = body.readUInt8(20)
  const senderPublic = body.subarray(21, 21 + idlen)
  const encrypted = body.subarray(21 + idlen)
  const subscriberPublic = subscriber.getPublicKey()
  const shared = subscriber.computeSecret(senderPublic)
  const prkKey = hmac(authSecret, shared)
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), subscriberPublic, senderPublic, Buffer.from([1])]))
  const prk = hmac(salt, ikm)
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01', 'binary')).subarray(0, 16)
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01', 'binary')).subarray(0, 12)
  const decipher = createDecipheriv('aes-128-gcm', cek, nonce)
  decipher.setAuthTag(encrypted.subarray(encrypted.length - 16))
  const padded = Buffer.concat([decipher.update(encrypted.subarray(0, encrypted.length - 16)), decipher.final()])
  let end = padded.length - 1
  while (end >= 0 && padded[end] === 0) end--
  if (padded[end] !== 2) throw new Error('BAD_PADDING')
  return padded.subarray(0, end)
}
