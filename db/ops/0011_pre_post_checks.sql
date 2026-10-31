-- 0011 (Financeiro) — conferências ANTES e DEPOIS da aplicação no Neon PREVIEW (somente leitura).
-- 1) Confirmar o alvo: deve ser o banco do Preview (cassiellos_crm), nunca Production.
SELECT current_database() AS banco, current_user AS usuario, now() AS horario;
-- 2) Contagens de referência das tabelas existentes (devem ser IGUAIS antes e depois).
SELECT 'leads' AS tabela, count(*) FROM crm.leads
UNION ALL SELECT 'form_submissions', count(*) FROM crm.form_submissions
UNION ALL SELECT 'appointments', count(*) FROM crm.appointments
UNION ALL SELECT 'booking_requests', count(*) FROM crm.booking_requests
UNION ALL SELECT 'lead_activities', count(*) FROM crm.lead_activities
UNION ALL SELECT 'consents', count(*) FROM crm.consents;
-- 3) Tabelas do Financeiro (antes: nenhuma; depois: 6).
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'crm' AND table_name LIKE 'finance\_%' ORDER BY table_name;
