-- 0008 — conferências SOMENTE LEITURA (antes e depois de aplicar a migração no Neon PREVIEW).
-- Não altera nada. Executar com o MESMO role que aplicou 0001–0007 (dono das tabelas do schema crm).

-- 1) Role e dono das tabelas existentes (devem coincidir; os objetos novos pertencem a quem executar).
SELECT current_user AS role_atual,
       (SELECT string_agg(DISTINCT tableowner, ',') FROM pg_tables WHERE schemaname = 'crm') AS donos_crm;

-- 2) As tabelas da 0008 ainda não existem (antes) / existem (depois).
SELECT t AS tabela, to_regclass('crm.' || t) IS NOT NULL AS existe
  FROM unnest(ARRAY['availability_settings','availability_blocks','availability_exceptions','holiday_rules']) AS t;

-- 3) Fotografia dos agendamentos históricos (comparar antes × depois: deve ser IDÊNTICA).
SELECT count(*) AS reunioes,
       count(*) FILTER (WHERE status = 'confirmed') AS confirmadas,
       count(*) FILTER (WHERE status = 'cancelled') AS canceladas,
       md5(string_agg(id::text || status || starts_at::text || ends_at::text || coalesce(calendar_event_id, '')
           || coalesce(cancelled_at::text, '') || coalesce(completed_at::text, ''), ',' ORDER BY id)) AS assinatura
  FROM crm.appointments;
SELECT count(*) AS reservas,
       md5(string_agg(id::text || status || starts_at::text || coalesce(google_event_id, ''), ',' ORDER BY id)) AS assinatura
  FROM crm.booking_requests;

-- 4) Depois: configuração inicial (deve ser seg–sex, 540–1080, 30 min, 180 min, 3 dias) e tabelas vazias.
-- (Executar só depois de aplicar; antes, retorna erro de tabela inexistente — esperado.)
-- SELECT * FROM crm.availability_settings;
-- SELECT (SELECT count(*) FROM crm.availability_blocks) AS bloqueios, (SELECT count(*) FROM crm.availability_exceptions) AS excecoes,
--        (SELECT count(*) FROM crm.holiday_rules) AS ajustes_feriados;
