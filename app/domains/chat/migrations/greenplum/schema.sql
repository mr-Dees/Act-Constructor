-- Схема базы данных для домена чата (Greenplum)
-- Схема: {SCHEMA}
-- Префикс таблиц: {PREFIX}

-- ============================================================================
-- ТАБЛИЦА БЕСЕД
-- ============================================================================

CREATE TABLE IF NOT EXISTS {SCHEMA}.{PREFIX}chat_conversations (
    id              VARCHAR(36) PRIMARY KEY,
    user_id         VARCHAR(50) NOT NULL,
    title           VARCHAR(500),
    domain_name     VARCHAR(100),
    context         JSONB,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)
WITH (appendonly=false)
DISTRIBUTED BY (id);

CREATE INDEX idx_{PREFIX}chat_conversations_user
    ON {SCHEMA}.{PREFIX}chat_conversations(user_id);
-- Составной индекс под список бесед: get_by_user сортирует по updated_at DESC.
CREATE INDEX idx_{PREFIX}chat_conversations_user_updated
    ON {SCHEMA}.{PREFIX}chat_conversations(user_id, updated_at DESC);

-- ============================================================================
-- ТАБЛИЦА СООБЩЕНИЙ
-- ============================================================================

CREATE TABLE IF NOT EXISTS {SCHEMA}.{PREFIX}chat_messages (
    id              VARCHAR(36) PRIMARY KEY,
    conversation_id VARCHAR(36) NOT NULL REFERENCES {SCHEMA}.{PREFIX}chat_conversations(id),
    role            VARCHAR(20) NOT NULL,
    content         JSONB NOT NULL,
    model           VARCHAR(100),
    token_usage     JSONB,
    -- Жизненный цикл assistant-сообщения: streaming → complete (или failed).
    -- User-сообщения создаются сразу со статусом 'complete'.
    status          VARCHAR(20) NOT NULL DEFAULT 'complete'
                    CONSTRAINT check_chat_messages_status_values
                    CHECK (status IN ('streaming','complete','failed')),
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)
WITH (appendonly=false)
DISTRIBUTED BY (id);

-- Идемпотентная миграция для существующих GP-таблиц. GP 6.x (PG 9.4)
-- не поддерживает ADD COLUMN/CONSTRAINT IF NOT EXISTS — выполняем
-- безусловно и полагаемся на GreenplumAdapter, который ловит
-- DuplicateColumnError / DuplicateObjectError.
ALTER TABLE {SCHEMA}.{PREFIX}chat_messages
    ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'complete';

ALTER TABLE {SCHEMA}.{PREFIX}chat_messages
    ADD CONSTRAINT check_chat_messages_status_values
    CHECK (status IN ('streaming','complete','failed'));

-- agent_ref: безусловный ALTER, дубль глотает GreenplumAdapter.
ALTER TABLE {SCHEMA}.{PREFIX}chat_messages ADD COLUMN agent_ref VARCHAR(36);

CREATE INDEX idx_{PREFIX}chat_messages_conversation
    ON {SCHEMA}.{PREFIX}chat_messages(conversation_id);

CREATE INDEX idx_{PREFIX}chat_messages_created
    ON {SCHEMA}.{PREFIX}chat_messages(conversation_id, created_at);

-- Под выборку «висящих» streaming-сообщений беседы. На GP partial-индексы
-- (WHERE ...) не используем — полный композитный надёжнее.
CREATE INDEX idx_{PREFIX}chat_messages_status
    ON {SCHEMA}.{PREFIX}chat_messages(conversation_id, status);

-- ============================================================================
-- ТАБЛИЦА ФАЙЛОВ
-- ============================================================================

-- В GP FK referential actions не enforce-ятся (declarative FK — только документация модели).
-- Целостность поддерживается на уровне репозитория: conversation_repository
-- сам удаляет файлы беседы.
CREATE TABLE IF NOT EXISTS {SCHEMA}.{PREFIX}chat_files (
    id              VARCHAR(36) PRIMARY KEY,
    conversation_id VARCHAR(36) NOT NULL REFERENCES {SCHEMA}.{PREFIX}chat_conversations(id),
    message_id      VARCHAR(36),
    filename        VARCHAR(500) NOT NULL,
    mime_type       VARCHAR(200) NOT NULL,
    file_size       INTEGER NOT NULL CONSTRAINT check_chat_files_file_size_positive CHECK (file_size > 0),
    file_data       BYTEA NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)
WITH (appendonly=false)
DISTRIBUTED BY (id);

CREATE INDEX idx_{PREFIX}chat_files_conversation
    ON {SCHEMA}.{PREFIX}chat_files(conversation_id);

-- ============================================================================
-- BUS-ТАБЛИЦА КАНАЛА К ВНЕШНЕМУ АГЕНТУ (nanobot)
-- ============================================================================

