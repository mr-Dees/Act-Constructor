-- Схема базы данных для домена администрирования (PostgreSQL)

-- ============================================================================
-- СПРАВОЧНИК ПОЛЬЗОВАТЕЛЕЙ (для локального тестирования)
-- ============================================================================

CREATE TABLE IF NOT EXISTS t_db_oarb_ua_user (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    fullname VARCHAR(255) NOT NULL,
    job VARCHAR(255) NOT NULL DEFAULT '',
    tn VARCHAR(50) NOT NULL DEFAULT '',
    email VARCHAR(255) NOT NULL DEFAULT '',
    branch VARCHAR(255) NOT NULL DEFAULT ''
);

COMMENT ON TABLE t_db_oarb_ua_user IS 'Справочник пользователей (реплика из GP для локального тестирования)';
COMMENT ON COLUMN t_db_oarb_ua_user.username IS 'Числовой логин пользователя';
COMMENT ON COLUMN t_db_oarb_ua_user.fullname IS 'ФИО пользователя';
COMMENT ON COLUMN t_db_oarb_ua_user.job IS 'Должность';
COMMENT ON COLUMN t_db_oarb_ua_user.tn IS 'Табельный номер';
COMMENT ON COLUMN t_db_oarb_ua_user.email IS 'Электронная почта';
COMMENT ON COLUMN t_db_oarb_ua_user.branch IS 'Подразделение';

-- Заполняем тестовыми данными
INSERT INTO t_db_oarb_ua_user (username, fullname, job, tn, email, branch) VALUES
    ('22494524', 'МАШТАКОВ ДЕНИС РОМАНОВИЧ', 'Менеджер направления', '02115412', 'DRMashtakov@omega.sbrf.ru', 'Отдел аудита розничного бизнеса'),
    ('22501001', 'ИВАНОВ АЛЕКСЕЙ ПЕТРОВИЧ', 'Руководитель группы', '02115500', 'APIvanov@omega.sbrf.ru', 'Отдел аудита розничного бизнеса'),
    ('22501002', 'ПЕТРОВА ЕЛЕНА СЕРГЕЕВНА', 'Главный аудитор', '02115501', 'ESPetrova@omega.sbrf.ru', 'Отдел аудита розничного бизнеса'),
    ('22501003', 'СИДОРОВ МИХАИЛ АНДРЕЕВИЧ', 'Старший аудитор', '02115502', 'MASidorov@omega.sbrf.ru', 'Отдел аудита розничного бизнеса'),
    ('22501004', 'КОЗЛОВА АННА ВИКТОРОВНА', 'Аудитор', '02115503', 'AVKozlova@omega.sbrf.ru', 'Отдел аудита розничного бизнеса'),
    ('22501005', 'НОВИКОВ ДМИТРИЙ ИГОРЕВИЧ', 'Менеджер направления', '02115504', 'DINovikov@omega.sbrf.ru', 'Отдел аудита розничного бизнеса'),
    ('22501006', 'ФЕДОРОВА ОЛЬГА НИКОЛАЕВНА', 'Старший аудитор', '02115505', 'ONFedorova@omega.sbrf.ru', 'Отдел аудита розничного бизнеса'),
    ('22501007', 'МОРОЗОВ АРТЁМ ВЛАДИМИРОВИЧ', 'Аудитор', '02115506', 'AVMorozov@omega.sbrf.ru', 'Отдел аудита розничного бизнеса'),
    ('22501008', 'ВОЛКОВА НАТАЛЬЯ АЛЕКСАНДРОВНА', 'Руководитель группы', '02115507', 'NAVolkova@omega.sbrf.ru', 'Отдел аудита розничного бизнеса'),
    ('22501009', 'ЛЕБЕДЕВ СЕРГЕЙ КОНСТАНТИНОВИЧ', 'Главный аудитор', '02115508', 'SKLebedev@omega.sbrf.ru', 'Отдел аудита розничного бизнеса'),
    ('22501010', 'ЗАХАРОВА МАРИЯ ДМИТРИЕВНА', 'Старший аудитор', '02115509', 'MDZakharova@omega.sbrf.ru', 'Отдел аудита корпоративного бизнеса')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- ТАБЛИЦА РОЛЕЙ
-- ============================================================================

CREATE TABLE IF NOT EXISTS roles (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL UNIQUE,
    domain_name VARCHAR(100),
    description TEXT NOT NULL DEFAULT ''
);

COMMENT ON TABLE roles IS 'Справочник ролей приложения';
COMMENT ON COLUMN roles.id IS 'Уникальный идентификатор роли';
COMMENT ON COLUMN roles.name IS 'Уникальное имя роли';
COMMENT ON COLUMN roles.domain_name IS 'Домен, к которому относится роль (NULL = глобальная)';
COMMENT ON COLUMN roles.description IS 'Описание роли';

-- Заполняем ролями по умолчанию
INSERT INTO roles (name, domain_name, description) VALUES
    ('Админ', NULL, 'Полный доступ ко всем доменам и функциям'),
    ('Цифровой акт', 'acts', 'Доступ к домену актов'),
    ('ЦК финансовый результат', 'ck_fin_res', 'Доступ к ЦК Фин.Рез.'),
    ('ЦК клиентский опыт', 'ck_client_exp', 'Доступ к ЦК Клиентский опыт')
ON CONFLICT DO NOTHING;

-- ============================================================================
-- ТАБЛИЦА СВЯЗЕЙ ПОЛЬЗОВАТЕЛЬ — РОЛЬ
-- ============================================================================

CREATE TABLE IF NOT EXISTS user_roles (
    id SERIAL PRIMARY KEY,
    username VARCHAR(50) NOT NULL,
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    assigned_by VARCHAR(50) NOT NULL,
    assigned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(username, role_id)
);

COMMENT ON TABLE user_roles IS 'Связь пользователей с ролями';
COMMENT ON COLUMN user_roles.username IS 'Числовой логин пользователя';
COMMENT ON COLUMN user_roles.role_id IS 'Ссылка на роль';
COMMENT ON COLUMN user_roles.assigned_by IS 'Кто назначил роль';
COMMENT ON COLUMN user_roles.assigned_at IS 'Дата и время назначения роли';

-- ============================================================================
-- ИНДЕКСЫ
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_user_roles_username
    ON user_roles(username);

COMMENT ON INDEX idx_user_roles_username IS 'Индекс для быстрого поиска ролей пользователя';

CREATE INDEX IF NOT EXISTS idx_user_roles_role_id
    ON user_roles(role_id);

COMMENT ON INDEX idx_user_roles_role_id IS 'Индекс для получения пользователей с определённой ролью';

CREATE INDEX IF NOT EXISTS idx_roles_domain_name
    ON roles(domain_name)
    WHERE domain_name IS NOT NULL;

COMMENT ON INDEX idx_roles_domain_name IS 'Частичный индекс для поиска ролей по домену';

CREATE INDEX IF NOT EXISTS idx_t_db_oarb_ua_user_branch
    ON t_db_oarb_ua_user(branch);

COMMENT ON INDEX idx_t_db_oarb_ua_user_branch IS 'Индекс для фильтрации пользователей по подразделению';
