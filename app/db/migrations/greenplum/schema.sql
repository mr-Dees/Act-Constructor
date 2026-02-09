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
    km_number_digit INTEGER NOT NULL,
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

COMMENT ON TABLE {SCHEMA}.{PREFIX}acts IS 'Основная таблица актов проверки с метаданными';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.id IS 'Уникальный идентификатор акта';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.km_number IS 'КМ номер в формате КМ-XX-XXXXX для отображения (НЕ меняется при добавлении СЗ)';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.km_number_digit IS 'КМ номер только цифры (всегда 7 цифр) для быстрого поиска';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.part_number IS 'Номер части акта (1,2,3... для актов без СЗ или 4 цифры из СЗ для актов с СЗ)';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.total_parts IS 'Общее количество частей акта (актов с данным КМ)';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.inspection_name IS 'Наименование проверки';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.city IS 'Город проведения проверки';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.created_date IS 'Дата составления акта (опционально)';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.order_number IS 'Номер приказа о проверке';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.order_date IS 'Дата приказа о проверке';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.is_process_based IS 'Флаг: является ли проверка процессной';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.inspection_start_date IS 'Дата начала проверки';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.inspection_end_date IS 'Дата окончания проверки';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.service_note IS 'Номер служебной записки в формате Текст/XXXX';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.service_note_date IS 'Дата служебной записки';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.needs_created_date IS 'Флаг валидации: требуется ли дата составления';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.needs_directive_number IS 'Флаг валидации: требуется ли номер поручения';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.needs_invoice_check IS 'Флаг валидации: требуется ли проверка фактуры';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.needs_service_note IS 'Флаг валидации: требуется ли информация по служебной записке';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.locked_by IS 'Username пользователя, заблокировавшего акт для редактирования';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.locked_at IS 'Время начала блокировки';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.lock_expires_at IS 'Время истечения блокировки (автоосвобождение)';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.created_at IS 'Дата и время создания записи';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.updated_at IS 'Дата и время последнего обновления метаданных';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.created_by IS 'Числовой логин пользователя-создателя';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.last_edited_by IS 'Числовой логин последнего редактора содержимого';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}acts.last_edited_at IS 'Дата и время последнего редактирования содержимого';

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

COMMENT ON TABLE {SCHEMA}.{PREFIX}audit_team_members IS 'Состав аудиторской группы для каждого акта';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}audit_team_members.id IS 'Уникальный идентификатор записи';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}audit_team_members.act_id IS 'Ссылка на акт';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}audit_team_members.role IS 'Роль члена группы: Куратор, Руководитель, Редактор или Участник';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}audit_team_members.full_name IS 'Полное имя члена группы (ФИО)';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}audit_team_members.position IS 'Должность члена группы';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}audit_team_members.username IS 'Числовой логин пользователя в системе';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}audit_team_members.order_index IS 'Порядок отображения члена группы (для сортировки)';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}audit_team_members.created_at IS 'Дата и время добавления в группу';

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

COMMENT ON TABLE {SCHEMA}.{PREFIX}act_directives IS 'Действующие поручения, относящиеся к акту';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_directives.id IS 'Уникальный идентификатор поручения';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_directives.act_id IS 'Ссылка на акт';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_directives.point_number IS 'Номер пункта в акте (формат: 5.X или 5.X.Y или 5.X.Y.Z и т.д.)';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_directives.directive_number IS 'Номер действующего поручения';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_directives.order_index IS 'Порядок отображения поручения (для сортировки)';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_directives.created_at IS 'Дата и время создания записи';

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

COMMENT ON TABLE {SCHEMA}.{PREFIX}act_tree IS 'Иерархическая структура акта в формате JSONB дерева';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_tree.id IS 'Уникальный идентификатор записи';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_tree.act_id IS 'Ссылка на акт (один акт = одно дерево)';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_tree.tree_data IS 'JSONB структура дерева с узлами, метками и детьми';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_tree.created_at IS 'Дата и время создания дерева';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_tree.updated_at IS 'Дата и время последнего изменения структуры';

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

