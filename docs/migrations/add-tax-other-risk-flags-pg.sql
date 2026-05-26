-- Добавляет флаги is_tax_risk_table и is_other_risk_table в act_tables
-- и обновляет partial-индекс idx_act_tables_special_flags.
-- Применять на существующих PostgreSQL-инсталляциях (свежие БД получают
-- схему из app/domains/acts/migrations/postgresql/schema.sql).

ALTER TABLE {SCHEMA}.{PREFIX}act_tables
    ADD COLUMN IF NOT EXISTS is_tax_risk_table BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_other_risk_table BOOLEAN DEFAULT FALSE;

DROP INDEX IF EXISTS {SCHEMA}.idx_{PREFIX}act_tables_special_flags;

CREATE INDEX idx_{PREFIX}act_tables_special_flags
    ON {SCHEMA}.{PREFIX}act_tables(act_id)
    WHERE is_metrics_table = TRUE
       OR is_main_metrics_table = TRUE
       OR is_regular_risk_table = TRUE
       OR is_operational_risk_table = TRUE
       OR is_tax_risk_table = TRUE
       OR is_other_risk_table = TRUE;
