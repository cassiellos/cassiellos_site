# Disponibilidade, feriados e bloqueios de agenda

Status: **implementado localmente** (branch `local/availability-prep`, base `dae52f7`). Nada foi publicado.
Migração `0008_availability.sql` **preparada e não aplicada** em nenhum banco Neon.

## 0. Decisões registradas (30/10/2026)

| Decisão | Situação | Conteúdo |
|---|---|---|
| D-A | **Aprovada** (com validação) | Política comercial de atendimento, editável pelo administrador: Carnaval seg+ter bloqueados; Cinzas até 14h; Corpus Christi bloqueado; 24/12 e 31/12 a partir de 13h; 15/08 e 08/12 (feriados municipais de BH) bloqueados; 28/10 e 30/10 sem bloqueio; sem pontes automáticas. Ponto facultativo não é tratado como feriado obrigatório automaticamente. A política vale independentemente de o dia ser ponto facultativo para órgãos públicos. |
| D-B | **Aguardando** | Migração 0008 no Neon Preview: NÃO executar. |
| D-C | **Aguardando** | Push/deploy: NÃO realizar antes de concluir e avaliar o teste real do Google Calendar (30/10, 09h40). |
| D-D | **Aprovada** | 409 `SLOT_UNAVAILABLE` para conflitos de disponibilidade; 400 `INVALID_SLOT` só para pedido estruturalmente inválido; mensagem clara ao visitante, sem detalhes técnicos (ver seção 3). |
| D-E | **Aprovada** | Revisar as datas de 2027 quando o calendário federal oficial de 2027 for publicado (ver seção 6). |

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
- **Municipal (BH):** a Portaria Conjunta TJMG 1.798/2026 cita o Anexo V da Lei 11.397/2022: Paixão, Corpus Christi,
  Assunção (15/08), Imaculada Conceição (08/12) e Consciência Negra (20/11). A Lei municipal 11.680/2024 (DOM 05/04/2024)
  também tornou 20/11 feriado civil em BH. Como 20/11 já é feriado nacional, o efeito na agenda é o mesmo.
- **Terça de Carnaval não é feriado municipal:** o PL 690/2026 foi vetado e a Câmara manteve o veto em 14/08/2026.
  O bloqueio de Carnaval é, portanto, **política comercial** (D-A).
- **Estadual (MG):** o calendário estadual de 2026 (Agência Minas, 02/12/2025) não traz feriado estadual próprio além de
  21/04 (Data Magna, coincide com Tiradentes). Os pontos facultativos estaduais (ex.: 02/01, 30/10) não bloqueiam a agenda.
- **20/11:** feriado **nacional** pela **Lei 14.759/2023** (Dia Nacional de Zumbi e da Consciência Negra).
- **Dia do Servidor Público 2026:** a **Portaria MGI 8.821/2026** transferiu para **30/10/2026** o ponto facultativo federal
  originalmente previsto para **28/10/2026**. A informação foi dada pela Agência Cassiellos em 30/10/2026; o texto da portaria
  no DOU não foi lido. Fontes secundárias confirmam a transferência para 30/10 em órgãos federais (MPF, Portaria PRR5
  143/2026; UNIRIO). **Política comercial:** a Cassiellos mantém **30/10 disponível** para agendamento.
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
| 28/10 | Dia do Servidor Público (data original) | ponto facultativo federal **transferido para 30/10** (Portaria MGI 8.821/2026) | **sem bloqueio** |
| 30/10 | Dia do Funcionário Público (MG) e ponto facultativo federal do Dia do Servidor (transferido) | expediente estadual + ponto facultativo federal | **sem bloqueio** (mantido disponível por política comercial) |
| 02/11 | Finados | feriado nacional | dia inteiro |
| 15/11 | Proclamação da República | feriado nacional | dia inteiro |
| 20/11 | Consciência Negra | feriado nacional (Lei 14.759/2023) e municipal (BH) | dia inteiro |
| 08/12 | Imaculada Conceição | feriado municipal (BH) | dia inteiro |
| 24/12 | Véspera de Natal | ponto facultativo após 13h + política | a partir de 13:00 |
| 25/12 | Natal | feriado nacional | dia inteiro |
| 31/12 | Véspera de Ano-Novo | ponto facultativo após 13h + política | a partir de 13:00 |

Sem bloqueio automático: pontos facultativos sem política comercial (ex.: 20/04 e 05/06/2026) e pontes.

### Calendário 2027 (regras legais + cálculo da Páscoa; parte PROVISÓRIA)

- Feriados legais (mesmas datas fixas de 2026) e Paixão em 26/03: **válidos**. Decorrem de lei e do cálculo da Páscoa (28/03/2027).
- Datas móveis das políticas: Carnaval 08/02 e 09/02, Cinzas 10/02 (até 14h), Corpus Christi 27/05.
- **Provisório** (o painel mostra a etiqueta PROVISÓRIO): a classificação de Carnaval, Cinzas, Corpus Christi (como ponto
  facultativo federal), 24/12, 31/12, 28/10 e 30/10 depende da portaria anual do MGI e do calendário estadual de 2027.
  O bloqueio comercial padrão (D-A) continua valendo.
- Anos conferidos: `OFFICIALLY_CONFIRMED_YEARS = [2026]` em `lib/crm/availability/holidays.ts`.

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

### Códigos de resposta da confirmação (decisão D-D)

| Situação | Resposta | Mensagem ao visitante |
|---|---|---|
| sábado, domingo, dia não atendido, feriado/política, bloqueio, fora do expediente, antecedência, data passada ou além da janela, ocupado no Google/CRM | `409 SLOT_UNAVAILABLE` | "Esse horário acabou de ficar indisponível. Escolha outro no calendário." |
| texto que não é data ISO UTC, data ou hora inexistente, horário fora da grade de 30 min, segundos | `400 INVALID_SLOT` | "Não foi possível validar o horário escolhido. Escolha novamente no calendário." |

Nenhum dos dois casos consulta o banco de reservas ou o Google. Antes do módulo, o fim de semana e a data
fora da janela retornavam 400, e o horário fora da grade retornava 409.

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

## 6. Pendências de calendário

1. **2027 (D-E):** quando a portaria do MGI e o calendário estadual de 2027 forem publicados, conferir as datas,
   incluir 2027 em `OFFICIALLY_CONFIRMED_YEARS` e ajustar o catálogo se algo mudar.
2. **Portaria MGI 8.821/2026:** transferência de 28/10 para 30/10 registrada; ler o texto oficial no DOU para fechar a
   conferência. O catálogo no código (`servidor_publico`) ainda mostra 28/10 para todos os anos. Não há efeito funcional,
   pois nenhum dos dois dias bloqueia; ajustar o rótulo de 2026 no código exige autorização (esta etapa foi só documental).
3. **Lei 11.397/2022 de BH:** a consolidação foi lida por meio da Portaria TJMG. Ler o texto oficial no DOM/CMBH quando possível.
4. **Migração 0008 (D-B)** e **publicação (D-C):** bloqueadas até a avaliação do teste das 09h40.
5. **Revisão anual:** a cada ano, conferir mudanças em leis municipais (ex.: novo feriado em BH) e repetir esta validação.
