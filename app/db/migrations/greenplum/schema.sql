-- Схема базы данных для Act Constructor (Greenplum)
-- Схема: {SCHEMA}
-- Префикс таблиц: {PREFIX}

-- ============================================================================
-- ОСНОВНАЯ ТАБЛИЦА АКТОВ
-- ============================================================================

CREATE TABLE {SCHEMA}.{PREFIX}acts (
    id BIGSERIAL PRIMARY KEY,

    -- Номер КМ и части
    km_number VARCHAR(50) NOT NULL,
    km_number_digit VARCHAR(10) NOT NULL,
    part_number INTEGER NOT NULL DEFAULT 1,
    total_parts INTEGER NOT NULL DEFAULT 1,

    -- Основные метаданные
    inspection_name TEXT NOT NULL,
    city VARCHAR(255) NOT NULL,
    created_date DATE,
    order_number VARCHAR(100) NOT NULL,
    order_date DATE NOT NULL,
    is_process_based BOOLEAN DEFAULT TRUE,
    inspection_start_date DATE NOT NULL,
    inspection_end_date DATE NOT NULL,

    -- Служебная записка
    service_note VARCHAR(100),
    service_note_date DATE,

    -- Служебные флаги для валидации
    needs_created_date BOOLEAN DEFAULT FALSE,
    needs_directive_number BOOLEAN DEFAULT FALSE,
    needs_invoice_check BOOLEAN DEFAULT FALSE,
    needs_service_note BOOLEAN DEFAULT FALSE,

    -- Блокировка для редактирования
    locked_by VARCHAR(50) DEFAULT NULL,
    locked_at TIMESTAMP DEFAULT NULL,
    lock_expires_at TIMESTAMP DEFAULT NULL,

    -- Системные поля
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(50) NOT NULL,
    last_edited_by VARCHAR(50),
    last_edited_at TIMESTAMP
)
WITH (appendonly=false)
DISTRIBUTED BY (id);

-- ============================================================================
-- ТАБЛИЦА АУДИТОРСКОЙ ГРУППЫ
-- ============================================================================

