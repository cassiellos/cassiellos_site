-- 0013 — CONSOLIDAÇÃO DAS DESPESAS DE OUTUBRO | PASSO 1: DESCOBERTA (SOMENTE LEITURA, Neon PREVIEW)
-- Não altera nada. Lista as fontes envolvidas com IDs reais e PROPÕE os pares para conferência humana.
-- A proposta é só um ponto de partida: o passo 2 executa exclusivamente os pares de IDs que forem confirmados.
BEGIN READ ONLY;
SELECT current_database() AS banco, now() AS horario;

-- A) Fontes de despesa (antes: 19 = 10 recorrentes + 9 avulsas encerradas)
SELECT s.id, s.description, s.category, s.periodicity, s.status, s.amount_cents, s.start_date, s.end_date, s.due_day,
       to_char(s.generate_from, 'YYYY-MM') AS gera_desde,
       (SELECT count(*) FROM crm.finance_entries e WHERE e.source_id = s.id) AS lancamentos
  FROM crm.finance_sources s WHERE s.direction = 'out' ORDER BY s.periodicity, lower(s.description);

-- B) Candidatas a remoção: avulsas, encerradas, com UM lançamento de out/2026
SELECT s.id AS fonte_avulsa, s.description, s.category, e.id AS lancamento, e.amount_cents, e.due_date, e.status,
       (SELECT coalesce(sum(st.amount_cents), 0) FROM crm.finance_settlements st WHERE st.entry_id = e.id AND st.reversed_at IS NULL) AS pago,
       (SELECT count(*) FROM crm.finance_settlements st WHERE st.entry_id = e.id) AS movimentos
  FROM crm.finance_sources s JOIN crm.finance_entries e ON e.source_id = s.id
 WHERE s.direction = 'out' AND s.periodicity = 'one_time' AND s.status = 'ended' AND e.competence_month = DATE '2026-10-01'
 ORDER BY lower(s.description);

-- C) PROPOSTA de pares (mesma categoria + mesma primeira palavra da descrição; a fonte recorrente não pode ter
--    lançamento em out/2026). CONFERIR UM A UM antes de usar. Pares ambíguos ou ausentes devem ser resolvidos à mão.
WITH old AS (
  SELECT s.id, s.description, s.category, lower(split_part(trim(s.description), ' ', 1)) AS k
    FROM crm.finance_sources s
   WHERE s.direction = 'out' AND s.periodicity = 'one_time' AND s.status = 'ended'
     AND (SELECT count(*) FROM crm.finance_entries e WHERE e.source_id = s.id AND e.competence_month = DATE '2026-10-01') = 1
), rec AS (
  SELECT s.id, s.description, s.category, lower(split_part(trim(s.description), ' ', 1)) AS k
    FROM crm.finance_sources s
   WHERE s.direction = 'out' AND s.periodicity <> 'one_time' AND s.status = 'active'
     AND NOT EXISTS (SELECT 1 FROM crm.finance_entries e WHERE e.source_id = s.id AND e.competence_month = DATE '2026-10-01')
)
SELECT old.id AS old, rec.id AS new, old.description AS avulsa, rec.description AS recorrente,
       old.category = rec.category AS mesma_categoria,
       count(*) OVER (PARTITION BY old.id) AS candidatos_para_esta_avulsa
  FROM old LEFT JOIN rec ON rec.k = old.k
 ORDER BY old.description;

-- D) Mapa pronto para o passo 2 (somente pares únicos). Conferir antes de usar.
WITH old AS (
  SELECT s.id, s.description, lower(split_part(trim(s.description), ' ', 1)) AS k FROM crm.finance_sources s
   WHERE s.direction = 'out' AND s.periodicity = 'one_time' AND s.status = 'ended'
), rec AS (
  SELECT s.id, lower(split_part(trim(s.description), ' ', 1)) AS k FROM crm.finance_sources s
   WHERE s.direction = 'out' AND s.periodicity <> 'one_time' AND s.status = 'active'
), pairs AS (
  SELECT old.id AS old, min(rec.id::text)::uuid AS new, old.description AS label, count(rec.id) AS n
    FROM old JOIN rec ON rec.k = old.k GROUP BY old.id, old.description
)
SELECT json_agg(json_build_object('old', old, 'new', new, 'label', label) ORDER BY label) AS mapa_para_conferir,
       count(*) FILTER (WHERE n <> 1) AS pares_ambiguos
  FROM pairs;

-- E) Totais de referência (devem ser IGUAIS depois do passo 2)
SELECT to_char(e.competence_month, 'YYYY-MM') AS competencia, count(*) AS lancamentos, sum(e.amount_cents) AS centavos
  FROM crm.finance_entries e
 WHERE e.direction = 'out' AND e.status = 'open' AND NOT e.client_ad_budget AND e.competence_month IN (DATE '2026-10-01', DATE '2026-11-01')
 GROUP BY 1 ORDER BY 1;
SELECT to_char(st.settled_on, 'YYYY-MM') AS caixa, e.direction, sum(st.amount_cents) AS centavos
  FROM crm.finance_settlements st JOIN crm.finance_entries e ON e.id = st.entry_id
 WHERE st.reversed_at IS NULL AND NOT e.client_ad_budget AND st.settled_on BETWEEN DATE '2026-10-01' AND DATE '2026-10-31'
 GROUP BY 1, 2 ORDER BY 2;
SELECT (SELECT count(*) FROM crm.finance_entries) AS lancamentos, (SELECT count(*) FROM crm.finance_settlements) AS movimentos,
       (SELECT sum(amount_cents) FROM crm.finance_settlements WHERE reversed_at IS NULL) AS movimentos_centavos;
COMMIT;
