# Central de Inteligência — Fase 2: clientes reais e integrações Google Ads / Meta Ads

Estado: **implementado e testado localmente** (PostgreSQL descartável + conectores com respostas falsas).
**Nada foi ativado em Production.** Não houve migração no Neon de Production, nem credencial real, conexão com
contas de clientes ou cron.

## 1. Arquitetura

O modo real reaproveita a fundação aprovada e não cria outro dashboard.

| Peça | Arquivo | Papel |
|---|---|---|
| Modo de dados | `lib/crm/intel/real/config.ts` | `MI_DATA_MODE=real` liga o modo real; sem ele, a Central continua em demonstração (padrão). |
| Leitura para os painéis | `lib/crm/intel/real/snapshot.ts` | Carrega clientes, contas, vínculos, campanhas, métricas, execuções e alertas do banco nas mesmas estruturas dos 4 painéis. Gráficos, filtros e isolamento continuam os homologados. |
| Repositório | `lib/crm/intel/real/repo.ts` | Clientes monitorados, vínculo financeiro explícito, conexões, contas descobertas, associação com confirmação e auditoria. |
| API administrativa | `lib/crm/intel/real/admin-real.ts` | Mesmas proteções do modo demonstração. Acrescenta ações de cadastro, vínculo, descoberta, OAuth, revogação e sincronização. |
| OAuth | `lib/crm/intel/real/oauth.ts`, `oauth-callback.ts`, `app/api/crm/intel/oauth/[provider]/callback` | `state` de uso único (hash no banco), PKCE no Google, token de longa duração na Meta. |
| Cofre | `lib/crm/intel/vault/pg-vault.ts` | AES-256-GCM com chaves próprias. O banco guarda só iv, texto cifrado e tag. |
| Sincronização | `lib/crm/intel/sync/pg-store.ts`, `sync/rate-limit.ts` | Lease distribuído, upsert idempotente, alertas e limites persistentes (substituem o N2 em memória). |
| Conectores | `lib/crm/intel/connectors/google-ads.ts`, `meta-ads.ts` | Somente leitura, sempre pela guarda `assertReadOnlyRequest`. |
| Interface | `app/crm/inteligencia/intel-admin.tsx` (+ ajustes em `intel-app.tsx`, `intel-areas.tsx`, `intel-ui.tsx`) | Painéis administrativos dentro de **Visão do cliente** e **Conexões e integrações**, no menu atual do CRM. |

### Regras de dados

- **Cliente monitorado ≠ cliente financeiro.** O vínculo com `crm.finance_clients` é explícito, opcional e único. O Financeiro é só lido (nome).
- **Nenhuma associação automática.** Uma conta descoberta só alimenta relatórios depois que o administrador **confirma** o vínculo cliente × conta.
- **Dono único por conta.** Compartilhamento só com justificativa registrada (10 a 500 caracteres).
- **Histórico preservado.** Encerrar um vínculo ou arquivar um cliente não apaga as métricas; elas deixam de alimentar os relatórios a partir dali.
- **Conversões não se misturam.**
  - Google `metrics.conversions` segue as definições e o modelo de atribuição da conta.
  - Meta usa uma ação explícita (`MI_META_RESULT_ACTION`, padrão `lead`) com janela de atribuição `7d_click, 1d_view`.
  - O agrupamento é por plataforma, definição, atribuição e moeda. Nenhuma das duas equivale a um lead do CRM.
- **Moedas separadas.** BRL e USD nunca são somados (não há conversão cambial).
- **Sem números inventados.**
  - Sem conexão: "Aguardando conexão".
  - Sem métricas no período: "Sem dados no período".
  - Falha: erro ou dados desatualizados.
  - O selo **DADOS REAIS** só aparece com evidência de importação concluída para os clientes da visão.
- **Prospecção no modo real:** leads e reuniões do CRM não são atribuídos às campanhas. O funil simulado não existe no modo real.

### Sincronização

- **Primeira sincronização de uma conta:** histórico de 90 dias.
- **Seguintes:** revisão dos últimos 7 dias completos, no fuso da conta, com idempotência.
- **Atualização manual:**
  - no máximo 1 por conta a cada 15 minutos e 20 por minuto no total;
  - controle no banco (`mi_rate_marks` e `mi_rate_limits`), válido entre instâncias.
