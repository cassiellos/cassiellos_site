-- 0008 — RECUPERAÇÃO (rollback). NÃO executar sem autorização expressa.
-- Remove SOMENTE as 4 tabelas criadas pela 0008. Não toca em leads, reuniões, reservas ou qualquer outra tabela.
-- Efeito no CRM: o código volta a usar o padrão embutido (feriados e políticas incluídos; 3 h / 3 dias);
-- bloqueios, exceções e ajustes de feriado cadastrados no painel são PERDIDOS (exportar antes, se houver).
-- Fica fora de db/migrations de propósito, para nunca ser aplicado junto com as migrações.

BEGIN;
DROP TABLE IF EXISTS crm.holiday_rules;
DROP TABLE IF EXISTS crm.availability_exceptions;
DROP TABLE IF EXISTS crm.availability_blocks;
DROP TABLE IF EXISTS crm.availability_settings;
COMMIT;
