# Auditoria somente leitura: lead qualificado sem reunião

**Estado: preparada e testada em banco descartável com dados fictícios. NÃO foi executada em produção e só roda com a
autorização específica do titular** (texto pronto na seção 5).

Arquivos: `scripts/tracking/auditoria-lead-qualificado-sem-reuniao.sql` (a consulta),
`scripts/tracking/auditoria-papel-somente-leitura.sql` (papel opcional de acesso mínimo) e
`lib/crm/audit-lead-sem-reuniao.test.ts` (testes).

## 1. Pergunta que a consulta responde

Para cada lead **real** (`is_test = false`) que o fluxo do formulário classificou como **qualificado**
(atividade `form_flow_qualified`), em que ponto o agendamento parou? A etapa `qualified` do lead nasce da resposta
do formulário, não da reunião (`lib/crm/lead-intake.ts`), por isso um lead pode estar "qualificado" e nunca ter
tido reunião.

## 2. O que a consulta lê (e o que não lê)

| Tabela | Colunas lidas |
| --- | --- |
| `crm.leads` | `id` (só os 8 primeiros caracteres aparecem), `is_test`, `stage`, `created_at` |
| `crm.lead_activities` | `lead_id`, `activity_kind`, `created_at` |
| `crm.booking_requests` | `lead_id`, `status`, `failure_code`, `created_at`, `starts_at` |
| `crm.appointments` | `lead_id`, `status`, `created_at` |
| `crm.tracking_events` | `lead_id`, `event_name` |
| `crm.availability_settings`, `availability_capacity`, `availability_blocks`, `availability_exceptions`, `availability_capacity_overrides` | só configuração, categoria, datas e `revoked_at` |

**Nunca lê:** nome, e-mail, WhatsApp, empresa, observações, `answers` do formulário, IP, user agent, link do Meet,
identificador do evento do Google, `metadata`, `details`, `idempotency_key`, motivos em texto livre, autores.
Isso é verificado por teste automático (a consulta e o papel não podem citar essas colunas).

**Garantias de execução:** transação `BEGIN READ ONLY` (o banco recusa gravação), `SELECT`/`WITH` apenas, 5 s por
comando, 1 s de espera por trava, `ROLLBACK` no fim, sem `SELECT *`.

## 3. Resultado esperado

Três tabelas pequenas: (1) um registro por lead qualificado com `diagnostico`, (2) totais por diagnóstico,
(3) configuração e bloqueios da agenda.

| Diagnóstico | Significa | Próximo passo (sempre com autorização) |
| --- | --- | --- |
| `A_TEM_REUNIAO` | há reunião pendente, confirmada ou concluída | nada a investigar |
| `B_REUNIAO_ENCERRADA_*` | reunião cancelada, remarcada ou faltou | conferir quem cancelou no CRM |
| `C_INCONSISTENTE_RESERVA_CONFIRMADA` | reserva confirmada sem reunião | correção manual proposta, nada automático |
| `D_RESERVA_TRAVADA` | reserva "em processamento" há mais de 10 min | ação administrativa "reservas travadas" do CRM |
| `E_RESERVA_EM_ANDAMENTO` | reserva há menos de 10 min | repetir a consulta depois |
| `F_FALHA_NA_RESERVA_<código>` | o servidor recusou a tentativa (código técnico) | tratar pelo código |
| `G_RESERVA_CANCELADA` | reserva cancelada | conferir no CRM |
| `H_SEM_TENTATIVA_DE_AGENDAMENTO` | o visitante nunca reservou um horário | ver abaixo |

**O caso `H` é o que o CRM sozinho não explica.** Pode ser abandono, calendário que não carregou (a falha 503 não deixava
rastro antes dos registros operacionais, ver `operacao-logs-e-neon.md`), token de agendamento expirado ou ausência de
horário livre na janela pública. A consulta 3 testa só a última hipótese (janela, antecedência, bloqueios,
capacidade diária). Para as demais seria preciso ler os **registros de execução da Vercel** das rotas
`/api/booking/calendar`, `/availability` e `/confirm` na hora do lead (apenas status HTTP e horário). Isso é uma
leitura separada e exige autorização própria.

## 4. Como foi testado (sem produção, sem Neon)

PostgreSQL 16 local descartável com as migrações do repositório e 10 leads fictícios, cada um com dados pessoais
fictícios marcados (nome, e-mail, telefone, notas, IP, link do Meet, token) para provar que nada disso aparece:

* 8 desfechos recebem o diagnóstico esperado (sem tentativa, reserva travada, em andamento, falha com código,
  cancelada, confirmada sem reunião, com reunião, reunião cancelada); um lead com orçamento limitado e um lead de
  teste ficam de fora;
* nenhuma das 10 marcas de dado pessoal aparece no resultado; as colunas devolvidas são exatamente as previstas;
* os totais da consulta 2 batem com a consulta 1;
* a gravação é recusada pelo banco na transação somente leitura;
* com o papel de acesso mínimo: a consulta inteira roda e devolve o mesmo resultado; o banco recusa 17 leituras de
  colunas pessoais (e `SELECT *`, tabelas de credenciais e de notificação) e toda escrita/criação de objeto, por
  duas travas independentes (padrão somente leitura e falta de permissão).

**Não verificado:** o comportamento no Neon de produção (versão do Postgres, Editor SQL, criação de papel pelo
Console) e o conteúdo real das tabelas. Tudo acima é simulado em banco local.

## 5. Como executar e o texto de autorização

**Caminho recomendado (A): Editor SQL do Neon, na sua sessão do Chrome.** Não cria papel, não muda nada em
produção e eu não recebo nenhuma credencial. A trava de somente leitura é do próprio banco (`BEGIN READ ONLY`).

**Caminho estrito (B), só se preferir a restrição por coluna também no banco:** criar o papel `crm_audit_ro`
(arquivo `auditoria-papel-somente-leitura.sql`, expira sozinho na data informada), rodar a consulta com ele e
removê-lo em seguida. Criar e remover o papel é uma alteração temporária em produção, por isso exige autorização
própria, e a senha do papel fica só com o titular.

Texto para colar no chat (caminho A):

> AUTORIZO, uma única vez, a execução da consulta de auditoria somente leitura
> `scripts/tracking/auditoria-lead-qualificado-sem-reuniao.sql` no banco Neon de produção (`crm-production-live`),
> schema `crm`, pelo Editor SQL do Neon na minha sessão do Chrome, dentro de `BEGIN READ ONLY … ROLLBACK`.
> Escopo: leads reais (`is_test = false`) criados desde 01/11/2026 e classificados como qualificados pelo formulário;
> somente as colunas listadas em `docs/tracking/auditoria-lead-qualificado-sem-reuniao.md`. O resultado deve vir
> como tabela com referência curta do lead, sem nome, e-mail, telefone, respostas, IP ou links. NÃO autorizo gravação,
> criação de papéis, leitura de outras tabelas ou colunas, nem cópia de linhas com dados pessoais. Validade: hoje.

Autorização opcional e separada (leitura dos registros de execução da Vercel):

> AUTORIZO ler, uma única vez, os registros de execução da Vercel do projeto `cassiellos-crm` apenas para as rotas
> `/api/booking/calendar`, `/api/booking/availability` e `/api/booking/confirm`, na janela de 2 horas em torno do horário
> do lead que a auditoria indicar, e relatar somente status HTTP, rota e horário.
