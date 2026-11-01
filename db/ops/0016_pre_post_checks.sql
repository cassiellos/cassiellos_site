-- 0016 (fundação Asaas) — conferências ANTES e DEPOIS, SOMENTE LEITURA (Neon PREVIEW, quando autorizado).
SELECT current_database() AS banco, current_user AS usuario, now() AS horario;
-- Pré-requisitos: 0011 e 0015 aplicadas (deve retornar 2).
SELECT count(*) AS prerequisitos FROM information_schema.columns
 WHERE table_schema = 'crm' AND ((table_name = 'finance_sources' AND column_name = 'installment_plan')
    OR (table_name = 'finance_entries' AND column_name = 'project_source_id'));
-- Referência: contagens e somas devem ser IGUAIS antes e depois (a 0016 não muda dados).
SELECT 'finance_sources' AS tabela, count(*) AS linhas, sum(amount_cents) AS centavos FROM crm.finance_sources
UNION ALL SELECT 'finance_entries', count(*), sum(amount_cents) FROM crm.finance_entries
UNION ALL SELECT 'finance_settlements', count(*), sum(amount_cents) FROM crm.finance_settlements
UNION ALL SELECT 'finance_audit_log', count(*), NULL FROM crm.finance_audit_log;
-- Depois: tabelas novas (7) e nenhuma ligação de ambiente (a ligação é um passo separado, autorizado) e contratos todos 'manual'.
SELECT table_name FROM information_schema.tables WHERE table_schema = 'crm'
   AND table_name IN ('finance_asaas_binding', 'finance_asaas_customers', 'finance_asaas_subscriptions', 'finance_asaas_payments',
                      'finance_asaas_payment_settlements', 'finance_asaas_events', 'finance_integration_log') ORDER BY 1;
-- (somente depois) SELECT billing_provider, count(*) FROM crm.finance_sources GROUP BY 1;
-- (somente depois) SELECT count(*) AS ligacoes FROM crm.finance_asaas_binding;  -- deve ser 0
