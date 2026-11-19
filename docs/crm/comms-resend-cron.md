# Vercel Cron — retentativas e cancelamentos de e-mail da Cassiellos

**Projeto:** `cassiellos-crm`, Production, branch `crm-production`.

## Agenda

`vercel.json`: `GET /api/crm/comms/sweep` a cada 10 minutos (UTC), suporte ao plano Pro.

- Retenta mensagens pendentes com falha temporária, respeitando idempotência e cotas existentes.
- Agenda mensagens futuras que entram na janela nativa de 30 dias da Resend.
- Reprocessa cancelamentos pendentes e isola pedidos com estado ambíguo para revisão.
- A reunião já confirmada permanece independente do envio de e-mail.

## Proteção

Na Vercel Production, `CRON_SECRET` e `COMMS_SWEEP_SECRET` são variáveis Sensitive com o **mesmo valor aleatório**. O Vercel Cron envia `Authorization: Bearer $CRON_SECRET` sem precisar colocar segredo no arquivo. A rota só responde autenticada; sem configuração retorna HTTP 404 e sem autorização retorna 403.

Nunca revelar as variáveis, colar segredo em issues/GitHub, ou usar query string para autenticação. Para trocar o segredo, atualizar **ambas** as variáveis juntas e fazer novo deploy.

## Isolamento do site institucional

O repositório `cassiellos/cassiellos_site` alimenta projetos distintos. O Cron está comprometido **somente em `crm-production`**, não em `main`. Não levar o `vercel.json` com o Cron para a branch que abastece o site institucional. Verificar a configuração do projeto ao fazer merges entre essas branches.

## Validação operacional

1. Deploy de Production **READY** e Cron listado no painel do projeto CRM.
2. HTTP GET sem Authorization retorna 403 (e não 404).
3. Verificar no painel de logs pelo menos uma execução agendada com evento `comms_email` / `sweep`.
4. Se `processed=0`, isso é esperado quando não há envios pendentes; não criar e-mails fictícios.
5. Nenhum cron de produção deve ser criado no projeto do site institucional.

A métrica `delivered` da Resend significa aceite pelo servidor receptor, não comprovação de leitura humana.
