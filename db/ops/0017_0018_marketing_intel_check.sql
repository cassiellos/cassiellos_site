-- Verificação (SOMENTE LEITURA) antes/depois das migrações 0017 + 0018. Não altera nada.
-- Antes: espera-se 0 tabelas mi_* e a 0016 já presente conforme decisão do titular.
-- Depois: espera-se as 12 tabelas mi_* e as tabelas existentes intactas.

SELECT 'mi_tables' AS check, count(*) AS value
  FROM information_schema.tables WHERE table_schema = 'crm' AND table_name LIKE 'mi\_%';

SELECT table_name FROM information_schema.tables WHERE table_schema = 'crm' AND table_name LIKE 'mi\_%' ORDER BY 1;

-- Google Calendar: a restrição continua exclusiva de 'google_calendar' (a Central não reutiliza esta tabela).
SELECT 'integration_credentials_check' AS check, pg_get_constraintdef(c.oid) AS value
  FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid JOIN pg_namespace n ON n.oid = t.relnamespace
 WHERE n.nspname = 'crm' AND t.relname = 'integration_credentials' AND c.contype = 'c' ORDER BY 2;

-- Nenhuma coluna com aparência de segredo nas tabelas da Central (só a referência opaca credential_ref).
SELECT 'secret_like_columns' AS check, string_agg(table_name || '.' || column_name, ', ') AS value
  FROM information_schema.columns
 WHERE table_schema = 'crm' AND table_name LIKE 'mi\_%' AND column_name ~ '(token|secret|password|refresh|api_key)';
