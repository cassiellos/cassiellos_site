-- 0013 — CONSOLIDAÇÃO DAS DESPESAS DE OUTUBRO | PASSO 2: EXECUÇÃO (Neon PREVIEW, com autorização)
--
-- Reassocia os 9 lançamentos AVULSOS de out/2026 às fontes RECORRENTES correspondentes e só então exclui as 9 fontes
-- avulsas redundantes. Lançamentos e pagamentos NÃO são apagados nem recriados: mesmos IDs, valores, competência,
-- vencimentos, datas e observações dos pagamentos. Uma única transação: qualquer divergência aborta TUDO.
--
-- USO (o mapa é OBRIGATÓRIO e usa IDs reais conferidos no passo 1 — nada é escolhido por semelhança de texto):
--   psql "$URL_DO_PREVIEW" -v ON_ERROR_STOP=1 \
--     -v map='[{"old":"<uuid avulsa>","new":"<uuid recorrente>","label":"Adobe"}, ... 9 pares ...]' \
--     -f db/ops/0013_consolidate_expenses.sql
--
-- Garantias verificadas DENTRO da transação (falha = ROLLBACK, nada muda):
--  - exatamente 9 pares; IDs distintos; nenhuma fonte aparece como antiga e nova;
--  - antiga: despesa, avulsa (one_time), encerrada, exatamente 1 lançamento, competência out/2026, sem nota fiscal;
--  - nova: despesa, recorrente, ativa, SEM lançamento em out/2026 (o índice único origem+mês impede duplicidade e o
--    motor de recorrência não gera meses já ocupados nem anteriores a generate_from);
--  - depois: mesmas contagens e somas de lançamentos e pagamentos, mesmos totais de out e nov, pagamentos idênticos
--    (hash), lançamentos idênticos exceto source_id/updated_at, fontes recorrentes intocadas, nenhuma referência
--    às fontes excluídas. A chave estrangeira (sem CASCADE) impede apagar fonte que ainda tenha lançamento.
--  - backup verificável em crm.finance_ops_0013_* (fontes, lançamentos e pagamentos envolvidos) + mapa + auditoria.
-- Reexecutar é seguro: pares já consolidados são reconhecidos e ignorados.
-- Reversão: db/ops/0013_consolidate_rollback.sql (recria as fontes a partir do backup).

\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
SELECT set_config('ops0013.map', :'map', true) \g /dev/null

CREATE TABLE IF NOT EXISTS crm.finance_ops_0013_map (
    old_source_id   uuid PRIMARY KEY,
    new_source_id   uuid NOT NULL,
    entry_id        uuid NOT NULL,
    label           text NOT NULL DEFAULT '',
    consolidated_at timestamptz NOT NULL DEFAULT now(),
    reverted_at     timestamptz
);
CREATE TABLE IF NOT EXISTS crm.finance_ops_0013_backup_sources (LIKE crm.finance_sources);
CREATE TABLE IF NOT EXISTS crm.finance_ops_0013_backup_entries (LIKE crm.finance_entries);
CREATE TABLE IF NOT EXISTS crm.finance_ops_0013_backup_settlements (LIKE crm.finance_settlements);

-- Ninguém escreve no Financeiro enquanto a consolidação roda (as leituras continuam).
LOCK TABLE crm.finance_sources, crm.finance_entries, crm.finance_settlements, crm.finance_invoices IN SHARE ROW EXCLUSIVE MODE;

DO $consolidate$
DECLARE
  m record;
  e record;
  n_map int; n_pending int := 0; n_done int := 0; n_deleted int;
  olds uuid[]; news uuid[];
  b_entries bigint; b_entries_sum bigint; b_sett bigint; b_sett_sum bigint; b_sett_hash text; b_entries_hash text;
  b_oct bigint; b_nov bigint; b_out_sources int; b_new_hash text; b_oct_paid bigint;
  a_entries bigint; a_entries_sum bigint; a_sett bigint; a_sett_sum bigint; a_sett_hash text; a_entries_hash text;
  a_oct bigint; a_nov bigint; a_out_sources int; a_new_hash text; a_oct_paid bigint;
