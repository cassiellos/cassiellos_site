# SHARK SCALE — Formulários inteligentes com bifurcações (0020)

## Entregável

No CRM, **Workspace → Formulários**, crie um formulário por nicho (ex.: Escolas). O editor permite:
- cadastrar nome, descrição e endereço público;
- criar perguntas de texto ou seleção, adicionar/remover etapas e alternativas;
- definir próximo passo padrão e, para cada resposta, substituir o destino por outra etapa;
- editar páginas de finalização distintas: `qualified` (orçamento compatível), `limited` (orçamento limitado), `other`;
- simular a jornada no próprio CRM, sem gravar leads;
- salvar rascunho, publicar explicitamente ou retirar do ar.

Rascunho e público são snapshots diferentes. Enquanto publicado, título, descrição, passos e destinos públicos não mudam ao salvar rascunhos. O endereço é bloqueado durante publicação. A gravação usa revisão otimista: duas sessões não sobrescrevem alterações silenciosamente.

## Jornada pública

Publicados usam `https://crm.cassiellos.com.br/formularios/<slug>`.
- O próprio backend recalcula o caminho percorrido; não aceita o resultado declarado pelo navegador.
- Antes de concluir cada final, solicita nome, e-mail, WhatsApp e confirmação explícita da solicitação de contato.
- Cloudflare Turnstile, origem autorizada, rate limiting, dados mínimos e idempotência seguem os mesmos padrões do CRM.
- `crm.form_submissions.answers.journey` registra resultado, caminho e versão. A tabela `crm.lead_activities` registra evento atômico `form_flow_qualified`, `form_flow_budget_limited` ou `form_flow_other`.
- Leads **novos** com orçamento compatível entram em `qualified`. Leads **novos** limitados permanecem `new` e aparecem na coluna **Orçamento limitado** do funil. Leads existentes conservam o estágio atual.
- O modelo inclui referência provisória de R$ 50/dia. Revise o valor antes de publicar campanhas.
- A versão histórica do `/agendar` e seu fluxo de Google Meet não são modificados. A finalização qualificada pode apontar para `/agendar`, configurável no editor.

## Importante: evento interno ≠ webhook externo

A classificação persiste **dentro da mesma transação do lead**, disponível ao CRM e a integrações futuras. Nenhum endpoint externo de webhook foi especificado/autorizado; portanto **não há disparo HTTP externo**. Ao definir destino, autenticação e consentimento, implementar entrega assíncrona com outbox, retries e idempotência, sem bloquear o envio do visitante. Não chamar isso de webhook externo pronto.

O formulário público novo ainda não dispara conversões Pixel/CAPI próprias; eventos de anúncio por tipo de lead e critérios de qualificação devem ser homologados antes de usar esse formulário como destino de anúncios pagos. Não misturar leads de orçamento limitado com conversões qualificadas.

## Segurança e validação

- Autorização por sessão administrativa no CRUD; CSRF por `Origin` exata.
- Graph validation: máximo de 24 etapas, alternativas válidas e exclusivas, sem ciclos, destinos inexistentes ou etapas desconectadas. URL de CTA restrita a caminho relativo no próprio domínio.
- Limite de 100 formulários retornados pela listagem, 50 KB no corpo administrativo, 16 KB no envio público.
- Nenhuma mutation em tabela de campanhas de anúncios, calendários ou credenciais.
- Não assumir publicação se a migração não estiver presente: respostas administrativas `MIGRATION_PENDING` e rotas públicas não publicadas 404.
- Testes em PostgreSQL local descartável com migrações 0001–0020.

## Rollout controlado

1. Revisar e aprovar PR da branch `feat/crm-visual-form-flows`.
2. Confirmar backup/restauração e **autorizar a migração aditiva 0020 em Production**, antes do deploy da aplicação. Não rodar automaticamente contra produção.
3. Aplicar `db/migrations/0020_form_flows.sql` na branch Neon **do CRM** e verificar tabelas/constraints (não usar branch padrão sem conferir `CRM_DATABASE_URL`).
4. Publicar o novo commit de `crm-production` na Vercel, confirmar READY.
5. No CRM, criar `Formulário Escolas` (rascunho), editar o valor provisório, percorrer Sim/Não em **Simular jornada** e salvar.
6. Publicar manualmente a versão validada e testar o link público no domínio oficial com controles reais de Turnstile. Não usar e-mails de clientes reais durante homologação; não testar envio no banco real sem autorização específica.
7. Antes dos anúncios nacionais, homologar eventos de conversão e decisão de webhook externo.

Rollback: restaurar commit anterior reverte o código; a tabela aditiva permanece inerte e conserva rascunhos. Evitar DROP de tabelas se houver formulários ou leads relacionados; somente remover schema com autorização explícita e backup.

## QA realizado

Testes unitários da máquina de rotas; testes transacionais de armazenamento, revisões, publicação/despublicação; testes integrados de captação qualificada/limitada, idempotência, histórico e preservação de leads existentes. `npx tsc --noEmit`, `npm run build` e suíte padrão `npm test`.
