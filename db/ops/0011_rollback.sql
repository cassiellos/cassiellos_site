-- 0011 (Financeiro) — REVERSÃO. DESTRUTIVA para os dados financeiros: apaga TODO o conteúdo do módulo.
-- Executar somente com autorização expressa do responsável e depois de exportar os dados (CSV no CRM).
-- Não toca em nenhuma outra tabela do CRM.
BEGIN;
DROP TABLE IF EXISTS crm.finance_audit_log;
DROP TABLE IF EXISTS crm.finance_invoices;
DROP TABLE IF EXISTS crm.finance_settlements;
DROP TABLE IF EXISTS crm.finance_entries;
DROP TABLE IF EXISTS crm.finance_sources;
DROP TABLE IF EXISTS crm.finance_clients;
COMMIT;
