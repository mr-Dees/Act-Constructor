-- app/db/schema.sql
-- Схема базы данных для Act Constructor

-- ============================================================================
-- ОСНОВНАЯ ТАБЛИЦА АКТОВ
-- ============================================================================

CREATE TABLE IF NOT EXISTS acts (
    id SERIAL PRIMARY KEY,

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

    -- Системные поля
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(50) NOT NULL,
    last_edited_by VARCHAR(50),
    last_edited_at TIMESTAMP,

    -- Constraints
    CONSTRAINT check_km_number_format
        CHECK (km_number ~ '^КМ-\d{2}-\d{4}$'),

    CONSTRAINT check_km_number_digit_length
        CHECK (length(km_number_digit) = 6),

    CONSTRAINT check_service_note_format
        CHECK (
            service_note IS NULL OR
            service_note ~ '^.+/\d{4}$'
        ),

    CONSTRAINT check_part_number_positive
        CHECK (part_number > 0),

    CONSTRAINT check_total_parts_positive
        CHECK (total_parts > 0),

    CONSTRAINT check_inspection_dates
        CHECK (inspection_end_date >= inspection_start_date),

    CONSTRAINT check_service_note_consistency
        CHECK (
            (service_note IS NULL AND service_note_date IS NULL) OR
            (service_note IS NOT NULL AND service_note_date IS NOT NULL)
        ),

    -- Уникальность по паре (km_number_digit, part_number)
    UNIQUE(km_number_digit, part_number)
);

COMMENT ON TABLE acts IS 'Основная таблица актов проверки с метаданными';

COMMENT ON COLUMN acts.id IS 'Уникальный идентификатор акта';
COMMENT ON COLUMN acts.km_number IS 'КМ номер в формате КМ-XX-XXXX для отображения (НЕ меняется при добавлении СЗ)';
COMMENT ON COLUMN acts.km_number_digit IS 'КМ номер только цифры (всегда 6 цифр) для быстрого поиска';
COMMENT ON COLUMN acts.part_number IS 'Номер части акта (1,2,3... для актов без СЗ или 4 цифры из СЗ для актов с СЗ)';
COMMENT ON COLUMN acts.total_parts IS 'Общее количество частей акта (актов с данным КМ)';
COMMENT ON COLUMN acts.inspection_name IS 'Наименование проверки';
COMMENT ON COLUMN acts.city IS 'Город проведения проверки';
COMMENT ON COLUMN acts.created_date IS 'Дата составления акта (опционально)';
COMMENT ON COLUMN acts.order_number IS 'Номер приказа о проверке';
COMMENT ON COLUMN acts.order_date IS 'Дата приказа о проверке';
COMMENT ON COLUMN acts.is_process_based IS 'Флаг: является ли проверка процессной';
COMMENT ON COLUMN acts.inspection_start_date IS 'Дата начала проверки';
COMMENT ON COLUMN acts.inspection_end_date IS 'Дата окончания проверки';
COMMENT ON COLUMN acts.service_note IS 'Номер служебной записки в формате Текст/XXXX';
COMMENT ON COLUMN acts.service_note_date IS 'Дата служебной записки';
COMMENT ON COLUMN acts.needs_created_date IS 'Флаг валидации: требуется ли дата составления';
COMMENT ON COLUMN acts.needs_directive_number IS 'Флаг валидации: требуется ли номер поручения';
COMMENT ON COLUMN acts.needs_invoice_check IS 'Флаг валидации: требуется ли проверка фактуры';
COMMENT ON COLUMN acts.needs_service_note IS 'Флаг валидации: требуется ли информация по служебной записке';
COMMENT ON COLUMN acts.created_at IS 'Дата и время создания записи';
COMMENT ON COLUMN acts.updated_at IS 'Дата и время последнего обновления метаданных';
COMMENT ON COLUMN acts.created_by IS 'Числовой логин пользователя-создателя';
COMMENT ON COLUMN acts.last_edited_by IS 'Числовой логин последнего редактора содержимого';
COMMENT ON COLUMN acts.last_edited_at IS 'Дата и время последнего редактирования содержимого';

