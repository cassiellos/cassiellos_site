-- 0009 — conferências SOMENTE LEITURA (antes e depois de aplicar no Neon PREVIEW). Não altera nada.
-- Executar com o MESMO role dono das tabelas do schema crm (cassiellos_crm_owner).

-- 1) Role, dono das tabelas e presença das tabelas da 0008/0009.
SELECT current_user AS role_atual,
       (SELECT string_agg(DISTINCT tableowner, ',') FROM pg_tables WHERE schemaname = 'crm') AS donos_crm;
SELECT t AS tabela, to_regclass('crm.' || t) IS NOT NULL AS existe
  FROM unnest(ARRAY['availability_settings', 'availability_capacity', 'availability_capacity_overrides']) AS t;

-- 2) Configuração atual (antes: 180 / 1080; depois: 120 / 1110, updated_by = 'migration:0009').
SELECT working_days, open_minute, close_minute, min_notice_minutes, window_days, updated_at, updated_by
  FROM crm.availability_settings;

-- 3) Fotografia do histórico (antes × depois: deve ser IDÊNTICA).
SELECT (SELECT count(*) FROM crm.leads) AS leads,
       (SELECT md5(string_agg(id::text || stage || updated_at::text, ',' ORDER BY id)) FROM crm.leads) AS assinatura_leads,
       (SELECT md5(string_agg(id::text || status || starts_at::text || ends_at::text || coalesce(calendar_event_id, '')
           || coalesce(cancelled_at::text, '') || coalesce(completed_at::text, ''), ',' ORDER BY id)) FROM crm.appointments) AS assinatura_reunioes,
       (SELECT md5(string_agg(id::text || status || starts_at::text || coalesce(google_event_id, ''), ',' ORDER BY id))
          FROM crm.booking_requests) AS assinatura_reservas,
       (SELECT count(*) FROM crm.availability_blocks WHERE revoked_at IS NULL) AS bloqueios_ativos,
       (SELECT count(*) FROM crm.availability_exceptions WHERE revoked_at IS NULL) AS excecoes_ativas,
       (SELECT count(*) FROM crm.holiday_rules) AS ajustes_feriados;

-- 4) Depois: capacidade (ligada, 3–4, 720–810, semente 1) e nenhum ajuste por data.
-- (Executar só depois de aplicar; antes, retorna erro de tabela inexistente — esperado.)
-- SELECT * FROM crm.availability_capacity;
-- SELECT count(*) AS ajustes FROM crm.availability_capacity_overrides;
