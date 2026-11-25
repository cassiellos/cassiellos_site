# Registros operacionais e correção da conexão com o Neon

Complementa `camadas-de-medicao.md`. **Nada aqui foi implantado.** O código está no ramo; produção só muda depois de
merge e deploy autorizados.

## 1. Registros operacionais mínimos (`lib/crm/ops-log.ts`)

**Finalidade:** saber quando e onde uma falha técnica impede o visitante de avançar. Antes, rejeições da verificação de
segurança, falhas do calendário e confirmações que terminavam em `BOOKING_REQUIRES_REVIEW` **não deixavam rastro**.

**Formato:** uma linha JSON no log de execução da plataforma (stdout), por exemplo:

```json
{"log":"cassiellos_ops","v":1,"stage":"form_submit","code":"SECURITY_CHECK_FAILED","status":403,"reason":"expired_or_reused","cf":["timeout-or-duplicate"],"form":"hamburguerias"}
```

| Campo | Conteúdo permitido |
| --- | --- |
| `stage` | `form_page`, `form_submit`, `booking_calendar`, `booking_availability`, `booking_confirm` |
| `code` | lista fechada de códigos técnicos públicos (os mesmos que as rotas já devolvem) ou `OTHER` |
| `status` | status HTTP devolvido |
| `reason` | motivo da verificação de segurança (`invalid`, `expired_or_reused`, `unavailable`…) |
| `cf` | até 5 códigos de erro do Siteverify da Cloudflare (palavras curtas em minúsculas) |
| `db` | categoria do erro de banco/rede, por exemplo `CONNECTION_TIMEOUT`, `AUTH_FAILED`, `SQLSTATE:57P01` |
| `form` | slug de um formulário **já encontrado** (o slug da URL, não confiável, nunca é registrado) |

**Nunca entram:** IP, user agent, token (Turnstile ou de agendamento), nome, e-mail, telefone, respostas, identificador
de lead/reserva/visitante, cookies, URL do visitante e a mensagem original do erro. Cada registro é montado só a partir
de listas fechadas e padrões curtos; qualquer outro campo é descartado (testado com dados pessoais fictícios em todos os
campos). O registro nunca lança erro nem muda a resposta ao visitante.

**Não é analytics:** não conta visitantes, não liga eventos entre si e não depende do consentimento do visitante porque
não trata dado pessoal. Isso e o prazo de retenção (o da plataforma de hospedagem, a confirmar) **dependem de validação
jurídica** (ver a minuta em `camadas-de-medicao.md`).

### Como consultar

No painel de logs da Vercel, busque por `cassiellos_ops`. Contagem por tipo: filtre por `"code":"SECURITY_CHECK_FAILED"`,
`"stage":"booking_confirm"` ou `"db":"CONNECTION_TIMEOUT"`.

### Achados que o registro passa a mostrar

* `POST /api/public/forms/[slug]` devolve `403 SECURITY_CHECK_FAILED` mesmo quando o Siteverify da Cloudflare está
  indisponível (`reason: unavailable`). O registro distingue os dois casos; mudar o status para 503 seria alteração de
  comportamento e fica como proposta.
* Confirmação que cai no `catch` externo (`BOOKING_REQUIRES_REVIEW`) agora informa a categoria do erro.

## 2. Correção da conexão com o Neon (`lib/crm/db.ts`, `lib/crm/db-retry.ts`)

**Evidência:** 1 ocorrência de `Connection terminated due to connection timeout` ao abrir `/formularios/hamburguerias`
(24/11/2026, 17:48 UTC): a página faz uma leitura no banco por visita e uma falha de conexão virava erro para o
visitante. A causa raiz não está provada (compatível com início a frio do Neon Free, suspenso após 5 minutos).

**Mudanças:**

1. Tempo limite de conexão do pool de 5 s para **10 s** (recomendação da documentação do Neon).
2. `retryTransient`: até 3 tentativas com espera de 300 ms e 900 ms e **orçamento de 9 s** (uma tentativa lenta não
   dispara outra depois do orçamento). Só para erros de conexão (`CONNECTION_TIMEOUT`, `POOL_CONNECT_TIMEOUT`,
   `CONNECTION_TERMINATED`, `ECONN*`/`ETIMEDOUT`, SQLSTATE classe 08 e 57P01/57P02/57P03). **Não** repete autenticação,
   configuração, SQL inválido nem timeout de consulta.
3. Aplicado somente a **leituras idempotentes**: página do formulário (`getPublishedFlow`) e regras de
   disponibilidade/calendário. Envio do lead, reserva, confirmação e criação de evento no Google **não** são repetidos.

**Riscos e pontos a confirmar antes do deploy:** o tempo máximo de execução da função da página na Vercel (10 s de
conexão + espera) deve caber no limite do plano; o plano gratuito do Neon continua suspendendo após 5 minutos (a
alternativa estrutural é um plano sem suspensão ou manter a computação aquecida, decisão de custo do titular).

## 3. Testes isolados (sem Neon, sem Vercel, sem produção)

`lib/crm/db-retry.test.ts` (12 testes) e `lib/crm/ops-log.test.ts` (32 testes):

* lógica de nova tentativa com relógio simulado (início a frio que responde na 3ª tentativa, esgotamento, orçamento,
  erros que não devem ser repetidos);
* o driver `pg` real contra um servidor TCP **local** que não responde (simula o Neon suspenso) e contra um que derruba a
  conexão: o tempo limite é respeitado, o erro é classificado como de conexão e há exatamente 3 tentativas;
* verificação no código-fonte de que só as leituras idempotentes usam a nova tentativa.

Limite: nenhum desses testes prova o comportamento do Neon real. A validação em ambiente de teste (homologação isolada)
é um passo posterior e exige autorização.