-- ============================================================================
-- ТАБЛИЦА АУДИТОРСКОЙ ГРУППЫ
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_team_members (
    id SERIAL PRIMARY KEY,
    act_id INTEGER NOT NULL REFERENCES acts(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL CHECK (role IN ('Куратор', 'Руководитель', 'Участник')),
    full_name VARCHAR(255) NOT NULL,
    position VARCHAR(255) NOT NULL,
    username VARCHAR(50) NOT NULL,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT check_order_index_non_negative
        CHECK (order_index >= 0)
);

COMMENT ON TABLE audit_team_members IS 'Состав аудиторской группы для каждого акта';

COMMENT ON COLUMN audit_team_members.id IS 'Уникальный идентификатор записи';
COMMENT ON COLUMN audit_team_members.act_id IS 'Ссылка на акт';
COMMENT ON COLUMN audit_team_members.role IS 'Роль члена группы: Куратор, Руководитель или Участник';
COMMENT ON COLUMN audit_team_members.full_name IS 'Полное имя члена группы (ФИО)';
COMMENT ON COLUMN audit_team_members.position IS 'Должность члена группы';
COMMENT ON COLUMN audit_team_members.username IS 'Числовой логин пользователя в системе';
COMMENT ON COLUMN audit_team_members.order_index IS 'Порядок отображения члена группы (для сортировки)';
COMMENT ON COLUMN audit_team_members.created_at IS 'Дата и время добавления в группу';

-- ============================================================================
-- ТАБЛИЦА ПОРУЧЕНИЙ
-- ============================================================================

CREATE TABLE IF NOT EXISTS act_directives (
    id SERIAL PRIMARY KEY,
    act_id INTEGER NOT NULL REFERENCES acts(id) ON DELETE CASCADE,
    point_number VARCHAR(50) NOT NULL,
    directive_number VARCHAR(100) NOT NULL,
    order_index INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT check_point_number_format
        CHECK (point_number ~ '^5\.([\d]+\.)*[\d]+$'),

    CONSTRAINT check_order_index_non_negative
        CHECK (order_index >= 0)
);

COMMENT ON TABLE act_directives IS 'Действующие поручения, относящиеся к акту';

COMMENT ON COLUMN act_directives.id IS 'Уникальный идентификатор поручения';
COMMENT ON COLUMN act_directives.act_id IS 'Ссылка на акт';
COMMENT ON COLUMN act_directives.point_number IS 'Номер пункта в акте (формат: 5.X или 5.X.Y или 5.X.Y.Z и т.д.)';
COMMENT ON COLUMN act_directives.directive_number IS 'Номер действующего поручения';
COMMENT ON COLUMN act_directives.order_index IS 'Порядок отображения поручения (для сортировки)';
COMMENT ON COLUMN act_directives.created_at IS 'Дата и время создания записи';

-- ============================================================================
-- ТАБЛИЦА СТРУКТУРЫ ДЕРЕВА АКТА
-- ============================================================================

CREATE TABLE IF NOT EXISTS act_tree (
    id SERIAL PRIMARY KEY,
    act_id INTEGER UNIQUE NOT NULL REFERENCES acts(id) ON DELETE CASCADE,
    tree_data JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT check_tree_data_not_empty
        CHECK (jsonb_typeof(tree_data) = 'object')
);

COMMENT ON TABLE act_tree IS 'Иерархическая структура акта в формате JSONB дерева';

COMMENT ON COLUMN act_tree.id IS 'Уникальный идентификатор записи';
COMMENT ON COLUMN act_tree.act_id IS 'Ссылка на акт (один акт = одно дерево)';
COMMENT ON COLUMN act_tree.tree_data IS 'JSONB структура дерева с узлами, метками и детьми';
COMMENT ON COLUMN act_tree.created_at IS 'Дата и время создания дерева';
COMMENT ON COLUMN act_tree.updated_at IS 'Дата и время последнего изменения структуры';

-- ============================================================================
-- ТАБЛИЦА ТАБЛИЦ (ДЕНОРМАЛИЗОВАННАЯ)
-- ============================================================================

CREATE TABLE IF NOT EXISTS act_tables (
    id SERIAL PRIMARY KEY,
    act_id INTEGER NOT NULL REFERENCES acts(id) ON DELETE CASCADE,
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

    CONSTRAINT check_grid_data_is_array
        CHECK (jsonb_typeof(grid_data) = 'array'),

    CONSTRAINT check_col_widths_is_array
        CHECK (jsonb_typeof(col_widths) = 'array'),

    UNIQUE(act_id, table_id)
);

COMMENT ON TABLE act_tables IS 'Таблицы внутри актов (денормализованное хранение для быстрого доступа)';

COMMENT ON COLUMN act_tables.id IS 'Уникальный идентификатор записи';
COMMENT ON COLUMN act_tables.act_id IS 'Ссылка на акт';
COMMENT ON COLUMN act_tables.table_id IS 'Уникальный ID таблицы внутри акта';
COMMENT ON COLUMN act_tables.node_id IS 'ID узла в дереве, к которому привязана таблица';
COMMENT ON COLUMN act_tables.node_number IS 'Номер узла (например, 3.2.1) для аналитики';
COMMENT ON COLUMN act_tables.table_label IS 'Название таблицы для поиска и навигации';
COMMENT ON COLUMN act_tables.grid_data IS 'JSONB массив строк и ячеек таблицы';
COMMENT ON COLUMN act_tables.col_widths IS 'JSONB массив ширин колонок в пикселях';
COMMENT ON COLUMN act_tables.is_protected IS 'Флаг: защищена ли таблица от редактирования';
COMMENT ON COLUMN act_tables.is_deletable IS 'Флаг: можно ли удалить таблицу';
COMMENT ON COLUMN act_tables.is_metrics_table IS 'Флаг: таблица метрик';
COMMENT ON COLUMN act_tables.is_main_metrics_table IS 'Флаг: основная таблица метрик';
COMMENT ON COLUMN act_tables.is_regular_risk_table IS 'Флаг: таблица регулярных рисков';
COMMENT ON COLUMN act_tables.is_operational_risk_table IS 'Флаг: таблица операционных рисков';
COMMENT ON COLUMN act_tables.created_at IS 'Дата и время создания таблицы';
COMMENT ON COLUMN act_tables.updated_at IS 'Дата и время последнего изменения таблицы';

-- ============================================================================
-- ТАБЛИЦА ТЕКСТОВЫХ БЛОКОВ
-- ============================================================================

CREATE TABLE IF NOT EXISTS act_textblocks (
    id SERIAL PRIMARY KEY,
    act_id INTEGER NOT NULL REFERENCES acts(id) ON DELETE CASCADE,
    textblock_id VARCHAR(100) NOT NULL,
    node_id VARCHAR(100) NOT NULL,
    node_number VARCHAR(50),
    content TEXT NOT NULL,
    formatting JSONB NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT check_formatting_is_object
        CHECK (jsonb_typeof(formatting) = 'object'),

    UNIQUE(act_id, textblock_id)
);

COMMENT ON TABLE act_textblocks IS 'Текстовые блоки с форматированием внутри актов';

COMMENT ON COLUMN act_textblocks.id IS 'Уникальный идентификатор записи';
COMMENT ON COLUMN act_textblocks.act_id IS 'Ссылка на акт';
COMMENT ON COLUMN act_textblocks.textblock_id IS 'Уникальный ID текстового блока внутри акта';
COMMENT ON COLUMN act_textblocks.node_id IS 'ID узла в дереве, к которому привязан блок';
COMMENT ON COLUMN act_textblocks.node_number IS 'Номер узла (например, 2.1) для аналитики';
COMMENT ON COLUMN act_textblocks.content IS 'Текстовое содержимое блока';
COMMENT ON COLUMN act_textblocks.formatting IS 'JSONB объект с информацией о форматировании (стили, выравнивание и т.д.)';
COMMENT ON COLUMN act_textblocks.created_at IS 'Дата и время создания блока';
COMMENT ON COLUMN act_textblocks.updated_at IS 'Дата и время последнего изменения блока';

-- ============================================================================
-- ТАБЛИЦА НАРУШЕНИЙ
-- ============================================================================

CREATE TABLE IF NOT EXISTS act_violations (
    id SERIAL PRIMARY KEY,
    act_id INTEGER NOT NULL REFERENCES acts(id) ON DELETE CASCADE,
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

    CONSTRAINT check_description_list_is_object_or_null
        CHECK (description_list IS NULL OR jsonb_typeof(description_list) = 'object'),

    CONSTRAINT check_additional_content_is_object_or_null
        CHECK (additional_content IS NULL OR jsonb_typeof(additional_content) = 'object'),

    CONSTRAINT check_reasons_is_object_or_null
        CHECK (
            reasons IS NULL OR
            (jsonb_typeof(reasons) = 'object' AND
             reasons ? 'enabled' AND
             reasons ? 'content')
        ),

    CONSTRAINT check_consequences_is_object_or_null
        CHECK (
            consequences IS NULL OR
            (jsonb_typeof(consequences) = 'object' AND
             consequences ? 'enabled' AND
             consequences ? 'content')
        ),

    CONSTRAINT check_responsible_is_object_or_null
        CHECK (
            responsible IS NULL OR
            (jsonb_typeof(responsible) = 'object' AND
             responsible ? 'enabled' AND
             responsible ? 'content')
        ),

    CONSTRAINT check_recommendations_is_object_or_null
        CHECK (
            recommendations IS NULL OR
            (jsonb_typeof(recommendations) = 'object' AND
             recommendations ? 'enabled' AND
             recommendations ? 'content')
        ),

    UNIQUE(act_id, violation_id)
);

COMMENT ON TABLE act_violations IS 'Нарушения, выявленные в ходе проверки';

COMMENT ON COLUMN act_violations.id IS 'Уникальный идентификатор записи';
COMMENT ON COLUMN act_violations.act_id IS 'Ссылка на акт';
COMMENT ON COLUMN act_violations.violation_id IS 'Уникальный ID нарушения внутри акта';
COMMENT ON COLUMN act_violations.node_id IS 'ID узла в дереве, к которому привязано нарушение';
COMMENT ON COLUMN act_violations.node_number IS 'Номер узла (например, 5.1.3) для аналитики';
COMMENT ON COLUMN act_violations.violated IS 'Что нарушено (нормативная база)';
COMMENT ON COLUMN act_violations.established IS 'Что установлено (факты нарушения)';
COMMENT ON COLUMN act_violations.description_list IS 'JSONB объект с полями enabled и items для списка описаний';
COMMENT ON COLUMN act_violations.additional_content IS 'JSONB объект с полями enabled и items для дополнительного содержимого';
COMMENT ON COLUMN act_violations.reasons IS 'JSONB объект с полями enabled и content для причин нарушения';
COMMENT ON COLUMN act_violations.consequences IS 'JSONB объект с полями enabled и content для последствий нарушения';
COMMENT ON COLUMN act_violations.responsible IS 'JSONB объект с полями enabled и content для ответственных лиц';
COMMENT ON COLUMN act_violations.recommendations IS 'JSONB объект с полями enabled и content для рекомендаций по устранению';
COMMENT ON COLUMN act_violations.created_at IS 'Дата и время создания записи о нарушении';
COMMENT ON COLUMN act_violations.updated_at IS 'Дата и время последнего изменения записи';

-- ============================================================================
-- ИНДЕКСЫ ДЛЯ ОПТИМИЗАЦИИ ЗАПРОСОВ
-- ============================================================================

-- Индексы на acts
CREATE INDEX IF NOT EXISTS idx_acts_km_digit
    ON acts(km_number_digit);

COMMENT ON INDEX idx_acts_km_digit IS 'Индекс для быстрого поиска по цифровой части КМ';

CREATE INDEX IF NOT EXISTS idx_acts_km_digit_part
    ON acts(km_number_digit, part_number);

COMMENT ON INDEX idx_acts_km_digit_part IS 'Композитный индекс для поиска конкретной части КМ';

CREATE INDEX IF NOT EXISTS idx_acts_service_note
    ON acts(service_note)
    WHERE service_note IS NOT NULL;

COMMENT ON INDEX idx_acts_service_note IS 'Частичный индекс на служебные записки (только не NULL значения)';

CREATE INDEX IF NOT EXISTS idx_acts_service_note_date
    ON acts(service_note_date)
    WHERE service_note_date IS NOT NULL;

COMMENT ON INDEX idx_acts_service_note_date IS 'Частичный индекс на даты служебных записок';

CREATE INDEX IF NOT EXISTS idx_acts_created_by
    ON acts(created_by);

COMMENT ON INDEX idx_acts_created_by IS 'Индекс для поиска актов по создателю';

CREATE INDEX IF NOT EXISTS idx_acts_last_edited_at
    ON acts(last_edited_at DESC NULLS LAST);

COMMENT ON INDEX idx_acts_last_edited_at IS 'Индекс для сортировки по времени последнего редактирования';

-- Индексы на audit_team_members
CREATE INDEX IF NOT EXISTS idx_audit_team_username
    ON audit_team_members(username);

COMMENT ON INDEX idx_audit_team_username IS 'Индекс для быстрого поиска актов пользователя';

CREATE INDEX IF NOT EXISTS idx_audit_team_act_id
    ON audit_team_members(act_id);

COMMENT ON INDEX idx_audit_team_act_id IS 'Индекс для быстрого получения команды по акту';

CREATE INDEX IF NOT EXISTS idx_audit_team_act_order
    ON audit_team_members(act_id, order_index);

COMMENT ON INDEX idx_audit_team_act_order IS 'Композитный индекс для сортировки членов группы';

-- Индексы на act_directives
CREATE INDEX IF NOT EXISTS idx_act_directives_act_id
    ON act_directives(act_id);

COMMENT ON INDEX idx_act_directives_act_id IS 'Индекс для быстрого получения поручений по акту';

CREATE INDEX IF NOT EXISTS idx_act_directives_act_order
    ON act_directives(act_id, order_index);

COMMENT ON INDEX idx_act_directives_act_order IS 'Композитный индекс для сортировки поручений';

-- Индексы на act_tables
CREATE INDEX IF NOT EXISTS idx_act_tables_act_id
    ON act_tables(act_id);

COMMENT ON INDEX idx_act_tables_act_id IS 'Индекс для получения всех таблиц акта';

CREATE INDEX IF NOT EXISTS idx_act_tables_node_number
    ON act_tables(act_id, node_number)
    WHERE node_number IS NOT NULL;

COMMENT ON INDEX idx_act_tables_node_number IS 'Частичный индекс для поиска таблиц по номеру узла';

CREATE INDEX IF NOT EXISTS idx_act_tables_label
    ON act_tables(act_id, table_label)
    WHERE table_label IS NOT NULL;

COMMENT ON INDEX idx_act_tables_label IS 'Частичный индекс для поиска таблиц по названию';

CREATE INDEX IF NOT EXISTS idx_act_tables_special_flags
    ON act_tables(act_id)
    WHERE is_metrics_table = TRUE
       OR is_main_metrics_table = TRUE
       OR is_regular_risk_table = TRUE
       OR is_operational_risk_table = TRUE;

COMMENT ON INDEX idx_act_tables_special_flags IS 'Индекс для быстрого поиска специальных таблиц';

-- Индексы на act_textblocks
CREATE INDEX IF NOT EXISTS idx_act_textblocks_act_id
    ON act_textblocks(act_id);

COMMENT ON INDEX idx_act_textblocks_act_id IS 'Индекс для получения всех текстовых блоков акта';

CREATE INDEX IF NOT EXISTS idx_act_textblocks_node_number
    ON act_textblocks(act_id, node_number)
    WHERE node_number IS NOT NULL;

COMMENT ON INDEX idx_act_textblocks_node_number IS 'Частичный индекс для поиска блоков по номеру узла';

-- Индексы на act_violations
CREATE INDEX IF NOT EXISTS idx_act_violations_act_id
    ON act_violations(act_id);

COMMENT ON INDEX idx_act_violations_act_id IS 'Индекс для получения всех нарушений акта';

CREATE INDEX IF NOT EXISTS idx_act_violations_node_number
    ON act_violations(act_id, node_number)
    WHERE node_number IS NOT NULL;

COMMENT ON INDEX idx_act_violations_node_number IS 'Частичный индекс для поиска нарушений по номеру узла';

-- GIN индексы на JSONB для полнотекстового поиска
CREATE INDEX IF NOT EXISTS idx_act_tree_data
    ON act_tree USING GIN(tree_data);

COMMENT ON INDEX idx_act_tree_data IS 'GIN индекс для быстрого поиска внутри структуры дерева';

CREATE INDEX IF NOT EXISTS idx_act_tables_grid_data
    ON act_tables USING GIN(grid_data);

COMMENT ON INDEX idx_act_tables_grid_data IS 'GIN индекс для поиска по содержимому таблиц';

CREATE INDEX IF NOT EXISTS idx_violations_content
    ON act_violations USING GIN(
        description_list, additional_content, reasons,
        consequences, responsible, recommendations
    );

COMMENT ON INDEX idx_violations_content IS 'Составной GIN индекс для полнотекстового поиска по всем полям нарушений';

-- ============================================================================
-- ТРИГГЕРЫ ДЛЯ АВТОМАТИЧЕСКОГО ОБНОВЛЕНИЯ updated_at
-- ============================================================================

-- Функция для обновления updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION update_updated_at_column() IS
    'Автоматически устанавливает updated_at = CURRENT_TIMESTAMP при UPDATE';

-- Триггер для acts
DROP TRIGGER IF EXISTS update_acts_updated_at ON acts;
CREATE TRIGGER update_acts_updated_at
    BEFORE UPDATE ON acts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TRIGGER update_acts_updated_at ON acts IS
    'Автоматически обновляет поле updated_at при изменении метаданных акта';

-- Триггер для act_tree
DROP TRIGGER IF EXISTS update_act_tree_updated_at ON act_tree;
CREATE TRIGGER update_act_tree_updated_at
    BEFORE UPDATE ON act_tree
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TRIGGER update_act_tree_updated_at ON act_tree IS
    'Автоматически обновляет поле updated_at при изменении структуры дерева';

-- Триггер для act_tables
DROP TRIGGER IF EXISTS update_act_tables_updated_at ON act_tables;
CREATE TRIGGER update_act_tables_updated_at
    BEFORE UPDATE ON act_tables
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TRIGGER update_act_tables_updated_at ON act_tables IS
    'Автоматически обновляет поле updated_at при изменении таблицы';

-- Триггер для act_textblocks
DROP TRIGGER IF EXISTS update_act_textblocks_updated_at ON act_textblocks;
CREATE TRIGGER update_act_textblocks_updated_at
    BEFORE UPDATE ON act_textblocks
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TRIGGER update_act_textblocks_updated_at ON act_textblocks IS
    'Автоматически обновляет поле updated_at при изменении текстового блока';

-- Триггер для act_violations
DROP TRIGGER IF EXISTS update_act_violations_updated_at ON act_violations;
CREATE TRIGGER update_act_violations_updated_at
    BEFORE UPDATE ON act_violations
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

COMMENT ON TRIGGER update_act_violations_updated_at ON act_violations IS
    'Автоматически обновляет поле updated_at при изменении нарушения';
