# Fase 4 — Ajuste final da disponibilidade (local)

Branch local `local/availability-v2-prep`, criada a partir de `c366dc3` (versão publicada no Preview).
**Sem push, deploy ou migração.** A migração 0009 está preparada e não foi executada no Neon.
Não inclui o agendamento sem convite, a privacidade nem o Meta Pixel.

## 1. Regras

| Regra | Valor | Onde |
|---|---|---|
| Antecedência mínima | 2 h, arredondada para o próximo slot de 30 min | `DEFAULT_BOOKING_POLICY.minimumNoticeMinutes` |
| Primeiro início | 09h00 | `DEFAULT_BOOKING_POLICY.openMinute` |
| Último início | 18h00, com término às 18h30 (início às 18h30 é recusado) | `lastStartMinute`; no banco, `close_minute` = 1110 |
| Janela | 3 dias corridos (sem mudança) | `maximumDaysAhead` |
| Capacidade diária | **Criada desligada (D1).** Quando ativada pelo painel: 3 a 4 horários por dia útil para atividades internas, com almoço 12h00–13h30 priorizado | `lib/crm/availability/capacity.ts` |

Exemplos aprovados (testados): 13h00 → 15h00; 15h00 → 17h00. Também: 09h10 → 11h30; 16h00 → só 18h00; 16h01 → nenhum.

## 2. Capacidade diária (bloqueios operacionais variáveis)

**Estado inicial (decisão D1): DESLIGADA.** Depois da 0009, nenhum horário é reservado até o administrador marcar "Reservas automáticas ativas" e salvar. Enquanto estiver desligada, o painel mostra uma prévia tracejada do que seria reservado em cada dia, sem aplicar nada.

**Como os horários são escolhidos**

- Em cada dia útil, o sistema escolhe de 3 a 4 horários para atividades internas.
- Um ou dois desses horários, seguidos, ficam dentro do almoço (12h00–13h30).
- Os demais se espalham pela manhã e pela tarde, sem horários vizinhos quando possível.
- Nunca é reservado mais de 1/3 do dia.

**Por que a escolha não muda a cada visita**

- A escolha é **determinística**: depende só da data, da configuração e de uma semente.
- Ela não depende do horário da consulta, do visitante, do Google nem das reservas.
- Por isso, todos os visitantes veem a mesma disponibilidade, e nada muda a cada visita.
- Uma reunião marcada em outro horário também não desloca as reservas internas.

**Por que os horários não se repetem**

- Um dia útil nunca repete exatamente os horários do dia útil anterior, inclusive de sexta para segunda.
- Isso foi testado em cerca de 3 anos de dias úteis: nenhum horário fora do almoço aparece em mais de 30% dos dias.

**O que o visitante vê**

- O horário reservado simplesmente não é oferecido.
- Não há texto sobre reunião, atividade interna ou motivo.
- Uma chamada direta à API recebe `409 SLOT_UNAVAILABLE`, com a mesma mensagem genérica de horário indisponível.

**Reuniões confirmadas**

- Nenhuma reunião, evento no Google ou registro falso é criado.
- Reuniões confirmadas nunca são alteradas.
- Se uma reserva interna coincidir com uma reunião já existente, a reunião é mantida e o painel apenas sinaliza.

**Interação com outras regras**

- Feriados, exceções, reservas e a ocupação do Google continuam valendo.
- Uma exceção que cubra o horário inteiro prevalece sobre a reserva interna, como acontece com os bloqueios.

**Painel (seção "Capacidade diária · atividades internas")**

- **Configuração geral:** ligar ou desligar, mínimo e máximo por dia, janela de almoço e "Redistribuir horários". Redistribuir troca a semente e desfaz as liberações feitas sobre a distribuição anterior.
- **Ajustes por data, nos próximos 10 dias úteis:**
  - liberar uma reserva;
  - reservar um horário manualmente, com motivo interno;
  - desligar as reservas automáticas do dia.
