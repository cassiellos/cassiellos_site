-- 0013 — REVERSÃO DA CONSOLIDAÇÃO (Neon PREVIEW, somente com autorização)
-- Recria as fontes avulsas a partir do backup crm.finance_ops_0013_backup_sources e devolve cada lançamento à sua
-- fonte original. Não apaga lançamentos nem pagamentos. Uma transação; aborta se os totais mudarem. Reexecutável.
--   psql "$URL_DO_PREVIEW" -v ON_ERROR_STOP=1 -f db/ops/0013_consolidate_rollback.sql
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE crm.finance_sources, crm.finance_entries, crm.finance_settlements IN SHARE ROW EXCLUSIVE MODE;
DO $revert$
DECLARE
  m record; n int := 0;
  b_sum bigint; b_sett text; a_sum bigint; a_sett text;
BEGIN
  SELECT coalesce(sum(amount_cents), 0) INTO b_sum FROM crm.finance_entries;
  SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t.id), '')) INTO b_sett FROM crm.finance_settlements t;
  FOR m IN SELECT * FROM crm.finance_ops_0013_map WHERE reverted_at IS NULL LOOP
    IF NOT EXISTS (SELECT 1 FROM crm.finance_ops_0013_backup_sources WHERE id = m.old_source_id) THEN
      RAISE EXCEPTION '0013 reversão: backup da fonte % ausente', m.old_source_id; END IF;
    INSERT INTO crm.finance_sources SELECT b.* FROM crm.finance_ops_0013_backup_sources b
     WHERE b.id = m.old_source_id AND NOT EXISTS (SELECT 1 FROM crm.finance_sources s WHERE s.id = b.id);
    UPDATE crm.finance_entries SET source_id = m.old_source_id, updated_at = now() WHERE id = m.entry_id AND source_id = m.new_source_id;
    IF (SELECT source_id FROM crm.finance_entries WHERE id = m.entry_id) IS DISTINCT FROM m.old_source_id THEN
      RAISE EXCEPTION '0013 reversão: lançamento % não pôde voltar à fonte original', m.entry_id; END IF;
    UPDATE crm.finance_ops_0013_map SET reverted_at = now() WHERE old_source_id = m.old_source_id;
    INSERT INTO crm.finance_audit_log (entity, entity_id, action, actor, details) VALUES
      ('entry', m.entry_id, 'source_reassignment_reverted', 'ops-0013', json_build_object('from', m.new_source_id, 'to', m.old_source_id)::jsonb),
      ('source', m.old_source_id, 'consolidation_reverted', 'ops-0013', json_build_object('entryId', m.entry_id)::jsonb);
    n := n + 1;
  END LOOP;
  SELECT coalesce(sum(amount_cents), 0) INTO a_sum FROM crm.finance_entries;
  SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t.id), '')) INTO a_sett FROM crm.finance_settlements t;
  IF a_sum <> b_sum OR a_sett <> b_sett THEN RAISE EXCEPTION '0013 reversão: valores mudaram'; END IF;
  RAISE NOTICE '0013 reversão: % pares revertidos', n;
END
$revert$;
COMMIT;
