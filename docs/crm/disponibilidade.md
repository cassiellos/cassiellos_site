# Disponibilidade, feriados e bloqueios de agenda

Status: **implementado localmente** (branch `local/availability-prep`, base `dae52f7`). Nada foi publicado.
Migração `0008_availability.sql` **preparada e não aplicada** em nenhum banco Neon.

## 1. Auditoria da lógica anterior (base `dae52f7`)

| Item | Como funcionava | Onde |
|---|---|---|
| Dias de atendimento | seg–sex fixo no código | `lib/crm/booking-slots.ts` (`DEFAULT_BOOKING_POLICY.workingDays`) |
| Horário | 09:00–18:00, último início 17:30 | `openHour` 9, `closeHour` 18 |
| Duração | 30 min (grade fixa) | `slotMinutes` 30 |
| Antecedência | 12 h | `minimumNoticeMinutes` 720 |
| Janela | hoje + 30 dias | `maximumDaysAhead` 30 |
| Fuso | America/Sao_Paulo, deslocamento fixo −03:00 | `booking-slots.ts` |
| Reservas internas | `crm.booking_requests` em `processing`/`confirmed` entram como ocupação; índice único `uq_crm_booking_active_slot` | `app/api/booking/availability`, migração 0005 |
| Conflitos Google | freebusy antes de reservar e de novo antes de criar o evento | `lib/crm/booking-confirmation.ts` |
| Remarcação / limites | 1 reunião ativa por caixa canônica até o término; até 3 agendamentos em 30 dias; allowlist exata em Preview | `lib/crm/booking-reservation.ts` |
| Feriados | **inexistentes** — 02/11 (Finados) era oferecido | — |
| Bloqueios/exceções | **inexistentes** | — |
| Navegador | repetia a regra seg–sex + 30 dias por conta própria | `app/agendar/[slug]/booking-experience.tsx` |
| Painel | rota de leitura marcada como `provisionalPolicy` | `app/api/crm/calendar/availability` |

## 2. Fontes oficiais conferidas (30/10/2026)

- **Portaria MGI nº 11.460/2025** (DOU 30/12/2025): feriados nacionais e pontos facultativos federais de 2026.
- **Portaria Conjunta TJMG nº 1.798/PR/2026**: calendário 2026 em BH. Cita a **Lei municipal 11.397/2022**
  (Paixão, Corpus Christi, 15/08 e 08/12) e o **art. 256 da Constituição de MG** (21/04, Data Magna).
- Leis federais 662/1949, 6.802/1980 (12/10), 9.093/1995 (feriados religiosos municipais) e 14.759/2023 (20/11).
- **Não confirmado:** a alteração "Portaria MGI 8.821/2026" não apareceu nas fontes lidas.
- **2027:** a portaria do MGI ainda não foi publicada. As datas móveis vêm do cálculo da Páscoa (28/03/2027)
  e devem ser conferidas quando a portaria sair.

### Calendário 2026 (efeito padrão na agenda)

| Data | Data comemorativa | Natureza | Efeito |
|---|---|---|---|
| 01/01 | Confraternização Universal | feriado nacional | dia inteiro |
| 16/02 e 17/02 | Carnaval | ponto facultativo federal + política comercial | dia inteiro |
| 18/02 | Quarta-feira de Cinzas | ponto facultativo até 14h + política comercial | até 14:00 |
| 03/04 | Paixão de Cristo | feriado nacional e municipal | dia inteiro |
| 21/04 | Tiradentes / Data Magna MG | feriado nacional e estadual | dia inteiro |
| 01/05 | Dia do Trabalho | feriado nacional | dia inteiro |
| 04/06 | Corpus Christi | feriado municipal (BH) + ponto facultativo federal + política | dia inteiro |
| 15/08 | Assunção de Nossa Senhora | feriado municipal (BH) | dia inteiro |
| 07/09 | Independência | feriado nacional | dia inteiro |
| 12/10 | Nossa Senhora Aparecida | feriado nacional | dia inteiro |
| 28/10 | Dia do Servidor Público | ponto facultativo federal | **sem bloqueio** |
| 30/10 | Dia do Funcionário Público (MG) | expediente estadual | **sem bloqueio** |
| 02/11 | Finados | feriado nacional | dia inteiro |
| 15/11 | Proclamação da República | feriado nacional | dia inteiro |
| 20/11 | Consciência Negra | feriado nacional | dia inteiro |
| 08/12 | Imaculada Conceição | feriado municipal (BH) | dia inteiro |
| 24/12 | Véspera de Natal | ponto facultativo após 13h + política | a partir de 13:00 |
| 25/12 | Natal | feriado nacional | dia inteiro |
| 31/12 | Véspera de Ano-Novo | ponto facultativo após 13h + política | a partir de 13:00 |

Sem bloqueio automático: pontos facultativos sem política comercial (ex.: 20/04 e 05/06/2026) e pontes.

### Calendário 2027 (previsão; fixos iguais a 2026)

Datas móveis: Carnaval 08/02 e 09/02, Cinzas 10/02 (até 14h), Paixão 26/03, Corpus Christi 27/05.

## 3. Arquitetura

