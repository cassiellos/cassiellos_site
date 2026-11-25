-- =============================================================================
-- AUDITORIA SOMENTE LEITURA — lead qualificado que não tem reunião
-- Cassiellos CRM (schema crm) · NÃO EXECUTAR sem autorização específica do titular.
--
-- O que faz: para cada lead REAL (is_test = false) que o fluxo do formulário classificou como
-- "qualificado", mostra em que ponto o agendamento parou. Só lê; nada é gravado.
--
-- Garantias de acesso mínimo:
--   * tudo roda dentro de BEGIN READ ONLY (o banco recusa qualquer escrita) e termina em ROLLBACK;
--   * só SELECT/WITH; nenhum INSERT/UPDATE/DELETE/DDL;
--   * tempo máximo de 5 s por comando e 1 s de espera por trava;
--   * NÃO lê: nome, e-mail, WhatsApp, empresa, observações, respostas do formulário (answers), IP,
--     user agent, link do Meet, identificador do evento do Google, token, metadata, idempotency_key;
--   * o lead aparece só por uma referência curta (8 primeiros caracteres do identificador interno),
--     suficiente para localizá-lo no CRM, e por horários (UTC e Brasília).
--
-- Como ler o resultado: a coluna "diagnostico" (consulta 1) usa estes valores:
--   A_TEM_REUNIAO                       reunião pendente/confirmada/concluída: não é o caso procurado
--   B_REUNIAO_ENCERRADA_<status>        existia reunião e foi cancelada/remarcada/faltou
--   C_INCONSISTENTE_RESERVA_CONFIRMADA  reserva "confirmed" sem reunião ativa (precisa de correção manual)
--   D_RESERVA_TRAVADA                   reserva "processing" há mais de 10 minutos
--   E_RESERVA_EM_ANDAMENTO              reserva "processing" há menos de 10 minutos
--   F_FALHA_NA_RESERVA_<codigo>         tentativa registrada e recusada pelo servidor (código técnico)
--   G_RESERVA_CANCELADA                 reserva cancelada
--   H_SEM_TENTATIVA_DE_AGENDAMENTO      o visitante nunca chegou a reservar um horário
-- H é o caso que o CRM sozinho não explica: pode ser abandono, calendário que não carregou
-- (o aviso 503 não deixava rastro antes dos registros operacionais) ou ausência de horário livre.
-- A consulta 3 mostra a configuração e os bloqueios da agenda para testar a hipótese "sem horário livre".
-- =============================================================================

BEGIN READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '1s';
SET LOCAL idle_in_transaction_session_timeout = '30s';

