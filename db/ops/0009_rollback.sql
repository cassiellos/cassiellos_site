-- 0009 — DESFAZER (somente com autorização). Fica fora de db/migrations para não ser aplicado por engano.
-- Remove apenas as 2 tabelas novas da capacidade diária e devolve os padrões anteriores (3 h / término 18h00).
-- A linha de configuração só volta a 180 / 1080 se ainda estiver exatamente como a 0009 deixou
-- (updated_by = 'migration:0009'); se o administrador já tiver salvo outro valor, ela é mantida.
-- Não toca em leads, reuniões, reservas, bloqueios, exceções, feriados nem no Google.

BEGIN;

DROP TABLE IF EXISTS crm.availability_capacity_overrides;
DROP TABLE IF EXISTS crm.availability_capacity;

ALTER TABLE crm.availability_settings ALTER COLUMN min_notice_minutes SET DEFAULT 180;
ALTER TABLE crm.availability_settings ALTER COLUMN close_minute SET DEFAULT 1080;

UPDATE crm.availability_settings
   SET min_notice_minutes = CASE WHEN min_notice_minutes = 120 THEN 180 ELSE min_notice_minutes END,
       close_minute       = CASE WHEN close_minute = 1110 THEN 1080 ELSE close_minute END,
       updated_at = now(),
       updated_by = 'rollback:0009'
 WHERE id = 1 AND updated_by = 'migration:0009';

COMMIT;
