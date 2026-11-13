/**
 * SQL da futura implementação PostgreSQL do SyncStore (tabelas das migrações 0017/0018). Nesta fase só é usado pelos
 * testes em banco DESCARTÁVEL (migrations.db.test.ts) — nunca contra o Neon.
 *
 * Upsert idempotente: repetir a mesma linha não grava nada (WHERE … IS DISTINCT FROM) e não devolve linha;
 * linha nova devolve inserted=true; linha alterada devolve inserted=false.
 */
export const UPSERT_ADS_DAILY_SQL = `
INSERT INTO crm.mi_ads_daily (asset_id, campaign_id, day, conversion_basis, currency_code, impressions, clicks, cost_micros,
                              conversions, conversions_value_micros, attribution, sync_job_id, fetched_at)
VALUES ($1, $2, $3::date, $4, $5, $6, $7, $8, $9, $10, $11, $12, now())
ON CONFLICT (asset_id, campaign_id, day, conversion_basis) DO UPDATE SET
  currency_code = EXCLUDED.currency_code, impressions = EXCLUDED.impressions, clicks = EXCLUDED.clicks,
  cost_micros = EXCLUDED.cost_micros, conversions = EXCLUDED.conversions, conversions_value_micros = EXCLUDED.conversions_value_micros,
  attribution = EXCLUDED.attribution, sync_job_id = EXCLUDED.sync_job_id, fetched_at = now()
WHERE (crm.mi_ads_daily.currency_code, crm.mi_ads_daily.impressions, crm.mi_ads_daily.clicks, crm.mi_ads_daily.cost_micros,
       crm.mi_ads_daily.conversions, crm.mi_ads_daily.conversions_value_micros, crm.mi_ads_daily.attribution)
  IS DISTINCT FROM
      (EXCLUDED.currency_code, EXCLUDED.impressions, EXCLUDED.clicks, EXCLUDED.cost_micros,
       EXCLUDED.conversions, EXCLUDED.conversions_value_micros, EXCLUDED.attribution)
RETURNING (xmax = 0) AS inserted`

/** Lease no banco: só um job `running` por ativo (índice único parcial mi_sync_one_running). */
export const START_SYNC_JOB_SQL = `
INSERT INTO crm.mi_sync_jobs (asset_id, kind, trigger, range_start, range_end, status, lease_owner, lease_until, started_at)
VALUES ($1, $2, $3, $4::date, $5::date, 'running', $6, now() + make_interval(secs => $7), now())
ON CONFLICT DO NOTHING
RETURNING id`

/** Métricas que alimentam painéis: SOMENTE ativos com vínculo CONFIRMADO e vigente do cliente informado. */
export const CLIENT_ADS_ROWS_SQL = `
SELECT d.asset_id, d.day::text AS day, d.currency_code, d.impressions, d.clicks, d.cost_micros, d.conversions, d.conversion_basis, d.attribution
  FROM crm.mi_ads_daily d
  JOIN crm.mi_client_assets ca ON ca.asset_id = d.asset_id AND ca.client_id = $1 AND ca.status = 'confirmed' AND ca.valid_to IS NULL
 WHERE d.day BETWEEN $2::date AND $3::date
 ORDER BY d.day, d.asset_id`
