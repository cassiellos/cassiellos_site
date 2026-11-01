-- 0016 — REVERSÃO (somente com autorização). Remove a fundação Asaas. Seguro apenas ENQUANTO as tabelas novas
-- estiverem vazias (nenhum vínculo/cobrança/evento real); com dados, exportar antes. Os movimentos do Financeiro
-- (finance_settlements) NÃO são apagados por esta reversão.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM crm.finance_asaas_payments) OR EXISTS (SELECT 1 FROM crm.finance_asaas_subscriptions)
     OR EXISTS (SELECT 1 FROM crm.finance_asaas_customers) OR EXISTS (SELECT 1 FROM crm.finance_asaas_events) THEN
    RAISE EXCEPTION '0016 rollback: há dados de integração — exportar e obter autorização específica antes';
  END IF;
  IF EXISTS (SELECT 1 FROM crm.finance_sources WHERE billing_provider <> 'manual') THEN
    RAISE EXCEPTION '0016 rollback: há contratos com billing_provider diferente de manual';
  END IF;
END $$;
DROP TABLE IF EXISTS crm.finance_integration_log;
DROP TABLE IF EXISTS crm.finance_asaas_events;
DROP TABLE IF EXISTS crm.finance_asaas_payment_settlements;
DROP TABLE IF EXISTS crm.finance_asaas_payments;
DROP TABLE IF EXISTS crm.finance_asaas_subscriptions;
DROP TABLE IF EXISTS crm.finance_asaas_customers;
ALTER TABLE crm.finance_sources DROP CONSTRAINT IF EXISTS finance_sources_billing_provider;
ALTER TABLE crm.finance_sources DROP COLUMN IF EXISTS billing_provider;
COMMIT;
