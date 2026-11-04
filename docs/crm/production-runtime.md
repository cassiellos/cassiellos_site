# CRM Cassiellos — ambiente Production (projeto Vercel `cassiellos-crm`)

**Preparado em:** 04/11/2026 · **Base:** `9506db9` (feature/mini-crm-shark-scale) · **Status:** alterações locais, não publicadas.

## Política de ambientes (`lib/crm/runtime-env.ts`)

O mesmo código roda em dois projetos Vercel. `VERCEL_ENV=production` sozinho **não** liga o CRM, porque a
produção do site institucional (`agencia-cassiellos`, branch `main`) também é "production".

| Deploy | VERCEL_ENV | CRM_PRODUCTION_ENABLED | CRM |
| --- | --- | --- | --- |
| agencia-cassiellos · Preview da branch do CRM | preview | — | ligado (como antes) |
| agencia-cassiellos · Production (site, main) | production | ausente | **404** (como antes) |
| cassiellos-crm · Production | production | `true` | ligado |
| qualquer outro / local | — | — | 404 nas rotas que exigiam Preview |

- Valor exato `true`; qualquer outro valor desliga.
- Definir `CRM_PRODUCTION_ENABLED` **somente** no projeto `cassiellos-crm`, ambiente Production. Nunca no `agencia-cassiellos`.
- Como `/crm-sw.js` e `/crm/manifest.webmanifest` são gerados no build, a variável precisa existir **antes** do deploy.

## Diferenças de Production

- **Origens (CSRF):** somente `https://crm.cassiellos.com.br`. Os aliases `*.vercel.app` do Preview não valem.
- **Google OAuth:** `CRM_GOOGLE_REDIRECT_URI` precisa estar em `crm.cassiellos.com.br`; aliases `*.vercel.app` são recusados.
  A credencial copiada do Preview (cifrada com a chave antiga) aparece como `reconnectRequired: true` em
  `/api/crm/google/status`, sem ser apagada, migrada ou registrada em log. A reconexão grava por cima.
- **Web Push:** problema `ENV_NOT_SUPPORTED` fora dos ambientes do CRM. Cada projeto usa o seu par VAPID.
- **Monitor Neon:** em Production exige `NEON_USAGE_BRANCH_ID` (sem padrão).
- **Registros:** `environment` nos metadados de leads/eventos passa a ser `production` em Production.

## Variáveis adicionais para a ativação (Production do cassiellos-crm)

| Variável | Valor | Tipo |
| --- | --- | --- |
| `CRM_PRODUCTION_ENABLED` | `true` | Config |
| `NEON_USAGE_BRANCH_ID` | `br-polished-art-b61qd87e` | Config |

Manter: `PWA_PUSH_ENABLED=false`, `CRM_GOOGLE_BOOKINGS_ENABLED=false`, `META_CHRONOS_LIVE_ENABLED=false`,
`META_CAPI_MODE=off`, `META_HOMOLOGATION_ENABLED=false` até cada etapa autorizada.

## Configuração Vercel a corrigir antes da ativação

O projeto `cassiellos-crm` tem **Production Branch = `main`** (branch do site institucional). Um push na `main`
publicaria o site institucional na Production do CRM. Antes de ligar o domínio, alterar para a branch do CRM
(ou uma branch dedicada) — decisão do titular.
