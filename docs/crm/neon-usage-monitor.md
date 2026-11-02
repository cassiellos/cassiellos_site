# CRM Cassiellos — monitor de consumo Neon (Preview)

## Escopo
- Local: sidebar de /crm, acima de Encerrar sessão, acesso administrativo.
- Branch Git: feature/mini-crm-shark-scale. Nunca aplicar a main por esta tarefa.
- API: GET /api/crm/neon-usage autenticado, somente VERCEL_ENV=preview.
- Sem novas tabelas/migrações/Asaas; sem chave mostra Conexão pendente, não um uso inventado.

## Ativação humana necessária
1. Neon Console → organização **Cassiellos CRM** → Settings → API keys → Create new → **Project-scoped**,
   projeto `cassiellos-crm` (rough-cloud-13370615), nome `crm-cassiellos-monitoramento-neon`.
   Não há chave somente leitura na Neon: a project-scoped tem acesso de **Editor** ao projeto (pode alterar
   e excluir recursos dentro dele, mas não o projeto nem outros projetos). A implementação usa apenas GET.
   O segredo aparece uma única vez; não compartilhar no chat.
2. Vercel → projeto agencia-cassiellos → Settings → Environment Variables: `NEON_USAGE_API_KEY`,
   marcada como Sensitive, ambiente **Preview** restrito à Git branch `feature/mini-crm-shark-scale`.
   Nunca `NEXT_PUBLIC_`, nunca em código.
3. `NEON_USAGE_PROJECT_ID` e `NEON_USAGE_PREVIEW_BRANCH_ID` **não são necessárias**: o código já usa
   rough-cloud-13370615 e br-solitary-darkness-b67vm982 como padrão. Só criar se o projeto/branch mudar.
4. Redeploy da Preview após salvar a chave (variáveis só valem para novos deploys).
5. Verificar: sem cookie → 401; Production → 404; resposta sem segredos.

## Fontes e unidades (API oficial Neon v2, conferida em 02/11/2026)
- Processamento: `project.compute_time_seconds` (segundos de CPU; 1 CPU × 1 s = 1, logo CU-segundos) ÷ 3600 =
  CU-h no ciclo `consumption_period_start`–`consumption_period_end`. Limite Free: 100 CU-h/projeto/mês.
- Transferência: `project.data_transfer_bytes` (egress do ciclo). Limite Free: 5 GB/projeto/mês (decimal, 5×10⁹ B).
- Armazenamento: `branch.logical_size` da branch Preview (bytes) frente a `project.branch_logical_size_limit_bytes`
  (limite lógico por branch; 1 GiB neste projeto). **Não** é o armazenamento faturável do projeto
  (Free: 1 GB/projeto somando root + deltas das branches filhas).
- `synthetic_storage_size` e `data_storage_bytes_hour` estão depreciados e retornam 0: não usar.
- `/consumption_history/v2/*` (métricas faturáveis) só existem nos planos Launch/Scale/Agent/Enterprise.
- Os campos do projeto "não são destinados a faturamento" e têm atraso; a Neon atualiza consumo ~a cada 15 min.
- Plano: `owner.subscription_type` (`free_v3` → Free com limites documentados; `free_v2` → Free legado sem limites
  presumidos; outros → limites não informados).
- Unidades exibidas em base decimal (MB = 10⁶ B, GB = 10⁹ B), como a Neon Console.

## Comportamento
- Cache de 15 min no processo servidor; atualização automática a cada 15 min com a aba visível.
- Botão de atualizar envia `?refresh=1`: ignora o cache se o dado tiver mais de 60 s (no máximo 1 chamada/min).
- ≥80% amarelo + aviso "Atenção"; ≥95% vermelho + aviso "Crítico". Sem limite conhecido: sem barra, sem alerta.
- Dado ausente aparece como "Indisponível" / "limite não informado", nunca como zero.

## Segurança
- O cliente recebe somente números sanitizados, sem token, listas de branches ou detalhes administrativos.
- Servidor faz exclusivamente GET em domínio fixo console.neon.tech, com timeout de 8s, sem URL arbitrária, redirects nem logging de resposta/chave.
- Cache-Control private, no-store.
- Proibido enviar chave ao Claude/ChatGPT, fazer commit dela ou copiar em log.
