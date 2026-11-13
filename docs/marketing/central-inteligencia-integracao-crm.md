# Central de Inteligência — integração ao CRM oficial (Missão 11)

Status: **preparada e homologada localmente; NÃO publicada.** Dados de marketing continuam **simulados**.
Nenhum push, merge, deploy, migração ou alteração de variável foi feito nesta missão.

## Como a Central se integra ao CRM

| Ponto | Situação |
|---|---|
| Base | `crm-production` (3d714c3) + os 5 commits homologados da Central, em avanço linear (sem conflitos). |
| Alterações no CRM existente | Somente `app/crm/page.tsx` (lê `MI_ENABLED`) e `app/crm/mini-crm.tsx` (link condicional no menu). Os demais arquivos são novos. |
| Login | O login do CRM (`/crm/login` → `/api/crm/auth/login`) e o cookie `__Host-cassiellos_crm`. A Central chama `verifyCrmSession` de `lib/crm/auth.ts`, sem login próprio. |
| Senha do Preview | Não é usada. O Preview tem apenas outro valor de `CRM_ADMIN_PASSWORD_HASH`. Em Production vale a senha atual do CRM. |
| Ambiente | Mesma política do CRM (`isCrmRuntimeEnabled`: Preview, ou Production com `CRM_PRODUCTION_ENABLED=true`). |
| Domínio | `https://crm.cassiellos.com.br/crm/inteligencia`. A origem `https://crm.cassiellos.com.br` é aceita nos POST. Em Production, `*.vercel.app` é recusada. |
| Logout | "Encerrar sessão" do CRM (inclusive dentro da Central) remove o cookie e a Central volta a exigir login. |

## Feature flag (desligada por padrão)

Só `MI_ENABLED=true`, com comparação exata, liga a Central. Ausente ou com qualquer outro valor (`TRUE`, `1`, `yes`, …):

- `/crm/inteligencia` → 404;
- `/api/crm/intel` (GET e POST) → 404, antes mesmo da verificação de sessão;
- o menu do CRM não mostra o link;
- nenhum estado da demonstração é criado: o snapshot simulado é preguiçoso e só nasce numa requisição autorizada com a flag ligada. Não há agendamento, `setInterval` nem processo de fundo.

## Banco de dados e migrações

- A demonstração usa só a memória do processo (`MemorySyncStore`). Não importa `pg` e não lê nem grava no Neon.
- O build (`next build`) e o carregamento da Central não executam migrações: não há script de migração em `build`/`start`/`postinstall` nem `instrumentation`.
- Testada sobre banco local com o mesmo esquema de Production (0001–0016, 38 tabelas): contagens idênticas antes e depois, nenhuma tabela nova.
- `0017_marketing_intel_foundation.sql` e `0018_marketing_intel_metrics.sql` são necessárias **somente na futura integração real** (Google Ads, GA4, GTM, Meta). Elas criam `crm.mi_clients`, `mi_connections`, `mi_assets`, `mi_asset_access`, `mi_client_assets`, `mi_audit_log`, `mi_campaigns`, `mi_sync_jobs`, `mi_ads_daily`, `mi_ga`, `mi_gtm_snapshot` e `mi_alerts`. São aditivas, não tocam tabelas existentes e têm verificação em `db/ops/0017_0018_marketing_intel_check.sql` e reversão em `db/ops/0017_0018_marketing_intel_rollback.sql`. A aplicação exige autorização própria do titular.

## Pendências (fora do escopo desta fase)

1. Integração real: OAuth Google, usuário de sistema Meta, cofre de credenciais (`credential_ref`), migrações 0017/0018, sincronização persistente.
2. Deduplicação e limite de taxa persistentes e distribuídos (ver `central-inteligencia-limites-do-mock.md`, N2). O limite atual é por instância e demonstrativo.
3. Sessões do CRM são assinadas e sem estado: o logout apaga o cookie, mas um token copiado continua válido até expirar (8 h) ou até a troca da senha. É característica do CRM existente, não introduzida pela Central. Revogação no servidor seria uma melhoria do CRM como um todo.
4. A Central não tem perfis de acesso próprios: herda o único perfil administrativo do CRM. Perfis por cliente só fazem sentido com acesso de clientes, que não está previsto.

## Plano seguro de homologação antes de Production

Cada etapa exige autorização explícita do titular.

1. Publicar a branch de integração no GitHub (push normal, branch nova, sem merge).
2. Preview do projeto `cassiellos-crm` só para essa branch, pelo procedimento da Missão 08A: regra temporária de build e restauração imediata. Variáveis do Preview dessa branch: `MI_ENABLED=true`, sessão e senha descartáveis, banco isolado e vazio. Nunca o Neon de Production.
3. Reteste pelo Claude B no Preview: autenticação, flag, 4 áreas, celular, regressão do CRM.
4. Aprovação do titular → merge em `crm-production` **com `MI_ENABLED` ausente em Production**. O CRM publicado fica idêntico ao atual, com a Central invisível (404).
5. Verificar Production: rotas existentes, `/crm/inteligencia` → 404, menu sem o link.
6. Só então, com nova autorização: `MI_ENABLED=true` em Production e redeploy. Conferir login com a senha atual do CRM, as 4 áreas e "DADOS SIMULADOS". Para reverter, basta remover a flag.
7. As migrações 0017/0018 e as contas reais ficam para a fase de integração real, com missão e autorização próprias.