```
holidays.ts  catálogo (lei/fonte, natureza, bloqueio padrão) + Páscoa → datas do ano
engine.ts    regras puras: grade → exceções → feriados/bloqueios → janela/antecedência → ocupação
store.ts     leitura/gravação das tabelas 0008 (fallback para o padrão do código se a 0008 não existir)
admin.ts     visão do painel + ações (confirmação obrigatória, autor registrado)
```

Ordem de decisão de cada horário:

1. dentro da janela (hoje … hoje + N dias) e da antecedência mínima;
2. na grade comercial **ou** dentro de uma exceção autorizada;
3. feriado/política/bloqueio removem o horário, a menos que ele esteja **inteiramente** dentro de uma exceção;
4. ocupação real (Google + reservas internas) **sempre** remove. Exceção nunca libera ocupação, antecedência ou janela.

A mesma função (`listAvailableSlots`) é usada para listar horários e para validar a confirmação.
Uma chamada direta à API com um horário fechado recebe `409 SLOT_UNAVAILABLE` **antes** de qualquer consulta
ao banco de reservas ou ao Google. Fora da janela: `400 INVALID_SLOT`.
Se a leitura das regras falhar por qualquer motivo que não seja "tabela inexistente", nenhum horário é oferecido
(503), ou seja, a falha é fechada.

Mudança de comportamento: sábado ou horário fora do expediente passou de `400 INVALID_SLOT` para
`409 SLOT_UNAVAILABLE` (o visitante vê "Esse horário acabou de ficar indisponível").

### Rotas

| Rota | Acesso | Função |
|---|---|---|
| `GET /api/booking/availability` | sessão de agendamento | horários do dia; dia fechado → `closed: true`, sem chamar o Google |
| `GET /api/booking/calendar` | sessão de agendamento | apenas as datas fechadas da janela (sem motivos, sem Google) |
| `POST /api/booking/confirm` | sessão de agendamento | valida pelas regras antes de reservar |
| `GET/POST /api/crm/availability` | admin, só Preview, origem verificada, `confirmed: true` | painel DISPONIBILIDADE |
| `GET /api/crm/calendar/availability` | admin | leitura do painel com as regras |

### Painel DISPONIBILIDADE (menu lateral do CRM)

- horário comercial: dias, início/término (06:00–22:00), antecedência (0–168 h), janela (1–90 dias);
- bloqueios de dia inteiro, de período do dia ou de intervalo de datas (férias, recesso, outro), até 366 dias;
- exceções de um único dia com horário;
- feriados e políticas de 2026/2027: natureza, fonte e efeito, com ajuste por ano ou para todos os anos;
- dias sem horários na janela pública, com o motivo de cada um.

Toda alteração pede confirmação. Bloqueios e exceções são **revogados**, nunca apagados.
Um bloqueio sobre reunião existente **não altera nem cancela** a reunião: apenas informa quantas existem.
Sem a migração 0008, o painel mostra "MIGRAÇÃO PENDENTE" e desativa as alterações.
A agenda continua funcionando com o padrão do código, já com feriados e políticas.

## 4. Migração 0008 (preparada, NÃO aplicada)

Ela só cria estruturas novas (`IF NOT EXISTS`), não apaga nem altera nada e pode ser executada mais de uma vez.

| Tabela | Conteúdo | Restrições principais |
|---|---|---|
| `crm.availability_settings` | linha única (id = 1): dias, início, término, slot, antecedência, janela | 06:00 ≤ início, término ≤ 22:00, múltiplos de 30, slot = 30, antecedência ≤ 10080 min, janela 1–90 |
| `crm.availability_blocks` | início/fim, categoria, motivo, autor, revogação | fim > início, ≤ 367 dias, categoria válida, motivo ≤ 200 |
| `crm.availability_exceptions` | início/fim, motivo, autor, revogação | ≤ 1 dia |
| `crm.holiday_rules` | ajuste por regra (ano específico ou NULL = todos) | tipo none/full/until/after, minuto obrigatório e múltiplo de 30 para until/after; único por (regra, ano) |

Aplicação (somente com autorização D4, somente no Neon **Preview**): executar o arquivo inteiro uma única vez.
Reversão: as tabelas são independentes. Basta parar de usá-las (ou removê-las com autorização). Nenhum dado existente é afetado.

## 5. Testes

- Unitários: Páscoa 2024–2028, listas 2026/2027, natureza, ajustes; grade comercial, fim de semana, feriados fixos e móveis,
  Cinzas a partir de 14:00, 24/12 e 31/12 até 12:30, ponto facultativo aberto, antecedência, janela, bloqueio total e parcial,
  férias, exceções (inclusive sobre feriado) sem liberar ocupação/antecedência/janela, fuso, validação de limites,
  falha fechada e confirmação recusando horário bloqueado sem chamar o Google.
- Integração (PostgreSQL 16 descartável, migrações 0001–0008): reexecução da 0008, restrições do banco, painel → leitura,
  bloqueio sobre reunião confirmada mantendo reserva e reunião idênticas, revogação com histórico, ajustes de feriado,
  confirmação direta à API com bloqueio do banco.
- Interface local com APIs simuladas: painel (desktop e celular), payloads, confirmações, calendário público com dias
  fechados do servidor e retorno à regra local quando o calendário falha.
