# CRM Cassiellos — homologação isolada do `/agendar` (branch `crm-homolog`)

**Status:** código local, não publicado. Nada daqui altera o CRM público, a `main` ou Production.

O modo permite exercitar o formulário `/agendar` num **Preview protegido** com as **chaves oficiais de teste do
Cloudflare Turnstile**, um **banco de homologação separado** e **nenhuma integração real**. A porta única está em
`lib/crm/homolog-mode.ts`. Se qualquer condição faltar, o modo fica **inativo** e a branch `crm-homolog` responde **404**
em todo o CRM (nunca cai no Preview normal com o banco do CRM, nunca liga em Production).

## Condições (todas obrigatórias)

| # | Condição | Fonte |
| --- | --- | --- |
| 1 | `CRM_HOMOLOG_MODE=true` (valor exato) | variável do projeto, só Preview da branch |
| 2 | Deploy **Preview** na Vercel (`VERCEL=1`, `VERCEL_ENV=preview`) | Vercel |
| 3 | Branch exata `crm-homolog` (`VERCEL_GIT_COMMIT_REF`) | Vercel |
| 4 | `CRM_HOMOLOG_DATABASE_URL` definida e **com host/banco diferentes** de `CRM_DATABASE_URL` | variável (secreta) |
| 5 | Origem confirmada pela Vercel: `VERCEL_BRANCH_URL` e/ou `VERCEL_URL` (`*.vercel.app`) | Vercel (nada é presumido no código) |
| 6 | Nenhuma integração real ligada: `CRM_GOOGLE_BOOKINGS_ENABLED`, `PWA_PUSH_ENABLED`, `META_PIXEL_ENABLED`, `META_HOMOLOGATION_ENABLED`, `META_CHRONOS_LIVE_ENABLED` diferentes de `true` e `META_CAPI_MODE` ausente ou `off` | variáveis |
| 7 | Turnstile com **as duas** chaves oficiais de teste (`NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`); chave real é recusada | variáveis |

## O que muda quando o modo está ativo

- **Banco:** somente `CRM_HOMOLOG_DATABASE_URL`; `CRM_DATABASE_URL` nunca é lido.
- **Origens aceitas (CSRF):** somente as confirmadas pela Vercel; o domínio real do CRM e os aliases antigos deixam de valer.
- **Google:** desligado de forma estrutural (OAuth e agenda); a agenda é **simulada** (nenhum horário ocupado, evento apenas
  local `homolog…`, **sem convite** e sem e-mail).
- **Turnstile:** chaves de teste aceitas; o Siteverify de teste responde `action: "test"`, aceito só aqui.
- **Leads:** todo lead novo é classificado como **teste**.
- Meta Pixel/CAPI, Push e Chronos permanecem desligados (condição 6).

## O que o dono precisa configurar na Vercel (somente Preview da branch `crm-homolog`)

1. **Projeto → Settings → Environment Variables → "Automatically expose System Environment Variables"** ligado (a Vercel
   precisa expor `VERCEL_GIT_COMMIT_REF`, `VERCEL_BRANCH_URL` e `VERCEL_URL` em tempo de execução). Sem isso o modo
   permanece inativo (falha segura) e a branch responde 404.
2. Variáveis com escopo **Preview + branch `crm-homolog`**: `CRM_HOMOLOG_MODE=true`, `CRM_HOMOLOG_DATABASE_URL`
   (banco de homologação **já migrado**, nunca o do CRM), `NEXT_PUBLIC_TURNSTILE_SITE_KEY` e `TURNSTILE_SECRET_KEY` com as
   chaves de teste da documentação do Turnstile, `CRM_SESSION_SECRET` próprio.
3. Variáveis do Preview compartilhado que ligariam integrações devem ter, para esta branch, valor desligado
   (`false`/`off`); credenciais herdadas (ex.: Google) ficam inertes — o modo as ignora.
4. Abrir o Preview pela URL que a **Vercel** mostrar para o deploy. Não use uma URL "prevista".

## Verificação manual no Preview

- `GET /agendar` mostra o formulário e o widget do Turnstile; sem as condições acima, devolve 404.
- Enviar o formulário: no log, motivos `security_check_rejected`/`action_mismatch` indicariam que o Siteverify de teste
  respondeu algo diferente do documentado (ver `acceptedActionAliases` em `lib/crm/turnstile.ts`).
- Não entrar na área administrativa `/crm` do Preview de homologação nem usar os botões de integração.