- **Concorrência:** o job `running` é único por conta. Um lease vencido de instância que caiu é encerrado automaticamente.
- **Falhas:**
  - 429 e erros transitórios: novas tentativas limitadas com backoff ou `Retry-After`;
  - autorização expirada ou revogada: para e abre alerta, e a conexão fica `expired`.
- **Sincronização recorrente (cron):** não implementada nem habilitada. Depende de aprovação (ver §6).

## 2. Banco de dados

| Migração | Conteúdo | Situação |
|---|---|---|
| 0017 | Clientes, conexões, contas, acesso, vínculos, auditoria | Pronta (só bancos descartáveis / Preview) |
| 0018 | Campanhas, jobs, métricas diárias, GA4, GTM, alertas | Pronta (só bancos descartáveis / Preview) |
| **0019** | `mi_credentials` (cofre), `mi_oauth_states`, `mi_rate_marks`, `mi_rate_limits` | **Nova**, aditiva, reexecutável. Reversão em `db/ops/0019_marketing_intel_real_rollback.sql`. |

**Nenhuma migração foi executada em Neon, nem no Preview nem em Production.** Aplicar 0017 → 0018 → 0019 no
Neon Preview isolado (`shark-scale-mi-preview-only`) é o primeiro passo do plano (§6). Precisa da URL do banco do
Preview, que esta sessão não leu.

## 3. Cofre de credenciais

- **Algoritmo:** AES-256-GCM, IV aleatório por gravação.
- **AAD:** referência + plataforma (o texto cifrado não pode ser trocado de linha).
- **Chaves:** `MI_VAULT_KEYS="1:<base64 de 32 bytes>"` e `MI_VAULT_KEY_CURRENT=1`. São **separadas** da chave do Google Calendar: o cofre se recusa a iniciar se coincidirem.
- **No banco:** só `iv`, `ciphertext` e `auth_tag`. A referência opaca (`vault:mi-<plataforma>:<aleatório>`) vai para `mi_connections.credential_ref`.
- **Uso:** o segredo só existe em memória dentro de `withSecret`. Nunca vai ao navegador, aos logs, à auditoria nem às respostas da API (verificado por `assertNoSecretsInPayload` e por testes).
- **Revogação:** apaga o material cifrado (fica 1 byte) e marca a conexão como `revoked`.

**Rotação de chave:**
1. Gerar a nova chave: `openssl rand -base64 32`.
2. Acrescentar `2:<nova>` em `MI_VAULT_KEYS` e definir `MI_VAULT_KEY_CURRENT=2`.
3. Reimplantar e executar `PgCredentialVault.rotate()` (tarefa administrativa). Ela recifra tudo com a versão 2 e mantém as referências.
4. Depois de conferir que nenhuma linha usa a versão 1, remover `1:` de `MI_VAULT_KEYS`.

## 4. Variáveis de ambiente (somente servidor)

Nenhuma foi criada nesta fase.

| Variável | Obrigatória para | Observação |
|---|---|---|
| `MI_DATA_MODE=real` | Modo real | Ausente = demonstração. |
| `MI_VAULT_KEYS`, `MI_VAULT_KEY_CURRENT` | Cofre | Gerar no servidor; nunca reutilizar `CRM_GOOGLE_ENCRYPTION_KEY`. |
| `MI_OAUTH_REDIRECT_BASE` | OAuth | `https://crm.cassiellos.com.br` (ou a URL do Preview em homologação). |
| `MI_GOOGLE_ADS_ENABLED=true` | Google Ads | Desligado por padrão. |
| `MI_GOOGLE_ADS_CLIENT_ID`, `MI_GOOGLE_ADS_CLIENT_SECRET` | Google Ads | Cliente OAuth com o escopo `.../auth/adwords`. Não usa as credenciais do Calendar. |
| `MI_GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads | Token de desenvolvedor da conta MCC. |
| `MI_GOOGLE_ADS_API_VERSION` | (opcional) | Padrão `v26`. |
| `MI_META_ADS_ENABLED=true` | Meta Ads | Desligado por padrão. |
| `MI_META_APP_ID`, `MI_META_APP_SECRET` | Meta Ads | App da Meta com o produto Marketing API. Não usa o token do CAPI. |
| `MI_META_GRAPH_VERSION` | (opcional) | Padrão `v26.0`. |
| `MI_META_RESULT_ACTION` | (opcional) | Ação contada como resultado (padrão `lead`). |
| `MI_META_SYSTEM_USER_TOKEN` | (opcional) | Usuário do sistema do portfólio empresarial, só com `ads_read`. |

Redirecionamentos a cadastrar nas plataformas:
- `https://crm.cassiellos.com.br/api/crm/intel/oauth/google/callback`
- `https://crm.cassiellos.com.br/api/crm/intel/oauth/meta/callback`

