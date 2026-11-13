# Central de Inteligência — limites da fundação simulada (N2) e requisitos da integração real

Status: fundação com **dados simulados**. Nenhuma conta real, nenhuma credencial, nenhum banco, nenhum agendamento.

## N2 — O controle de atualização manual é demonstrativo, por instância e NÃO é controle de segurança

O que existe hoje (`lib/crm/intel/admin-request.ts`, `lib/crm/intel/sync/engine.ts`, `lib/crm/intel/demo/snapshot.ts`):

- intervalo mínimo de **15 minutos por conta** (`MANUAL_MIN_INTERVAL_MS`), registrado no `manualAt` do snapshot em memória;
- teto global de **20 atualizações por minuto** por processo (`manualWindow`);
- deduplicação/lease de sincronização do armazenamento em memória (`sync/store.ts`).

Limitações — todas intencionais nesta fase e informadas na interface (aviso de armazenamento da área Conexões):

1. Todo esse estado vive na **memória de cada instância serverless**. Outra instância, um novo deploy ou um reinício começam do zero.
2. Duas instâncias **não compartilham** contadores: o limite efetivo cresce com o número de instâncias e pode ser contornado repetindo o pedido até cair em outra instância.
3. Portanto **não é** um controle de segurança, de custo ou de cota. Serve somente para demonstrar o comportamento da interface (mensagens de "muito cedo", recarga única dos dados).
4. A proteção real da rota continua sendo: ambiente do CRM + flag exclusiva `MI_ENABLED=true` + sessão administrativa válida + origem do próprio CRM nas ações (POST) + corpo pequeno e JSON + validação de ativo/cliente/vínculo confirmado.

## Requisito OBRIGATÓRIO da futura integração real (não implementado nesta fase)

Antes de qualquer conexão real com Google/Meta, a atualização manual e as sincronizações exigem:

- **deduplicação persistente e compartilhada** entre instâncias (uma sincronização por ativo por vez — lease com validade, em armazenamento comum);
- **limite de taxa persistente e distribuído** (por conta, por cliente e global), com contagem em armazenamento comum e resposta `429` coerente com a interface;
- registro de cada tentativa (quem, quando, resultado) fora da memória;
- testes que provem o comportamento com **duas instâncias simultâneas**.

Escolha da tecnologia (ex.: banco, cache distribuído) e criação de tabelas/serviços: decisão de fase própria, com autorização do titular. Fora do escopo da Missão 09: Redis, tabelas, Neon, agendamento e persistência.
