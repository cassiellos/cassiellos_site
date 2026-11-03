# Abertura comercial do Mini CRM — ativação e rollback

**Preparado em:** 03/11/2026
**Branch:** `feature/mini-crm-shark-scale`
**Ambiente:** somente o Preview da branch, em crm.cassiellos.com.br. A `main` e a produção não são alteradas.

A homologação está concluída:
- Pixel: Lead e os 4 eventos Chronos;
- Schedule pelo navegador e pelo servidor, com o mesmo `event_id`.

A desduplicação ainda estava "em análise" na Meta em 03/11.

## Pré-requisitos (nesta ordem)

1. **Textos do formulário (odontologia-v4).** Publicados com o commit `feat(booking): definitive public copy…`.
2. **Política de Privacidade v4.** O commit `docs(legal): privacy v4 draft…` só pode ir ao ar depois da aprovação do titular:
   - na publicação, `LEGAL_POLICY_VERSION` precisa ser a data efetiva;
   - a v3 diz que a API de Conversões "não está ativa", então `META_CAPI_MODE=live` exige a v4 publicada.
3. **Lista de e-mails internos.** O titular informa os e-mails usados em testes da equipe, que vão para `CRM_TEST_EMAILS`. O e-mail de `CRM_BOOKING_ALLOWED_EMAIL` já é sempre teste.

## Variáveis (Vercel → agencia-cassiellos → Preview, branch `feature/mini-crm-shark-scale`)

| Variável | Valor | Efeito | Observação |
| --- | --- | --- | --- |
| `CRM_TEST_EMAILS` | e-mails internos, separados por vírgula | Esses e-mails continuam classificados como teste | Criar como **Encrypted** |
| `CRM_BOOKING_MODE` | `live` | Lead novo passa a ser real, exceto lista de teste, e-mail da allowlist e domínios de teste. O funil conta como real | Leads existentes **não** mudam de classificação |
| `META_CHRONOS_LIVE_ENABLED` | `true` | Libera os 4 eventos Chronos para visitantes reais | Só com Pixel ativo, formulário em modo live e consentimento de marketing a cada evento; sem `cassiellos_teste` |
| `META_CAPI_MODE` | `live` | Envia o Schedule pelo servidor para lead real | Proteções descritas abaixo; a variável já existe com `off` e basta editar |

**Não alterar:**
- `META_HOMOLOGATION_ENABLED=false`;
- `META_PIXEL_ENABLED` e `META_PIXEL_ID`;
- `META_CAPI_ACCESS_TOKEN` (Sensitive);
- `CRM_BOOKING_RESTRICT_TO_ALLOWED_EMAIL`, que deve continuar ausente. Se ficar `true`, o funil volta para teste.

Proteções do envio pelo servidor (`META_CAPI_MODE=live`). O evento só sai quando:
- o lead é real nas duas marcas (`tracking_events.metadata.isTest === false` e `crm.leads.is_test === false`);
- a reunião ainda está `confirmed`;
- o consentimento de marketing está vigente;
- o evento tem até 7 dias.

Outros comportamentos:
- não leva `test_event_code`;
- cada reunião gera um único envio (`crm.meta_deliveries`);
- os dados enviados são só IP e user agent, usados em memória e não gravados.

## Ativação (uma execução)

1. Confirmar que o deploy com os pré-requisitos 1 e 2 está **READY** e que o domínio crm.cassiellos.com.br aponta para ele.
2. Criar `CRM_TEST_EMAILS`.
3. Criar `CRM_BOOKING_MODE=live` e `META_CHRONOS_LIVE_ENABLED=true`, e editar `META_CAPI_MODE` para `live`.
4. Fazer **um** redeploy da Preview da branch e confirmar **READY** com o alias crm.cassiellos.com.br.
5. Verificar sem criar reunião:
   - `/agendar/odontologia` mostra os textos v4;
   - o aviso de cookies mostra o texto novo de marketing;
   - a Política de Privacidade mostra a data da v4.
6. No primeiro agendamento real (sem teste forçado), conferir:
   - nos logs da Vercel: `{"scope":"meta_capi","outcome":"accepted","route":"live"}`;
   - no Gerenciador de Eventos: Programar pelo navegador e pelo servidor com o mesmo `event_id`;
   - no CRM: o lead **sem** a marca TESTE.
7. Entre 24 e 48 horas depois, abrir Programar → Desduplicação de evento e registrar o resultado.

## Rollback

Desfazer a ação toda:
1. Editar `META_CAPI_MODE` para `off`.
2. Remover `META_CHRONOS_LIVE_ENABLED`, ou definir `false`.
3. Remover `CRM_BOOKING_MODE`.
4. Fazer um redeploy e confirmar READY.

Rollback parcial:
- **Só a CAPI:** `META_CAPI_MODE=off` e redeploy. O Pixel continua.
- **Só o Chronos:** remover `META_CHRONOS_LIVE_ENABLED` e redeploy.

Leads criados no modo live continuam reais depois do rollback, como esperado. Envios já feitos à Meta não são desfeitos.

## Fora deste procedimento

- **Campanhas, orçamento e publicação no Meta Ads:** precisam de autorização própria. A seleção do Schedule como evento de otimização só pode ser verificada num rascunho de campanha novo, porque o único rascunho existente na conta é a edição de criativo "GOOGLE ADS - SEM PREÇO", com erros, e não deve ser reutilizado.
- **Reclassificar leads históricos**, como Francine e Fran: tratar separadamente.
- **Medição no dispositivo do cliente**, que a Meta ativa por padrão em 12/11/2026: decisão do titular.
