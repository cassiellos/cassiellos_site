-- 0016 — REVERSÃO (somente com autorização). Remove a fundação Asaas. Recusa-se a rodar se QUALQUER tabela da
-- integração (inclusive a trilha e a ligação de ambiente) tiver dados; com dados, exportar antes. Os movimentos do Financeiro
-- (finance_settlements) NÃO são apagados por esta reversão.
BEGIN;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM crm.finance_asaas_payments) OR EXISTS (SELECT 1 FROM crm.finance_asaas_subscriptions)
     OR EXISTS (SELECT 1 FROM crm.finance_asaas_customers) OR EXISTS (SELECT 1 FROM crm.finance_asaas_events)
     OR EXISTS (SELECT 1 FROM crm.finance_asaas_payment_settlements) OR EXISTS (SELECT 1 FROM crm.finance_integration_log)
     OR EXISTS (SELECT 1 FROM crm.finance_asaas_binding) THEN
    RAISE EXCEPTION '0016 rollback: há dados de integração — exportar e obter autorização específica antes';
  END IF;
  IF EXISTS (SELECT 1 FROM crm.finance_sources WHERE billing_provider <> 'manual') THEN
    RAISE EXCEPTION '0016 rollback: há contratos com billing_provider diferente de manual';
  END IF;
END $$;
DROP TABLE IF EXISTS crm.finance_integration_log;
DROP TABLE IF EXISTS crm.finance_asaas_events;
DROP TRIGGER IF EXISTS trg_finance_asaas_payment_settlement_check ON crm.finance_asaas_payment_settlements;
DROP TABLE IF EXISTS crm.finance_asaas_payment_settlements;
DROP FUNCTION IF EXISTS crm.finance_asaas_payment_settlement_check();
DROP TABLE IF EXISTS crm.finance_asaas_payments;
DROP TABLE IF EXISTS crm.finance_asaas_subscriptions;
DROP TABLE IF EXISTS crm.finance_asaas_customers;
DROP TABLE IF EXISTS crm.finance_asaas_binding;
ALTER TABLE crm.finance_sources DROP CONSTRAINT IF EXISTS finance_sources_billing_provider;
ALTER TABLE crm.finance_sources DROP COLUMN IF EXISTS billing_provider;
COMMIT;