COMMENT ON TABLE {SCHEMA}.{PREFIX}act_tables IS 'Таблицы внутри актов (денормализованное хранение для быстрого доступа)';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_tables.id IS 'Уникальный идентификатор записи';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_tables.act_id IS 'Ссылка на акт';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_tables.table_id IS 'Уникальный ID таблицы внутри акта';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_tables.node_id IS 'ID узла в дереве, к которому привязана таблица';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_tables.node_number IS 'Номер узла (например, 3.2.1) для аналитики';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_tables.table_label IS 'Название таблицы для поиска и навигации';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_tables.grid_data IS 'JSONB массив строк и ячеек таблицы';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_tables.col_widths IS 'JSONB массив ширин колонок в пикселях';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_tables.is_protected IS 'Флаг: защищена ли таблица от редактирования';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_tables.is_deletable IS 'Флаг: можно ли удалить таблицу';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_tables.is_metrics_table IS 'Флаг: таблица метрик';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_tables.is_main_metrics_table IS 'Флаг: основная таблица метрик';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_tables.is_regular_risk_table IS 'Флаг: таблица регулярных рисков';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_tables.is_operational_risk_table IS 'Флаг: таблица операционных рисков';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_tables.created_at IS 'Дата и время создания таблицы';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_tables.updated_at IS 'Дата и время последнего изменения таблицы';

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

COMMENT ON TABLE {SCHEMA}.{PREFIX}act_textblocks IS 'Текстовые блоки с форматированием внутри актов';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_textblocks.id IS 'Уникальный идентификатор записи';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_textblocks.act_id IS 'Ссылка на акт';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_textblocks.textblock_id IS 'Уникальный ID текстового блока внутри акта';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_textblocks.node_id IS 'ID узла в дереве, к которому привязан блок';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_textblocks.node_number IS 'Номер узла (например, 2.1) для аналитики';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_textblocks.content IS 'Текстовое содержимое блока';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_textblocks.formatting IS 'JSONB объект с информацией о форматировании (стили, выравнивание и т.д.)';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_textblocks.created_at IS 'Дата и время создания блока';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_textblocks.updated_at IS 'Дата и время последнего изменения блока';

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

COMMENT ON TABLE {SCHEMA}.{PREFIX}act_violations IS 'Нарушения, выявленные в ходе проверки';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_violations.id IS 'Уникальный идентификатор записи';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_violations.act_id IS 'Ссылка на акт';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_violations.violation_id IS 'Уникальный ID нарушения внутри акта';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_violations.node_id IS 'ID узла в дереве, к которому привязано нарушение';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_violations.node_number IS 'Номер узла (например, 5.1.3) для аналитики';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_violations.violated IS 'Что нарушено (нормативная база)';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_violations.established IS 'Что установлено (факты нарушения)';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_violations.description_list IS 'JSONB объект с полями enabled и items для списка описаний';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_violations.additional_content IS 'JSONB объект с полями enabled и items для дополнительного содержимого';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_violations.reasons IS 'JSONB объект с полями enabled и content для причин нарушения';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_violations.consequences IS 'JSONB объект с полями enabled и content для последствий нарушения';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_violations.responsible IS 'JSONB объект с полями enabled и content для ответственных лиц';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_violations.recommendations IS 'JSONB объект с полями enabled и content для рекомендаций по устранению';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_violations.created_at IS 'Дата и время создания записи о нарушении';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_violations.updated_at IS 'Дата и время последнего изменения записи';

-- ============================================================================
-- ТАБЛИЦА ФАКТУР
-- ============================================================================

CREATE TABLE {SCHEMA}.{PREFIX}act_invoices (
    id BIGSERIAL PRIMARY KEY,
    act_id BIGINT NOT NULL,
    node_id VARCHAR(100) NOT NULL,
    node_number VARCHAR(50),
    db_type VARCHAR(20) NOT NULL,
    schema_name VARCHAR(255) NOT NULL,
    table_name VARCHAR(255) NOT NULL,
    metrics_types JSONB NOT NULL DEFAULT '[]',
    verification_status VARCHAR(20) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(50) NOT NULL
)
WITH (appendonly=false)
DISTRIBUTED BY (id);

COMMENT ON TABLE {SCHEMA}.{PREFIX}act_invoices IS 'Фактуры, прикрепленные к пунктам акта';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_invoices.id IS 'Уникальный идентификатор записи';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_invoices.act_id IS 'Ссылка на акт';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_invoices.node_id IS 'ID узла в дереве, к которому привязана фактура';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_invoices.node_number IS 'Номер узла (например, 5.1.3) для аналитики';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_invoices.db_type IS 'Тип базы данных: hive или greenplum';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_invoices.schema_name IS 'Имя схемы в базе данных';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_invoices.table_name IS 'Имя таблицы в базе данных';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_invoices.metrics_types IS 'JSONB массив типов метрик (КС, ФР, ОР, РР, МКР)';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_invoices.verification_status IS 'Статус верификации: pending, verified, rejected';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_invoices.created_at IS 'Дата и время создания записи';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_invoices.updated_at IS 'Дата и время последнего обновления';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}act_invoices.created_by IS 'Числовой логин пользователя-создателя';

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

