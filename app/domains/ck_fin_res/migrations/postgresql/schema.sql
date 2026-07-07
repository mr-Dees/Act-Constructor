-- ============================================================================
-- Схема БД домена ЦК Фин.Рез. (PostgreSQL)
-- ============================================================================

-- ============================================================================
-- ТАБЛИЦА FR-ВАЛИДАЦИИ
-- Хранит результаты верификации метрик по направлению FR (финансовый результат).
-- ============================================================================

CREATE TABLE IF NOT EXISTS t_db_oarb_ck_fr_validation (
    id SERIAL PRIMARY KEY,

    -- Идентификатор записи в таблице sub_number (связь с актом)
    act_sub_number_id BIGINT,

    -- Идентификатор метрики в реестре (FK на t_db_oarb_ck_validation_reestr_metric)
    reestr_metric_id BIGINT,

    -- Статус заявки
    application_status TEXT NOT NULL DEFAULT '',

    -- Идентификатор ТБ в системе Neg Finder
    neg_finder_tb_id TEXT NOT NULL DEFAULT '',

    -- Код метрики FR
    metric_code TEXT NOT NULL DEFAULT '',

    -- Наименование метрики
    metric_name TEXT NOT NULL DEFAULT '',

    -- Количество элементов (строк/операций) по метрике
    metric_element_counts BIGINT DEFAULT 0,

    -- Сумма по метрике в рублях
    metric_amount_rubles NUMERIC(38, 2) DEFAULT 0,

    -- Признак: направлено ли руководству
    is_sent_to_top_brass BOOLEAN DEFAULT false,

    -- Идентификатор КМ (формат КМ-XX-XXXXX)
    km_id TEXT NOT NULL DEFAULT '',

    -- Номер служебной записки
    num_sz TEXT NOT NULL DEFAULT '',

    -- Дата служебной записки
    dt_sz DATE,

    -- Номер пункта акта
    act_item_number TEXT NOT NULL DEFAULT '',

    -- Номер бизнес-процесса
    process_number TEXT NOT NULL DEFAULT '',

    -- Наименование бизнес-процесса
    process_name TEXT NOT NULL DEFAULT '',

    -- Описание выявленного отклонения
    deviation_description TEXT NOT NULL DEFAULT '',

    -- Причина отклонения
    deviation_reason TEXT NOT NULL DEFAULT '',

    -- Последствие отклонения
    deviation_consequence TEXT NOT NULL DEFAULT '',

    -- Признак реального финансового ущерба
    real_loss BOOLEAN DEFAULT false,

    -- Комментарий контролёра (ЦК)
    ck_comment TEXT NOT NULL DEFAULT '',

    -- Карман / направление учёта потерь
    pocket TEXT NOT NULL DEFAULT '',

    -- Тип риска
    risk TEXT NOT NULL DEFAULT '',

    -- Дата начала проверки
    rev_start_dt TIMESTAMP,

    -- Дата окончания проверки
    rev_end_dt TIMESTAMP,

    -- Блок-владелец процесса (фиксируется на момент создания записи)
    block_owner TEXT NOT NULL DEFAULT '',

    -- Подразделение-владелец процесса (фиксируется на момент создания записи)
    department_owner TEXT NOT NULL DEFAULT '',

    -- Номер контрольного задания в СберДокс
    sberdocs_ctrl_assgn_number TEXT NOT NULL DEFAULT '',

    -- Идентификатор задания
    assigment_id BIGINT,

    -- Формат задания
    assigment_format TEXT NOT NULL DEFAULT '',

    -- Наименование проверки
    inspection_name TEXT NOT NULL DEFAULT '',

    -- Рекомендация по заданию
    assigment_recommendation TEXT NOT NULL DEFAULT '',

    -- Срок исполнения
    execution_deadline TIMESTAMP,

    -- Используемая библиотека процессного менеджмента
    used_pm_lib TEXT NOT NULL DEFAULT '',

    -- ТБ-руководитель проверки (tb_id справочника терр. банков строкой)
    tb_leader TEXT NOT NULL DEFAULT '',

    -- Идентификатор ETL-загрузки
    etl_loading_id BIGINT,

    -- Хэш строки для контроля дублирования
    row_hash TEXT NOT NULL DEFAULT '',

    -- Признак: применено ли в UA
    applied_into_ua BOOLEAN NOT NULL DEFAULT false,

    -- Стандартные аудиторские поля
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    created_by TEXT DEFAULT 'system',
    updated_by TEXT,
    deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

-- Индексы
CREATE INDEX IF NOT EXISTS idx_ck_fr_validation_metric_code
    ON t_db_oarb_ck_fr_validation (metric_code);

CREATE INDEX IF NOT EXISTS idx_ck_fr_validation_dt_sz
    ON t_db_oarb_ck_fr_validation (dt_sz);

CREATE INDEX IF NOT EXISTS idx_ck_fr_validation_is_actual
    ON t_db_oarb_ck_fr_validation (is_actual);

CREATE INDEX IF NOT EXISTS idx_ck_fr_validation_km_id
    ON t_db_oarb_ck_fr_validation (km_id);

CREATE INDEX IF NOT EXISTS idx_ck_fr_validation_act_sub_number_id
    ON t_db_oarb_ck_fr_validation (act_sub_number_id);

-- ============================================================================
-- VIEW FR-ВАЛИДАЦИИ
-- Присоединяет номер акта из справочника служебных записок по act_sub_number_id.
-- Поля block_owner/department_owner хранятся в самой таблице
-- (фиксируются на момент создания записи).
-- ============================================================================

CREATE OR REPLACE VIEW v_db_oarb_ck_fr_validation AS
SELECT fr.*,
       sn.act_sub_number
FROM t_db_oarb_ck_fr_validation fr
LEFT JOIN t_db_oarb_ua_sub_number sn ON sn.id = fr.act_sub_number_id
WHERE fr.is_actual = true;

-- ============================================================================
-- СПРАВОЧНАЯ ИНФОРМАЦИЯ: t_db_oarb_ck_validation_reestr_metric
-- Таблица реестра метрик (управляется ETL, в приложении не создаётся).
-- Содержит присвоенные ID реестра метрик (формат ФР00001),
-- генерируемые автоматически средствами БД.
--
-- Структура (Greenplum):
--   id                    bigserial  — PK
--   act_sub_number_id     bigint     — связь с актом
--   hash_reestr_metric_id bigint     — хэш идентификатора метрики
--   reestr_metric         text       — номер реестра метрики (формат ФР00001)
--   metric_group          text       — группа метрики
--   metric_code           text       — код метрики
--   etl_loading_id        bigint     — ID ETL-загрузки
--   + стандартные аудиторские поля
--
-- Связь: t_db_oarb_ck_fr_validation.reestr_metric_id → id этой таблицы.
-- ============================================================================

-- ============================================================================
-- ТЕСТОВЫЕ ДАННЫЕ
-- Идемпотентность обеспечивается по-строчной проверкой существования
-- (km_id + act_item_number + metric_code), а не общим "таблица непуста":
-- иначе при создании схемы в одной транзакции вставилась бы только первая строка.
-- act_sub_number в подзапросе — только из справочника t_db_oarb_ua_sub_number
-- (иначе act_sub_number_id = NULL). reestr_metric_id управляется ETL (NULL).
-- ============================================================================

-- 1. Искажение данных финансовой отчётности при закрытии отчётного периода (п. 5.1, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, 'Новая', '14', '2001', 'Искажение финансовой отчетности', 5, 120000.00, true, 'КМ-09-41726', '255', '2025-01-05', '5.1', 'П6152', 'Кредитование юридических лиц', 'Искажение данных финансовой отчётности при закрытии отчётного периода', 'Несоблюдение процедур внутреннего контроля при формировании отчётности', 'Недостоверность отчётных показателей подразделения', true, 'Требуется доработка процедуры: достоверности финансовой отчётности', 'Городская', 'Операционный риск', '2024-07-01 00:00:00', '2025-01-01 00:00:00', 'Кредитование', 'Департамент кредитования ЮЛ', 'SD-2025-00255', 1001, 'Централизованный контроль', 'Проверка достоверности финансовой отчётности (ЦА 2025)', 'Усилить контроль: достоверности финансовой отчётности', '2025-06-28 00:00:00', 'Да', NULL, 'frh00200151', true, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.1' AND metric_code = '2001' AND neg_finder_tb_id = '14');

-- 2. Некорректный расчёт финансовых показателей по кредитному портфелю ЮЛ (п. 5.1.1, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, 'На рассмотрении', '7', '2002', 'Некорректный расчет финансовых показателей', 8, 295000.00, false, 'КМ-09-41726', '255', '2025-02-06', '5.1.1', 'П6210', 'Операции на финансовых рынках', 'Некорректный расчёт финансовых показателей по кредитному портфелю ЮЛ', 'Ошибки в исходных данных по сделкам', 'Завышение прибыли по кредитному портфелю', false, 'Требуется доработка процедуры: методики расчёта показателей', 'Корпоративная', 'Кредитный риск B2B', '2024-08-01 00:00:00', '2025-02-01 00:00:00', 'Финансы', 'Казначейство', 'SD-2025-00256', 1002, 'Самостоятельный контроль', 'Проверка методики расчёта показателей (ЦА 2025)', 'Усилить контроль: методики расчёта показателей', '2025-07-28 00:00:00', 'Нет', NULL, 'frh012002511', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.1.1' AND metric_code = '2002' AND neg_finder_tb_id = '7');

-- 3. Нарушение учётной политики при отражении модельных резервов (п. 5.1.2, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, 'Утверждена', '8', '2003', 'Нарушение учетной политики', 11, 470000.00, false, 'КМ-09-41726', '255', '2025-03-07', '5.1.2', 'П6301', 'Расчётно-кассовое обслуживание', 'Нарушение учётной политики при отражении модельных резервов', 'Отступление от утверждённой методологии', 'Искажение величины резервов', false, '', 'Региональная', 'Модельный риск', '2024-09-01 00:00:00', '2025-03-01 00:00:00', 'Транзакционный бизнес', 'Платежи и переводы', 'SD-2025-00257', 1003, 'Нет поручения', 'Проверка модельных резервов (ЦА 2025)', 'Усилить контроль: модельных резервов', '2025-08-28 00:00:00', 'Да', NULL, 'frh022003512', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.1.2' AND metric_code = '2003' AND neg_finder_tb_id = '8');

-- 4. Некорректный расчёт комиссионных показателей по РКО (п. 5.1.4, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, 'Новая', '1', '2001', 'Искажение финансовой отчетности', 14, 645000.00, true, 'КМ-09-41726', '255', '2025-04-08', '5.1.4', 'П6401', 'Управление рисками', 'Некорректный расчёт комиссионных показателей по РКО', 'Ошибка в тарифной настройке', 'Искажение комиссионного дохода', true, 'Требуется доработка процедуры: комиссионного дохода РКО', 'Розничная', 'Риск изменения законодательства', '2024-10-01 00:00:00', '2025-04-01 00:00:00', 'Риски', 'Управление рисками', 'SD-2025-00258', NULL, 'Централизованный контроль', 'Проверка комиссионного дохода РКО (ЦА 2025)', 'Усилить контроль: комиссионного дохода РКО', '2025-09-28 00:00:00', 'Нет', NULL, 'frh032001514', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.1.4' AND metric_code = '2001' AND neg_finder_tb_id = '1');

-- 5. Нарушение учётной политики при резервировании по требованиям комплаенс (п. 5.2, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, 'На рассмотрении', '4', '2002', 'Некорректный расчет финансовых показателей', 17, 820000.00, false, 'КМ-09-41726', '255', '2025-05-09', '5.2', 'П6701', 'Комплаенс и ПОД/ФТ', 'Нарушение учётной политики при резервировании по требованиям комплаенс', 'Несвоевременный учёт изменений законодательства', 'Риск доначислений и санкций регулятора', true, 'Требуется доработка процедуры: соответствия требованиям комплаенс', 'Городская', 'Риск ликвидности', '2024-11-01 00:00:00', '2025-05-01 00:00:00', 'Комплаенс', 'Департамент комплаенс', 'SD-2025-00259', 1005, 'Самостоятельный контроль', 'Проверка соответствия требованиям комплаенс (ЦА 2025)', 'Усилить контроль: соответствия требованиям комплаенс', '2025-10-28 00:00:00', 'Да', NULL, 'frh04200252', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.2' AND metric_code = '2002' AND neg_finder_tb_id = '4');

-- 6. Искажение процентного дохода по портфелю ценных бумаг (п. 5.2.1, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, 'Утверждена', '14', '2003', 'Нарушение учетной политики', 20, 995000.00, false, 'КМ-09-41726', '255', '2025-06-10', '5.2.1', 'П6802', 'Внутренний контроль', 'Искажение процентного дохода по портфелю ценных бумаг', 'Неверная переоценка долговых инструментов', 'Завышение процентного дохода банковской книги', false, 'Требуется доработка процедуры: процентного дохода по ЦБ', 'Корпоративная', 'Стратегический риск', '2024-07-01 00:00:00', '2025-01-01 00:00:00', 'Риски', 'Департамент внутреннего контроля', 'SD-2025-00260', 1006, 'Нет поручения', 'Проверка процентного дохода по ЦБ (ЦА 2025)', 'Усилить контроль: процентного дохода по ЦБ', '2025-11-28 00:00:00', 'Нет', NULL, 'frh052003521', true, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.2.1' AND metric_code = '2003' AND neg_finder_tb_id = '14');

-- 7. Некорректное признание отложенных налоговых активов (п. 5.2.2, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, 'Новая', '7', '2001', 'Искажение финансовой отчетности', 23, 1170000.00, true, 'КМ-09-41726', '255', '2025-01-11', '5.2.2', 'П6152', 'Кредитование юридических лиц', 'Некорректное признание отложенных налоговых активов', 'Ошибка в оценке возмещаемости ОНА', 'Завышение чистой прибыли периода', false, 'Требуется доработка процедуры: отложенных налоговых активов', 'Региональная', 'Операционный риск', '2024-08-01 00:00:00', '2025-02-01 00:00:00', 'Кредитование', 'Департамент кредитования ЮЛ', 'SD-2025-00261', 1007, 'Централизованный контроль', 'Проверка отложенных налоговых активов (ЦА 2025)', 'Усилить контроль: отложенных налоговых активов', '2025-06-28 00:00:00', 'Да', NULL, 'frh062001522', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.2.2' AND metric_code = '2001' AND neg_finder_tb_id = '7');

-- 8. Нарушение порядка формирования резерва под обесценение (п. 5.2.3, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, 'На рассмотрении', '8', '2002', 'Некорректный расчет финансовых показателей', 26, 1345000.00, false, 'КМ-09-41726', '255', '2025-02-12', '5.2.3', 'П6210', 'Операции на финансовых рынках', 'Нарушение порядка формирования резерва под обесценение', 'Занижение вероятности дефолта в модели', 'Недосоздание резерва на возможные потери', true, '', 'Розничная', 'Кредитный риск B2B', '2024-09-01 00:00:00', '2025-03-01 00:00:00', 'Финансы', 'Казначейство', 'SD-2025-00262', NULL, 'Самостоятельный контроль', 'Проверка резервов под обесценение (ЦА 2025)', 'Усилить контроль: резервов под обесценение', '2025-07-28 00:00:00', 'Нет', NULL, 'frh072002523', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.2.3' AND metric_code = '2002' AND neg_finder_tb_id = '8');

-- 9. Искажение финансового результата от операций хеджирования (п. 5.3, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, 'Утверждена', '1', '2003', 'Нарушение учетной политики', 29, 1520000.00, false, 'КМ-09-41726', '255', '2025-03-13', '5.3', 'П6301', 'Расчётно-кассовое обслуживание', 'Искажение финансового результата от операций хеджирования', 'Неверное применение учёта хеджирования', 'Волатильность отчётного финансового результата', true, 'Требуется доработка процедуры: операций хеджирования', 'Городская', 'Модельный риск', '2024-10-01 00:00:00', '2025-04-01 00:00:00', 'Транзакционный бизнес', 'Платежи и переводы', 'SD-2025-00263', 1009, 'Нет поручения', 'Проверка операций хеджирования (ЦА 2025)', 'Усилить контроль: операций хеджирования', '2025-08-28 00:00:00', 'Да', NULL, 'frh08200353', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.3' AND metric_code = '2003' AND neg_finder_tb_id = '1');

-- 10. Некорректный расчёт эффективной процентной ставки (п. 5.3.1, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, 'Новая', '4', '2001', 'Искажение финансовой отчетности', 32, 1695000.00, true, 'КМ-09-41726', '255', '2025-04-14', '5.3.1', 'П6401', 'Управление рисками', 'Некорректный расчёт эффективной процентной ставки', 'Ошибка в модели ЭПС по розничным ссудам', 'Искажение процентного дохода розничного портфеля', false, 'Требуется доработка процедуры: расчёта эффективной ставки', 'Корпоративная', 'Риск изменения законодательства', '2024-11-01 00:00:00', '2025-05-01 00:00:00', 'Риски', 'Управление рисками', 'SD-2025-00264', 1010, 'Централизованный контроль', 'Проверка расчёта эффективной ставки (ЦА 2025)', 'Усилить контроль: расчёта эффективной ставки', '2025-09-28 00:00:00', 'Нет', NULL, 'frh092001531', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.3.1' AND metric_code = '2001' AND neg_finder_tb_id = '4');

-- 11. Нарушение сроков признания расходов отчётного периода (п. 5.3.2, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, 'На рассмотрении', '14', '2002', 'Некорректный расчет финансовых показателей', 35, 1870000.00, false, 'КМ-09-41726', '255', '2025-05-15', '5.3.2', 'П6701', 'Комплаенс и ПОД/ФТ', 'Нарушение сроков признания расходов отчётного периода', 'Несвоевременное отражение первичных документов', 'Смещение финансового результата между периодами', false, 'Требуется доработка процедуры: признания расходов периода', 'Региональная', 'Риск ликвидности', '2024-07-01 00:00:00', '2025-01-01 00:00:00', 'Комплаенс', 'Департамент комплаенс', 'SD-2025-00265', 1011, 'Самостоятельный контроль', 'Проверка признания расходов периода (ЦА 2025)', 'Усилить контроль: признания расходов периода', '2025-10-28 00:00:00', 'Да', NULL, 'frh102002532', true, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.3.2' AND metric_code = '2002' AND neg_finder_tb_id = '14');

-- 12. Искажение справедливой стоимости финансовых вложений (п. 5.4, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, 'Утверждена', '7', '2003', 'Нарушение учетной политики', 38, 2045000.00, false, 'КМ-09-41726', '255', '2025-06-16', '5.4', 'П6802', 'Внутренний контроль', 'Искажение справедливой стоимости финансовых вложений', 'Использование неактуальных рыночных котировок', 'Недостоверная оценка портфеля вложений', true, 'Требуется доработка процедуры: справедливой стоимости вложений', 'Розничная', 'Стратегический риск', '2024-08-01 00:00:00', '2025-02-01 00:00:00', 'Риски', 'Департамент внутреннего контроля', 'SD-2025-00266', NULL, 'Нет поручения', 'Проверка справедливой стоимости вложений (ЦА 2025)', 'Усилить контроль: справедливой стоимости вложений', '2025-11-28 00:00:00', 'Нет', NULL, 'frh11200354', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.4' AND metric_code = '2003' AND neg_finder_tb_id = '7');

-- 13. Искажение данных финансовой отчётности при закрытии отчётного периода (п. 5.1, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, 'Новая', '8', '2001', 'Искажение финансовой отчетности', 41, 170000.00, true, 'КМ-07-30001', '100', '2025-01-17', '5.1', 'П6152', 'Кредитование юридических лиц', 'Искажение данных финансовой отчётности при закрытии отчётного периода', 'Несоблюдение процедур внутреннего контроля при формировании отчётности', 'Недостоверность отчётных показателей подразделения', true, '', 'Городская', 'Операционный риск', '2024-09-01 00:00:00', '2025-03-01 00:00:00', 'Кредитование', 'Департамент кредитования ЮЛ', 'SD-2025-00112', 1013, 'Централизованный контроль', 'Проверка достоверности финансовой отчётности (МСК 2025)', 'Усилить контроль: достоверности финансовой отчётности', '2025-06-28 00:00:00', 'Да', NULL, 'frh12200151', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-07-30001' AND act_item_number = '5.1' AND metric_code = '2001' AND neg_finder_tb_id = '8');

-- 14. Некорректный расчёт финансовых показателей по кредитному портфелю ЮЛ (п. 5.1.1, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, 'На рассмотрении', '1', '2002', 'Некорректный расчет финансовых показателей', 44, 345000.00, false, 'КМ-07-30001', '100', '2025-02-18', '5.1.1', 'П6210', 'Операции на финансовых рынках', 'Некорректный расчёт финансовых показателей по кредитному портфелю ЮЛ', 'Ошибки в исходных данных по сделкам', 'Завышение прибыли по кредитному портфелю', false, 'Требуется доработка процедуры: методики расчёта показателей', 'Корпоративная', 'Кредитный риск B2B', '2024-10-01 00:00:00', '2025-04-01 00:00:00', 'Финансы', 'Казначейство', 'SD-2025-00113', 1014, 'Самостоятельный контроль', 'Проверка методики расчёта показателей (МСК 2025)', 'Усилить контроль: методики расчёта показателей', '2025-07-28 00:00:00', 'Нет', NULL, 'frh132002511', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-07-30001' AND act_item_number = '5.1.1' AND metric_code = '2002' AND neg_finder_tb_id = '1');

-- 15. Нарушение учётной политики при отражении модельных резервов (п. 5.1.2, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, 'Утверждена', '4', '2003', 'Нарушение учетной политики', 47, 520000.00, false, 'КМ-07-30001', '100', '2025-03-19', '5.1.2', 'П6301', 'Расчётно-кассовое обслуживание', 'Нарушение учётной политики при отражении модельных резервов', 'Отступление от утверждённой методологии', 'Искажение величины резервов', false, 'Требуется доработка процедуры: модельных резервов', 'Региональная', 'Модельный риск', '2024-11-01 00:00:00', '2025-05-01 00:00:00', 'Транзакционный бизнес', 'Платежи и переводы', 'SD-2025-00114', 1015, 'Нет поручения', 'Проверка модельных резервов (МСК 2025)', 'Усилить контроль: модельных резервов', '2025-08-28 00:00:00', 'Да', NULL, 'frh142003512', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-07-30001' AND act_item_number = '5.1.2' AND metric_code = '2003' AND neg_finder_tb_id = '4');

-- 16. Некорректный расчёт комиссионных показателей по РКО (п. 5.1.4, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, 'Новая', '14', '2001', 'Искажение финансовой отчетности', 5, 695000.00, true, 'КМ-07-30001', '100', '2025-04-20', '5.1.4', 'П6401', 'Управление рисками', 'Некорректный расчёт комиссионных показателей по РКО', 'Ошибка в тарифной настройке', 'Искажение комиссионного дохода', true, 'Требуется доработка процедуры: комиссионного дохода РКО', 'Розничная', 'Риск изменения законодательства', '2024-07-01 00:00:00', '2025-01-01 00:00:00', 'Риски', 'Управление рисками', 'SD-2025-00115', NULL, 'Централизованный контроль', 'Проверка комиссионного дохода РКО (МСК 2025)', 'Усилить контроль: комиссионного дохода РКО', '2025-09-28 00:00:00', 'Нет', NULL, 'frh152001514', true, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-07-30001' AND act_item_number = '5.1.4' AND metric_code = '2001' AND neg_finder_tb_id = '14');

-- 17. Нарушение учётной политики при резервировании по требованиям комплаенс (п. 5.2, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, 'На рассмотрении', '7', '2002', 'Некорректный расчет финансовых показателей', 8, 870000.00, false, 'КМ-07-30001', '100', '2025-05-21', '5.2', 'П6701', 'Комплаенс и ПОД/ФТ', 'Нарушение учётной политики при резервировании по требованиям комплаенс', 'Несвоевременный учёт изменений законодательства', 'Риск доначислений и санкций регулятора', true, 'Требуется доработка процедуры: соответствия требованиям комплаенс', 'Городская', 'Риск ликвидности', '2024-08-01 00:00:00', '2025-02-01 00:00:00', 'Комплаенс', 'Департамент комплаенс', 'SD-2025-00116', 1017, 'Самостоятельный контроль', 'Проверка соответствия требованиям комплаенс (МСК 2025)', 'Усилить контроль: соответствия требованиям комплаенс', '2025-10-28 00:00:00', 'Да', NULL, 'frh16200252', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-07-30001' AND act_item_number = '5.2' AND metric_code = '2002' AND neg_finder_tb_id = '7');

-- 18. Искажение процентного дохода по портфелю ценных бумаг (п. 5.2.1, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, 'Утверждена', '8', '2003', 'Нарушение учетной политики', 11, 1045000.00, false, 'КМ-07-30001', '100', '2025-06-22', '5.2.1', 'П6802', 'Внутренний контроль', 'Искажение процентного дохода по портфелю ценных бумаг', 'Неверная переоценка долговых инструментов', 'Завышение процентного дохода банковской книги', false, '', 'Корпоративная', 'Стратегический риск', '2024-09-01 00:00:00', '2025-03-01 00:00:00', 'Риски', 'Департамент внутреннего контроля', 'SD-2025-00117', 1018, 'Нет поручения', 'Проверка процентного дохода по ЦБ (МСК 2025)', 'Усилить контроль: процентного дохода по ЦБ', '2025-11-28 00:00:00', 'Нет', NULL, 'frh172003521', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-07-30001' AND act_item_number = '5.2.1' AND metric_code = '2003' AND neg_finder_tb_id = '8');

-- 19. Некорректное признание отложенных налоговых активов (п. 5.2.2, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, 'Новая', '1', '2001', 'Искажение финансовой отчетности', 14, 1220000.00, true, 'КМ-07-30001', '100', '2025-01-23', '5.2.2', 'П6152', 'Кредитование юридических лиц', 'Некорректное признание отложенных налоговых активов', 'Ошибка в оценке возмещаемости ОНА', 'Завышение чистой прибыли периода', false, 'Требуется доработка процедуры: отложенных налоговых активов', 'Региональная', 'Операционный риск', '2024-10-01 00:00:00', '2025-04-01 00:00:00', 'Кредитование', 'Департамент кредитования ЮЛ', 'SD-2025-00118', 1019, 'Централизованный контроль', 'Проверка отложенных налоговых активов (МСК 2025)', 'Усилить контроль: отложенных налоговых активов', '2025-06-28 00:00:00', 'Да', NULL, 'frh182001522', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-07-30001' AND act_item_number = '5.2.2' AND metric_code = '2001' AND neg_finder_tb_id = '1');

-- 20. Нарушение порядка формирования резерва под обесценение (п. 5.2.3, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, 'На рассмотрении', '4', '2002', 'Некорректный расчет финансовых показателей', 17, 1395000.00, false, 'КМ-07-30001', '100', '2025-02-24', '5.2.3', 'П6210', 'Операции на финансовых рынках', 'Нарушение порядка формирования резерва под обесценение', 'Занижение вероятности дефолта в модели', 'Недосоздание резерва на возможные потери', true, 'Требуется доработка процедуры: резервов под обесценение', 'Розничная', 'Кредитный риск B2B', '2024-11-01 00:00:00', '2025-05-01 00:00:00', 'Финансы', 'Казначейство', 'SD-2025-00119', NULL, 'Самостоятельный контроль', 'Проверка резервов под обесценение (МСК 2025)', 'Усилить контроль: резервов под обесценение', '2025-07-28 00:00:00', 'Нет', NULL, 'frh192002523', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-07-30001' AND act_item_number = '5.2.3' AND metric_code = '2002' AND neg_finder_tb_id = '4');

-- 21. Искажение финансового результата от операций хеджирования (п. 5.3, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, 'Утверждена', '14', '2003', 'Нарушение учетной политики', 20, 1570000.00, false, 'КМ-07-30001', '100', '2025-03-05', '5.3', 'П6301', 'Расчётно-кассовое обслуживание', 'Искажение финансового результата от операций хеджирования', 'Неверное применение учёта хеджирования', 'Волатильность отчётного финансового результата', true, 'Требуется доработка процедуры: операций хеджирования', 'Городская', 'Модельный риск', '2024-07-01 00:00:00', '2025-01-01 00:00:00', 'Транзакционный бизнес', 'Платежи и переводы', 'SD-2025-00120', 1021, 'Нет поручения', 'Проверка операций хеджирования (МСК 2025)', 'Усилить контроль: операций хеджирования', '2025-08-28 00:00:00', 'Да', NULL, 'frh20200353', true, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-07-30001' AND act_item_number = '5.3' AND metric_code = '2003' AND neg_finder_tb_id = '14');

-- 22. Некорректный расчёт эффективной процентной ставки (п. 5.3.1, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, 'Новая', '7', '2001', 'Искажение финансовой отчетности', 23, 1745000.00, true, 'КМ-07-30001', '100', '2025-04-06', '5.3.1', 'П6401', 'Управление рисками', 'Некорректный расчёт эффективной процентной ставки', 'Ошибка в модели ЭПС по розничным ссудам', 'Искажение процентного дохода розничного портфеля', false, 'Требуется доработка процедуры: расчёта эффективной ставки', 'Корпоративная', 'Риск изменения законодательства', '2024-08-01 00:00:00', '2025-02-01 00:00:00', 'Риски', 'Управление рисками', 'SD-2025-00121', 1022, 'Централизованный контроль', 'Проверка расчёта эффективной ставки (МСК 2025)', 'Усилить контроль: расчёта эффективной ставки', '2025-09-28 00:00:00', 'Нет', NULL, 'frh212001531', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-07-30001' AND act_item_number = '5.3.1' AND metric_code = '2001' AND neg_finder_tb_id = '7');

-- 23. Нарушение сроков признания расходов отчётного периода (п. 5.3.2, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, 'На рассмотрении', '8', '2002', 'Некорректный расчет финансовых показателей', 26, 1920000.00, false, 'КМ-07-30001', '100', '2025-05-07', '5.3.2', 'П6701', 'Комплаенс и ПОД/ФТ', 'Нарушение сроков признания расходов отчётного периода', 'Несвоевременное отражение первичных документов', 'Смещение финансового результата между периодами', false, '', 'Региональная', 'Риск ликвидности', '2024-09-01 00:00:00', '2025-03-01 00:00:00', 'Комплаенс', 'Департамент комплаенс', 'SD-2025-00122', 1023, 'Самостоятельный контроль', 'Проверка признания расходов периода (МСК 2025)', 'Усилить контроль: признания расходов периода', '2025-10-28 00:00:00', 'Да', NULL, 'frh222002532', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-07-30001' AND act_item_number = '5.3.2' AND metric_code = '2002' AND neg_finder_tb_id = '8');

-- 24. Искажение справедливой стоимости финансовых вложений (п. 5.4, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, 'Утверждена', '1', '2003', 'Нарушение учетной политики', 29, 2095000.00, false, 'КМ-07-30001', '100', '2025-06-08', '5.4', 'П6802', 'Внутренний контроль', 'Искажение справедливой стоимости финансовых вложений', 'Использование неактуальных рыночных котировок', 'Недостоверная оценка портфеля вложений', true, 'Требуется доработка процедуры: справедливой стоимости вложений', 'Розничная', 'Стратегический риск', '2024-10-01 00:00:00', '2025-04-01 00:00:00', 'Риски', 'Департамент внутреннего контроля', 'SD-2025-00123', NULL, 'Нет поручения', 'Проверка справедливой стоимости вложений (МСК 2025)', 'Усилить контроль: справедливой стоимости вложений', '2025-11-28 00:00:00', 'Нет', NULL, 'frh23200354', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-07-30001' AND act_item_number = '5.4' AND metric_code = '2003' AND neg_finder_tb_id = '1');

-- 25. Искажение данных финансовой отчётности при закрытии отчётного периода (п. 5.1, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, 'Новая', '4', '2001', 'Искажение финансовой отчетности', 32, 220000.00, true, 'КМ-14-50001', '300', '2025-01-09', '5.1', 'П6152', 'Кредитование юридических лиц', 'Искажение данных финансовой отчётности при закрытии отчётного периода', 'Несоблюдение процедур внутреннего контроля при формировании отчётности', 'Недостоверность отчётных показателей подразделения', true, 'Требуется доработка процедуры: достоверности финансовой отчётности', 'Городская', 'Операционный риск', '2024-11-01 00:00:00', '2025-05-01 00:00:00', 'Кредитование', 'Департамент кредитования ЮЛ', 'SD-2025-00324', 1025, 'Централизованный контроль', 'Проверка достоверности финансовой отчётности (ЦА 2025)', 'Усилить контроль: достоверности финансовой отчётности', '2025-06-28 00:00:00', 'Да', NULL, 'frh24200151', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-14-50001' AND act_item_number = '5.1' AND metric_code = '2001' AND neg_finder_tb_id = '4');

-- 26. Некорректный расчёт финансовых показателей по кредитному портфелю ЮЛ (п. 5.1.1, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, 'На рассмотрении', '14', '2002', 'Некорректный расчет финансовых показателей', 35, 395000.00, false, 'КМ-14-50001', '300', '2025-02-10', '5.1.1', 'П6210', 'Операции на финансовых рынках', 'Некорректный расчёт финансовых показателей по кредитному портфелю ЮЛ', 'Ошибки в исходных данных по сделкам', 'Завышение прибыли по кредитному портфелю', false, 'Требуется доработка процедуры: методики расчёта показателей', 'Корпоративная', 'Кредитный риск B2B', '2024-07-01 00:00:00', '2025-01-01 00:00:00', 'Финансы', 'Казначейство', 'SD-2025-00325', 1026, 'Самостоятельный контроль', 'Проверка методики расчёта показателей (ЦА 2025)', 'Усилить контроль: методики расчёта показателей', '2025-07-28 00:00:00', 'Нет', NULL, 'frh252002511', true, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-14-50001' AND act_item_number = '5.1.1' AND metric_code = '2002' AND neg_finder_tb_id = '14');

-- 27. Нарушение учётной политики при отражении модельных резервов (п. 5.1.2, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, 'Утверждена', '7', '2003', 'Нарушение учетной политики', 38, 570000.00, false, 'КМ-14-50001', '300', '2025-03-11', '5.1.2', 'П6301', 'Расчётно-кассовое обслуживание', 'Нарушение учётной политики при отражении модельных резервов', 'Отступление от утверждённой методологии', 'Искажение величины резервов', false, 'Требуется доработка процедуры: модельных резервов', 'Региональная', 'Модельный риск', '2024-08-01 00:00:00', '2025-02-01 00:00:00', 'Транзакционный бизнес', 'Платежи и переводы', 'SD-2025-00326', 1027, 'Нет поручения', 'Проверка модельных резервов (ЦА 2025)', 'Усилить контроль: модельных резервов', '2025-08-28 00:00:00', 'Да', NULL, 'frh262003512', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-14-50001' AND act_item_number = '5.1.2' AND metric_code = '2003' AND neg_finder_tb_id = '7');

-- 28. Некорректный расчёт комиссионных показателей по РКО (п. 5.1.4, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, 'Новая', '8', '2001', 'Искажение финансовой отчетности', 41, 745000.00, true, 'КМ-14-50001', '300', '2025-04-12', '5.1.4', 'П6401', 'Управление рисками', 'Некорректный расчёт комиссионных показателей по РКО', 'Ошибка в тарифной настройке', 'Искажение комиссионного дохода', true, '', 'Розничная', 'Риск изменения законодательства', '2024-09-01 00:00:00', '2025-03-01 00:00:00', 'Риски', 'Управление рисками', 'SD-2025-00327', NULL, 'Централизованный контроль', 'Проверка комиссионного дохода РКО (ЦА 2025)', 'Усилить контроль: комиссионного дохода РКО', '2025-09-28 00:00:00', 'Нет', NULL, 'frh272001514', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-14-50001' AND act_item_number = '5.1.4' AND metric_code = '2001' AND neg_finder_tb_id = '8');

-- 29. Нарушение учётной политики при резервировании по требованиям комплаенс (п. 5.2, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, 'На рассмотрении', '1', '2002', 'Некорректный расчет финансовых показателей', 44, 920000.00, false, 'КМ-14-50001', '300', '2025-05-13', '5.2', 'П6701', 'Комплаенс и ПОД/ФТ', 'Нарушение учётной политики при резервировании по требованиям комплаенс', 'Несвоевременный учёт изменений законодательства', 'Риск доначислений и санкций регулятора', true, 'Требуется доработка процедуры: соответствия требованиям комплаенс', 'Городская', 'Риск ликвидности', '2024-10-01 00:00:00', '2025-04-01 00:00:00', 'Комплаенс', 'Департамент комплаенс', 'SD-2025-00328', 1029, 'Самостоятельный контроль', 'Проверка соответствия требованиям комплаенс (ЦА 2025)', 'Усилить контроль: соответствия требованиям комплаенс', '2025-10-28 00:00:00', 'Да', NULL, 'frh28200252', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-14-50001' AND act_item_number = '5.2' AND metric_code = '2002' AND neg_finder_tb_id = '1');

-- 30. Искажение процентного дохода по портфелю ценных бумаг (п. 5.2.1, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, 'Утверждена', '4', '2003', 'Нарушение учетной политики', 47, 1095000.00, false, 'КМ-14-50001', '300', '2025-06-14', '5.2.1', 'П6802', 'Внутренний контроль', 'Искажение процентного дохода по портфелю ценных бумаг', 'Неверная переоценка долговых инструментов', 'Завышение процентного дохода банковской книги', false, 'Требуется доработка процедуры: процентного дохода по ЦБ', 'Корпоративная', 'Стратегический риск', '2024-11-01 00:00:00', '2025-05-01 00:00:00', 'Риски', 'Департамент внутреннего контроля', 'SD-2025-00329', 1030, 'Нет поручения', 'Проверка процентного дохода по ЦБ (ЦА 2025)', 'Усилить контроль: процентного дохода по ЦБ', '2025-11-28 00:00:00', 'Нет', NULL, 'frh292003521', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-14-50001' AND act_item_number = '5.2.1' AND metric_code = '2003' AND neg_finder_tb_id = '4');

-- 31. Некорректное признание отложенных налоговых активов (п. 5.2.2, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, 'Новая', '14', '2001', 'Искажение финансовой отчетности', 5, 1270000.00, true, 'КМ-14-50001', '300', '2025-01-15', '5.2.2', 'П6152', 'Кредитование юридических лиц', 'Некорректное признание отложенных налоговых активов', 'Ошибка в оценке возмещаемости ОНА', 'Завышение чистой прибыли периода', false, 'Требуется доработка процедуры: отложенных налоговых активов', 'Региональная', 'Операционный риск', '2024-07-01 00:00:00', '2025-01-01 00:00:00', 'Кредитование', 'Департамент кредитования ЮЛ', 'SD-2025-00330', 1031, 'Централизованный контроль', 'Проверка отложенных налоговых активов (ЦА 2025)', 'Усилить контроль: отложенных налоговых активов', '2025-06-28 00:00:00', 'Да', NULL, 'frh302001522', true, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-14-50001' AND act_item_number = '5.2.2' AND metric_code = '2001' AND neg_finder_tb_id = '14');

-- 32. Нарушение порядка формирования резерва под обесценение (п. 5.2.3, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, 'На рассмотрении', '7', '2002', 'Некорректный расчет финансовых показателей', 8, 1445000.00, false, 'КМ-14-50001', '300', '2025-02-16', '5.2.3', 'П6210', 'Операции на финансовых рынках', 'Нарушение порядка формирования резерва под обесценение', 'Занижение вероятности дефолта в модели', 'Недосоздание резерва на возможные потери', true, 'Требуется доработка процедуры: резервов под обесценение', 'Розничная', 'Кредитный риск B2B', '2024-08-01 00:00:00', '2025-02-01 00:00:00', 'Финансы', 'Казначейство', 'SD-2025-00331', NULL, 'Самостоятельный контроль', 'Проверка резервов под обесценение (ЦА 2025)', 'Усилить контроль: резервов под обесценение', '2025-07-28 00:00:00', 'Нет', NULL, 'frh312002523', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-14-50001' AND act_item_number = '5.2.3' AND metric_code = '2002' AND neg_finder_tb_id = '7');

-- 33. Искажение финансового результата от операций хеджирования (п. 5.3, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, 'Утверждена', '8', '2003', 'Нарушение учетной политики', 11, 1620000.00, false, 'КМ-14-50001', '300', '2025-03-17', '5.3', 'П6301', 'Расчётно-кассовое обслуживание', 'Искажение финансового результата от операций хеджирования', 'Неверное применение учёта хеджирования', 'Волатильность отчётного финансового результата', true, '', 'Городская', 'Модельный риск', '2024-09-01 00:00:00', '2025-03-01 00:00:00', 'Транзакционный бизнес', 'Платежи и переводы', 'SD-2025-00332', 1033, 'Нет поручения', 'Проверка операций хеджирования (ЦА 2025)', 'Усилить контроль: операций хеджирования', '2025-08-28 00:00:00', 'Да', NULL, 'frh32200353', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-14-50001' AND act_item_number = '5.3' AND metric_code = '2003' AND neg_finder_tb_id = '8');

-- 34. Некорректный расчёт эффективной процентной ставки (п. 5.3.1, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, 'Новая', '1', '2001', 'Искажение финансовой отчетности', 14, 1795000.00, true, 'КМ-14-50001', '300', '2025-04-18', '5.3.1', 'П6401', 'Управление рисками', 'Некорректный расчёт эффективной процентной ставки', 'Ошибка в модели ЭПС по розничным ссудам', 'Искажение процентного дохода розничного портфеля', false, 'Требуется доработка процедуры: расчёта эффективной ставки', 'Корпоративная', 'Риск изменения законодательства', '2024-10-01 00:00:00', '2025-04-01 00:00:00', 'Риски', 'Управление рисками', 'SD-2025-00333', 1034, 'Централизованный контроль', 'Проверка расчёта эффективной ставки (ЦА 2025)', 'Усилить контроль: расчёта эффективной ставки', '2025-09-28 00:00:00', 'Нет', NULL, 'frh332001531', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-14-50001' AND act_item_number = '5.3.1' AND metric_code = '2001' AND neg_finder_tb_id = '1');

-- 35. Нарушение сроков признания расходов отчётного периода (п. 5.3.2, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, 'На рассмотрении', '4', '2002', 'Некорректный расчет финансовых показателей', 17, 1970000.00, false, 'КМ-14-50001', '300', '2025-05-19', '5.3.2', 'П6701', 'Комплаенс и ПОД/ФТ', 'Нарушение сроков признания расходов отчётного периода', 'Несвоевременное отражение первичных документов', 'Смещение финансового результата между периодами', false, 'Требуется доработка процедуры: признания расходов периода', 'Региональная', 'Риск ликвидности', '2024-11-01 00:00:00', '2025-05-01 00:00:00', 'Комплаенс', 'Департамент комплаенс', 'SD-2025-00334', 1035, 'Самостоятельный контроль', 'Проверка признания расходов периода (ЦА 2025)', 'Усилить контроль: признания расходов периода', '2025-10-28 00:00:00', 'Да', NULL, 'frh342002532', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-14-50001' AND act_item_number = '5.3.2' AND metric_code = '2002' AND neg_finder_tb_id = '4');

-- 36. Искажение справедливой стоимости финансовых вложений (п. 5.4, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, 'Утверждена', '14', '2003', 'Нарушение учетной политики', 20, 2145000.00, false, 'КМ-14-50001', '300', '2025-06-20', '5.4', 'П6802', 'Внутренний контроль', 'Искажение справедливой стоимости финансовых вложений', 'Использование неактуальных рыночных котировок', 'Недостоверная оценка портфеля вложений', true, 'Требуется доработка процедуры: справедливой стоимости вложений', 'Розничная', 'Стратегический риск', '2024-07-01 00:00:00', '2025-01-01 00:00:00', 'Риски', 'Департамент внутреннего контроля', 'SD-2025-00335', NULL, 'Нет поручения', 'Проверка справедливой стоимости вложений (ЦА 2025)', 'Усилить контроль: справедливой стоимости вложений', '2025-11-28 00:00:00', 'Нет', NULL, 'frh35200354', true, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-14-50001' AND act_item_number = '5.4' AND metric_code = '2003' AND neg_finder_tb_id = '14');

-- 2а. Та же метрика 2002 на п. 5.1.1, выявлена Поволжским банком (группа для консолидации)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, 'На рассмотрении', '8', '2002', 'Некорректный расчет финансовых показателей', 3, 215000.00, false, 'КМ-09-41726', '255', '2025-02-06', '5.1.1', 'П6210', 'Операции на финансовых рынках', 'Некорректный расчёт финансовых показателей по кредитному портфелю ЮЛ', 'Ошибки в исходных данных по сделкам', 'Завышение прибыли по кредитному портфелю', false, 'Требуется доработка процедуры: методики расчёта показателей', 'Корпоративная', 'Кредитный риск B2B', '2024-08-01 00:00:00', '2025-02-01 00:00:00', 'Финансы', 'Казначейство', 'SD-2025-00256', 1002, 'Самостоятельный контроль', 'Проверка методики расчёта показателей (ЦА 2025)', 'Усилить контроль: методики расчёта показателей', '2025-07-28 00:00:00', 'Нет', NULL, 'frh012002518', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.1.1' AND metric_code = '2002' AND neg_finder_tb_id = '8');

-- 2б. Та же метрика 2002 на п. 5.1.1, выявлена Байкальским банком
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status, neg_finder_tb_id, metric_code, metric_name, metric_element_counts, metric_amount_rubles, is_sent_to_top_brass, km_id, num_sz, dt_sz, act_item_number, process_number, process_name, deviation_description, deviation_reason, deviation_consequence, real_loss, ck_comment, pocket, risk, rev_start_dt, rev_end_dt, block_owner, department_owner, sberdocs_ctrl_assgn_number, assigment_id, assigment_format, inspection_name, assigment_recommendation, execution_deadline, used_pm_lib, etl_loading_id, row_hash, applied_into_ua, created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, 'На рассмотрении', '1', '2002', 'Некорректный расчет финансовых показателей', 1, 55000.00, false, 'КМ-09-41726', '255', '2025-02-06', '5.1.1', 'П6210', 'Операции на финансовых рынках', 'Некорректный расчёт финансовых показателей по кредитному портфелю ЮЛ', 'Ошибки в исходных данных по сделкам', 'Завышение прибыли по кредитному портфелю', false, 'Требуется доработка процедуры: методики расчёта показателей', 'Корпоративная', 'Кредитный риск B2B', '2024-08-01 00:00:00', '2025-02-01 00:00:00', 'Финансы', 'Казначейство', 'SD-2025-00256', 1002, 'Самостоятельный контроль', 'Проверка методики расчёта показателей (ЦА 2025)', 'Усилить контроль: методики расчёта показателей', '2025-07-28 00:00:00', 'Нет', NULL, 'frh012002519', false, 'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation WHERE km_id = 'КМ-09-41726' AND act_item_number = '5.1.1' AND metric_code = '2002' AND neg_finder_tb_id = '1');

-- Бэкфилл ТБ-руководителя для демо-строк (идемпотентно: только пустые)
UPDATE t_db_oarb_ck_fr_validation SET tb_leader = '14'
WHERE tb_leader = '' AND km_id IN ('КМ-09-41726', 'КМ-07-30001', 'КМ-14-50001');
