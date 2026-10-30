import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  HOMOLOGATION_MAX_MINUTES, activeHomologation, getHomologationConfig, homologationCookieName,
  issueHomologationGrant, verifyHomologationGrant,
} from './homologation'

const SECRET = 'ab'.repeat(32)
const ENV = {
  VERCEL_ENV: 'preview', NODE_ENV: 'production', CRM_SESSION_SECRET: SECRET,
  META_PIXEL_ENABLED: 'true', META_PIXEL_ID: '28992534033707610', META_HOMOLOGATION_ENABLED: 'true',
}
const now = new Date('2026-10-30T18:00:00Z')
const ACTOR = '0123456789abcdef'

describe('homologação do Meta Pixel — configuração', () => {
  it('só existe no Preview, com a chave explícita e o Pixel COMERCIAL ligado (sem dataset separado)', () => {
    assert.deepEqual(getHomologationConfig(ENV), { pixelId: '28992534033707610' })
    for (const env of [
      { ...ENV, VERCEL_ENV: 'production' }, { ...ENV, VERCEL_ENV: undefined }, { ...ENV, VERCEL_ENV: 'development' },
      { ...ENV, META_HOMOLOGATION_ENABLED: undefined }, { ...ENV, META_HOMOLOGATION_ENABLED: '1' },
      { ...ENV, META_HOMOLOGATION_ENABLED: 'false' }, { ...ENV, META_PIXEL_ENABLED: undefined },
      { ...ENV, META_PIXEL_ID: 'abc' },
    ]) assert.equal(getHomologationConfig(env), null, JSON.stringify(env))
  })
  it('cookie com prefixo __Host- em produção', () => {
    assert.equal(homologationCookieName({ NODE_ENV: 'production' }), '__Host-cassiellos_meta_homolog')
  })
})

describe('homologação do Meta Pixel — liberação temporária', () => {
  it('emite e confere; duração limitada a 30 min', () => {
    const { token, maxAgeSeconds, grant } = issueHomologationGrant(SECRET, { minutes: 999, actorRef: ACTOR, now })
    assert.equal(maxAgeSeconds, HOMOLOGATION_MAX_MINUTES * 60)
    assert.deepEqual(verifyHomologationGrant(token, SECRET, now), grant)
    assert.equal(grant.expiresAt, '2026-10-30T18:30:00.000Z')
    assert.equal(issueHomologationGrant(SECRET, { minutes: 1, actorRef: ACTOR, now }).maxAgeSeconds, 5 * 60)
  })
  it('expira, e não aceita token adulterado, de outro segredo ou malformado', () => {
    const { token } = issueHomologationGrant(SECRET, { minutes: 30, actorRef: ACTOR, now })
    assert.equal(verifyHomologationGrant(token, SECRET, new Date(now.getTime() + 30 * 60_000)), null)
    assert.equal(verifyHomologationGrant(token, 'cd'.repeat(32), now), null)
    const [payload, sig] = token.split('.')
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), exp: 9e9 })).toString('base64url')
    assert.equal(verifyHomologationGrant(forged + '.' + sig, SECRET, now), null)
    for (const bad of [null, '', 'x', token + '.x', 'a'.repeat(700)]) assert.equal(verifyHomologationGrant(bad, SECRET, now), null)
  })
  it('não emite sem segredo válido ou com referência inválida', () => {
    assert.throws(() => issueHomologationGrant(undefined, { minutes: 30, actorRef: ACTOR }))
    assert.throws(() => issueHomologationGrant('curto', { minutes: 30, actorRef: ACTOR }))
    assert.throws(() => issueHomologationGrant(SECRET, { minutes: 30, actorRef: 'maria@x.com' }))
  })
  it('modo ativo só com Preview + dataset + cookie válido; o token não contém dado pessoal', () => {
    const { token } = issueHomologationGrant(SECRET, { minutes: 30, actorRef: ACTOR, now })
    const header = 'a=1; ' + homologationCookieName(ENV) + '=' + token
    const active = activeHomologation(header, ENV, now)
    assert.equal(active?.pixelId, '28992534033707610')
    assert.match(active?.nonce ?? '', /^[a-f0-9]{16}$/)
    assert.equal(activeHomologation(header, { ...ENV, VERCEL_ENV: 'production' }, now), null)
    assert.equal(activeHomologation(header, { ...ENV, META_HOMOLOGATION_ENABLED: undefined }, now), null, 'chave desligada = modo inexistente')
    assert.equal(activeHomologation('cassiellos_meta_homolog=' + token, ENV, now), null, 'nome do cookie errado')
    assert.equal(activeHomologation(null, ENV, now), null)
    assert.deepEqual(Object.keys(JSON.parse(Buffer.from(token.split('.')[0], 'base64url').toString())).sort(), ['exp', 'iat', 'kind', 'n', 'ref', 'v'])
  })
})
