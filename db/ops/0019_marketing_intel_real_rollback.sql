-- Reversão da 0019 (Central de Inteligência — integrações reais). Remove SOMENTE as 4 tabelas criadas pela 0019.
-- ATENÇÃO: apagar crm.mi_credentials descarta as credenciais cifradas (as conexões precisarão ser reautorizadas).
-- Antes, em mi_connections, marcar as conexões como revogadas se a reversão for definitiva.
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP TABLE IF EXISTS crm.mi_rate_limits;
DROP TABLE IF EXISTS crm.mi_rate_marks;
DROP TABLE IF EXISTS crm.mi_oauth_states;
DROP TABLE IF EXISTS crm.mi_credentials;
COMMIT;
