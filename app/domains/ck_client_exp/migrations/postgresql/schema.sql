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
-- Идемпотентность обеспечивается по-строчной проверкой существования
-- (km_id + act_item_number + metric_code), а не общим "таблица непуста":
-- иначе при создании схемы в одной транзакции вставилась бы только первая строка.
-- act_sub_number в подзапросе — только из справочника t_db_oarb_ua_sub_number
-- (иначе act_sub_number_id = NULL). reestr_metric_id управляется ETL (NULL).
-- ============================================================================

-- 1. Превышение лимитов кредитования ЮЛ (п. 5.1.1, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, '14', '1001', 25, 30, 500000.00, true,
    'КМ-09-41726', '255', '2026-01-15', '5.1.1',
    'П6152', 'Кредитование юридических лиц', 'Кредитование', 'Департамент кредитования ЮЛ', 'Превышение установленных лимитов кредитования по портфелю ЮЛ', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.1.1' AND metric_code = '1001');

-- 2. Нарушение порядка оценки залога (п. 5.1.2, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, '7', '1002', 12, 18, 240500.50, false,
    'КМ-09-41726', '255', '2026-01-22', '5.1.2',
    'П6153', 'Кредитование физических лиц', 'Розничный бизнес', 'Департамент кредитования ФЛ', 'Оценка залога проведена без актуального отчёта независимого оценщика', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.1.2' AND metric_code = '1002');

-- 3. Некорректное определение категории качества (п. 5.1.4, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, '8', '1003', 40, 55, 1250000.00, true,
    'КМ-09-41726', '255', '2026-02-03', '5.1.4',
    'П6401', 'Управление рисками', 'Риски', 'Управление рисками', 'Категория качества ссуды определена без учёта финансового положения заёмщика', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.1.4' AND metric_code = '1003');

-- 4. Нарушение порядка формирования резервов (п. 5.2, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, '1', '1004', 8, 10, 90000.00, false,
    'КМ-09-41726', '255', '2025-11-20', '5.2',
    'П6802', 'Внутренний контроль', 'Риски', 'Департамент внутреннего контроля', 'Резерв на возможные потери сформирован в заниженном размере', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.2' AND metric_code = '1004');

-- 5. Выдача кредитов сверх лимита (п. 5.2.1, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, '4', '1001', 33, 41, 780000.75, true,
    'КМ-09-41726', '255', '2026-02-14', '5.2.1',
    'П6301', 'Расчётно-кассовое обслуживание', 'Транзакционный бизнес', 'Платежи и переводы', 'Выдача кредитных средств сверх лимита на одного заёмщика', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.2.1' AND metric_code = '1001');

-- 6. Завышение залоговой стоимости (п. 5.2.3, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, '14', '1002', 6, 9, 150000.00, false,
    'КМ-09-41726', '255', '2026-03-05', '5.2.3',
    'П6152', 'Кредитование юридических лиц', 'Кредитование', 'Департамент кредитования ЮЛ', 'Завышена залоговая стоимость обеспечения при выдаче кредита', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.2.3' AND metric_code = '1002');

-- 7. Занижение категории качества по реструктуризации (п. 5.3, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, '7', '1003', 21, 27, 460000.00, false,
    'КМ-09-41726', '255', '2026-03-18', '5.3',
    'П6701', 'Комплаенс и ПОД/ФТ', 'Комплаенс', 'Департамент комплаенс', 'Занижена категория качества по реструктурированным ссудам', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.3' AND metric_code = '1003');

-- 8. Недосоздание резерва по проблемной задолженности (п. 5.3.2, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, '8', '1004', 14, 16, 0.00, false,
    'КМ-09-41726', '255', '2025-12-01', '5.3.2',
    'П6401', 'Управление рисками', 'Риски', 'Управление рисками', 'Не досоздан резерв по проблемной задолженности', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.3.2' AND metric_code = '1004');

-- 9. Отсутствие контроля концентрации риска (п. 5.4, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, '14', '1001', 50, 60, 2100000.00, true,
    'КМ-09-41726', '255', '2026-04-02', '5.4',
    'П6152', 'Кредитование юридических лиц', 'Кредитование', 'Департамент кредитования ЮЛ', 'Отсутствие контроля концентрации кредитного риска по группе связанных заёмщиков', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.4' AND metric_code = '1001');

-- 10. Отсутствие мониторинга предмета залога (п. 5.4.1, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, '1', '1002', 9, 11, 320000.00, false,
    'КМ-09-41726', '255', '2026-04-15', '5.4.1',
    'П6153', 'Кредитование физических лиц', 'Розничный бизнес', 'Департамент кредитования ФЛ', 'Не проведён периодический мониторинг предмета залога', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.4.1' AND metric_code = '1002');

-- 11. Непересмотр категории качества (п. 5.1, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, '4', '1003', 27, 35, 640000.00, true,
    'КМ-09-41726', '255', '2026-05-06', '5.1',
    'П6802', 'Внутренний контроль', 'Риски', 'Департамент внутреннего контроля', 'Не пересмотрена категория качества при ухудшении обслуживания долга', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.1' AND metric_code = '1003');

-- 12. Нарушение сроков формирования резервов (п. 5.2.2, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, '7', '1004', 3, 5, 55000.00, false,
    'КМ-09-41726', '255', '2026-05-20', '5.2.2',
    'П6401', 'Управление рисками', 'Риски', 'Управление рисками', 'Нарушены сроки формирования резервов по вновь выданным ссудам', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.2.2' AND metric_code = '1004');

-- 13. Несоблюдение лимитов по среднему бизнесу (п. 5.1, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, '7', '1001', 18, 22, 410000.00, false,
    'КМ-07-30001', '100', '2026-01-12', '5.1',
    'П6152', 'Кредитование юридических лиц', 'Кредитование', 'Департамент кредитования ЮЛ', 'Несоблюдение лимитов кредитования по сегменту среднего бизнеса', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-07-30001' AND act_item_number = '5.1' AND metric_code = '1001');

-- 14. Отсутствие переоценки обеспечения (п. 5.1.1, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, '8', '1002', 11, 14, 205000.25, false,
    'КМ-07-30001', '100', '2026-01-28', '5.1.1',
    'П6153', 'Кредитование физических лиц', 'Розничный бизнес', 'Департамент кредитования ФЛ', 'Нарушен порядок оценки залога — отсутствует переоценка обеспечения', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-07-30001' AND act_item_number = '5.1.1' AND metric_code = '1002');

-- 15. Некорректная категория качества задолженности (п. 5.1.3, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, '14', '1003', 36, 48, 980000.00, true,
    'КМ-07-30001', '100', '2026-02-09', '5.1.3',
    'П6401', 'Управление рисками', 'Риски', 'Управление рисками', 'Некорректно определена категория качества ссудной задолженности', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-07-30001' AND act_item_number = '5.1.3' AND metric_code = '1003');

-- 16. Резервы без учёта обесценения обеспечения (п. 5.2, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, '1', '1004', 7, 9, 72000.00, false,
    'КМ-07-30001', '100', '2025-12-05', '5.2',
    'П6802', 'Внутренний контроль', 'Риски', 'Департамент внутреннего контроля', 'Резервы сформированы без учёта обесценения обеспечения', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-07-30001' AND act_item_number = '5.2' AND metric_code = '1004');

-- 17. Превышение лимита на связанную группу (п. 5.2.1, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, '4', '1001', 29, 34, 690000.50, true,
    'КМ-07-30001', '100', '2026-02-22', '5.2.1',
    'П6301', 'Расчётно-кассовое обслуживание', 'Транзакционный бизнес', 'Платежи и переводы', 'Превышен лимит кредитования на связанную группу заёмщиков', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-07-30001' AND act_item_number = '5.2.1' AND metric_code = '1001');

-- 18. Оценка залога без осмотра (п. 5.2.3, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, '7', '1002', 5, 7, 130000.00, false,
    'КМ-07-30001', '100', '2026-03-11', '5.2.3',
    'П6152', 'Кредитование юридических лиц', 'Кредитование', 'Департамент кредитования ЮЛ', 'Залоговая стоимость определена без выезда и осмотра предмета залога', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-07-30001' AND act_item_number = '5.2.3' AND metric_code = '1002');

-- 19. Категория качества не понижена при просрочке (п. 5.3.1, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, '8', '1003', 24, 31, 520000.00, false,
    'КМ-07-30001', '100', '2026-03-25', '5.3.1',
    'П6701', 'Комплаенс и ПОД/ФТ', 'Комплаенс', 'Департамент комплаенс', 'Категория качества не понижена при наличии просроченной задолженности', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-07-30001' AND act_item_number = '5.3.1' AND metric_code = '1003');

-- 20. Недоформирование резерва III категории (п. 5.3.2, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, '14', '1004', 16, 19, 88000.00, true,
    'КМ-07-30001', '100', '2025-12-18', '5.3.2',
    'П6401', 'Управление рисками', 'Риски', 'Управление рисками', 'Недоформирован резерв по ссуде III категории качества', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-07-30001' AND act_item_number = '5.3.2' AND metric_code = '1004');

-- 21. Кредиты сверх лимита на продукт (п. 5.4, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, '1', '1001', 44, 52, 1750000.00, true,
    'КМ-07-30001', '100', '2026-04-07', '5.4',
    'П6153', 'Кредитование физических лиц', 'Розничный бизнес', 'Департамент кредитования ФЛ', 'Кредиты выданы сверх утверждённого лимита на продукт', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-07-30001' AND act_item_number = '5.4' AND metric_code = '1001');

-- 22. Неактуальная оценка залога (п. 5.4.2, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, '4', '1002', 8, 10, 275000.00, false,
    'КМ-07-30001', '100', '2026-04-19', '5.4.2',
    'П6802', 'Внутренний контроль', 'Риски', 'Департамент внутреннего контроля', 'Не актуализирована оценка залога после истечения срока отчёта оценщика', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-07-30001' AND act_item_number = '5.4.2' AND metric_code = '1002');

-- 23. Занижение категории по однородным ссудам (п. 5.1.4, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, '7', '1003', 22, 28, 445000.00, false,
    'КМ-07-30001', '100', '2026-05-08', '5.1.4',
    'П6152', 'Кредитование юридических лиц', 'Кредитование', 'Департамент кредитования ЮЛ', 'Занижена категория качества по группе однородных ссуд', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-07-30001' AND act_item_number = '5.1.4' AND metric_code = '1003');

-- 24. Нарушение порядка и сроков резервирования (п. 5.3, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, '8', '1004', 4, 6, 61000.00, false,
    'КМ-07-30001', '100', '2026-05-23', '5.3',
    'П6401', 'Управление рисками', 'Риски', 'Управление рисками', 'Нарушен порядок и сроки формирования резервов на возможные потери', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-07-30001' AND act_item_number = '5.3' AND metric_code = '1004');

-- 25. Несоблюдение лимитов по крупным корпоративным клиентам (п. 5.1, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, '14', '1001', 30, 38, 850000.00, true,
    'КМ-14-50001', '300', '2026-01-18', '5.1',
    'П6152', 'Кредитование юридических лиц', 'Кредитование', 'Департамент кредитования ЮЛ', 'Несоблюдение лимитов кредитования по крупным корпоративным клиентам', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-14-50001' AND act_item_number = '5.1' AND metric_code = '1001');

-- 26. Оценка залога с нарушением методики (п. 5.1.2, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, '7', '1002', 13, 17, 260000.75, false,
    'КМ-14-50001', '300', '2026-02-01', '5.1.2',
    'П6153', 'Кредитование физических лиц', 'Розничный бизнес', 'Департамент кредитования ФЛ', 'Оценка предмета залога проведена с нарушением методики', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-14-50001' AND act_item_number = '5.1.2' AND metric_code = '1002');

-- 27. Категория качества без анализа денежного потока (п. 5.1.4, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, '8', '1003', 47, 61, 1350000.00, true,
    'КМ-14-50001', '300', '2026-02-12', '5.1.4',
    'П6401', 'Управление рисками', 'Риски', 'Управление рисками', 'Категория качества определена без анализа денежного потока заёмщика', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-14-50001' AND act_item_number = '5.1.4' AND metric_code = '1003');

-- 28. Заниженный резерв по проблемным активам (п. 5.2, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, '1', '1004', 6, 8, 68000.00, false,
    'КМ-14-50001', '300', '2025-11-28', '5.2',
    'П6802', 'Внутренний контроль', 'Риски', 'Департамент внутреннего контроля', 'Резерв сформирован в заниженном размере по проблемным активам', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-14-50001' AND act_item_number = '5.2' AND metric_code = '1004');

-- 29. Превышение лимита концентрации на заёмщика (п. 5.2.2, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, '4', '1001', 35, 43, 720000.25, true,
    'КМ-14-50001', '300', '2026-03-03', '5.2.2',
    'П6301', 'Расчётно-кассовое обслуживание', 'Транзакционный бизнес', 'Платежи и переводы', 'Превышение лимита концентрации на одного заёмщика', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-14-50001' AND act_item_number = '5.2.2' AND metric_code = '1001');

-- 30. Отсутствие переоценки залогового имущества (п. 5.2.4, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, '14', '1002', 9, 12, 175000.00, false,
    'КМ-14-50001', '300', '2026-03-20', '5.2.4',
    'П6152', 'Кредитование юридических лиц', 'Кредитование', 'Департамент кредитования ЮЛ', 'Не проведена переоценка залогового имущества в установленный срок', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-14-50001' AND act_item_number = '5.2.4' AND metric_code = '1002');

-- 31. Категория качества не пересмотрена при реструктуризации (п. 5.3, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, '7', '1003', 26, 33, 500000.00, false,
    'КМ-14-50001', '300', '2026-04-01', '5.3',
    'П6701', 'Комплаенс и ПОД/ФТ', 'Комплаенс', 'Департамент комплаенс', 'Категория качества не пересмотрена при реструктуризации ссуды', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-14-50001' AND act_item_number = '5.3' AND metric_code = '1003');

-- 32. Недосоздание резерва при ухудшении положения (п. 5.3.2, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, '8', '1004', 15, 18, 95000.00, true,
    'КМ-14-50001', '300', '2025-12-22', '5.3.2',
    'П6401', 'Управление рисками', 'Риски', 'Управление рисками', 'Не досоздан резерв при ухудшении финансового положения заёмщика', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-14-50001' AND act_item_number = '5.3.2' AND metric_code = '1004');

-- 33. Совокупная задолженность сверх лимита на розничный продукт (п. 5.4, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, '14', '1001', 52, 64, 2300000.00, true,
    'КМ-14-50001', '300', '2026-04-11', '5.4',
    'П6153', 'Кредитование физических лиц', 'Розничный бизнес', 'Департамент кредитования ФЛ', 'Совокупная задолженность превышает установленный лимит на розничный продукт', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-14-50001' AND act_item_number = '5.4' AND metric_code = '1001');

-- 34. Отсутствие мониторинга сохранности залога (п. 5.4.1, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, '1', '1002', 10, 13, 300000.00, false,
    'КМ-14-50001', '300', '2026-04-24', '5.4.1',
    'П6802', 'Внутренний контроль', 'Риски', 'Департамент внутреннего контроля', 'Отсутствует актуальный мониторинг сохранности предмета залога', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-14-50001' AND act_item_number = '5.4.1' AND metric_code = '1002');

-- 35. Занижение категории по ссудам с обесценением (п. 5.1.1, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, '4', '1003', 23, 29, 470000.00, false,
    'КМ-14-50001', '300', '2026-05-12', '5.1.1',
    'П6152', 'Кредитование юридических лиц', 'Кредитование', 'Департамент кредитования ЮЛ', 'Занижена категория качества по ссудам с признаками обесценения', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-14-50001' AND act_item_number = '5.1.1' AND metric_code = '1003');

-- 36. Нарушение требований по формированию резервов по ссудам (п. 5.3.1, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_cs_validation (
    act_sub_number_id, reestr_metric_id, neg_finder_tb_id, metric_code,
    metric_unic_clients, metric_element_counts, metric_amount_rubles,
    is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name, block_owner, department_owner, ck_comment, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, '7', '1004', 4, 6, 58000.00, false,
    'КМ-14-50001', '300', '2026-05-27', '5.3.1',
    'П6401', 'Управление рисками', 'Риски', 'Управление рисками', 'Нарушены требования по формированию резервов на возможные потери по ссудам', 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_cs_validation WHERE km_id = 'КМ-14-50001' AND act_item_number = '5.3.1' AND metric_code = '1004');
