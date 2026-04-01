-- Схема ЦК Клиентский опыт (PostgreSQL)

-- ============================================================================
-- ТАБЛИЦА CS-ВАЛИДАЦИИ
-- ============================================================================

CREATE TABLE IF NOT EXISTS t_db_oarb_ck_cs_validation (
    id SERIAL PRIMARY KEY,
    reestr_metric_id TEXT NOT NULL DEFAULT '',
    neg_finder_tb_id TEXT NOT NULL DEFAULT '',
    metric_code TEXT NOT NULL DEFAULT '',
    metric_unic_clients BIGINT DEFAULT 0,
    metric_element_counts BIGINT DEFAULT 0,
    metric_amount_rubles NUMERIC(38, 2) DEFAULT 0,
    is_sent_to_top_brass BOOLEAN DEFAULT false,
    km_id TEXT NOT NULL DEFAULT '',
    num_sz TEXT NOT NULL DEFAULT '',
    dt_sz DATE,
    act_item_number TEXT NOT NULL DEFAULT '',
    process_number TEXT NOT NULL DEFAULT '',
    process_name TEXT NOT NULL DEFAULT '',
    ck_comment TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    created_by TEXT DEFAULT 'system',
    updated_by TEXT,
    deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_ck_cs_validation_metric ON t_db_oarb_ck_cs_validation(metric_code);
CREATE INDEX IF NOT EXISTS idx_ck_cs_validation_dt_sz ON t_db_oarb_ck_cs_validation(dt_sz);
CREATE INDEX IF NOT EXISTS idx_ck_cs_validation_actual ON t_db_oarb_ck_cs_validation(is_actual);

-- ============================================================================
-- VIEW CS-ВАЛИДАЦИИ
-- ============================================================================

CREATE OR REPLACE VIEW v_db_oarb_ck_cs_validation AS
SELECT
    cs.*,
    sn.act_sub_number
FROM t_db_oarb_ck_cs_validation cs
LEFT JOIN t_db_oarb_ua_sub_number sn ON sn.km_id = cs.km_id
WHERE cs.is_actual = true;

-- ============================================================================
-- ТЕСТОВЫЕ ДАННЫЕ
-- ============================================================================

INSERT INTO t_db_oarb_ck_cs_validation (
    reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, ck_comment, created_by
) VALUES
    ('CS001', '14', '101', 25, 30, 500000.00, true,
     'КМ-09-41726', 'ЦА 36-мо0255', '2026-01-15', '3.1.1',
     '3119', 'Работа с обратной связью клиентов', 'Комментарий', '22494524'),
    ('CS002', '7', '102', 10, 15, 200000.50, false,
     'КМ-07-30001', 'МСК 12-мо0100', '2026-02-10', '2.2.3',
     '5010', 'Осуществление переводов', '', '22501001'),
    ('CS003', '4', '103', 50, 75, 1500000.00, true,
     'КМ-14-50001', 'ЦА 50-мо0300', '2026-03-01', '4.1.1',
     '2014', 'Программа лояльности', 'Требует внимания', '22501002'),
    ('CS004', '14', '17', 5, 8, 0, false,
     'КМ-09-41726', 'ЦА 36-мо0255', '2025-11-20', '1.3.2',
     '1010', 'Управление операционным риском', '', '22494524'),
    ('CS005', '8', '19', 15, 20, 350000.25, false,
     'КМ-07-30001', 'МСК 12-мо0100', '2025-12-05', '5.2.1',
     '7010', 'Ведение кредитных сделок', 'Рекомендация выдана', '22501003')
ON CONFLICT DO NOTHING;