Para a homologação, as mesmas URLs com a origem do Preview.

## 5. Permissões externas (dependem do titular)

### Google Ads
1. **Conta de administrador (MCC)** da Cassiellos, com acesso às contas dos clientes (vínculo gerente → cliente aceito por cada cliente).
2. **Token de desenvolvedor** (Central de API da MCC). Com acesso *Teste* ele só lê contas de teste; para contas reais é preciso o **acesso Básico** aprovado pelo Google (formulário de solicitação).
3. **Cliente OAuth** no Google Cloud com a *Google Ads API* habilitada, a tela de consentimento configurada, o escopo `https://www.googleapis.com/auth/adwords` e os redirecionamentos acima. O app pode precisar de verificação do Google.
4. Quem autoriza no CRM precisa ter acesso de leitura à MCC ou às contas.

### Meta Ads
1. **App da Meta** do tipo Empresa, com o produto *Marketing API*, vinculado ao portfólio empresarial (Business Manager) da Cassiellos.
2. Permissão **`ads_read`**. Para contas de terceiros (clientes) é necessária a **Análise do App** (App Review) da `ads_read` e a **verificação da empresa**. Nenhuma permissão de gerenciamento de anúncios é pedida.
3. Contas de anúncios dos clientes compartilhadas com o portfólio da Cassiellos (parceiro) ou acessíveis ao usuário que autoriza.
4. **Alternativa recomendada para produção:** um usuário do sistema do portfólio com acesso somente leitura às contas e token com `ads_read` (`MI_META_SYSTEM_USER_TOKEN`).

Enquanto alguma aprovação estiver pendente, a plataforma fica **desligada** (`MI_*_ENABLED` ausente). A interface
mostra "Desativado neste ambiente" e o motivo, sem simular dados.

## 6. Plano controlado de ativação (cada etapa exige autorização específica)

| Etapa | Ação | Risco | Reversão |
|---|---|---|---|
| A | Aplicar 0017 → 0018 → 0019 no **Neon Preview isolado** | Nenhum dado real (banco vazio) | `db/ops/0019_…_rollback.sql` e depois `0017_0018_…_rollback.sql` |
| B | Preview da branch `feat/mi-fase2-integracoes` com `MI_DATA_MODE=real`, cofre de teste e plataformas **desligadas** | Nenhum | Remover as variáveis do Preview |
| C | Homologação pelo Claude B no Preview: cadastro, vínculos, isolamento, celular | Nenhum | — |
| D | Com as aprovações do §5: habilitar Google e/ou Meta **no Preview** e conectar uma conta de teste ou da própria Cassiellos | Leitura real de uma conta autorizada | Revogar a conexão na Central; remover `MI_*_ENABLED` |
| E | Production: **backup** (branch do Neon) e então 0017 → 0018 → 0019 no Neon Production | Tabelas novas e aditivas, sem tocar o CRM | Scripts de reversão; restaurar a branch de backup |
| F | Merge em `crm-production` com `MI_DATA_MODE` **ausente** (Central continua em demonstração) | Baixo | Rollback do deployment na Vercel |
| G | `MI_DATA_MODE=real`, chaves do cofre e plataformas aprovadas em Production; cadastrar clientes e conectar contas | Importação de dados reais | Remover `MI_DATA_MODE` (volta à demonstração; dados ficam no banco); revogar conexões |
| H | (Opcional) sincronização recorrente agendada | Consumo de cota e de funções | Desligar o agendamento |
