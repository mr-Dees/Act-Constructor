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

    -- Владелец процесса
    process_owner TEXT NOT NULL DEFAULT '',

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
-- ============================================================================

CREATE OR REPLACE VIEW v_db_oarb_ck_fr_validation AS
SELECT fr.*, sn.act_sub_number
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

INSERT INTO t_db_oarb_ck_fr_validation (
    act_sub_number_id, reestr_metric_id, application_status,
    neg_finder_tb_id, metric_code, metric_name,
    metric_element_counts, metric_amount_rubles, is_sent_to_top_brass,
    km_id, num_sz, dt_sz, act_item_number,
    process_number, process_name,
    deviation_description, deviation_reason, deviation_consequence,
    real_loss, ck_comment, pocket, risk,
    rev_start_dt, rev_end_dt, process_owner,
    sberdocs_ctrl_assgn_number, assigment_id, assigment_format,
    inspection_name, assigment_recommendation, execution_deadline,
    used_pm_lib, etl_loading_id, row_hash, applied_into_ua
)
VALUES
    -- 1. Осуществление переводов
    (
        NULL, NULL, 'Новая',
        'TB-09-001', '211', 'Нарушение порядка переводов',
        15, 1250000.00, true,
        'КМ-09-41726', 'ЦА 36-мо0255', '2025-03-01', '2.1',
        '3015', 'Осуществление переводов',
        'Некорректное проведение валютных переводов', 'Ошибка оператора', 'Задержка зачисления средств',
        true, 'Требуется доработка процедуры контроля', 'Городская', 'Операционный риск',
        '2025-01-15 00:00:00', '2025-03-01 00:00:00', 'Козлов А.В.',
        'SD-2025-00142', 1001, 'Предписание',
        'Проверка переводов СР банк 2025', 'Усилить контроль валютных операций', '2025-06-30 00:00:00',
        'PM-LIB-3.2', NULL, 'a1b2c3d4e5f6', false
    ),
    -- 2. Управление рисками сделок
    (
        NULL, NULL, 'На рассмотрении',
        'TB-07-001', '231', 'Неполная оценка кредитного риска',
        8, 3500000.00, false,
        'КМ-07-30001', 'МСК 12-мо0100', '2025-02-15', '3.2',
        '2019', 'Управление рисками сделок',
        'Неполная оценка кредитного риска', 'Недостаток информации о заёмщике', 'Увеличение просроченной задолженности',
        false, '', 'Корпоративная', 'Кредитный риск',
        '2025-01-10 00:00:00', '2025-02-15 00:00:00', 'Смирнова Е.П.',
        'SD-2025-00098', 1002, 'Рекомендация',
        'Проверка управления рисками МСК 2025', 'Обновить модель оценки рисков', '2025-07-31 00:00:00',
        'PM-LIB-3.2', NULL, 'b2c3d4e5f6a1', false
    ),
    -- 3. Риск-менеджмент
    (
        NULL, NULL, 'Утверждена',
        'TB-14-001', '402', 'Превышение лимитов расходов',
        22, 780000.00, true,
        'КМ-14-50001', 'ЦА 50-мо0300', '2025-04-10', '1.3',
        '2014', 'Риск-менеджмент',
        'Превышение лимитов операционных расходов', 'Рост затрат на устранение инцидентов', 'Перерасход бюджета подразделения',
        true, 'Необходим пересмотр лимитов', 'Региональная', 'Операционный риск',
        '2025-02-01 00:00:00', '2025-04-10 00:00:00', 'Николаев Д.С.',
        'SD-2025-00201', 1003, 'Предписание',
        'Проверка риск-менеджмента ПВ банк 2025', 'Пересмотреть лимиты расходов', '2025-09-30 00:00:00',
        'PM-LIB-3.1', NULL, 'c3d4e5f6a1b2', true
    ),
    -- 4. Работа с обратной связью клиентов
    (
        NULL, NULL, 'Новая',
        'TB-09-002', '211', 'Несвоевременная обработка обращений',
        5, 420000.00, false,
        'КМ-09-41726', 'ЦА 36-мо0255', '2025-03-01', '4.1',
        '1014', 'Работа с обратной связью клиентов',
        'Несвоевременная обработка обращений клиентов', 'Нехватка персонала', 'Снижение лояльности клиентов',
        false, 'Рекомендовано увеличить штат', 'Городская', 'Репутационный риск',
        '2025-01-15 00:00:00', '2025-03-01 00:00:00', 'Козлов А.В.',
        'SD-2025-00143', NULL, 'Рекомендация',
        'Проверка переводов СР банк 2025', 'Оптимизировать процесс обработки обращений', '2025-06-30 00:00:00',
        'PM-LIB-3.2', NULL, 'd4e5f6a1b2c3', false
    ),
    -- 5. Ведение кредитных сделок
    (
        NULL, NULL, 'На рассмотрении',
        'TB-07-002', '130', 'Нарушение оформления кредитных договоров',
        30, 5600000.00, true,
        'КМ-07-30001', 'МСК 12-мо0100', '2025-02-15', '2.4',
        '1013', 'Ведение кредитных сделок',
        'Нарушение порядка оформления кредитных договоров', 'Несоблюдение внутренних регламентов', 'Рост просроченной задолженности',
        true, 'Критичное нарушение, требуется немедленное устранение', 'Корпоративная', 'Кредитный риск',
        '2025-01-10 00:00:00', '2025-02-15 00:00:00', 'Смирнова Е.П.',
        'SD-2025-00099', 1004, 'Предписание',
        'Проверка управления рисками МСК 2025', 'Провести обучение сотрудников', '2025-05-31 00:00:00',
        'PM-LIB-3.2', NULL, 'e5f6a1b2c3d4', false
    )
ON CONFLICT DO NOTHING;
