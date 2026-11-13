/**
 * Montagem das dependências do modo real a partir do ambiente (somente servidor). Conectores só existem quando a
 * plataforma está HABILITADA e CONFIGURADA (config.ts); do contrário ficam nulos e a interface mostra o motivo.
 */
import { createGoogleAdsConnector } from '../connectors/google-ads'
import type { FetchLike } from '../connectors/http'
import { createMetaAdsConnector } from '../connectors/meta-ads'
import type { AdsReadConnector } from '../connectors/contracts'
import { parseKeyRing, PgCredentialVault, type KeyRing, type Queryable } from '../vault/pg-vault'
import { googleStatus, metaStatus, providerReady, type Env } from './config'
import { googleAccessTokenProvider, metaAccessTokenProvider } from './oauth'

export type RealRuntime = {
  db: Queryable
  env: Env
  fetch: FetchLike
  ring: KeyRing | null
  vault: PgCredentialVault | null
  google: AdsReadConnector | null
  meta: AdsReadConnector | null
  googleTokens: ReturnType<typeof googleAccessTokenProvider> | null
}

export function buildRealRuntime(db: Queryable, env: Env, fetchImpl: FetchLike): RealRuntime {
  let ring: KeyRing | null = null
  try { ring = parseKeyRing(env) } catch { ring = null }
  const vault = ring ? new PgCredentialVault(db, ring) : null
  const googleTokens = vault && providerReady(googleStatus(env)) ? googleAccessTokenProvider({ db, vault, fetch: fetchImpl, env }) : null
  const google = googleTokens ? createGoogleAdsConnector({ fetch: fetchImpl, apiVersion: env.MI_GOOGLE_ADS_API_VERSION, developerToken: env.MI_GOOGLE_ADS_DEVELOPER_TOKEN!, accessToken: id => googleTokens.get(id) }) : null
  const metaTokens = vault && providerReady(metaStatus(env)) ? metaAccessTokenProvider({ db, vault }) : null
  const meta = metaTokens ? createMetaAdsConnector({ fetch: fetchImpl, graphVersion: env.MI_META_GRAPH_VERSION, appSecret: env.MI_META_APP_SECRET, resultAction: env.MI_META_RESULT_ACTION, accessToken: id => metaTokens.get(id) }) : null
  return { db, env, fetch: fetchImpl, ring, vault, google, meta, googleTokens }
}

/** fetch nativo adaptado (Node 18+). */
export const nodeFetch: FetchLike = async (url, init) => {
  const res = await fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: init.signal, redirect: 'error', cache: 'no-store' })
  return { status: res.status, headers: res.headers, text: () => res.text() }
}

let cached: { key: string; rt: RealRuntime } | null = null
/** Runtime por processo (o cache de tokens de acesso Google vive nele). Recriado se a configuração mudar. */
export function realRuntimeFor(db: Queryable, env: Env): RealRuntime {
  const key = ['MI_VAULT_KEYS', 'MI_VAULT_KEY_CURRENT', 'MI_GOOGLE_ADS_ENABLED', 'MI_META_ADS_ENABLED', 'MI_GOOGLE_ADS_CLIENT_ID', 'MI_META_APP_ID', 'MI_OAUTH_REDIRECT_BASE'].map(k => env[k] ?? '').join('|')
  if (!cached || cached.key !== key) cached = { key, rt: buildRealRuntime(db, env, nodeFetch) }
  return cached.rt
}
