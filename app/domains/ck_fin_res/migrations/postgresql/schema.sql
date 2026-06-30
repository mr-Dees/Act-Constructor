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
-- ============================================================================

-- 1. Искажение финансовой отчётности (п. 5.1, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status,
    neg_finder_tb_id, metric_code, metric_name,
    metric_element_counts, metric_amount_rubles, is_sent_to_top_brass,
    km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name,
    deviation_description, deviation_reason, deviation_consequence,
    real_loss, ck_comment, pocket, risk,
    rev_start_dt, rev_end_dt, block_owner, department_owner,
    sberdocs_ctrl_assgn_number, assigment_id, assigment_format,
    inspection_name, assigment_recommendation, execution_deadline,
    used_pm_lib, etl_loading_id, row_hash, applied_into_ua,
    created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, 'Новая',
    '14', '2001', 'Искажение финансовой отчетности',
    15, 1250000.00, true,
    'КМ-09-41726', '255', '2025-03-01', '5.1',
    'П6802', 'Внутренний контроль',
    'Искажение данных финансовой отчётности при закрытии отчётного периода', 'Несоблюдение процедур внутреннего контроля', 'Недостоверность отчётных показателей подразделения',
    true, 'Требуется доработка процедуры контроля отчётности', 'Городская', 'Операционный риск',
    '2025-01-15 00:00:00', '2025-03-01 00:00:00', 'Риски', 'Департамент внутреннего контроля',
    'SD-2025-00255', 1001, 'Централизованный контроль',
    'Проверка достоверности финансовой отчётности ЦА 2025', 'Усилить контроль формирования отчётности', '2025-06-30 00:00:00',
    'Да', NULL, 'a1b2c3d4e5f6', false,
    'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation LIMIT 1);

-- 2. Некорректный расчёт финансовых показателей по портфелю ЮЛ (п. 5.2.1, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status,
    neg_finder_tb_id, metric_code, metric_name,
    metric_element_counts, metric_amount_rubles, is_sent_to_top_brass,
    km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name,
    deviation_description, deviation_reason, deviation_consequence,
    real_loss, ck_comment, pocket, risk,
    rev_start_dt, rev_end_dt, block_owner, department_owner,
    sberdocs_ctrl_assgn_number, assigment_id, assigment_format,
    inspection_name, assigment_recommendation, execution_deadline,
    used_pm_lib, etl_loading_id, row_hash, applied_into_ua,
    created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, 'На рассмотрении',
    '7', '2002', 'Некорректный расчет финансовых показателей',
    8, 3500000.00, false,
    'КМ-07-30001', '100', '2025-02-15', '5.2.1',
    'П6152', 'Кредитование юридических лиц',
    'Некорректный расчёт финансовых показателей по кредитному портфелю ЮЛ', 'Ошибки в исходных данных по сделкам', 'Завышение прибыли по кредитному портфелю',
    false, '', 'Корпоративная', 'Кредитный риск B2B',
    '2025-01-10 00:00:00', '2025-02-15 00:00:00', 'Кредитование', 'Департамент кредитования ЮЛ',
    'SD-2025-00100', 1002, 'Самостоятельный контроль',
    'Проверка кредитного портфеля ЮЛ МСК 2025', 'Обновить методику расчёта показателей', '2025-07-31 00:00:00',
    'Нет', NULL, 'b2c3d4e5f6a1', false,
    'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation LIMIT 1);

-- 3. Нарушение учётной политики при отражении модельных резервов (п. 5.3, суб-акт ЦА 50-мо0300)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status,
    neg_finder_tb_id, metric_code, metric_name,
    metric_element_counts, metric_amount_rubles, is_sent_to_top_brass,
    km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name,
    deviation_description, deviation_reason, deviation_consequence,
    real_loss, ck_comment, pocket, risk,
    rev_start_dt, rev_end_dt, block_owner, department_owner,
    sberdocs_ctrl_assgn_number, assigment_id, assigment_format,
    inspection_name, assigment_recommendation, execution_deadline,
    used_pm_lib, etl_loading_id, row_hash, applied_into_ua,
    created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 50-мо0300' LIMIT 1), NULL, 'Утверждена',
    '14', '2003', 'Нарушение учетной политики',
    22, 780000.00, true,
    'КМ-14-50001', '300', '2025-04-10', '5.3',
    'П6401', 'Управление рисками',
    'Нарушение учётной политики при отражении модельных резервов', 'Отступление от утверждённой методологии', 'Искажение величины резервов',
    true, 'Необходим пересмотр модельной методологии', 'Региональная', 'Модельный риск',
    '2025-02-01 00:00:00', '2025-04-10 00:00:00', 'Риски', 'Управление рисками',
    'SD-2025-00300', 1003, 'Централизованный контроль',
    'Проверка модельных резервов ЦА 2025', 'Привести расчёт резервов к учётной политике', '2025-09-30 00:00:00',
    'Да', NULL, 'c3d4e5f6a1b2', true,
    'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation LIMIT 1);

-- 4. Некорректный расчёт комиссионных показателей по РКО (п. 5.1.4, суб-акт ЦА 36-мо0255)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status,
    neg_finder_tb_id, metric_code, metric_name,
    metric_element_counts, metric_amount_rubles, is_sent_to_top_brass,
    km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name,
    deviation_description, deviation_reason, deviation_consequence,
    real_loss, ck_comment, pocket, risk,
    rev_start_dt, rev_end_dt, block_owner, department_owner,
    sberdocs_ctrl_assgn_number, assigment_id, assigment_format,
    inspection_name, assigment_recommendation, execution_deadline,
    used_pm_lib, etl_loading_id, row_hash, applied_into_ua,
    created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'ЦА 36-мо0255' LIMIT 1), NULL, 'Новая',
    '8', '2002', 'Некорректный расчет финансовых показателей',
    5, 420000.00, false,
    'КМ-09-41726', '255', '2025-03-01', '5.1.4',
    'П6301', 'Расчётно-кассовое обслуживание',
    'Некорректный расчёт комиссионных показателей по РКО', 'Ошибка в тарифной настройке', 'Искажение комиссионного дохода',
    false, 'Рекомендовано выверить тарифную сетку', 'Городская', 'Операционный риск',
    '2025-01-15 00:00:00', '2025-03-01 00:00:00', 'Транзакционный бизнес', 'Платежи и переводы',
    'SD-2025-00256', NULL, 'Самостоятельный контроль',
    'Проверка комиссионного дохода РКО ЦА 2025', 'Выверить тарифную настройку РКО', '2025-06-30 00:00:00',
    'Нет', NULL, 'd4e5f6a1b2c3', false,
    'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation LIMIT 1);

-- 5. Нарушение учётной политики по требованиям комплаенс (п. 5.2, суб-акт МСК 12-мо0100)
INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status,
    neg_finder_tb_id, metric_code, metric_name,
    metric_element_counts, metric_amount_rubles, is_sent_to_top_brass,
    km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name,
    deviation_description, deviation_reason, deviation_consequence,
    real_loss, ck_comment, pocket, risk,
    rev_start_dt, rev_end_dt, block_owner, department_owner,
    sberdocs_ctrl_assgn_number, assigment_id, assigment_format,
    inspection_name, assigment_recommendation, execution_deadline,
    used_pm_lib, etl_loading_id, row_hash, applied_into_ua,
    created_by
) SELECT
    (SELECT id FROM t_db_oarb_ua_sub_number WHERE act_sub_number = 'МСК 12-мо0100' LIMIT 1), NULL, 'На рассмотрении',
    '7', '2003', 'Нарушение учетной политики',
    30, 5600000.00, true,
    'КМ-07-30001', '100', '2025-02-15', '5.2',
    'П6701', 'Комплаенс и ПОД/ФТ',
    'Нарушение учётной политики при резервировании по требованиям комплаенс', 'Несвоевременный учёт изменений законодательства', 'Риск доначислений и санкций регулятора',
    true, 'Критичное нарушение, требуется устранение', 'Корпоративная', 'Риск изменения законодательства',
    '2025-01-10 00:00:00', '2025-02-15 00:00:00', 'Комплаенс', 'Департамент комплаенс',
    'SD-2025-00101', 1004, 'Централизованный контроль',
    'Проверка соответствия требованиям комплаенс МСК 2025', 'Актуализировать учётную политику под изменения закона', '2025-05-31 00:00:00',
    'Да', NULL, 'e5f6a1b2c3d4', false,
    'system'
WHERE NOT EXISTS (SELECT 1 FROM t_db_oarb_ck_fr_validation LIMIT 1);
