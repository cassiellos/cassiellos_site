# ProspectFlow — formulário de entrada do site

## Status desta implementação

O site e a rota server-side estão implementados nesta branch. A conexão real com n8n, a escolha da Data Table canônica e a credencial de e-mail **ainda precisam ser validadas no ambiente DEV do n8n** antes de qualquer publicação em produção.

Motivo: este repositório não possui acesso administrativo ao ambiente n8n/Data Tables. O arquivo `n8n/ProspectFlow_Website_Inbound_Form.json` é um template de importação e não deve ser ativado sem a inspeção descrita abaixo.

## Arquitetura

```text
browser
  -> POST /api/prospects/inbound
  -> validação e metadados server-side Next.js
  -> n8n via webhook server-to-server autenticado
  -> validação / idempotência
  -> Data Table / fonte canônica de prospect
  -> readback
  -> notificação por e-mail
  -> effect=COMPLETE
  -> estado de sucesso no site
```

O navegador nunca recebe a URL do webhook nem o segredo do n8n.

## Rota

`POST /api/prospects/inbound`

A rota:

- limita o corpo a 64 KiB;
- trata honeypot antes de enviar ao n8n;
- valida os campos obrigatórios e os limites de tamanho;
- preserva `whatsapp_raw` e cria `whatsapp_normalized` sem presumir DDI brasileiro;
- deriva `submission_id` estável no servidor com HMAC do token de tentativa e do segredo server-side;
- adiciona `source=website_form`, timestamps, consentimento, locale, URL, referrer e UTMs;
- usa timeout de 10 segundos para o upstream;
- envia `X-CassiellOS-Key` ao n8n, seguindo o padrão já existente no ecossistema Cassiellos;
- só responde sucesso quando o n8n devolve `ok=true`, `effect=COMPLETE`, o mesmo `submission_id` e um `prospect_id` não vazio;
- nunca imprime o payload completo nos logs.

## Environment variables

```text
N8N_PROSPECT_INBOUND_WEBHOOK_URL
N8N_PROSPECT_INBOUND_WEBHOOK_SECRET
CONTACT_NOTIFICATION_EMAIL
```

`CONTACT_NOTIFICATION_EMAIL` pode usar `cassiellosagencia@gmail.com`.

Nenhuma das variáveis acima deve usar prefixo `NEXT_PUBLIC_`.

### Preview

Configurar primeiro no ambiente Preview da Vercel apontando para o workflow DEV do n8n.

### Production

Somente copiar/configurar os valores de Production após o teste de efeito completo no DEV: POST -> WRITE -> READBACK -> e-mail -> retry sem duplicata.

## Data Table

Antes de ativar o workflow, procurar no n8n DEV por uma fonte canônica existente com papel de `Prospect`, `ProspectFlow`, `Inbound` ou `Leads`.

- Se existir uma fonte canônica adequada, remapear os nós Data Table do template para ela e preservar o contrato/status já usado.
- Se não existir, criar `prospects_inbound` como fonte inicial.

O template aponta por nome para `prospects_inbound` apenas como fallback de configuração. O arquivo no Git **não prova que essa tabela exista**.

### Schema inicial sugerido

- `submission_id` — string, único por envio
- `prospect_id` — string, UUID estável do prospect
- `source` — string
- `status` — string; `NEW_INBOUND` apenas se não houver enum canônico existente
- `created_at`, `updated_at` — dateTime/string ISO
- `name`, `role`
- `whatsapp_raw`, `whatsapp_normalized`
- `email`
- `company`, `segment`, `location`, `website_or_instagram`
- `goals` — JSON serializado ou tipo estruturado equivalente
- `main_challenge`
- `marketing_setup`, `channels` — JSON serializado ou tipo estruturado equivalente
- `success_definition`
- `investment_range`, `start_timing`
- `additional_context`
- `privacy_consent`, `privacy_consent_at`
- `locale`, `page_url`, `referrer`
- `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`
- `notification_email_status`

Não usar nome, e-mail, WhatsApp ou empresa como chave primária.

## Idempotência

O browser gera apenas um `request_token` por carregamento do formulário. Ele **não é autoridade**.

A API deriva um `submission_id` server-side, de maneira estável, e o n8n deve consultar esse ID antes do insert. Se o ID já existir, o workflow retorna o registro existente e não cria outro lead.

Não fazer merge destrutivo por WhatsApp/e-mail/empresa sem regra de negócio aprovada.

## Notificação por e-mail

Após o readback confirmado, o workflow envia para `CONTACT_NOTIFICATION_EMAIL` usando uma credencial Gmail já existente/segura no n8n.

O e-mail é efeito secundário. Se o registro estiver confirmado mas o Gmail falhar:

1. manter o prospect;
2. registrar `notification_email_status=FAILED` quando possível;
3. devolver `effect=COMPLETE` ao site, porque o contexto já foi preservado;
4. permitir retry interno da notificação.

Nenhuma senha ou credencial Gmail deve entrar no Git.

## Analytics

O componente usa apenas eventos sem PII:

- `contact_form_view`
- `contact_form_start`
- `contact_form_submit`
- `contact_form_success`
- `contact_form_error`

Nome, empresa, WhatsApp, e-mail e textos do formulário nunca são anexados aos eventos.

## Testes antes de produção

Validar no Preview:

1. envio completo válido;
2. envio apenas com obrigatórios;
3. nome ausente;
4. WhatsApp ausente;
5. `goals` vazio;
6. consentimento ausente;
7. e-mail inválido;
8. payload > 64 KiB;
9. honeypot preenchido;
10. webhook indisponível;
11. timeout do n8n;
12. retry do mesmo envio sem duplicata;
13. e-mail falhando depois do readback;
14. mobile sem overflow;
15. navegação por teclado e foco no primeiro erro;
16. `prefers-reduced-motion` sem regressão nos componentes globais;
17. `npm run build`;
18. verificação de tipos/lint disponível no projeto.

### Teste de efeito obrigatório

Para um envio real de DEV:

1. receber `effect=COMPLETE`;
2. abrir a Data Table;
3. localizar `submission_id`;
4. confirmar os campos e `prospect_id`;
5. confirmar timestamps e consentimento;
6. confirmar o e-mail;
7. repetir o mesmo envio/retry e confirmar que não surgiu uma segunda linha.

Sem esse readback, a integração não deve ser declarada concluída.

## Troca de destinatário

Alterar `CONTACT_NOTIFICATION_EMAIL` no ambiente correto e manter o workflow lendo o destinatário enviado pela API server-side ou a configuração central equivalente. Não alterar o frontend.