- Todo ajuste pode ser desfeito. Desfazer revoga o registro e mantém o histórico.
- Dias de feriado de dia inteiro aparecem como fechados e não têm botões.
- **Reservas manuais:** continuam valendo mesmo com a capacidade desligada, até serem removidas.

## 3. Migração 0009 (preparada, NÃO aplicada)

Arquivo: `db/migrations/0009_availability_capacity.sql`. Transação única, reexecutável e dependente da 0008.

| Parte | Efeito |
|---|---|
| `availability_settings` | Os padrões passam a 120 min e término 1110. A linha atual só muda onde ainda estiver no padrão anterior (180 / 1080), marcada com `updated_by = 'migration:0009'`. Valores personalizados são mantidos |
| `availability_capacity` (nova) | Linha única: **desligada** (`enabled = false`), 3–4, almoço 720–810, semente 1 |
| `availability_capacity_overrides` (nova) | Ajustes por data (`release`, `hold`, `day_off`), revogáveis, com um ajuste ativo por data, ação e horário |

### Auditoria em banco descartável (PostgreSQL 16, histórico simulado)

| Verificação | Resultado |
|---|---|
| Histórico | Assinaturas de leads, reuniões e reservas idênticas antes e depois |
| Reexecução | Aplicada duas vezes sem erro, sem nova alteração |
| Falha no meio | Erro forçado antes do COMMIT: nada muda (configuração 180 / 1080, nenhuma tabela nova) |
| Desfazer | `db/ops/0009_rollback.sql` remove só as 2 tabelas novas e volta a 180 / 1080 se a linha ainda estiver como a 0009 deixou. Histórico intacto; reaplicação ok |
| Valores personalizados | Antecedência de 240 min e término 1140 salvos pelo painel são mantidos ao reaplicar a 0009 |
| Restrições | Valores inválidos e ajuste duplicado recusados por SQL direto |
| Conferência | `db/ops/0009_pre_post_checks.sql` (somente leitura) |

### Compatibilidade de publicação

| Código × banco | Resultado |
|---|---|
| Publicado (`c366dc3`) × 0008 | Situação atual: 3 h, último início 17h30 |
| Publicado (`c366dc3`) × 0008 + 0009 | Funciona: 2 h, último início 18h00, sem capacidade (o código antigo ignora as tabelas novas) |
| Novo × só 0008 | Funciona: 3 h, último início 17h30 (valores do banco), capacidade desligada |
| Novo × 0008 + 0009 | Regras novas: 2 h e último início 18h00; capacidade desligada até ser ativada pelo painel |

As duas ordens são seguras. Ordem sugerida: publicar o código e depois aplicar a 0009.

**Importante:** como o Neon Preview guarda 180 / 1080, as regras novas **só passam a valer depois da 0009** (ou de um ajuste salvo no painel). O deploy sozinho não muda a antecedência nem o último início.

## 4. Riscos e pendências

- **Ativação da capacidade.** A capacidade começa desligada (D1). Ao ativá-la pelo painel, 3 a 4 horários por dia útil deixam de ser oferecidos imediatamente, inclusive nos dias já visíveis ao público.
- **Redistribuir** muda as reservas também nos dias já visíveis ao público. É uma ação administrativa explícita e pede confirmação.
- **Reunião anterior à capacidade.** Uma reserva interna que coincida com uma reunião criada antes da capacidade não reserva tempo real naquele horário. O painel sinaliza esse caso.
- **Testes de navegador** usaram o handler real contra banco descartável, sem Neon e sem Google. O comportamento com o Google será conferido após a publicação.
- **Testes antigos que não se repetem.** Alguns testes de banco anteriores (lead-intake e o teste de 2031-03-05) usam datas e e-mails fixos e só passam em banco descartável novo. Os testes novos podem ser repetidos no mesmo banco.
