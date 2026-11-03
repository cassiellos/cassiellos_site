# Meta Conversions API — Schedule pelo servidor

**Preparado em:** 03/11/2026 (issue #26)
**Branch:** `feature/mini-crm-shark-scale` (somente Preview)
**Status:** implementado e testado com a Meta simulada. **DESLIGADO** até o token existir na Vercel e haver aprovação para ligar.

## O que faz

Quando `/api/booking/confirm` cria uma reunião nova (HTTP 201) para um lead real, ou para um lead de teste com a reserva de homologação do Schedule, o servidor envia **um** evento `Schedule` para a Meta:

- usa o **mesmo `event_name` e o mesmo `event_id`** do Pixel (`chronos_scheduled_<bookingId>`), para a Meta deduplicar navegador + servidor;
- o envio acontece **depois** da resposta ao visitante (`after()`); se a Meta falhar, ficar lenta ou fora do ar, a reunião no Google Calendar continua confirmada;
- a idempotência vem de `crm.meta_deliveries` (UNIQUE por `tracking_event_id`, `INSERT … ON CONFLICT DO NOTHING`): repetições e chamadas simultâneas não geram um segundo envio.

Código: `lib/crm/meta-capi.ts` (decisão, envio, fila); `lib/crm/meta-events.ts` (montagem do evento); `app/api/booking/confirm/route.ts` (ligação).

## Travas, conferidas no momento do envio e antes de cada nova tentativa

| Trava | Regra |
| --- | --- |
| Modo | Só `META_CAPI_MODE=test` ou `live`. Qualquer outro valor, ou variável ausente, deixa desligado |
| Credenciais | `META_PIXEL_ID` válido e `META_CAPI_ACCESS_TOKEN` presente; sem eles fica desligado |
| Lead real | `tracking_events.metadata.isTest === false` **e** `crm.leads.is_test === false` (somente no modo `live`) |
| Homologação | Lead de teste + reserva `meta_homologation_event` do Schedule + `META_CAPI_TEST_EVENT_CODE`. O envio **sempre** leva `test_event_code` e `cassiellos_teste=homologacao` |
| Reunião | `crm.appointments.status = 'confirmed'`: reunião cancelada, pendente ou remarcada não envia |
| Consentimento | `readMarketingConsentState` vigente. Ausente ou revogado não envia, e a revogação entre tentativas interrompe o reenvio |
| Janela | Evento com até 7 dias, como exige a Meta |

## Dados enviados à Meta

- `event_name=Schedule`, `event_time`, `event_id`, `action_source=website` e `event_source_url` (`https://crm.cassiellos.com.br/agendar/<slug>`).
- `custom_data.content_name` = slug do formulário.
- `user_data` contém **somente**:
  - `client_user_agent`, que a Meta exige em eventos de site;
  - `client_ip_address`, quando válido.

  Os dois vêm da própria requisição de confirmação, ficam **só em memória** e **não são gravados**.
- **Não enviados:** e-mail, telefone, nome, respostas, `fbp`, `fbc`, `fbclid` e `external_id`. As decisões C2 e G2 continuam como estavam.

A cópia gravada em `meta_deliveries.payload` não tem IP, user agent nem token. Ela guarda a rota, a versão, o evento sem `user_data`, a lista dos campos de correspondência usados e, da resposta, só `fbtrace_id` e `events_received`.

## Respostas e tentativas

| Resposta | Ação |
| --- | --- |
| 2xx com `events_received = 1` | `accepted` |
| 2xx sem `events_received = 1` | `rejected` (`no_events_received`) |
| 429, 5xx, timeout (8 s), erro de rede, erro Graph transitório | `retry`; até 3 tentativas na mesma execução (esperas de 2 s e 6 s), depois `abandoned` |
| Outros 4xx | `rejected`, com código e subcódigo Graph sanitizados (`http_400:100/2804003`) |

Não há reprocessamento posterior por rotina agendada. Reenviar mais tarde exigiria gravar user agent e IP, o que seria uma **nova decisão de dados**, com aprovação própria.

Os logs (`console.info`) trazem só `{scope, event, outcome, route, httpStatus, attempts, delivery}`. Nunca levam token, IP, user agent, e-mail ou telefone.

## Variáveis (Vercel, Preview, branch `feature/mini-crm-shark-scale`)

| Variável | Valor | Observação |
| --- | --- | --- |
| `META_CAPI_ACCESS_TOKEN` | gerado pelo titular no Gerenciador de Eventos | **Sensitive**. Nunca no chat, em arquivo ou no terminal |
| `META_CAPI_MODE` | `test`, para a homologação com `test_event_code` | `live` somente após aprovação comercial |
| `META_CAPI_TEST_EVENT_CODE` | código da aba "Testar eventos" (ex.: `TEST93849`) | usado apenas na rota de homologação |
| `META_GRAPH_API_VERSION` | opcional, padrão `v26.0` | formato `vNN.0` |

## Teste real (com `test_event_code`)

1. Titular: Gerenciador de Eventos → dataset **28992534033707610** → **Configurações** → **API de Conversões** → **Gerar token de acesso**. Cadastrar o token direto na Vercel como `META_CAPI_ACCESS_TOKEN` (Sensitive, Preview, branch).
2. Definir `META_CAPI_MODE=test` e `META_CAPI_TEST_EVENT_CODE`, e fazer o redeploy do Preview.
3. Liberar a homologação **Lead/Schedule** (`META_HOMOLOGATION_ENABLED=true` + painel), com uma reunião de teste autorizada.
4. Em "Testar eventos", conferir **Programar** recebido pelo **Servidor** com o mesmo `event_id`, e também pelo **Navegador**, deduplicado.
5. Desligar: `META_CAPI_MODE` removido ou `off`, `META_HOMOLOGATION_ENABLED=false`, redeploy. Cancelar a reunião de teste.

## Rollback

Remover `META_CAPI_MODE` (ou usar qualquer valor diferente de `test`/`live`) e fazer o redeploy. O Pixel, o Lead, o Schedule do navegador e os agendamentos seguem sem mudança.
