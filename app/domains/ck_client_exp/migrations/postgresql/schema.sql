-- Схема ЦК Клиентский опыт (PostgreSQL)

-- ============================================================================
-- ТАБЛИЦА CS-ВАЛИДАЦИИ
-- ============================================================================

CREATE TABLE IF NOT EXISTS t_db_oarb_ck_cs_validation (
    id SERIAL PRIMARY KEY,

    -- Идентификатор записи в таблице sub_number (связь с актом)
    act_sub_number_id BIGINT,

    reestr_metric_id BIGINT,
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
    -- Блок-владелец процесса (фиксируется на момент создания записи)
    block_owner TEXT NOT NULL DEFAULT '',
    -- Подразделение-владелец процесса (фиксируется на момент создания записи)
    department_owner TEXT NOT NULL DEFAULT '',
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
CREATE INDEX IF NOT EXISTS idx_ck_cs_validation_act_sub_number_id ON t_db_oarb_ck_cs_validation(act_sub_number_id);

-- ============================================================================
-- VIEW CS-ВАЛИДАЦИИ
-- Присоединяет номер акта из справочника служебных записок по act_sub_number_id.
-- Поля block_owner/department_owner хранятся в самой таблице
-- (фиксируются на момент создания записи).
-- ============================================================================

CREATE OR REPLACE VIEW v_db_oarb_ck_cs_validation AS
SELECT
    cs.*,
    sn.act_sub_number
FROM t_db_oarb_ck_cs_validation cs
LEFT JOIN t_db_oarb_ua_sub_number sn ON sn.id = cs.act_sub_number_id
WHERE cs.is_actual = true;

-- ============================================================================
-- ТЕСТОВЫЕ ДАННЫЕ
-- ============================================================================

-- 1. Несоблюдение лимитов кредитования (п. 5.1.1, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, '14', '1001', 25, 30, 500000.00, true,
    'КМ-09-41726', '255', '2026-01-15', '5.1.1',
    'П6152', 'Кредитование юридических лиц', 'Кредитование', 'Департамент кредитования ЮЛ', 'Превышение лимитов кредитования по портфелю ЮЛ', '22494524'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation LIMIT 1);

-- 2. Нарушение порядка оценки залога (п. 5.2.3, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, '7', '1002', 10, 15, 200000.50, false,
    'КМ-07-30001', '100', '2026-02-10', '5.2.3',
    'П6152', 'Кредитование юридических лиц', 'Кредитование', 'Департамент кредитования ЮЛ', '', '22501001'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation LIMIT 1);

-- 3. Некорректное определение категории качества (п. 5.1, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, '14', '1003', 50, 75, 1500000.00, true,
    'КМ-14-50001', '300', '2026-03-01', '5.1',
    'П6401', 'Управление рисками', 'Риски', 'Управление рисками', 'Требует внимания', '22501002'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation LIMIT 1);

-- 4. Нарушение порядка формирования резервов (п. 5.3.2, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, '14', '1004', 5, 8, 0, false,
    'КМ-09-41726', '255', '2025-11-20', '5.3.2',
    'П6802', 'Внутренний контроль', 'Риски', 'Департамент внутреннего контроля', '', '22494524'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation LIMIT 1);

-- 5. Несоблюдение лимитов кредитования (п. 5.2.1, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, '8', '1001', 15, 20, 350000.25, false,
    'КМ-07-30001', '100', '2025-12-05', '5.2.1',
    'П6401', 'Управление рисками', 'Риски', 'Управление рисками', 'Рекомендация выдана', '22501001'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation LIMIT 1);
