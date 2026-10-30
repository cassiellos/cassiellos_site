import { getCrmPool } from '../db'
import { readPushEnv } from './config'
import type { PushDeps } from './store'
import type { FetchLike } from './web-push'

/** Dependências reais do Web Push (servidor). O pool só é criado quando uma consulta acontece. */
export function pushRuntimeDeps(): PushDeps {
  const fetchImpl: FetchLike = async (url, init) => {
    const res = await fetch(url, { method: init.method, headers: init.headers, body: new Uint8Array(init.body), signal: init.signal, redirect: 'error', cache: 'no-store' })
    return { status: res.status, headers: res.headers }
  }
  return {
    pool: { query: ((...args: Parameters<ReturnType<typeof getCrmPool>['query']>) => getCrmPool().query(...args)) as ReturnType<typeof getCrmPool>['query'] },
    env: readPushEnv,
    fetch: fetchImpl,
    secret: process.env.CRM_SESSION_SECRET,
  }
}
