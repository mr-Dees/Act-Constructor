-- Схема базы данных для домена администрирования (Greenplum)
-- Схема: {SCHEMA}
-- Префикс таблиц: {PREFIX}
-- Примечание: таблица t_db_oarb_ua_user уже существует в GP, НЕ создаём её

-- ============================================================================
-- ТАБЛИЦА РОЛЕЙ
-- ============================================================================

CREATE TABLE {SCHEMA}.{PREFIX}roles (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    domain_name VARCHAR(100),
    description TEXT NOT NULL DEFAULT '',

    UNIQUE(name)
)
WITH (appendonly=false)
DISTRIBUTED BY (id);

COMMENT ON TABLE {SCHEMA}.{PREFIX}roles IS 'Справочник ролей приложения';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}roles.id IS 'Уникальный идентификатор роли';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}roles.name IS 'Уникальное имя роли';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}roles.domain_name IS 'Домен, к которому относится роль (NULL = глобальная)';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}roles.description IS 'Описание роли';

-- Заполняем ролями по умолчанию (выполняется только при первом создании таблиц)
INSERT INTO {SCHEMA}.{PREFIX}roles (name, domain_name, description) VALUES
    ('Админ', NULL, 'Полный доступ ко всем доменам и функциям'),
    ('Цифровой акт', 'acts', 'Доступ к домену актов'),
    ('ЦК финансовый результат', 'ck_fin_res', 'Доступ к ЦК Фин.Рез.'),
    ('ЦК клиентский опыт', 'ck_client_exp', 'Доступ к ЦК Клиентский опыт');

-- ============================================================================
-- ТАБЛИЦА СВЯЗЕЙ ПОЛЬЗОВАТЕЛЬ — РОЛЬ
-- ============================================================================

CREATE TABLE {SCHEMA}.{PREFIX}user_roles (
    id BIGSERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    role_id BIGINT NOT NULL,
    assigned_by VARCHAR(50) NOT NULL,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(username, role_id)
)
WITH (appendonly=false)
DISTRIBUTED BY (id);

COMMENT ON TABLE {SCHEMA}.{PREFIX}user_roles IS 'Связь пользователей с ролями';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}user_roles.username IS 'Числовой логин пользователя';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}user_roles.role_id IS 'Ссылка на роль';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}user_roles.assigned_by IS 'Кто назначил роль';
COMMENT ON COLUMN {SCHEMA}.{PREFIX}user_roles.assigned_at IS 'Дата и время назначения роли';

-- ============================================================================
-- ИНДЕКСЫ
-- ============================================================================

CREATE INDEX idx_{PREFIX}user_roles_username
    ON {SCHEMA}.{PREFIX}user_roles(username);

CREATE INDEX idx_{PREFIX}user_roles_role_id
    ON {SCHEMA}.{PREFIX}user_roles(role_id);

CREATE INDEX idx_{PREFIX}roles_domain_name
    ON {SCHEMA}.{PREFIX}roles(domain_name)
    WHERE domain_name IS NOT NULL;
