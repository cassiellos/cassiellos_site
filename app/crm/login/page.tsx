import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { crmSessionCookieName, isCrmAuthConfigured, verifyCrmSession } from '@/lib/crm/auth'
import { safeCrmReturnPath } from '@/lib/crm/return-path'
import '../crm.css'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Entrar | CRM | Cassiellos',
  robots: { index: false, follow: false, nocache: true },
}

type LoginProps = { searchParams: Promise<{ error?: string; next?: string }> }

export default async function CrmLoginPage({ searchParams }: LoginProps) {
  const cookieStore = await cookies()
  const { error, next: rawNext } = await searchParams
  // Volta para a tela pedida (ex.: aviso do PWA) depois do login — só caminhos internos do CRM.
  const next = safeCrmReturnPath(rawNext)
  if (verifyCrmSession(cookieStore.get(crmSessionCookieName())?.value)) redirect(next ?? '/crm')
  const configured = isCrmAuthConfigured()

  const errorText: Record<string, string> = {
    invalid: 'Usuário ou senha inválidos.',
    locked: 'Muitas tentativas. Tente novamente após 15 minutos.',
    unavailable: 'Não foi possível autenticar agora. Tente novamente.',
    setup: 'Acesso administrativo ainda não configurado.',
  }
  return <div id="cassiellos-crm">
    <main className="crm-auth-shell">
      <section className="crm-auth-card" aria-labelledby="crm-login-title">
        <div className="crm-auth-brand">
          <img src="/brand/cassiellos-symbol-signal-red.svg" width="55" height="32" alt="Símbolo Cassiellos" />
          <div><strong>Cassiellos</strong><small>MINI CRM / ACESSO ADMINISTRATIVO</small></div>
        </div>
        <div className="crm-auth-eyebrow">ÁREA RESTRITA</div>
        <h1 id="crm-login-title">Bem-vindo de volta.</h1>
        <p className="crm-auth-description">Entre para acompanhar leads, agendamentos e resultados da Cassiellos.</p>

        {!configured && <div className="crm-auth-alert" role="status">
          <strong>Configuração pendente.</strong> O acesso será liberado depois que as credenciais administrativas forem configuradas no ambiente Preview.
        </div>}
        {configured && error && errorText[error] && <div className="crm-auth-alert" role="alert">{errorText[error]}</div>}

        <form action="/api/crm/auth/login" method="POST" className="crm-auth-form">
          {next && <input type="hidden" name="next" value={next} />}
          <label htmlFor="crm-username">Usuário</label>
          <input id="crm-username" name="username" type="text" required autoComplete="username" autoCapitalize="none" autoCorrect="off" maxLength={100} placeholder="admin" disabled={!configured} />
          <label htmlFor="crm-password">Senha</label>
          <input id="crm-password" name="password" type="password" required minLength={12} maxLength={256} autoComplete="current-password" placeholder="Sua senha de acesso" disabled={!configured} />
          <button className="crm-btn crm-btn-primary crm-auth-submit" type="submit" disabled={!configured}>Acessar meu CRM <span aria-hidden="true">→</span></button>
        </form>
        <p className="crm-auth-footer">Sessão protegida · Expira após 8 horas · Ambiente Preview</p>
      </section>
      <div className="crm-auth-bottom">© Cassiellos · Identidade oficial preservada</div>
    </main>
  </div>
}
