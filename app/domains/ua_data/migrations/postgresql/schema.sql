-- Схема справочных данных UA (PostgreSQL)

-- СПРАВОЧНИК БИЗНЕС-ПРОЦЕССОВ
CREATE TABLE IF NOT EXISTS t_db_oarb_ua_process_dict (
    id SERIAL PRIMARY KEY,
    process_code TEXT NOT NULL,
    process_name TEXT NOT NULL,
    block_owner TEXT NOT NULL DEFAULT '',
    department_owner TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP,
    created_by TEXT DEFAULT 'system',
    updated_by TEXT,
    deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO t_db_oarb_ua_process_dict (process_code, process_name, block_owner, department_owner) VALUES
    ('1013', 'Управление рисками сделок с капиталом', 'Финансы', 'Департамент рисков'),
    ('1014', 'Управление кредитным риском', 'Финансы', 'Департамент рисков'),
    ('2019', 'Риск-менеджмент', 'Риски', 'Управление рисками'),
    ('3119', 'Работа с обратной связью клиентов физических лиц', 'Розничный бизнес', 'Клиентский сервис'),
    ('2014', 'Программа лояльности СберСпасибо', 'Розничный бизнес', 'Маркетинг'),
    ('1010', 'Управление операционным риском', 'Риски', 'Управление рисками'),
    ('7010', 'Ведение кредитных сделок', 'Кредитование', 'Управление кредитования'),
    ('1015', 'Управление рыночным риском', 'Финансы', 'Департамент рисков'),
    ('2134', 'Операции на финансовых рынках', 'Финансы', 'Казначейство'),
    ('5010', 'Осуществление переводов денежных средств', 'Транзакционный бизнес', 'Платежи и переводы')
ON CONFLICT DO NOTHING;

-- СПРАВОЧНИК ТЕРРИТОРИАЛЬНЫХ БАНКОВ
CREATE TABLE IF NOT EXISTS t_db_oarb_ua_terbank_dict (
    tb_id BIGINT PRIMARY KEY,
    short_name TEXT NOT NULL,
    full_name TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP, created_by TEXT DEFAULT 'system',
    updated_by TEXT, deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO t_db_oarb_ua_terbank_dict (tb_id, short_name, full_name) VALUES
    (1, 'Байкальский', 'Байкальский банк ПАО Сбербанк'),
    (4, 'Волго-Вятский', 'Волго-Вятский банк ПАО Сбербанк'),
    (7, 'Московский', 'Московский банк ПАО Сбербанк'),
    (8, 'Поволжский', 'Поволжский банк ПАО Сбербанк'),
    (14, 'Центральный аппарат', 'Центральный аппарат ПАО Сбербанк')
ON CONFLICT DO NOTHING;

-- СПРАВОЧНИК ГОСБ
CREATE TABLE IF NOT EXISTS t_db_oarb_ua_gosb_dict (
    gosb_id BIGINT PRIMARY KEY,
    gosb_name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP, created_by TEXT DEFAULT 'system',
    updated_by TEXT, deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO t_db_oarb_ua_gosb_dict (gosb_id, gosb_name) VALUES
    (1001, 'ГОСБ Иркутск'), (4001, 'ГОСБ Нижний Новгород'), (7001, 'ГОСБ Москва')
ON CONFLICT DO NOTHING;

-- СПРАВОЧНИК ВСП
CREATE TABLE IF NOT EXISTS t_db_oarb_ua_vsp_dict (
    vsp_id BIGINT PRIMARY KEY,
    vsp_urf_code TEXT NOT NULL DEFAULT '',
    vsp_type TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP, created_by TEXT DEFAULT 'system',
    updated_by TEXT, deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO t_db_oarb_ua_vsp_dict (vsp_id, vsp_urf_code, vsp_type) VALUES
    (100101, 'URF001', 'Филиал'), (400101, 'URF004', 'Допофис'), (700101, 'URF007', 'Филиал')
ON CONFLICT DO NOTHING;

-- СПРАВОЧНИК КАНАЛОВ
CREATE TABLE IF NOT EXISTS t_db_oarb_ua_channel_dict (
    id SERIAL PRIMARY KEY,
    channel TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP, created_by TEXT DEFAULT 'system',
    updated_by TEXT, deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO t_db_oarb_ua_channel_dict (channel) VALUES
    ('Мобильный банк'), ('Офис'), ('Онлайн'), ('Банкомат'), ('Контактный центр')
ON CONFLICT DO NOTHING;

-- СПРАВОЧНИК ПРОДУКТОВ
CREATE TABLE IF NOT EXISTS t_db_oarb_ua_product_dict (
    id SERIAL PRIMARY KEY,
    product_name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP, created_by TEXT DEFAULT 'system',
    updated_by TEXT, deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO t_db_oarb_ua_product_dict (product_name) VALUES
    ('Ипотека'), ('Потребительский кредит'), ('Дебетовая карта'), ('Кредитная карта'), ('Вклад')
ON CONFLICT DO NOTHING;

-- СПРАВОЧНИК ДОЧЕРНИХ КОМПАНИЙ
CREATE TABLE IF NOT EXISTS t_db_oarb_ua_subsidiary_dict (
    id SERIAL PRIMARY KEY,
    subsidiary_group TEXT NOT NULL DEFAULT '',
    subsidiary_name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP, created_by TEXT DEFAULT 'system',
    updated_by TEXT, deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO t_db_oarb_ua_subsidiary_dict (subsidiary_group, subsidiary_name) VALUES
    ('Страхование', 'СберСтрахование'), ('Лизинг', 'СберЛизинг'), ('Управление активами', 'Сбер Управление Активами')
ON CONFLICT DO NOTHING;

-- СПРАВОЧНИК ПОДРАЗДЕЛЕНИЙ
CREATE TABLE IF NOT EXISTS t_db_oarb_ua_departments (
    id SERIAL PRIMARY KEY,
    tb_id BIGINT, gosb_id BIGINT, vsp_id BIGINT, subsidiary_id BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP, created_by TEXT DEFAULT 'system',
    updated_by TEXT, deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO t_db_oarb_ua_departments (tb_id, gosb_id, vsp_id, subsidiary_id) VALUES
    (1, 1001, 100101, NULL), (4, 4001, 400101, NULL), (7, 7001, 700101, NULL),
    (7, 7001, NULL, 1), (14, NULL, NULL, NULL)
ON CONFLICT DO NOTHING;

-- СПРАВОЧНИК МЕТРИК НАРУШЕНИЙ
CREATE TABLE IF NOT EXISTS t_db_oarb_ua_violation_metric_dict (
    id SERIAL PRIMARY KEY,
    code TEXT NOT NULL,
    metric_name TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP, created_by TEXT DEFAULT 'system',
    updated_by TEXT, deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO t_db_oarb_ua_violation_metric_dict (code, metric_name) VALUES
    ('211', 'Недополучение процентного и комиссионного дохода'),
    ('231', 'Недополучение процентного дохода'),
    ('402', 'Действие третьих лиц, прочее'),
    ('130', 'Прочие возможности улучшения'),
    ('101', 'Финансовые потери клиента от имени Банка'),
    ('102', 'Недокументированный отказ в оказании услуги'),
    ('103', 'Нарушение сроков оказания услуги'),
    ('17', 'Нарушение Стандартов коммуникации с клиентами'),
    ('19', 'Некорректный/некондиционный документ'),
    ('21', 'Недополучение дохода от взыскания долгов'),
    ('6', 'Финансовые потери Банка в результате недостаточности ИТ услуг'),
    ('10', 'Прочие возможности по улучшению финансовых результатов Банка')
ON CONFLICT DO NOTHING;

-- СПРАВОЧНИК КОМАНД
CREATE TABLE IF NOT EXISTS t_db_oarb_ua_team_dict (
    id SERIAL PRIMARY KEY,
    tb_id BIGINT,
    username TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP, created_by TEXT DEFAULT 'system',
    updated_by TEXT, deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO t_db_oarb_ua_team_dict (tb_id, username) VALUES
    (7, '22494524'), (7, '22501001'), (14, '22501002')
ON CONFLICT DO NOTHING;

-- СВЯЗКА КМ → КОМАНДА
CREATE TABLE IF NOT EXISTS t_db_oarb_ua_team_member_by_km (
    id SERIAL PRIMARY KEY,
    km_id TEXT NOT NULL,
    team_id BIGINT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP, created_by TEXT DEFAULT 'system',
    updated_by TEXT, deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO t_db_oarb_ua_team_member_by_km (km_id, team_id) VALUES
    ('КМ-09-41726', 1), ('КМ-07-30001', 2), ('КМ-14-50001', 3)
ON CONFLICT DO NOTHING;

-- НОМЕРА СУБ-АКТОВ
CREATE TABLE IF NOT EXISTS t_db_oarb_ua_sub_number (
    id SERIAL PRIMARY KEY,
    km_id TEXT NOT NULL,
    act_sub_number TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP, created_by TEXT DEFAULT 'system',
    updated_by TEXT, deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO t_db_oarb_ua_sub_number (km_id, act_sub_number) VALUES
    ('КМ-09-41726', 'ЦА 36-мо0255'), ('КМ-07-30001', 'МСК 12-мо0100'), ('КМ-14-50001', 'ЦА 50-мо0300')
ON CONFLICT DO NOTHING;

-- КЛИЕНТЫ С НАРУШЕНИЯМИ
CREATE TABLE IF NOT EXISTS t_db_oarb_ua_violation_clients (
    id SERIAL PRIMARY KEY,
    epk_id TEXT NOT NULL DEFAULT '',
    innul TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP, created_by TEXT DEFAULT 'system',
    updated_by TEXT, deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

-- ФАКТЫ НАРУШЕНИЙ
CREATE TABLE IF NOT EXISTS t_db_oarb_ua_violation_facts (
    row_id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL DEFAULT '',
    operation_datetime TIMESTAMP,
    team_id BIGINT, ua_violation_id BIGINT,
    operation_department_id BIGINT, client_id BIGINT,
    channel_id BIGINT, responsible_department_id BIGINT,
    product_id BIGINT, process_id BIGINT,
    operation_sum NUMERIC(38, 2) DEFAULT 0,
    row_hash TEXT NOT NULL DEFAULT '',
    etl_loading_id BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP, created_by TEXT DEFAULT 'system',
    updated_by TEXT, deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO t_db_oarb_ua_violation_facts (row_id, operation_id, operation_datetime, team_id, process_id, operation_sum) VALUES
    ('ROW001', 'OP001', '2025-06-15', 1, 1, 150000.50),
    ('ROW002', 'OP002', '2025-07-20', 1, 2, 250000.00),
    ('ROW003', 'OP003', '2025-08-10', 2, 3, 75000.25),
    ('ROW004', 'OP004', '2025-09-05', 2, 5, 500000.00),
    ('ROW005', 'OP005', '2025-10-12', 3, 7, 320000.75)
ON CONFLICT DO NOTHING;

-- МЕТРИКИ FR
CREATE TABLE IF NOT EXISTS t_db_oarb_ua_violation_fr_metric (
    id SERIAL PRIMARY KEY,
    row_id TEXT NOT NULL,
    metric_code TEXT NOT NULL,
    fr_sum NUMERIC(38, 2) DEFAULT 0,
    etl_loading_id BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP, created_by TEXT DEFAULT 'system',
    updated_by TEXT, deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO t_db_oarb_ua_violation_fr_metric (row_id, metric_code, fr_sum) VALUES
    ('ROW001', '211', 150000.50), ('ROW002', '231', 250000.00),
    ('ROW003', '211', 75000.25), ('ROW004', '402', 500000.00), ('ROW005', '130', 320000.75)
ON CONFLICT DO NOTHING;

-- МЕТРИКИ CS
CREATE TABLE IF NOT EXISTS t_db_oarb_ua_violation_cs_metric (
    id SERIAL PRIMARY KEY,
    row_id TEXT NOT NULL,
    metric_code TEXT NOT NULL,
    missing_fin_sum NUMERIC(38, 2) DEFAULT 0,
    crm_id TEXT NOT NULL DEFAULT '',
    etl_loading_id BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP, created_by TEXT DEFAULT 'system',
    updated_by TEXT, deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

INSERT INTO t_db_oarb_ua_violation_cs_metric (row_id, metric_code, missing_fin_sum) VALUES
    ('ROW001', '101', 50000.00), ('ROW002', '102', 30000.00),
    ('ROW003', '103', 15000.50), ('ROW004', '17', 0), ('ROW005', '19', 25000.00)
ON CONFLICT DO NOTHING;

-- МЕТРИКИ MKR (пустая)
CREATE TABLE IF NOT EXISTS t_db_oarb_ua_violation_mkr_metric (
    id SERIAL PRIMARY KEY,
    row_id TEXT NOT NULL, metric_code TEXT NOT NULL,
    has_disagree BOOLEAN DEFAULT false,
    isu_id TEXT NOT NULL DEFAULT '', isu_mkr TEXT NOT NULL DEFAULT '',
    departmet_id BIGINT, violation_amount NUMERIC(38, 2) DEFAULT 0,
    tab_number TEXT NOT NULL DEFAULT '', etl_loading_id BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP, created_by TEXT DEFAULT 'system',
    updated_by TEXT, deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

-- МЕТРИКИ IOR (пустая)
CREATE TABLE IF NOT EXISTS t_db_oarb_ua_violation_ior_metric (
    id SERIAL PRIMARY KEY,
    row_id TEXT NOT NULL, metric_code TEXT NOT NULL,
    risk_type TEXT NOT NULL DEFAULT '',
    count_client_with_theft BIGINT DEFAULT 0,
    fict_sales_count BIGINT DEFAULT 0,
    indirected_losses_sum NUMERIC(38, 2) DEFAULT 0,
    ior_sum NUMERIC(38, 2) DEFAULT 0,
    cred_risk_consequences TEXT NOT NULL DEFAULT '',
    potential_losses_sum NUMERIC(38, 2) DEFAULT 0,
    missing_client_sum NUMERIC(38, 2) DEFAULT 0,
    direct_losses_sum NUMERIC(38, 2) DEFAULT 0,
    etl_loading_id BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP, created_by TEXT DEFAULT 'system',
    updated_by TEXT, deleted_at TIMESTAMP,
    is_actual BOOLEAN NOT NULL DEFAULT true
);

-- ИНДЕКСЫ
CREATE INDEX IF NOT EXISTS idx_ua_process_dict_code ON t_db_oarb_ua_process_dict(process_code);
CREATE INDEX IF NOT EXISTS idx_ua_violation_facts_process ON t_db_oarb_ua_violation_facts(process_id);
CREATE INDEX IF NOT EXISTS idx_ua_fr_metric_row ON t_db_oarb_ua_violation_fr_metric(row_id);
CREATE INDEX IF NOT EXISTS idx_ua_fr_metric_code ON t_db_oarb_ua_violation_fr_metric(metric_code);
CREATE INDEX IF NOT EXISTS idx_ua_cs_metric_row ON t_db_oarb_ua_violation_cs_metric(row_id);
CREATE INDEX IF NOT EXISTS idx_ua_cs_metric_code ON t_db_oarb_ua_violation_cs_metric(metric_code);
