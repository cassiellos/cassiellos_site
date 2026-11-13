-- Conferência pós-aplicação da 0019 (somente leitura).
SELECT table_name FROM information_schema.tables
 WHERE table_schema = 'crm' AND table_name IN ('mi_credentials', 'mi_oauth_states', 'mi_rate_marks', 'mi_rate_limits') ORDER BY 1;
-- nenhuma coluna de segredo em claro: o cofre só tem iv/ciphertext/auth_tag
SELECT column_name FROM information_schema.columns
 WHERE table_schema = 'crm' AND table_name = 'mi_credentials' ORDER BY ordinal_position;
