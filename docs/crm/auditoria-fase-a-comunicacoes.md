# Auditoria técnica Fase A — CRM Cassiellos (18/11/2026)

Branch `feat/comms-resend-whatsapp-20261118`; PR #57. **NÃO ATIVAR RESEND/WHATSAPP CLOUD.**

## A1 — Quotas (BLOQUEADOR)
- `send.ts/checkCaps` consulta `sent_at` da aceitação, não reserva capacidade para a data futura de envio (`scheduled_for`).
- `store.ts/claimForSend` mantém `status=pending`; duas execuções concorrentes podem reservar o mesmo e-mail. A verificação de quota não é transacional entre mensagens distintas.
- A Resend contabiliza uso em nível de conta; outros envios e recebimentos não entram na contagem local. Confirmar semântica de agendamentos e conciliar com `GET /usage` (API oficial de 01/10/2026).
- A chave idempotente da Resend vence em 24 horas: retentativas incertas após esse prazo não garantem deduplicação.
**Necessário:** reserva transacional de quota diária/mensal (aceitação e janela agendada), estado `sending` atômico e testes concorrentes com PostgreSQL isolado.

## A2 — Cancelamentos (BLOQUEADOR)
- `cancelPending()` marca `cancelled` local antes de garantir cancelamento remoto; falha da Resend é ignorada em `cancelMeetingEmails()`.
- A rota administrativa só executa cancelamento se `readEmailConfig().ready`; desligar a flag pode deixar lembretes já agendados.
- `cancelEmail()` interpreta 404 como sucesso, mas 404 não comprova ausência de envio.
**Necessário:** estado durável `cancel_requested`, confirmação por mensagem do provedor, reprocessamento e tratamento de canal desligado. Não reutilizar estado `cancelled` no reenvio.

## A3 — Atrasos (CORRIGIDO PARCIALMENTE)
- Lembrete vencido há mais de cinco minutos não sai como envio tardio (`REMINDER_EXPIRED`).
- Confirmação não sai depois do início da reunião.
- Reenvio administrativo não ressuscita e-mail cancelado, nem antecipa horário de lembretes.
- Persistem riscos de retries/cancelamentos e quota, bloqueando ativação.

## A4 — Respostas por e-mail (CORRIGIDO)
- Removida promessa de `responder a este e-mail` porque não existe confirmação de inbox monitorada.
- Para permitir respostas futuramente, validar recebimento ou configurar `Reply-To` e caixa real.

## A5 — WhatsApp (MODO A PRESERVADO; MODO B BLOQUEADO)
- Botão manual usa `wa.me`, sem Cloud API.
- Modo B exige credenciais/assinatura, referência e conferência do remetente, mas está desativado.
- No webhook Meta, exceção retorna 200 e pode confirmar evento não processado; exigir tratamento de falha e deduplicação por `wamid` antes de ativar.
- Coexistência, versão Graph e comparação de números brasileiros precisam validação adicional.

## Testes
- 89 testes de duas suítes `comms.test.ts` e `orchestration.test.ts` passaram localmente com stubs dos utilitários preexistentes. **Não equivale ao conjunto completo de 867 testes do projeto nem a teste com banco real.**
- Nenhuma mensagem real, migração, alteração DNS ou ação no WhatsApp. Produção não foi modificada.

## Fontes externas
- https://resend.com/pricing
- https://resend.com/changelog/account-usage-api
- https://resend.com/changelog/idempotency-keys

## Reserva de quota e concorrência (correção A1, pendente de integração DB)

- `claimForSend()` exige transação de `pg.Pool.connect()`, usa advisory lock global do canal, consulta `claimed_at` (data de submissão) e `scheduled_for` (data alvo futura), e muda `pending` para `sending` antes de chamar a Resend.
- Os limiares de lembretes reservam 20% da capacidade diária e 10% da mensal para confirmações; datas futuras são contabilizadas conservadoramente.
- `claimed_at` foi acrescentado à migration 0021, ainda não aplicada. Não executar contra produção nesta etapa.
- **Restrições:** contadores internos não incluem outras keys nem e-mails recebidos; deve-se comparar com `GET /usage` da Resend antes de ativar envios. Teste de concorrência real com PostgreSQL isolado ainda é obrigatório.
- `sending` abandonado por morte da função não é reenviado automaticamente; requer reconciliação, pois a idempotência do provedor expira em 24h.

## Revisão de estados desconhecidos
- HTTP 408, 5xx e timeouts de envio são tratados como resultado incerto: `needs_review`, sem retry automático.
- Varredura coloca em `needs_review` operações `sending` abandonadas há mais de 20 minutos e cancelamentos sem id remoto após 20 minutos. Nenhum novo e-mail é enviado nessa reconciliação.
- Continuidade do sweep depende de agendador externo autorizado. Sem ele, o processamento assíncrono inicial continua protegido, mas a reconciliação não acontece automaticamente.
