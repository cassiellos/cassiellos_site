# CRM Cassiellos — monitor de consumo Neon (Preview)

## Escopo
- Local: sidebar de /crm, acima de Encerrar sessão, acesso administrativo.
- Branch Git: feature/mini-crm-shark-scale. Nunca aplicar a main por esta tarefa.
- API: GET /api/crm/neon-usage autenticado, somente VERCEL_ENV=preview.
- Sem novas tabelas/migrações/Asaas; sem chave mostra Conexão pendente, não um uso inventado.

## Ativação humana necessária
1. Na Neon Console, criar uma chave de API com escopo restrito ao projeto cassiellos-crm, de preferência project-scoped organization API key. Atenção: a própria chave pode ter mais permissões do que apenas GET, embora a implementação somente use GET. Não compartilhar token no chat.
2. Na Vercel, projeto agência Cassiellos, criar NEON_USAGE_API_KEY com target Preview, restrito à Git branch feature/mini-crm-shark-scale. O valor deve ser informado diretamente na UI criptografada, nunca em NEXT_PUBLIC_ ou código fonte.
3. As variáveis opcionais NEON_USAGE_PROJECT_ID (rough-cloud-13370615) e NEON_USAGE_PREVIEW_BRANCH_ID (br-solitary-darkness-b67vm982) já possuem defaults para este projeto.
4. Fazer redeploy da Preview após salvar a chave; entrar no /crm, observar as três barras e conferir que os valores correspondem à Neon.
5. Verificar que chamada sem cookie de sessão retorna 401; produção retorna 404.

## Significado das barras
- Processamento mensal: project.compute_time_seconds / 3600, em CU-h (compute ponderado por capacidade; não são horas de relógio). Cota Free atual: 100 CU-h por projeto/ciclo.
- Saída de dados mensal: project.data_transfer_bytes, em bytes, quota Free atual 5 GiB.
- Armazenamento: tamanho lógico branch Preview, obtido de branch.logical_size, com limite per-branch project.branch_logical_size_limit_bytes (1 GiB neste projeto). Não é o total físico nem a fatura do projeto; branches são copy-on-write e não se devem somar os tamanhos lógicos.
- Consumos de processamento e rede usam período indicado pelo projeto Neon.
- Plano não Free: limites desconhecidos são exibidos como indisponíveis, nunca estimados.
- >=80% amarelo/laranja, >=95% vermelho, 15 min de cache e atualização periódica.

## Segurança
- O cliente recebe somente números sanitizados, sem token, listas de branches ou detalhes administrativos.
- Servidor faz exclusivamente GET em domínio fixo console.neon.tech, com timeout de 8s, sem URL arbitrária, redirects nem logging de resposta/chave.
- Cache-Control private, no-store (cache de 15 minutos somente no processo servidor).
- Se falhar, mostrar Conexão pendente ou Dados indisponíveis, sem preencher com zero.
- Proibido enviar chave ao Claude/ChatGPT, fazer commit dela ou copiar em log.
