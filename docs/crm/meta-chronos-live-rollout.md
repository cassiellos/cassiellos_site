# Plano de liberação comercial — eventos personalizados Chronos
**Preparado em:** 03/11/2026  
**Repositório:** `cassiellos/cassiellos_site`  
**Branch de desenvolvimento:** `feature/mini-crm-shark-scale`  
**Status:** IMPLEMENTADO EM CÓDIGO, **DESLIGADO** até aprovação separada.

## Eventos e finalidade
| Nome enviado à Meta | Momento de envio | Tipo |
| --- | --- | --- |
| `ChronosView` | Formulário público visível com consentimento de marketing | `trackCustom` |
| `ChronosFirstInteraction` | Primeira interação textual ou seleção que permita disparar com consentimento | `trackCustom` |
| `ChronosSubmit` | Backend aceita o cadastro e devolve token de reserva (não é confirmação da reunião) | `trackCustom` |
| `Chronos_View_Scheduled` | Etapa de calendário/agendamento visível com consentimento | `trackCustom` |

**Conversões existentes preservadas:** `Lead` só com evento servidor para lead novo e real; `Chronos_Scheduled` é o nome interno convertido para **`Schedule`** exclusivamente após a confirmação efetiva do agendamento. Nunca enviar `Chronos_Scheduled` como segundo evento.

## Travas implementadas
A liberação comercial exige, simultaneamente:
1. `META_PIXEL_ENABLED=true` e `META_PIXEL_ID` válido;
2. `META_CHRONOS_LIVE_ENABLED=true` **exatamente** — variável ausente ou qualquer outro valor é OFF;
3. formulário em **modo live** (nunca modo de teste, allowlist de testes ou página bloqueada);
4. não existir homologação ativa no navegador (`scope=chronos` usa apenas o modo de teste, e `scope=conversions` não envia os quatro Chronos);
5. **consentimento de marketing vigente** no momento de *cada* evento; consentimento de métricas não substitui marketing;
6. armazenamento de sessão disponível para deduplicação por `event_id` estável por tipo de evento e sessão. Se não for possível guardar a chave, falha fechada.

Se o visitante recusar ou revogar marketing, nenhum novo evento personalizado sai e o Pixel segue o fluxo atual de revogação e limpeza de cookies.

## Dados enviados
Somente o **nome do evento**, **`event_id` técnico aleatório por sessão/tipo**, e o slug sanitizado do formulário (`content_name`). Em homologação, acrescenta `cassiellos_teste=homologacao`. Em modo real, **não** coloca esta marca.

Não enviar nome, telefone, e-mail, receita, respostas do formulário, `fbclid`, `_fbp` ou `_fbc` como parâmetros personalizados. O Pixel da Meta pode empregar seus cookies próprios depois do consentimento; a CAPI permanece desativada.

## Plano de aprovação e virada de chave — NÃO executar automaticamente
1. Com a flag **ausente/desligada**, executar `node --import tsx --test lib/marketing/meta.test.ts lib/marketing/meta-client.test.ts`, `npx tsc --noEmit` e `npm run build`. Verificar suíte completa e não corrigir problemas preexistentes de push fora do escopo.
2. Publicar **somente Preview** na branch autorizada e confirmar `READY`. Com a flag desligada, testes de navegação devem resultar em **zero** eventos novos de visitantes.
3. Antes do go-live, confirmar consentimento, regras de proteção de dados e que o modo de captação realmente é live; validar a UX no celular e testar os quatro eventos em ambiente controlado com a flag de liberação específica.
4. **Pedir autorização expressa separada** ao titular para criar `META_CHRONOS_LIVE_ENABLED=true` no ambiente desejado e executar novo deploy. Não reutilizar `META_HOMOLOGATION_ENABLED` para visitantes reais.
5. No lançamento, verificar no Gerenciador de Eventos nomes, volumes, `event_id`, consistência do opt-in, recusas e ausência de duplicidade. `Schedule` permanece evento principal de otimização; não configurar os quatro estágios como quatro conversões de reunião.
6. Rollback: definir `META_CHRONOS_LIVE_ENABLED=false` (ou remover a variável) no ambiente de liberação e redeploy. Confirmar que os eventos personalizados param sem interromper `Lead` e `Schedule`.

**Importante:** validação anterior em homologação não implica ativação comercial, nem comprova métricas de campanha em tempo real. A ativação de visitantes reais continua pendente.
