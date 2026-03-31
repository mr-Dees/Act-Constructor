-- ============================================================================
-- Схема БД домена справочных данных UA (PostgreSQL)
-- ============================================================================

-- ============================================================================
-- СПРАВОЧНИК ПРОЦЕССОВ
-- ============================================================================

CREATE TABLE IF NOT EXISTS t_db_oarb_ua_process_dict (
    id BIGSERIAL PRIMARY KEY,
    process_code VARCHAR(20) NOT NULL,
    process_name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    created_by TEXT DEFAULT 'system',
    updated_by TEXT,
    deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_process_dict_code
    ON t_db_oarb_ua_process_dict (process_code);

INSERT INTO t_db_oarb_ua_process_dict (process_code, process_name, description)
VALUES
    ('1013', 'Кредитование ЮЛ', 'Процесс кредитования юридических лиц'),
    ('1014', 'Кредитование ФЛ', 'Процесс кредитования физических лиц'),
    ('2019', 'Операции на финансовых рынках', 'Процесс операций на финансовых рынках'),
    ('3119', 'Расчётно-кассовое обслуживание', 'Процесс расчётно-кассового обслуживания'),
    ('2014', 'Управление рисками', 'Процесс управления рисками'),
    ('1010', 'Ипотечное кредитование', 'Процесс ипотечного кредитования'),
    ('7010', 'Информационные технологии', 'Процесс информационных технологий'),
    ('1015', 'Карточные продукты', 'Процесс карточных продуктов'),
    ('2134', 'Валютный контроль', 'Процесс валютного контроля'),
    ('5010', 'Комплаенс', 'Процесс комплаенс')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- СПРАВОЧНИК ТЕРРИТОРИАЛЬНЫХ БАНКОВ
-- ============================================================================

CREATE TABLE IF NOT EXISTS t_db_oarb_ua_terbank_dict (
    id BIGSERIAL PRIMARY KEY,
    terbank_code VARCHAR(20) NOT NULL,
    terbank_name TEXT NOT NULL,
    short_name VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    created_by TEXT DEFAULT 'system',
    updated_by TEXT,
    deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_terbank_dict_code
    ON t_db_oarb_ua_terbank_dict (terbank_code);

INSERT INTO t_db_oarb_ua_terbank_dict (terbank_code, terbank_name, short_name)
VALUES
    ('01', 'Центральный аппарат', 'ЦА'),
    ('07', 'Московский банк', 'МСК'),
    ('09', 'Среднерусский банк', 'СР'),
    ('14', 'Поволжский банк', 'ПВ'),
    ('38', 'Сибирский банк', 'СИБ')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- СПРАВОЧНИК ГОСБов
-- ============================================================================

CREATE TABLE IF NOT EXISTS t_db_oarb_ua_gosb_dict (
    id BIGSERIAL PRIMARY KEY,
    gosb_code VARCHAR(20) NOT NULL,
    gosb_name TEXT NOT NULL,
    terbank_id BIGINT REFERENCES t_db_oarb_ua_terbank_dict(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    created_by TEXT DEFAULT 'system',
    updated_by TEXT,
    deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_gosb_dict_code
    ON t_db_oarb_ua_gosb_dict (gosb_code);

INSERT INTO t_db_oarb_ua_gosb_dict (gosb_code, gosb_name, terbank_id)
VALUES
    ('0901', 'ГОСБ Тула', (SELECT id FROM t_db_oarb_ua_terbank_dict WHERE terbank_code = '09' LIMIT 1)),
    ('0902', 'ГОСБ Рязань', (SELECT id FROM t_db_oarb_ua_terbank_dict WHERE terbank_code = '09' LIMIT 1)),
    ('0701', 'ГОСБ Москва', (SELECT id FROM t_db_oarb_ua_terbank_dict WHERE terbank_code = '07' LIMIT 1))
ON CONFLICT DO NOTHING;

-- ============================================================================
-- СПРАВОЧНИК ВСП
-- ============================================================================

CREATE TABLE IF NOT EXISTS t_db_oarb_ua_vsp_dict (
    id BIGSERIAL PRIMARY KEY,
    vsp_code VARCHAR(20) NOT NULL,
    vsp_name TEXT NOT NULL,
    gosb_id BIGINT REFERENCES t_db_oarb_ua_gosb_dict(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    created_by TEXT DEFAULT 'system',
    updated_by TEXT,
    deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_vsp_dict_code
    ON t_db_oarb_ua_vsp_dict (vsp_code);

INSERT INTO t_db_oarb_ua_vsp_dict (vsp_code, vsp_name, gosb_id)
VALUES
    ('09011', 'ВСП Тула-1', (SELECT id FROM t_db_oarb_ua_gosb_dict WHERE gosb_code = '0901' LIMIT 1)),
    ('09012', 'ВСП Тула-2', (SELECT id FROM t_db_oarb_ua_gosb_dict WHERE gosb_code = '0901' LIMIT 1)),
    ('07011', 'ВСП Москва-1', (SELECT id FROM t_db_oarb_ua_gosb_dict WHERE gosb_code = '0701' LIMIT 1))
ON CONFLICT DO NOTHING;

-- ============================================================================
-- СПРАВОЧНИК КАНАЛОВ
-- ============================================================================

CREATE TABLE IF NOT EXISTS t_db_oarb_ua_channel_dict (
    id BIGSERIAL PRIMARY KEY,
    channel_code VARCHAR(20) NOT NULL,
    channel_name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    created_by TEXT DEFAULT 'system',
    updated_by TEXT,
    deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_channel_dict_code
    ON t_db_oarb_ua_channel_dict (channel_code);

INSERT INTO t_db_oarb_ua_channel_dict (channel_code, channel_name)
VALUES
    ('MB', 'Мобильный банк'),
    ('OFF', 'Офис'),
    ('ONL', 'Онлайн'),
    ('ATM', 'Банкомат'),
    ('CC', 'Контактный центр')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- СПРАВОЧНИК ПРОДУКТОВ
-- ============================================================================

CREATE TABLE IF NOT EXISTS t_db_oarb_ua_product_dict (
    id BIGSERIAL PRIMARY KEY,
    product_code VARCHAR(20) NOT NULL,
    product_name TEXT NOT NULL,
    category VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    created_by TEXT DEFAULT 'system',
    updated_by TEXT,
    deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_product_dict_code
    ON t_db_oarb_ua_product_dict (product_code);

INSERT INTO t_db_oarb_ua_product_dict (product_code, product_name, category)
VALUES
    ('CRED_FL', 'Потребительский кредит', 'Кредитование'),
    ('CRED_UL', 'Кредит для бизнеса', 'Кредитование'),
    ('MORT', 'Ипотека', 'Кредитование'),
    ('DEPOSIT', 'Вклад', 'Депозиты'),
    ('CARD', 'Банковская карта', 'Карты')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- СПРАВОЧНИК ДОЧЕРНИХ ОРГАНИЗАЦИЙ
-- ============================================================================

CREATE TABLE IF NOT EXISTS t_db_oarb_ua_subsidiary_dict (
    id BIGSERIAL PRIMARY KEY,
    subsidiary_code VARCHAR(20) NOT NULL,
    subsidiary_name TEXT NOT NULL,
    inn VARCHAR(20),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    created_by TEXT DEFAULT 'system',
    updated_by TEXT,
    deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_subsidiary_dict_code
    ON t_db_oarb_ua_subsidiary_dict (subsidiary_code);

INSERT INTO t_db_oarb_ua_subsidiary_dict (subsidiary_code, subsidiary_name, inn)
VALUES
    ('SBER_LEASING', 'СберЛизинг', '7707083893'),
    ('SBER_INSURANCE', 'СберСтрахование', '7706810747'),
    ('SBER_FACTORING', 'СберФакторинг', '7730673498')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- СВЯЗЬ ПОДРАЗДЕЛЕНИЙ
-- ============================================================================

CREATE TABLE IF NOT EXISTS t_db_oarb_ua_departments (
    id BIGSERIAL PRIMARY KEY,
    department_code VARCHAR(20) NOT NULL,
    department_name TEXT NOT NULL,
    parent_code VARCHAR(20),
    level INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    created_by TEXT DEFAULT 'system',
    updated_by TEXT,
    deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_departments_code
    ON t_db_oarb_ua_departments (department_code);

INSERT INTO t_db_oarb_ua_departments (department_code, department_name, parent_code, level)
VALUES
    ('OARB', 'Отдел аудита розничного бизнеса', NULL, 1),
    ('OAKB', 'Отдел аудита корпоративного бизнеса', NULL, 1),
    ('OAIT', 'Отдел аудита информационных технологий', NULL, 1),
    ('GR_OARB_1', 'Группа 1 ОАРБ', 'OARB', 2),
    ('GR_OARB_2', 'Группа 2 ОАРБ', 'OARB', 2)
ON CONFLICT DO NOTHING;

-- ============================================================================
-- СПРАВОЧНИК МЕТРИК НАРУШЕНИЙ
-- ============================================================================

CREATE TABLE IF NOT EXISTS t_db_oarb_ua_violation_metric_dict (
    id BIGSERIAL PRIMARY KEY,
    metric_code VARCHAR(20) NOT NULL,
    metric_name TEXT NOT NULL,
    metric_type VARCHAR(50),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    created_by TEXT DEFAULT 'system',
    updated_by TEXT,
    deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_violation_metric_code
    ON t_db_oarb_ua_violation_metric_dict (metric_code);

INSERT INTO t_db_oarb_ua_violation_metric_dict (metric_code, metric_name, metric_type, description)
VALUES
    ('211', 'Уровень потерь', 'FR', 'Финансовый результат — уровень потерь'),
    ('231', 'Упущенная выгода', 'FR', 'Финансовый результат — упущенная выгода'),
    ('402', 'Операционные расходы', 'FR', 'Финансовый результат — операционные расходы'),
    ('130', 'Просроченная задолженность', 'FR', 'Финансовый результат — просроченная задолженность'),
    ('101', 'Индекс удовлетворённости', 'CS', 'Клиентский опыт — индекс удовлетворённости'),
    ('102', 'Количество жалоб', 'CS', 'Клиентский опыт — количество жалоб'),
    ('103', 'Время обработки обращений', 'CS', 'Клиентский опыт — время обработки обращений'),
    ('17', 'Частота инцидентов', 'MKR', 'Макрориск — частота инцидентов'),
    ('19', 'Коэффициент резервирования', 'MKR', 'Макрориск — коэффициент резервирования'),
    ('21', 'Индекс операционного риска', 'IOR', 'Индивидуальный операционный риск'),
    ('6', 'Коэффициент потерь ОР', 'IOR', 'Индивидуальный операционный риск — коэффициент потерь'),
    ('10', 'Уровень контроля', 'IOR', 'Индивидуальный операционный риск — уровень контроля')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- СПРАВОЧНИК КОМАНД АУДИТА
-- ============================================================================

CREATE TABLE IF NOT EXISTS t_db_oarb_ua_team_dict (
    id BIGSERIAL PRIMARY KEY,
    team_code VARCHAR(20) NOT NULL,
    team_name TEXT NOT NULL,
    leader_name TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    created_by TEXT DEFAULT 'system',
    updated_by TEXT,
    deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_team_dict_code
    ON t_db_oarb_ua_team_dict (team_code);

INSERT INTO t_db_oarb_ua_team_dict (team_code, team_name, leader_name)
VALUES
    ('TEAM_01', 'Команда аудита 1', 'Иванов И.И.'),
    ('TEAM_02', 'Команда аудита 2', 'Петров П.П.'),
    ('TEAM_03', 'Команда аудита 3', 'Сидоров С.С.')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- ПРИВЯЗКА УЧАСТНИКОВ КОМАНДЫ К КМ
-- ============================================================================

CREATE TABLE IF NOT EXISTS t_db_oarb_ua_team_member_by_km (
    id BIGSERIAL PRIMARY KEY,
    km_number VARCHAR(50) NOT NULL,
    team_id BIGINT REFERENCES t_db_oarb_ua_team_dict(id),
    member_name TEXT NOT NULL,
    role VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    created_by TEXT DEFAULT 'system',
    updated_by TEXT,
    deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_team_member_km
    ON t_db_oarb_ua_team_member_by_km (km_number);

INSERT INTO t_db_oarb_ua_team_member_by_km (km_number, team_id, member_name, role)
VALUES
    ('КМ-09-41726', (SELECT id FROM t_db_oarb_ua_team_dict WHERE team_code = 'TEAM_01' LIMIT 1), 'Иванов И.И.', 'Руководитель'),
    ('КМ-07-30001', (SELECT id FROM t_db_oarb_ua_team_dict WHERE team_code = 'TEAM_02' LIMIT 1), 'Петров П.П.', 'Руководитель'),
    ('КМ-14-50001', (SELECT id FROM t_db_oarb_ua_team_dict WHERE team_code = 'TEAM_03' LIMIT 1), 'Сидоров С.С.', 'Руководитель')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- НОМЕРА СЛУЖЕБНЫХ ЗАПИСОК
-- ============================================================================

CREATE TABLE IF NOT EXISTS t_db_oarb_ua_sub_number (
    id BIGSERIAL PRIMARY KEY,
    km_number VARCHAR(50) NOT NULL,
    sub_number VARCHAR(100) NOT NULL,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    created_by TEXT DEFAULT 'system',
    updated_by TEXT,
    deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_sub_number_km
    ON t_db_oarb_ua_sub_number (km_number);

INSERT INTO t_db_oarb_ua_sub_number (km_number, sub_number)
VALUES
    ('КМ-09-41726', 'ЦА 36-мо0255'),
    ('КМ-07-30001', 'МСК 12-мо0100'),
    ('КМ-14-50001', 'ЦА 50-мо0300')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- КЛИЕНТЫ НАРУШЕНИЙ (пустая таблица)
-- ============================================================================

CREATE TABLE IF NOT EXISTS t_db_oarb_ua_violation_clients (
    id BIGSERIAL PRIMARY KEY,
    row_id BIGINT,
    client_id VARCHAR(50),
    client_name TEXT,
    client_type VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    created_by TEXT DEFAULT 'system',
    updated_by TEXT,
    deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_violation_clients_row_id
    ON t_db_oarb_ua_violation_clients (row_id);

-- ============================================================================
-- ФАКТЫ НАРУШЕНИЙ
-- ============================================================================

CREATE TABLE IF NOT EXISTS t_db_oarb_ua_violation_facts (
    id BIGSERIAL PRIMARY KEY,
    row_id BIGINT NOT NULL,
    km_number VARCHAR(50) NOT NULL,
    violation_code VARCHAR(50),
    violation_name TEXT,
    process_code VARCHAR(20),
    channel_code VARCHAR(20),
    product_code VARCHAR(20),
    terbank_code VARCHAR(20),
    amount NUMERIC(18, 2) DEFAULT 0,
    currency VARCHAR(10) DEFAULT 'RUB',
    violation_date DATE,
    status VARCHAR(50) DEFAULT 'new',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    created_by TEXT DEFAULT 'system',
    updated_by TEXT,
    deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_violation_facts_row_id
    ON t_db_oarb_ua_violation_facts (row_id);

CREATE INDEX IF NOT EXISTS idx_violation_facts_km
    ON t_db_oarb_ua_violation_facts (km_number);

CREATE INDEX IF NOT EXISTS idx_violation_facts_process
    ON t_db_oarb_ua_violation_facts (process_code);

INSERT INTO t_db_oarb_ua_violation_facts (row_id, km_number, violation_code, violation_name, process_code, channel_code, product_code, terbank_code, amount, violation_date)
VALUES
    (1, 'КМ-09-41726', 'V001', 'Нарушение порядка идентификации клиента', '1014', 'OFF', 'CRED_FL', '09', 150000.00, '2025-01-15'),
    (2, 'КМ-09-41726', 'V002', 'Нарушение порядка оценки залога', '1013', 'OFF', 'CRED_UL', '09', 500000.00, '2025-01-20'),
    (3, 'КМ-09-41726', 'V003', 'Несоблюдение лимитов кредитования', '1014', 'ONL', 'MORT', '09', 2500000.00, '2025-02-01'),
    (4, 'КМ-07-30001', 'V004', 'Нарушение сроков обработки заявки', '1014', 'MB', 'CRED_FL', '07', 75000.00, '2025-02-10'),
    (5, 'КМ-07-30001', 'V005', 'Некорректное формирование резерва', '2014', 'OFF', 'CRED_UL', '07', 1200000.00, '2025-02-15'),
    (6, 'КМ-07-30001', 'V006', 'Нарушение валютного контроля', '2134', 'OFF', 'CRED_UL', '07', 300000.00, '2025-03-01'),
    (7, 'КМ-14-50001', 'V007', 'Нарушение кассовой дисциплины', '3119', 'OFF', 'CARD', '14', 50000.00, '2025-03-05'),
    (8, 'КМ-14-50001', 'V008', 'Несанкционированный доступ к данным', '7010', 'ONL', NULL, '14', 0.00, '2025-03-10'),
    (9, 'КМ-14-50001', 'V009', 'Нарушение процедуры комплаенс', '5010', 'CC', NULL, '14', 100000.00, '2025-03-15'),
    (10, 'КМ-09-41726', 'V010', 'Нарушение порядка выдачи карт', '1015', 'ATM', 'CARD', '09', 25000.00, '2025-03-20')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- МЕТРИКИ ФАКТОВ НАРУШЕНИЙ — ФИНАНСОВЫЙ РЕЗУЛЬТАТ (FR)
-- ============================================================================

CREATE TABLE IF NOT EXISTS t_db_oarb_ua_violation_fr_metric (
    id BIGSERIAL PRIMARY KEY,
    row_id BIGINT NOT NULL,
    metric_code VARCHAR(20) NOT NULL,
    metric_value NUMERIC(18, 2) DEFAULT 0,
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    created_by TEXT DEFAULT 'system',
    updated_by TEXT,
    deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_violation_fr_row_id
    ON t_db_oarb_ua_violation_fr_metric (row_id);

CREATE INDEX IF NOT EXISTS idx_violation_fr_metric_code
    ON t_db_oarb_ua_violation_fr_metric (metric_code);

INSERT INTO t_db_oarb_ua_violation_fr_metric (row_id, metric_code, metric_value, comment)
VALUES
    (1, '211', 150000.00, 'Потери по идентификации клиента'),
    (2, '231', 500000.00, 'Упущенная выгода по залогу'),
    (3, '402', 2500000.00, 'Операционные расходы по лимитам'),
    (4, '130', 75000.00, 'Просрочка по заявке'),
    (5, '211', 1200000.00, 'Потери по резерву'),
    (6, '231', 300000.00, 'Упущенная выгода по валютному контролю'),
    (7, '402', 50000.00, 'Расходы по кассовой дисциплине'),
    (8, '130', 0.00, 'Нет просрочки'),
    (9, '211', 100000.00, 'Потери по комплаенс'),
    (10, '231', 25000.00, 'Упущенная выгода по картам')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- МЕТРИКИ ФАКТОВ НАРУШЕНИЙ — КЛИЕНТСКИЙ ОПЫТ (CS)
-- ============================================================================

CREATE TABLE IF NOT EXISTS t_db_oarb_ua_violation_cs_metric (
    id BIGSERIAL PRIMARY KEY,
    row_id BIGINT NOT NULL,
    metric_code VARCHAR(20) NOT NULL,
    metric_value NUMERIC(18, 2) DEFAULT 0,
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    created_by TEXT DEFAULT 'system',
    updated_by TEXT,
    deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_violation_cs_row_id
    ON t_db_oarb_ua_violation_cs_metric (row_id);

CREATE INDEX IF NOT EXISTS idx_violation_cs_metric_code
    ON t_db_oarb_ua_violation_cs_metric (metric_code);

INSERT INTO t_db_oarb_ua_violation_cs_metric (row_id, metric_code, metric_value, comment)
VALUES
    (1, '101', 3.5, 'Удовлетворённость по идентификации'),
    (2, '102', 2.0, 'Жалобы по залогу'),
    (3, '103', 48.0, 'Время обработки обращений (часы)'),
    (4, '101', 4.0, 'Удовлетворённость по заявке'),
    (5, '102', 5.0, 'Жалобы по резерву'),
    (6, '103', 72.0, 'Время обработки (часы)'),
    (7, '101', 4.5, 'Удовлетворённость по кассе'),
    (8, '102', 1.0, 'Жалобы по доступу'),
    (9, '103', 24.0, 'Время обработки (часы)'),
    (10, '101', 3.0, 'Удовлетворённость по картам')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- МЕТРИКИ ФАКТОВ НАРУШЕНИЙ — МАКРОРИСК (MKR) (пустая таблица)
-- ============================================================================

CREATE TABLE IF NOT EXISTS t_db_oarb_ua_violation_mkr_metric (
    id BIGSERIAL PRIMARY KEY,
    row_id BIGINT NOT NULL,
    metric_code VARCHAR(20) NOT NULL,
    metric_value NUMERIC(18, 2) DEFAULT 0,
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    created_by TEXT DEFAULT 'system',
    updated_by TEXT,
    deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_violation_mkr_row_id
    ON t_db_oarb_ua_violation_mkr_metric (row_id);

CREATE INDEX IF NOT EXISTS idx_violation_mkr_metric_code
    ON t_db_oarb_ua_violation_mkr_metric (metric_code);

-- ============================================================================
-- МЕТРИКИ ФАКТОВ НАРУШЕНИЙ — ИНДИВИДУАЛЬНЫЙ ОПЕРАЦИОННЫЙ РИСК (IOR) (пустая таблица)
-- ============================================================================

CREATE TABLE IF NOT EXISTS t_db_oarb_ua_violation_ior_metric (
    id BIGSERIAL PRIMARY KEY,
    row_id BIGINT NOT NULL,
    metric_code VARCHAR(20) NOT NULL,
    metric_value NUMERIC(18, 2) DEFAULT 0,
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    created_by TEXT DEFAULT 'system',
    updated_by TEXT,
    deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_violation_ior_row_id
    ON t_db_oarb_ua_violation_ior_metric (row_id);

CREATE INDEX IF NOT EXISTS idx_violation_ior_metric_code
    ON t_db_oarb_ua_violation_ior_metric (metric_code);