BEGIN
  CREATE TEMP TABLE ops0013_input ON COMMIT DROP AS
    SELECT x.old, x.new, coalesce(x.label, '') AS label
      FROM json_to_recordset(current_setting('ops0013.map')::json) AS x(old uuid, new uuid, label text);

  -- 1) Mapa: exatamente 9 pares, sem repetição nem cruzamento
  SELECT count(*) INTO n_map FROM ops0013_input;
  IF n_map <> 9 THEN RAISE EXCEPTION '0013: o mapa deve ter exatamente 9 pares (recebido: %)', n_map; END IF;
  IF EXISTS (SELECT 1 FROM ops0013_input WHERE old IS NULL OR new IS NULL OR old = new) THEN RAISE EXCEPTION '0013: par com ID vazio ou repetido'; END IF;
  IF (SELECT count(DISTINCT old) FROM ops0013_input) <> 9 OR (SELECT count(DISTINCT new) FROM ops0013_input) <> 9 THEN
    RAISE EXCEPTION '0013: IDs repetidos no mapa (cada avulsa e cada recorrente aparece uma única vez)'; END IF;
  IF EXISTS (SELECT 1 FROM ops0013_input a JOIN ops0013_input b ON a.old = b.new) THEN RAISE EXCEPTION '0013: uma fonte aparece como antiga e como nova'; END IF;
  SELECT array_agg(old ORDER BY old), array_agg(new ORDER BY old) INTO olds, news FROM ops0013_input;

  -- 2) Fotografia ANTES (todo o Financeiro, não só os envolvidos)
  SELECT count(*), coalesce(sum(amount_cents), 0) INTO b_entries, b_entries_sum FROM crm.finance_entries;
  SELECT md5(coalesce(string_agg(concat_ws('|', id, direction, client_id, category, description, competence_month, due_date, amount_cents,
           invoice_required, client_ad_budget, status, cancelled_at, cancel_reason, created_at), ',' ORDER BY id), '')) INTO b_entries_hash FROM crm.finance_entries;
  SELECT count(*), coalesce(sum(amount_cents), 0), md5(coalesce(string_agg(t::text, ',' ORDER BY t.id), ''))
    INTO b_sett, b_sett_sum, b_sett_hash FROM crm.finance_settlements t;
  SELECT coalesce(sum(amount_cents) FILTER (WHERE competence_month = DATE '2026-10-01'), 0),
         coalesce(sum(amount_cents) FILTER (WHERE competence_month = DATE '2026-11-01'), 0)
    INTO b_oct, b_nov FROM crm.finance_entries WHERE direction = 'out' AND status = 'open' AND NOT client_ad_budget;
  SELECT coalesce(sum(st.amount_cents), 0) INTO b_oct_paid FROM crm.finance_settlements st JOIN crm.finance_entries x ON x.id = st.entry_id
   WHERE x.direction = 'out' AND st.reversed_at IS NULL AND NOT x.client_ad_budget AND st.settled_on BETWEEN DATE '2026-10-01' AND DATE '2026-10-31';
  SELECT count(*) INTO b_out_sources FROM crm.finance_sources WHERE direction = 'out';
  SELECT md5(coalesce(string_agg(s::text, ',' ORDER BY s.id), '')) INTO b_new_hash FROM crm.finance_sources s WHERE s.id = ANY(news);

  -- 3) Validação par a par
  FOR m IN SELECT * FROM ops0013_input ORDER BY label LOOP
    IF NOT EXISTS (SELECT 1 FROM crm.finance_sources WHERE id = m.old) THEN
      -- já consolidado numa execução anterior? Só aceita se o registro do mapa e o lançamento confirmarem.
      IF EXISTS (SELECT 1 FROM crm.finance_ops_0013_map mp JOIN crm.finance_entries x ON x.id = mp.entry_id
                  WHERE mp.old_source_id = m.old AND mp.new_source_id = m.new AND mp.reverted_at IS NULL AND x.source_id = m.new) THEN
        n_done := n_done + 1; CONTINUE;
      END IF;
      RAISE EXCEPTION '0013: fonte avulsa % (%) não existe e não consta como consolidada', m.old, m.label;
    END IF;
    PERFORM 1 FROM crm.finance_sources WHERE id = m.old AND direction = 'out' AND periodicity = 'one_time' AND status = 'ended';
    IF NOT FOUND THEN RAISE EXCEPTION '0013: % (%) não é despesa avulsa encerrada', m.old, m.label; END IF;
    PERFORM 1 FROM crm.finance_sources WHERE id = m.new AND direction = 'out' AND periodicity <> 'one_time' AND status = 'active';
    IF NOT FOUND THEN RAISE EXCEPTION '0013: % (%) não é despesa recorrente ativa', m.new, m.label; END IF;
    IF (SELECT count(*) FROM crm.finance_entries WHERE source_id = m.old) <> 1 THEN
      RAISE EXCEPTION '0013: a avulsa % (%) deveria ter exatamente 1 lançamento', m.old, m.label; END IF;
    SELECT * INTO e FROM crm.finance_entries WHERE source_id = m.old;
    IF e.competence_month <> DATE '2026-10-01' OR e.direction <> 'out' THEN
      RAISE EXCEPTION '0013: lançamento % (%) não é despesa de out/2026', e.id, m.label; END IF;
    IF EXISTS (SELECT 1 FROM crm.finance_entries WHERE source_id = m.new AND competence_month = e.competence_month) THEN
      RAISE EXCEPTION '0013: a recorrente % (%) já tem lançamento em out/2026 — consolidar duplicaria a competência', m.new, m.label; END IF;
    IF EXISTS (SELECT 1 FROM crm.finance_invoices WHERE entry_id = e.id) THEN RAISE EXCEPTION '0013: lançamento % tem nota fiscal', e.id; END IF;
    IF (SELECT category FROM crm.finance_sources WHERE id = m.old) <> (SELECT category FROM crm.finance_sources WHERE id = m.new) THEN
      RAISE NOTICE '0013: % — categorias diferentes entre avulsa e recorrente; o lançamento mantém a categoria original', m.label; END IF;

    -- 4) Backup verificável (idempotente)
    INSERT INTO crm.finance_ops_0013_backup_sources SELECT s.* FROM crm.finance_sources s
     WHERE s.id IN (m.old, m.new) AND NOT EXISTS (SELECT 1 FROM crm.finance_ops_0013_backup_sources b WHERE b.id = s.id);
    INSERT INTO crm.finance_ops_0013_backup_entries SELECT x.* FROM crm.finance_entries x
     WHERE x.id = e.id AND NOT EXISTS (SELECT 1 FROM crm.finance_ops_0013_backup_entries b WHERE b.id = x.id);
    INSERT INTO crm.finance_ops_0013_backup_settlements SELECT t.* FROM crm.finance_settlements t
     WHERE t.entry_id = e.id AND NOT EXISTS (SELECT 1 FROM crm.finance_ops_0013_backup_settlements b WHERE b.id = t.id);

    -- 5) Reassociação (só o vínculo; nada mais no lançamento muda) + rastreabilidade
    UPDATE crm.finance_entries SET source_id = m.new, updated_at = now() WHERE id = e.id AND source_id = m.old;
    INSERT INTO crm.finance_ops_0013_map (old_source_id, new_source_id, entry_id, label) VALUES (m.old, m.new, e.id, m.label)
      ON CONFLICT (old_source_id) DO UPDATE SET new_source_id = EXCLUDED.new_source_id, entry_id = EXCLUDED.entry_id,
        label = EXCLUDED.label, consolidated_at = now(), reverted_at = NULL;
    INSERT INTO crm.finance_audit_log (entity, entity_id, action, actor, details) VALUES
      ('entry', e.id, 'source_reassigned', 'ops-0013', json_build_object('from', m.old, 'to', m.new, 'label', m.label)::jsonb),
      ('source', m.old, 'consolidated_deleted', 'ops-0013', json_build_object('into', m.new, 'entryId', e.id, 'label', m.label)::jsonb),
      ('source', m.new, 'consolidated_from', 'ops-0013', json_build_object('from', m.old, 'entryId', e.id, 'label', m.label)::jsonb);
    n_pending := n_pending + 1;
  END LOOP;

  IF n_pending = 0 THEN RAISE NOTICE '0013: os 9 pares já estavam consolidados — nada a fazer.'; RETURN; END IF;

  -- 6) Exclusão definitiva SOMENTE das fontes avulsas do mapa, já sem nenhum lançamento (FK sem CASCADE).
  DELETE FROM crm.finance_sources s
   WHERE s.id = ANY(olds) AND s.direction = 'out' AND s.periodicity = 'one_time' AND s.status = 'ended'
     AND NOT EXISTS (SELECT 1 FROM crm.finance_entries x WHERE x.source_id = s.id);
  GET DIAGNOSTICS n_deleted = ROW_COUNT;
  IF n_deleted <> n_pending THEN RAISE EXCEPTION '0013: excluídas % fontes, esperadas %', n_deleted, n_pending; END IF;

  -- 7) Fotografia DEPOIS e comparação
  SELECT count(*), coalesce(sum(amount_cents), 0) INTO a_entries, a_entries_sum FROM crm.finance_entries;
  SELECT md5(coalesce(string_agg(concat_ws('|', id, direction, client_id, category, description, competence_month, due_date, amount_cents,
           invoice_required, client_ad_budget, status, cancelled_at, cancel_reason, created_at), ',' ORDER BY id), '')) INTO a_entries_hash FROM crm.finance_entries;
  SELECT count(*), coalesce(sum(amount_cents), 0), md5(coalesce(string_agg(t::text, ',' ORDER BY t.id), ''))
    INTO a_sett, a_sett_sum, a_sett_hash FROM crm.finance_settlements t;
  SELECT coalesce(sum(amount_cents) FILTER (WHERE competence_month = DATE '2026-10-01'), 0),
         coalesce(sum(amount_cents) FILTER (WHERE competence_month = DATE '2026-11-01'), 0)
    INTO a_oct, a_nov FROM crm.finance_entries WHERE direction = 'out' AND status = 'open' AND NOT client_ad_budget;
  SELECT coalesce(sum(st.amount_cents), 0) INTO a_oct_paid FROM crm.finance_settlements st JOIN crm.finance_entries x ON x.id = st.entry_id
   WHERE x.direction = 'out' AND st.reversed_at IS NULL AND NOT x.client_ad_budget AND st.settled_on BETWEEN DATE '2026-10-01' AND DATE '2026-10-31';
  SELECT count(*) INTO a_out_sources FROM crm.finance_sources WHERE direction = 'out';
  SELECT md5(coalesce(string_agg(s::text, ',' ORDER BY s.id), '')) INTO a_new_hash FROM crm.finance_sources s WHERE s.id = ANY(news);

  IF (a_entries, a_entries_sum, a_entries_hash) IS DISTINCT FROM (b_entries, b_entries_sum, b_entries_hash) THEN
    RAISE EXCEPTION '0013: lançamentos mudaram (antes % / %, depois % / %)', b_entries, b_entries_sum, a_entries, a_entries_sum; END IF;
  IF (a_sett, a_sett_sum, a_sett_hash) IS DISTINCT FROM (b_sett, b_sett_sum, b_sett_hash) THEN RAISE EXCEPTION '0013: pagamentos mudaram'; END IF;
  IF (a_oct, a_nov, a_oct_paid) IS DISTINCT FROM (b_oct, b_nov, b_oct_paid) THEN
    RAISE EXCEPTION '0013: totais mudaram (out % → %, nov % → %, pago out % → %)', b_oct, a_oct, b_nov, a_nov, b_oct_paid, a_oct_paid; END IF;
  IF a_new_hash IS DISTINCT FROM b_new_hash THEN RAISE EXCEPTION '0013: fontes recorrentes foram alteradas'; END IF;
  IF a_out_sources <> b_out_sources - n_pending THEN RAISE EXCEPTION '0013: contagem de fontes inesperada (% → %)', b_out_sources, a_out_sources; END IF;
  IF EXISTS (SELECT 1 FROM crm.finance_entries WHERE source_id = ANY(olds)) THEN RAISE EXCEPTION '0013: lançamento órfão'; END IF;
  IF EXISTS (SELECT source_id, competence_month FROM crm.finance_entries WHERE source_id IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1) THEN
    RAISE EXCEPTION '0013: competência duplicada'; END IF;

  RAISE NOTICE '0013: consolidados % pares (% já estavam). Fontes de despesa: % → %. Lançamentos: % (inalterados). Pagamentos: % (inalterados). Out/2026: % centavos; pago em out: %; Nov/2026: % centavos.',
    n_pending, n_done, b_out_sources, a_out_sources, a_entries, a_sett, a_oct, a_oct_paid, a_nov;
END
$consolidate$;

COMMIT;
