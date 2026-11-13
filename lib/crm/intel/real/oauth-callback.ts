/**
 * Retorno do OAuth (Google Ads / Meta) no modo real. Sem framework, testável.
 *
 * O cookie de sessão do CRM é SameSite=Strict e não acompanha o redirecionamento vindo do Google/Meta: a autenticidade
 * vem do `state` (criado por um administrador com sessão válida, uso único, 10 min, preso à plataforma). A resposta é uma
 * página mínima que volta ao CRM por navegação iniciada no próprio domínio (assim a sessão Strict volta a valer).
 * Nunca exibe código, token ou mensagem bruta da plataforma.
 */
import { isCrmRuntimeEnabled } from '../../runtime-env'
import { isIntelEnabled } from '../feature'
import { ConnectorError } from '../connectors/contracts'
import { dataMode, googleStatus, metaStatus, providerReady } from './config'
import { consumeOAuthState, googleExchangeCode, metaExchangeCode } from './oauth'
import * as repo from './repo'
import type { RealRuntime } from './runtime'

export type CallbackResult = { status: number; html: string }

function page(outcome: 'ok' | 'erro', message: string): string {
  const target = '/crm?view=intel-conexoes&oauth=' + outcome
  const esc = message.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' }[c]!))
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="robots" content="noindex"><meta http-equiv="refresh" content="1;url=${target}">
<title>Central de Inteligência</title></head><body style="font-family:system-ui;background:#07101F;color:#e6edf7;padding:32px">
<p>${esc}</p><p><a style="color:#ff5a6e" href="${target}">Voltar ao CRM</a></p></body></html>`
}

export async function handleOAuthCallback(rt: RealRuntime, input: { provider: string; code: string | null; state: string | null; error: string | null; intelEnabled: string | undefined; runtimeEnabled?: boolean }, now = new Date()): Promise<CallbackResult> {
  const runtimeOk = input.runtimeEnabled ?? isCrmRuntimeEnabled()
  if (!runtimeOk || !isIntelEnabled(input.intelEnabled) || dataMode(rt.env) !== 'real') return { status: 404, html: 'Not found' }
  const provider = input.provider === 'google' ? 'google' : input.provider === 'meta' ? 'meta' : null
  if (!provider) return { status: 404, html: 'Not found' }
  const actor = await consumeOAuthState(rt.db, provider, input.state, now)
  if (!actor) return { status: 400, html: page('erro', 'Autorização recusada: pedido inválido ou expirado. Inicie a conexão novamente pela Central.') }
  if (input.error || !input.code || input.code.length > 2048) return { status: 400, html: page('erro', 'Autorização cancelada ou não concedida na plataforma.') }
  const status = provider === 'google' ? googleStatus(rt.env) : metaStatus(rt.env)
  if (!providerReady(status) || !rt.vault || !rt.ring) return { status: 409, html: page('erro', 'Plataforma não habilitada neste ambiente.') }
  try {
    if (provider === 'google') {
      const ex = await googleExchangeCode(rt.fetch, rt.env, rt.ring, input.code, input.state!)
      const meta = await rt.vault.store({ connectionId: 'oauth', provider: 'google', secret: ex.refreshToken, scopes: ex.scopes, expiresAt: null })
      const conn = await repo.createConnection(rt.db, actor, { provider: 'google', authKind: 'oauth_user', label: 'Google Ads · ' + now.toISOString().slice(0, 10), credentialRef: meta.ref, scopes: ex.scopes, principalHint: null, expiresAt: null })
      if (ex.accessToken) rt.googleTokens?.seed(conn.id, ex.accessToken, ex.expiresIn)
    } else {
      const ex = await metaExchangeCode(rt.fetch, rt.env, input.code, now.getTime())
      const meta = await rt.vault.store({ connectionId: 'oauth', provider: 'meta', secret: ex.token, scopes: ['ads_read'], expiresAt: ex.expiresAt })
      await repo.createConnection(rt.db, actor, { provider: 'meta', authKind: 'oauth_user', label: 'Meta Ads · ' + now.toISOString().slice(0, 10), credentialRef: meta.ref, scopes: ['ads_read'], principalHint: null, expiresAt: ex.expiresAt })
    }
    return { status: 200, html: page('ok', 'Conexão autorizada. Voltando ao CRM para descobrir as contas…') }
  } catch (e) {
    const kind = e instanceof ConnectorError ? e.kind : 'erro'
    console.info(JSON.stringify({ scope: 'marketing_intel_real', event: 'oauth_callback_failed', provider, kind }))
    return { status: 502, html: page('erro', kind === 'permission_denied' ? 'A permissão necessária não foi concedida.' : 'Não foi possível concluir a autorização. Tente novamente.') }
  }
}