-- -----------------------------------------------------------------------------
-- Consulta 1 — um registro por lead real qualificado, com o diagnóstico
-- -----------------------------------------------------------------------------
WITH qualified AS (
  SELECT a.lead_id, min(a.created_at) AS qualified_at, count(*)::int AS qualified_submissions
    FROM crm.lead_activities a
   WHERE a.activity_kind = 'form_flow_qualified'
   GROUP BY a.lead_id
), last_booking AS (
  SELECT DISTINCT ON (r.lead_id) r.lead_id, r.status, r.failure_code, r.created_at, r.starts_at
    FROM crm.booking_requests r
   ORDER BY r.lead_id, r.created_at DESC
), best_meeting AS (
  SELECT DISTINCT ON (x.lead_id) x.lead_id, x.status
    FROM crm.appointments x
   ORDER BY x.lead_id, (x.status IN ('pending', 'confirmed', 'completed')) DESC, x.created_at DESC
), events AS (
  SELECT t.lead_id,
         bool_or(t.event_name = 'Lead')              AS has_lead_event,
         bool_or(t.event_name = 'Chronos_Scheduled') AS has_schedule_event
    FROM crm.tracking_events t
   GROUP BY t.lead_id
)
SELECT left(l.id::text, 8)                                              AS lead_ref,
       to_char(q.qualified_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') AS qualificado_em_utc,
       to_char(q.qualified_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS qualificado_em_brasilia,
       round(extract(epoch FROM (now() - q.qualified_at)) / 60)::int    AS minutos_desde_a_qualificacao,
       l.stage                                                          AS etapa_no_crm,
       q.qualified_submissions                                          AS envios_qualificados,
       CASE
         WHEN m.status IN ('pending', 'confirmed', 'completed')          THEN 'A_TEM_REUNIAO'
         WHEN m.status IN ('cancelled', 'rescheduled', 'no_show')        THEN 'B_REUNIAO_ENCERRADA_' || upper(m.status)
         WHEN b.status = 'confirmed'                                     THEN 'C_INCONSISTENTE_RESERVA_CONFIRMADA'
         WHEN b.status = 'processing' AND now() - b.created_at > interval '10 minutes' THEN 'D_RESERVA_TRAVADA'
         WHEN b.status = 'processing'                                    THEN 'E_RESERVA_EM_ANDAMENTO'
         WHEN b.status = 'failed'                                        THEN 'F_FALHA_NA_RESERVA_' || coalesce(b.failure_code, 'SEM_CODIGO')
         WHEN b.status = 'cancelled'                                     THEN 'G_RESERVA_CANCELADA'
         ELSE 'H_SEM_TENTATIVA_DE_AGENDAMENTO'
       END                                                              AS diagnostico,
       b.status                                                         AS reserva_status,
       b.failure_code                                                   AS reserva_codigo_de_falha,
       to_char(b.starts_at AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS reserva_horario_brasilia,
       m.status                                                         AS reuniao_status,
       coalesce(e.has_lead_event, false)                                AS tem_evento_lead_no_crm,
       coalesce(e.has_schedule_event, false)                            AS tem_evento_schedule_no_crm
  FROM crm.leads l
  JOIN qualified q            ON q.lead_id = l.id
  LEFT JOIN last_booking b    ON b.lead_id = l.id
  LEFT JOIN best_meeting m    ON m.lead_id = l.id
  LEFT JOIN events e          ON e.lead_id = l.id
 WHERE l.is_test = false
   AND l.created_at >= timestamptz '2026-11-01 00:00:00-03'
 ORDER BY q.qualified_at;

-- -----------------------------------------------------------------------------
-- Consulta 2 — totais por diagnóstico (mesma regra da consulta 1; só contagens)
-- -----------------------------------------------------------------------------
WITH qualified AS (
  SELECT a.lead_id FROM crm.lead_activities a WHERE a.activity_kind = 'form_flow_qualified' GROUP BY a.lead_id
), last_booking AS (
  SELECT DISTINCT ON (r.lead_id) r.lead_id, r.status, r.failure_code, r.created_at
    FROM crm.booking_requests r ORDER BY r.lead_id, r.created_at DESC
), best_meeting AS (
  SELECT DISTINCT ON (x.lead_id) x.lead_id, x.status
    FROM crm.appointments x
   ORDER BY x.lead_id, (x.status IN ('pending', 'confirmed', 'completed')) DESC, x.created_at DESC
)
SELECT CASE
         WHEN m.status IN ('pending', 'confirmed', 'completed')          THEN 'A_TEM_REUNIAO'
         WHEN m.status IN ('cancelled', 'rescheduled', 'no_show')        THEN 'B_REUNIAO_ENCERRADA_' || upper(m.status)
         WHEN b.status = 'confirmed'                                     THEN 'C_INCONSISTENTE_RESERVA_CONFIRMADA'
         WHEN b.status = 'processing' AND now() - b.created_at > interval '10 minutes' THEN 'D_RESERVA_TRAVADA'
         WHEN b.status = 'processing'                                    THEN 'E_RESERVA_EM_ANDAMENTO'
         WHEN b.status = 'failed'                                        THEN 'F_FALHA_NA_RESERVA_' || coalesce(b.failure_code, 'SEM_CODIGO')
         WHEN b.status = 'cancelled'                                     THEN 'G_RESERVA_CANCELADA'
         ELSE 'H_SEM_TENTATIVA_DE_AGENDAMENTO'
       END AS diagnostico,
       count(*)::int AS leads
  FROM crm.leads l
  JOIN qualified q         ON q.lead_id = l.id
  LEFT JOIN last_booking b ON b.lead_id = l.id
  LEFT JOIN best_meeting m ON m.lead_id = l.id
 WHERE l.is_test = false
   AND l.created_at >= timestamptz '2026-11-01 00:00:00-03'
 GROUP BY 1
 ORDER BY 1;

-- -----------------------------------------------------------------------------
-- Consulta 3 — agenda: configuração e bloqueios (sem texto livre de motivo, sem autor)
-- Serve para testar a hipótese "não havia horário livre na janela pública".
-- -----------------------------------------------------------------------------
SELECT 'configuracao' AS tipo,
       working_days::text AS dias_uteis_0dom_6sab,
       (open_minute / 60)::text || 'h' || lpad((open_minute % 60)::text, 2, '0')   AS abre,
       (close_minute / 60)::text || 'h' || lpad((close_minute % 60)::text, 2, '0') AS ultimo_inicio_fecha,
       min_notice_minutes AS antecedencia_minima_min,
       window_days        AS janela_em_dias,
       NULL::text         AS categoria,
       NULL::int          AS quantidade
  FROM crm.availability_settings
UNION ALL
SELECT 'capacidade_diaria', NULL, NULL, NULL, NULL, NULL,
       CASE WHEN enabled THEN 'LIGADA' ELSE 'DESLIGADA' END, NULL
  FROM crm.availability_capacity
UNION ALL
SELECT 'bloqueios_ativos_hoje_e_proximos_dias', NULL, NULL, NULL, NULL, NULL, category, count(*)::int
  FROM crm.availability_blocks
 WHERE revoked_at IS NULL AND ends_at > now() - interval '7 days' AND starts_at < now() + interval '30 days'
 GROUP BY category
UNION ALL
SELECT 'excecoes_ativas', NULL, NULL, NULL, NULL, NULL, 'excecao', count(*)::int
  FROM crm.availability_exceptions
 WHERE revoked_at IS NULL AND ends_at > now() - interval '7 days' AND starts_at < now() + interval '30 days'
UNION ALL
SELECT 'ajustes_de_capacidade_ativos', NULL, NULL, NULL, NULL, NULL, action, count(*)::int
  FROM crm.availability_capacity_overrides
 WHERE revoked_at IS NULL AND day >= (now() AT TIME ZONE 'America/Sao_Paulo')::date - 7
 GROUP BY action
ORDER BY 1, 7;

ROLLBACK;
