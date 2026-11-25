-- =============================================================================
-- OPCIONAL — papel de banco de acesso mínimo para a auditoria do lead qualificado sem reunião
-- NÃO EXECUTAR sem autorização específica do titular. Alternativa mais estrita à execução
-- no Editor SQL do Neon com a conta do titular (ver docs/tracking/auditoria-lead-qualificado-sem-reuniao.md).
--
-- Validado somente em PostgreSQL 16 local descartável. No Neon, prefira criar o papel em
-- Console > Roles (a senha fica com o titular) e rodar apenas as seções "2. PERMISSÕES" e "4. REMOÇÃO".
--
-- Princípios:
--   * LOGIN com limite de 1 conexão, sem herdar nada, sem criar papéis/bancos;
--   * default_transaction_read_only = on e tempo máximo de 5 s por comando, gravados no papel;
--   * SELECT por COLUNA, só nas colunas que a consulta usa; as colunas com dados pessoais
--     (nome, e-mail, WhatsApp, empresa, observações, respostas, IP, user agent, link do Meet,
--     identificador do Google, metadata, token) NÃO são concedidas, então o banco recusa a leitura;
--   * nenhuma permissão de escrita, de sequência ou de função;
--   * remoção completa ao final (seção 4).
-- =============================================================================

-- 1. CRIAÇÃO (a senha vem de uma variável do psql; nunca escreva a senha neste arquivo)
--    psql ... -v audit_password='<gerada pelo titular>' -v audit_valid_until='<data limite, ex.: 3 dias à frente>' \
--         -f auditoria-papel-somente-leitura.sql
--    O papel expira sozinho na data informada, mesmo que a remoção (seção 4) seja esquecida.
CREATE ROLE crm_audit_ro LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION
  CONNECTION LIMIT 1 PASSWORD :'audit_password' VALID UNTIL :'audit_valid_until';
ALTER ROLE crm_audit_ro SET default_transaction_read_only = on;
ALTER ROLE crm_audit_ro SET statement_timeout = '5s';
ALTER ROLE crm_audit_ro SET lock_timeout = '1s';
ALTER ROLE crm_audit_ro SET idle_in_transaction_session_timeout = '30s';

-- 2. PERMISSÕES (somente leitura, por coluna)
GRANT USAGE ON SCHEMA crm TO crm_audit_ro;
GRANT SELECT (id, is_test, stage, created_at)                          ON crm.leads                 TO crm_audit_ro;
GRANT SELECT (lead_id, activity_kind, created_at)                      ON crm.lead_activities       TO crm_audit_ro;
GRANT SELECT (lead_id, status, failure_code, created_at, starts_at)    ON crm.booking_requests      TO crm_audit_ro;
GRANT SELECT (lead_id, status, created_at)                             ON crm.appointments          TO crm_audit_ro;
GRANT SELECT (lead_id, event_name)                                     ON crm.tracking_events       TO crm_audit_ro;
GRANT SELECT (working_days, open_minute, close_minute, min_notice_minutes, window_days)
                                                                       ON crm.availability_settings TO crm_audit_ro;
GRANT SELECT (enabled)                                                 ON crm.availability_capacity TO crm_audit_ro;
GRANT SELECT (category, starts_at, ends_at, revoked_at)                ON crm.availability_blocks   TO crm_audit_ro;
GRANT SELECT (starts_at, ends_at, revoked_at)                          ON crm.availability_exceptions TO crm_audit_ro;
GRANT SELECT (action, day, revoked_at)                                 ON crm.availability_capacity_overrides TO crm_audit_ro;

-- 3. USO: conectar como crm_audit_ro e executar auditoria-lead-qualificado-sem-reuniao.sql

-- 4. REMOÇÃO (executar assim que o resultado for entregue)
-- REVOKE ALL ON ALL TABLES IN SCHEMA crm FROM crm_audit_ro;
-- REVOKE ALL ON SCHEMA crm FROM crm_audit_ro;
-- DROP OWNED BY crm_audit_ro;
-- DROP ROLE crm_audit_ro;
