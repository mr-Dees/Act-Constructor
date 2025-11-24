-- app/db/schema.sql (исправленный)
-- Схема базы данных для Act Constructor

-- Основная таблица актов с метаданными
CREATE TABLE IF NOT EXISTS acts (
    id SERIAL PRIMARY KEY,
    km_number VARCHAR(50) UNIQUE NOT NULL,
    inspection_name TEXT NOT NULL,
    city VARCHAR(255) NOT NULL,
    created_date DATE NOT NULL,
    order_number VARCHAR(100) NOT NULL,
    order_date DATE NOT NULL,
    is_process_based BOOLEAN DEFAULT TRUE,
    inspection_start_date DATE NOT NULL,
    inspection_end_date DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255) NOT NULL,
    last_edited_by VARCHAR(255),
    last_edited_at TIMESTAMP
);

-- Таблица членов аудиторской группы
CREATE TABLE IF NOT EXISTS audit_team_members (
    id SERIAL PRIMARY KEY,
    act_id INTEGER REFERENCES acts(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL CHECK (role IN ('Куратор', 'Руководитель', 'Участник')),
    full_name VARCHAR(255) NOT NULL,
    position VARCHAR(255) NOT NULL,
    username VARCHAR(255) NOT NULL,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица поручений
CREATE TABLE IF NOT EXISTS act_directives (
    id SERIAL PRIMARY KEY,
    act_id INTEGER REFERENCES acts(id) ON DELETE CASCADE,
    point_number VARCHAR(50) NOT NULL,
    directive_number VARCHAR(100) NOT NULL,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица структуры дерева актов (хранится как JSONB для гибкости)
CREATE TABLE IF NOT EXISTS act_tree (
    id SERIAL PRIMARY KEY,
    act_id INTEGER UNIQUE REFERENCES acts(id) ON DELETE CASCADE,
    tree_data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Таблица таблиц (денормализованная для удобства запросов)
CREATE TABLE IF NOT EXISTS act_tables (
    id SERIAL PRIMARY KEY,
    act_id INTEGER REFERENCES acts(id) ON DELETE CASCADE,
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
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(act_id, table_id)
);

-- Таблица текстовых блоков
CREATE TABLE IF NOT EXISTS act_textblocks (
    id SERIAL PRIMARY KEY,
    act_id INTEGER REFERENCES acts(id) ON DELETE CASCADE,
    textblock_id VARCHAR(100) NOT NULL,
    node_id VARCHAR(100) NOT NULL,
    node_number VARCHAR(50),
    content TEXT NOT NULL,
    formatting JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(act_id, textblock_id)
);

-- Таблица нарушений
CREATE TABLE IF NOT EXISTS act_violations (
    id SERIAL PRIMARY KEY,
    act_id INTEGER REFERENCES acts(id) ON DELETE CASCADE,
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
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(act_id, violation_id)
);

-- Индексы для оптимизации запросов

-- Индексы на acts
CREATE INDEX IF NOT EXISTS idx_acts_km_number ON acts(km_number);
CREATE INDEX IF NOT EXISTS idx_acts_created_by ON acts(created_by);
CREATE INDEX IF NOT EXISTS idx_acts_last_edited_at ON acts(last_edited_at DESC);

-- Индексы на audit_team_members для быстрого поиска актов пользователя
CREATE INDEX IF NOT EXISTS idx_audit_team_username ON audit_team_members(username);
CREATE INDEX IF NOT EXISTS idx_audit_team_act_id ON audit_team_members(act_id);

-- Индексы на act_tables для аналитических запросов
CREATE INDEX IF NOT EXISTS idx_act_tables_act_id ON act_tables(act_id);
CREATE INDEX IF NOT EXISTS idx_act_tables_node_number ON act_tables(act_id, node_number);
CREATE INDEX IF NOT EXISTS idx_act_tables_label ON act_tables(act_id, table_label);

-- Индексы на act_textblocks
CREATE INDEX IF NOT EXISTS idx_act_textblocks_act_id ON act_textblocks(act_id);
CREATE INDEX IF NOT EXISTS idx_act_textblocks_node_number ON act_textblocks(act_id, node_number);

-- Индексы на act_violations
CREATE INDEX IF NOT EXISTS idx_act_violations_act_id ON act_violations(act_id);
CREATE INDEX IF NOT EXISTS idx_act_violations_node_number ON act_violations(act_id, node_number);

-- GIN индексы на JSONB для быстрого поиска внутри JSON
CREATE INDEX IF NOT EXISTS idx_act_tree_data ON act_tree USING GIN(tree_data);
CREATE INDEX IF NOT EXISTS idx_violations_content ON act_violations USING GIN(
    description_list, additional_content, reasons,
    consequences, responsible, recommendations
);

-- Функция для автоматического обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Удаляем старые триггеры если существуют, затем создаем новые
DROP TRIGGER IF EXISTS update_acts_updated_at ON acts;
CREATE TRIGGER update_acts_updated_at
    BEFORE UPDATE ON acts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_act_tree_updated_at ON act_tree;
CREATE TRIGGER update_act_tree_updated_at
    BEFORE UPDATE ON act_tree
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_act_tables_updated_at ON act_tables;
CREATE TRIGGER update_act_tables_updated_at
    BEFORE UPDATE ON act_tables
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_act_textblocks_updated_at ON act_textblocks;
CREATE TRIGGER update_act_textblocks_updated_at
    BEFORE UPDATE ON act_textblocks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_act_violations_updated_at ON act_violations;
CREATE TRIGGER update_act_violations_updated_at
    BEFORE UPDATE ON act_violations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