-- Индексы на act_invoices
CREATE INDEX idx_{PREFIX}act_invoices_act_id
    ON {SCHEMA}.{PREFIX}act_invoices(act_id);

CREATE INDEX idx_{PREFIX}act_invoices_act_node
    ON {SCHEMA}.{PREFIX}act_invoices(act_id, node_id);

-- ============================================================================
-- ТРИГГЕРЫ ДЛЯ АВТОМАТИЧЕСКОГО ОБНОВЛЕНИЯ updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION {SCHEMA}.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION {SCHEMA}.update_updated_at_column() IS
    'Автоматически устанавливает updated_at = CURRENT_TIMESTAMP при UPDATE';

DROP TRIGGER IF EXISTS update_{PREFIX}acts_updated_at ON {SCHEMA}.{PREFIX}acts;
CREATE TRIGGER update_{PREFIX}acts_updated_at
    BEFORE UPDATE ON {SCHEMA}.{PREFIX}acts
    FOR EACH ROW
    EXECUTE PROCEDURE {SCHEMA}.update_updated_at_column();

COMMENT ON TRIGGER update_{PREFIX}acts_updated_at ON {SCHEMA}.{PREFIX}acts IS
    'Автоматически обновляет поле updated_at при изменении метаданных акта';

DROP TRIGGER IF EXISTS update_{PREFIX}act_tree_updated_at ON {SCHEMA}.{PREFIX}act_tree;
CREATE TRIGGER update_{PREFIX}act_tree_updated_at
    BEFORE UPDATE ON {SCHEMA}.{PREFIX}act_tree
    FOR EACH ROW
    EXECUTE PROCEDURE {SCHEMA}.update_updated_at_column();

COMMENT ON TRIGGER update_{PREFIX}act_tree_updated_at ON {SCHEMA}.{PREFIX}act_tree IS
    'Автоматически обновляет поле updated_at при изменении структуры дерева';

DROP TRIGGER IF EXISTS update_{PREFIX}act_tables_updated_at ON {SCHEMA}.{PREFIX}act_tables;
CREATE TRIGGER update_{PREFIX}act_tables_updated_at
    BEFORE UPDATE ON {SCHEMA}.{PREFIX}act_tables
    FOR EACH ROW
    EXECUTE PROCEDURE {SCHEMA}.update_updated_at_column();

COMMENT ON TRIGGER update_{PREFIX}act_tables_updated_at ON {SCHEMA}.{PREFIX}act_tables IS
    'Автоматически обновляет поле updated_at при изменении таблицы';

DROP TRIGGER IF EXISTS update_{PREFIX}act_textblocks_updated_at ON {SCHEMA}.{PREFIX}act_textblocks;
CREATE TRIGGER update_{PREFIX}act_textblocks_updated_at
    BEFORE UPDATE ON {SCHEMA}.{PREFIX}act_textblocks
    FOR EACH ROW
    EXECUTE PROCEDURE {SCHEMA}.update_updated_at_column();

COMMENT ON TRIGGER update_{PREFIX}act_textblocks_updated_at ON {SCHEMA}.{PREFIX}act_textblocks IS
    'Автоматически обновляет поле updated_at при изменении текстового блока';

DROP TRIGGER IF EXISTS update_{PREFIX}act_violations_updated_at ON {SCHEMA}.{PREFIX}act_violations;
CREATE TRIGGER update_{PREFIX}act_violations_updated_at
    BEFORE UPDATE ON {SCHEMA}.{PREFIX}act_violations
    FOR EACH ROW
    EXECUTE PROCEDURE {SCHEMA}.update_updated_at_column();

COMMENT ON TRIGGER update_{PREFIX}act_violations_updated_at ON {SCHEMA}.{PREFIX}act_violations IS
    'Автоматически обновляет поле updated_at при изменении нарушения';

DROP TRIGGER IF EXISTS update_{PREFIX}act_invoices_updated_at ON {SCHEMA}.{PREFIX}act_invoices;
CREATE TRIGGER update_{PREFIX}act_invoices_updated_at
    BEFORE UPDATE ON {SCHEMA}.{PREFIX}act_invoices
    FOR EACH ROW
    EXECUTE PROCEDURE {SCHEMA}.update_updated_at_column();

COMMENT ON TRIGGER update_{PREFIX}act_invoices_updated_at ON {SCHEMA}.{PREFIX}act_invoices IS
    'Автоматически обновляет поле updated_at при изменении фактуры';
