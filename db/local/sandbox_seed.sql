-- SOMENTE PARA POSTGRESQL LOCAL DESCARTÁVEL. Liga o banco ao ambiente SANDBOX do Asaas e cria um contrato
-- FICTÍCIO mínimo. Nenhum dado real: nomes, valores e ids são sintéticos; nenhum id do Asaas é criado aqui.
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM crm_local_test.marker WHERE kind = 'disposable-local' AND mode = 'sandbox') THEN
    RAISE EXCEPTION 'semente recusada: banco sem marcador local descartável (sandbox)';
  END IF;
END $$;
INSERT INTO crm.finance_asaas_binding (environment, bound_by) VALUES ('sandbox', 'local-seed') ON CONFLICT DO NOTHING;
INSERT INTO crm.finance_integration_log (environment, entity, entity_ref, action, actor)
  SELECT 'sandbox', 'event', 'binding', 'environment_bound', 'local-seed'
  WHERE NOT EXISTS (SELECT 1 FROM crm.finance_integration_log WHERE entity_ref = 'binding');
INSERT INTO crm.finance_clients (id, name, company, notes)
  VALUES ('00000000-0000-4000-8000-00000000c001', 'Cliente Fictício Sandbox', 'Empresa Fictícia Ltda', 'SINTÉTICO — banco local descartável')
  ON CONFLICT (id) DO NOTHING;
COMMIT;
