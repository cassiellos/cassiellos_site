-- REVERSÃO das migrações 0017 + 0018 (Central de Inteligência de Marketing).
--
-- PREPARADA, NÃO EXECUTADA. Remove SOMENTE as tabelas crm.mi_* — nenhuma tabela do CRM comercial, do Financeiro,
-- do agendamento, do Google Calendar (crm.integration_credentials) ou do Pixel/CAPI é tocada.
-- Apaga os dados da Central (métricas sincronizadas, vínculos, conexões): executar apenas com autorização do titular e
-- após exportar o que for necessário. Ordem inversa das dependências; reexecutável (IF EXISTS).

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DROP TABLE IF EXISTS crm.mi_alerts;
DROP TABLE IF EXISTS crm.mi_gtm_snapshot;
DROP TABLE IF EXISTS crm.mi_ga4_daily;
DROP TABLE IF EXISTS crm.mi_ads_daily;
DROP TABLE IF EXISTS crm.mi_sync_jobs;
DROP TABLE IF EXISTS crm.mi_campaigns;
DROP TABLE IF EXISTS crm.mi_audit_log;
DROP TABLE IF EXISTS crm.mi_client_assets;
DROP TABLE IF EXISTS crm.mi_asset_access;
DROP TABLE IF EXISTS crm.mi_assets;
DROP TABLE IF EXISTS crm.mi_connections;
DROP TABLE IF EXISTS crm.mi_clients;

COMMIT;