-- «Провод» между AW и агентом. Имена колонок согласованы со стороной nanobot.
-- chat_id = uid треда (= chat_messages.conversation_id); conversation_id = uid
-- одного сообщения (на него ссылается reply_to). role 'tool' разрешён, но AW
-- его пока не обрабатывает.
CREATE TABLE IF NOT EXISTS {SCHEMA}.{PREFIX}agent_messages (
    id              VARCHAR(36) NOT NULL,
    chat_id         VARCHAR(36) NOT NULL,
    user_id         VARCHAR(50) NOT NULL,
    conversation_id VARCHAR(36) NOT NULL,
    role            VARCHAR(20) NOT NULL
                    CONSTRAINT check_agent_messages_role_values
                    CHECK (role IN ('user','assistant','tool')),
    content         TEXT,
    media           JSONB,
    metadata        JSONB,
    reply_to        VARCHAR(36),
    buttons         JSONB,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending'
                    CONSTRAINT check_agent_messages_status_values
                    CHECK (status IN ('pending','in_progress','complete','error','timeout')),
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- GP-требование: DISTRIBUTED BY ⊆ PK. id ведущий (lookup WHERE id=$1 по PK).
    PRIMARY KEY (id, chat_id)
)
WITH (appendonly=false)
DISTRIBUTED BY (chat_id);

CREATE INDEX idx_{PREFIX}agent_messages_chat
    ON {SCHEMA}.{PREFIX}agent_messages(chat_id, created_at);
CREATE INDEX idx_{PREFIX}agent_messages_conversation
    ON {SCHEMA}.{PREFIX}agent_messages(conversation_id);
CREATE INDEX idx_{PREFIX}agent_messages_status
    ON {SCHEMA}.{PREFIX}agent_messages(status, created_at);
CREATE INDEX idx_{PREFIX}agent_messages_reply_to
    ON {SCHEMA}.{PREFIX}agent_messages(reply_to);

-- ============================================================================
-- МЕТРИКИ ВЫПОЛНЕНИЯ CHATTOOL'ОВ
-- ============================================================================

-- Sequence для id метрик; BIGSERIAL недоступен в GP-схеме PK + DISTRIBUTED.
-- Адаптер ловит DuplicateObjectError при повторном CREATE.
CREATE SEQUENCE {SCHEMA}.{PREFIX}chat_tool_metrics_id_seq;

-- Append-only журнал latency/status/ошибок tool-вызовов. conversation_id
-- хранится как VARCHAR(36) БЕЗ FK — метрики переживают удаление беседы.
CREATE TABLE IF NOT EXISTS {SCHEMA}.{PREFIX}chat_tool_metrics (
    id              BIGINT NOT NULL
                    DEFAULT nextval('{SCHEMA}.{PREFIX}chat_tool_metrics_id_seq'),
    tool_name       VARCHAR(128) NOT NULL,
    status          VARCHAR(32) NOT NULL
                    CONSTRAINT check_chat_tool_metrics_status_values
                    CHECK (status IN ('success','error','validation_error')),
    latency_ms      INTEGER NOT NULL
                    CONSTRAINT check_chat_tool_metrics_latency_nonneg
                    CHECK (latency_ms >= 0),
    username        VARCHAR(64),
    conversation_id VARCHAR(36),
    error_message   TEXT,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
)
WITH (appendonly=false)
DISTRIBUTED BY (id);

CREATE INDEX idx_{PREFIX}chat_tool_metrics_tool_created
    ON {SCHEMA}.{PREFIX}chat_tool_metrics(tool_name, created_at);
CREATE INDEX idx_{PREFIX}chat_tool_metrics_status_created
    ON {SCHEMA}.{PREFIX}chat_tool_metrics(status, created_at);

-- ============================================================================
-- AUDIT-ЛОГ ЖИЗНЕННОГО ЦИКЛА БЕСЕДЫ
-- ============================================================================

-- Sequence для id audit-записей.
CREATE SEQUENCE {SCHEMA}.{PREFIX}chat_audit_log_id_seq;

-- Append-only журнал действий пользователей. Пишется глушащим сервисом:
-- сбой записи не должен ломать основную операцию (см. AuditService).
-- conversation_id хранится как VARCHAR(36) БЕЗ FK — записи о DELETE
-- беседы остаются после её удаления (forensic-trail).
CREATE TABLE IF NOT EXISTS {SCHEMA}.{PREFIX}chat_audit_log (
    id              BIGINT NOT NULL
                    DEFAULT nextval('{SCHEMA}.{PREFIX}chat_audit_log_id_seq'),
    username        VARCHAR(64) NOT NULL,
    action          VARCHAR(64) NOT NULL,
    conversation_id VARCHAR(36),
    details_json    JSONB,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
)
WITH (appendonly=false)
DISTRIBUTED BY (id);

CREATE INDEX idx_{PREFIX}chat_audit_log_username_created
    ON {SCHEMA}.{PREFIX}chat_audit_log(username, created_at);
CREATE INDEX idx_{PREFIX}chat_audit_log_action_created
    ON {SCHEMA}.{PREFIX}chat_audit_log(action, created_at);
CREATE INDEX idx_{PREFIX}chat_audit_log_conversation_created
    ON {SCHEMA}.{PREFIX}chat_audit_log(conversation_id, created_at);
