-- Greenplum 6.x (PG 9.4) — добавляем флаги is_tax_risk_table и is_other_risk_table
-- в act_tables и обновляем partial-индекс idx_act_tables_special_flags.
-- В GP 6.x нет ADD COLUMN IF NOT EXISTS, поэтому при ручном применении на уже
-- мигрированной БД оператор ADD COLUMN упадёт с DuplicateColumnError —
-- адаптер на старте приложения это глотает; в ручном режиме запускайте
-- statements по одному и игнорируйте «column already exists».

ALTER TABLE {SCHEMA}.{PREFIX}act_tables
    ADD COLUMN is_tax_risk_table BOOLEAN DEFAULT FALSE;

ALTER TABLE {SCHEMA}.{PREFIX}act_tables
    ADD COLUMN is_other_risk_table BOOLEAN DEFAULT FALSE;

DROP INDEX IF EXISTS {SCHEMA}.idx_{PREFIX}act_tables_special_flags;

CREATE INDEX idx_{PREFIX}act_tables_special_flags
    ON {SCHEMA}.{PREFIX}act_tables(act_id)
    WHERE is_metrics_table = TRUE
       OR is_main_metrics_table = TRUE
       OR is_regular_risk_table = TRUE
       OR is_operational_risk_table = TRUE
       OR is_tax_risk_table = TRUE
       OR is_other_risk_table = TRUE;
