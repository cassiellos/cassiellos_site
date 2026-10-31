-- 0012 (Financeiro: situação do serviço e formalização) — conferências ANTES e DEPOIS, somente leitura (Neon PREVIEW).
SELECT current_database() AS banco, current_user AS usuario, now() AS horario;
-- Contagens e somas de referência: devem ser IGUAIS antes e depois (nenhum valor financeiro muda).
SELECT 'finance_clients' AS tabela, count(*) AS linhas, NULL::numeric AS soma_centavos FROM crm.finance_clients
UNION ALL SELECT 'finance_sources', count(*), sum(amount_cents) FROM crm.finance_sources
UNION ALL SELECT 'finance_entries', count(*), sum(amount_cents) FROM crm.finance_entries
UNION ALL SELECT 'finance_settlements', count(*), sum(amount_cents) FROM crm.finance_settlements
UNION ALL SELECT 'finance_invoices', count(*), NULL FROM crm.finance_invoices
UNION ALL SELECT 'finance_audit_log', count(*), NULL FROM crm.finance_audit_log
UNION ALL SELECT 'leads', count(*), NULL FROM crm.leads;
-- Status financeiro existente (deve ser IGUAL antes e depois).
SELECT direction, status, count(*) FROM crm.finance_sources GROUP BY 1, 2 ORDER BY 1, 2;
-- Colunas novas (antes: nenhuma; depois: 3) e distribuição (depois: tudo 'unknown').
SELECT column_name, data_type, column_default FROM information_schema.columns
 WHERE table_schema = 'crm' AND table_name = 'finance_sources'
   AND column_name IN ('service_status', 'formalization_status', 'admin_status_updated_at') ORDER BY 1;
-- Executar só DEPOIS da aplicação:
-- SELECT service_status, formalization_status, count(*) FROM crm.finance_sources GROUP BY 1, 2;