CREATE TABLE {SCHEMA}.{PREFIX}audit_team_members (
    id BIGSERIAL PRIMARY KEY,
    act_id BIGINT NOT NULL,
    role VARCHAR(50) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    position VARCHAR(255) NOT NULL,
    username VARCHAR(50) NOT NULL,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
WITH (appendonly=false)
DISTRIBUTED BY (id);

-- ============================================================================
-- ТАБЛИЦА ПОРУЧЕНИЙ
-- ============================================================================

CREATE TABLE {SCHEMA}.{PREFIX}act_directives (
    id BIGSERIAL PRIMARY KEY,
    act_id BIGINT NOT NULL,
    point_number VARCHAR(50) NOT NULL,
    directive_number VARCHAR(100) NOT NULL,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
WITH (appendonly=false)
DISTRIBUTED BY (id);

-- ============================================================================
-- ТАБЛИЦА СТРУКТУРЫ ДЕРЕВА АКТА
-- ============================================================================

CREATE TABLE {SCHEMA}.{PREFIX}act_tree (
    id BIGSERIAL PRIMARY KEY,
    act_id BIGINT NOT NULL,
    tree_data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
WITH (appendonly=false)
DISTRIBUTED BY (id);

-- ============================================================================
-- ТАБЛИЦА ТАБЛИЦ (ДЕНОРМАЛИЗОВАННАЯ)
-- ============================================================================

CREATE TABLE {SCHEMA}.{PREFIX}act_tables (
    id BIGSERIAL PRIMARY KEY,
    act_id BIGINT NOT NULL,
    table_id VARCHAR(100) NOT NULL,
    node_id VARCHAR(100) NOT NULL,
    node_number VARCHAR(50),
    table_label TEXT,
    grid_data JSONB NOT NULL,
    col_widths JSONB NOT NULL,
    is_protected BOOLEAN DEFAULT FALSE,
    is_deletable BOOLEAN DEFAULT TRUE,
    is_metrics_table BOOLEAN DEFAULT FALSE,
    is_main_metrics_table BOOLEAN DEFAULT FALSE,
    is_regular_risk_table BOOLEAN DEFAULT FALSE,
    is_operational_risk_table BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
WITH (appendonly=false)
DISTRIBUTED BY (id);

-- ============================================================================
-- ТАБЛИЦА ТЕКСТОВЫХ БЛОКОВ
-- ============================================================================

CREATE TABLE {SCHEMA}.{PREFIX}act_textblocks (
    id BIGSERIAL PRIMARY KEY,
    act_id BIGINT NOT NULL,
    textblock_id VARCHAR(100) NOT NULL,
    node_id VARCHAR(100) NOT NULL,
    node_number VARCHAR(50),
    content TEXT NOT NULL,
    formatting JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
WITH (appendonly=false)
DISTRIBUTED BY (id);

-- ============================================================================
-- ТАБЛИЦА НАРУШЕНИЙ
-- ============================================================================

CREATE TABLE {SCHEMA}.{PREFIX}act_violations (
    id BIGSERIAL PRIMARY KEY,
    act_id BIGINT NOT NULL,
    violation_id VARCHAR(100) NOT NULL,
    node_id VARCHAR(100) NOT NULL,
    node_number VARCHAR(50),
    violated TEXT,
    established TEXT,
    description_list JSONB,
    additional_content JSONB,
    reasons JSONB,
    consequences JSONB,
    responsible JSONB,
    recommendations JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)
WITH (appendonly=false)
DISTRIBUTED BY (id);

-- ============================================================================
-- ИНДЕКСЫ ДЛЯ ОПТИМИЗАЦИИ ЗАПРОСОВ
-- ============================================================================

-- Индексы на acts
CREATE INDEX idx_{PREFIX}acts_id
    ON {SCHEMA}.{PREFIX}acts(id);

CREATE INDEX idx_{PREFIX}acts_km_digit
    ON {SCHEMA}.{PREFIX}acts(km_number_digit);

CREATE INDEX idx_{PREFIX}acts_km_digit_part
    ON {SCHEMA}.{PREFIX}acts(km_number_digit, part_number);

CREATE INDEX idx_{PREFIX}acts_service_note
    ON {SCHEMA}.{PREFIX}acts(service_note)
    WHERE service_note IS NOT NULL;

CREATE INDEX idx_{PREFIX}acts_created_by
    ON {SCHEMA}.{PREFIX}acts(created_by);

CREATE INDEX idx_{PREFIX}acts_last_edited_at
    ON {SCHEMA}.{PREFIX}acts(last_edited_at);

-- Индексы для блокировок
CREATE INDEX idx_{PREFIX}acts_locked_by
    ON {SCHEMA}.{PREFIX}acts(locked_by)
    WHERE locked_by IS NOT NULL;

CREATE INDEX idx_{PREFIX}acts_lock_expires
    ON {SCHEMA}.{PREFIX}acts(lock_expires_at)
    WHERE lock_expires_at IS NOT NULL;

-- Индексы на audit_team_members
CREATE INDEX idx_{PREFIX}audit_team_username
    ON {SCHEMA}.{PREFIX}audit_team_members(username);

CREATE INDEX idx_{PREFIX}audit_team_act_id
    ON {SCHEMA}.{PREFIX}audit_team_members(act_id);

-- Индексы на act_directives
CREATE INDEX idx_{PREFIX}act_directives_act_id
    ON {SCHEMA}.{PREFIX}act_directives(act_id);

-- Индексы на act_tree
CREATE INDEX idx_{PREFIX}act_tree_act_id
    ON {SCHEMA}.{PREFIX}act_tree(act_id);

-- Индексы на act_tables
CREATE INDEX idx_{PREFIX}act_tables_act_id
    ON {SCHEMA}.{PREFIX}act_tables(act_id);

CREATE INDEX idx_{PREFIX}act_tables_act_table
    ON {SCHEMA}.{PREFIX}act_tables(act_id, table_id);

CREATE INDEX idx_{PREFIX}act_tables_node_number
    ON {SCHEMA}.{PREFIX}act_tables(act_id, node_number)
    WHERE node_number IS NOT NULL;

-- Индексы на act_textblocks
CREATE INDEX idx_{PREFIX}act_textblocks_act_id
    ON {SCHEMA}.{PREFIX}act_textblocks(act_id);

CREATE INDEX idx_{PREFIX}act_textblocks_act_textblock
    ON {SCHEMA}.{PREFIX}act_textblocks(act_id, textblock_id);

-- Индексы на act_violations
CREATE INDEX idx_{PREFIX}act_violations_act_id
    ON {SCHEMA}.{PREFIX}act_violations(act_id);

CREATE INDEX idx_{PREFIX}act_violations_act_violation
    ON {SCHEMA}.{PREFIX}act_violations(act_id, violation_id);

-- ============================================================================
-- ТРИГГЕРЫ ДЛЯ АВТОМАТИЧЕСКОГО ОБНОВЛЕНИЯ updated_at
-- ============================================================================

-- Функция для обновления updated_at
CREATE OR REPLACE FUNCTION {SCHEMA}.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Триггеры для каждой таблицы
DROP TRIGGER IF EXISTS update_{PREFIX}acts_updated_at ON {SCHEMA}.{PREFIX}acts;
CREATE TRIGGER update_{PREFIX}acts_updated_at
    BEFORE UPDATE ON {SCHEMA}.{PREFIX}acts
    FOR EACH ROW
    EXECUTE PROCEDURE {SCHEMA}.update_updated_at_column();

DROP TRIGGER IF EXISTS update_{PREFIX}act_tree_updated_at ON {SCHEMA}.{PREFIX}act_tree;
CREATE TRIGGER update_{PREFIX}act_tree_updated_at
    BEFORE UPDATE ON {SCHEMA}.{PREFIX}act_tree
    FOR EACH ROW
    EXECUTE PROCEDURE {SCHEMA}.update_updated_at_column();

DROP TRIGGER IF EXISTS update_{PREFIX}act_tables_updated_at ON {SCHEMA}.{PREFIX}act_tables;
CREATE TRIGGER update_{PREFIX}act_tables_updated_at
    BEFORE UPDATE ON {SCHEMA}.{PREFIX}act_tables
    FOR EACH ROW
    EXECUTE PROCEDURE {SCHEMA}.update_updated_at_column();

DROP TRIGGER IF EXISTS update_{PREFIX}act_textblocks_updated_at ON {SCHEMA}.{PREFIX}act_textblocks;
CREATE TRIGGER update_{PREFIX}act_textblocks_updated_at
    BEFORE UPDATE ON {SCHEMA}.{PREFIX}act_textblocks
    FOR EACH ROW
    EXECUTE PROCEDURE {SCHEMA}.update_updated_at_column();

DROP TRIGGER IF EXISTS update_{PREFIX}act_violations_updated_at ON {SCHEMA}.{PREFIX}act_violations;
CREATE TRIGGER update_{PREFIX}act_violations_updated_at
    BEFORE UPDATE ON {SCHEMA}.{PREFIX}act_violations
    FOR EACH ROW
    EXECUTE PROCEDURE {SCHEMA}.update_updated_at_column();
