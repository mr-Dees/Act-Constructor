-- Схема базы данных для домена чата (PostgreSQL)
-- Использует те же плейсхолдеры {SCHEMA}.{PREFIX}, что и GP-вариант:
-- адаптер подменяет {SCHEMA}. на "" и {PREFIX} на DATABASE__TABLE_PREFIX.

CREATE TABLE IF NOT EXISTS {SCHEMA}.{PREFIX}chat_conversations (
    id              VARCHAR(36) PRIMARY KEY,
    user_id         VARCHAR(50) NOT NULL,
    title           VARCHAR(500),
    domain_name     VARCHAR(100),
    context         JSONB,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_{PREFIX}chat_conversations_user ON {SCHEMA}.{PREFIX}chat_conversations(user_id);
-- Составной индекс под список бесед: get_by_user сортирует по updated_at DESC.
-- Без него — seq-scan + sort при росте таблицы.
CREATE INDEX IF NOT EXISTS idx_{PREFIX}chat_conversations_user_updated
    ON {SCHEMA}.{PREFIX}chat_conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS {SCHEMA}.{PREFIX}chat_messages (
    id              VARCHAR(36) PRIMARY KEY,
    conversation_id VARCHAR(36) NOT NULL REFERENCES {SCHEMA}.{PREFIX}chat_conversations(id) ON DELETE CASCADE,
    role            VARCHAR(20) NOT NULL,
    content         JSONB NOT NULL,
    model           VARCHAR(100),
    token_usage     JSONB,
    -- Жизненный цикл assistant-сообщения: streaming → complete (или failed).
    -- 'streaming' — сообщение материализуется по мере прихода блоков от LLM/
    -- внешнего агента; 'complete' — финализированное; 'failed' — оборвалось
    -- с ошибкой. User-сообщения создаются сразу со статусом 'complete'.
    status          VARCHAR(20) NOT NULL DEFAULT 'complete'
                    CONSTRAINT check_chat_messages_status_values
                    CHECK (status IN ('streaming','complete','failed')),
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_{PREFIX}chat_messages_conversation ON {SCHEMA}.{PREFIX}chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_{PREFIX}chat_messages_created ON {SCHEMA}.{PREFIX}chat_messages(conversation_id, created_at);
-- Partial-индекс под выборку «висящих» streaming-сообщений беседы при
-- ресанье/восстановлении. Поддерживается с PG 9.4.
CREATE INDEX IF NOT EXISTS idx_{PREFIX}chat_messages_streaming
    ON {SCHEMA}.{PREFIX}chat_messages(conversation_id, status)
    WHERE status = 'streaming';

-- Идемпотентная миграция status-колонки для уже существующих БД, где
-- CREATE TABLE IF NOT EXISTS выше не сработал. DO-блок работает в PG 9.4+;
-- ADD COLUMN IF NOT EXISTS появилось только в 9.6.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = '{SCHEMA}.{PREFIX}chat_messages'::regclass
          AND attname = 'status'
          AND NOT attisdropped
    ) THEN
        ALTER TABLE {SCHEMA}.{PREFIX}chat_messages
            ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'complete';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = '{SCHEMA}.{PREFIX}chat_messages'::regclass
          AND conname = 'check_chat_messages_status_values'
    ) THEN
        ALTER TABLE {SCHEMA}.{PREFIX}chat_messages
            ADD CONSTRAINT check_chat_messages_status_values
            CHECK (status IN ('streaming','complete','failed'));
    END IF;
END$$;

CREATE TABLE IF NOT EXISTS {SCHEMA}.{PREFIX}chat_files (
    id              VARCHAR(36) PRIMARY KEY,
    conversation_id VARCHAR(36) NOT NULL REFERENCES {SCHEMA}.{PREFIX}chat_conversations(id) ON DELETE CASCADE,
    message_id      VARCHAR(36) REFERENCES {SCHEMA}.{PREFIX}chat_messages(id) ON DELETE SET NULL,
    filename        VARCHAR(500) NOT NULL,
    mime_type       VARCHAR(200) NOT NULL,
    file_size       INTEGER NOT NULL CONSTRAINT check_chat_files_file_size_positive CHECK (file_size > 0),
    file_data       BYTEA NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_{PREFIX}chat_files_conversation ON {SCHEMA}.{PREFIX}chat_files(conversation_id);

-- Ссылка draft-сообщения на строку-вопрос в agent_messages (conversation_id вопроса).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = '{SCHEMA}.{PREFIX}chat_messages'::regclass
          AND attname = 'agent_ref' AND NOT attisdropped
    ) THEN
        ALTER TABLE {SCHEMA}.{PREFIX}chat_messages ADD COLUMN agent_ref VARCHAR(36);
    END IF;
END$$;

-- ── Bus-таблица канала к внешнему агенту (nanobot) ─────────────────────
-- «Провод» между AW и агентом. Имена колонок согласованы со стороной nanobot.
-- chat_id = uid треда (= chat_messages.conversation_id); conversation_id = uid
-- одного сообщения (на него ссылается reply_to). role 'tool' разрешён, но AW
-- его пока не обрабатывает. Если таблица уже создана стороной агента —
-- CREATE TABLE IF NOT EXISTS / адаптер делают это безопасно.
CREATE TABLE IF NOT EXISTS {SCHEMA}.{PREFIX}agent_messages (
    id              VARCHAR(36) PRIMARY KEY,
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
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_{PREFIX}agent_messages_chat
    ON {SCHEMA}.{PREFIX}agent_messages(chat_id, created_at);
CREATE INDEX IF NOT EXISTS idx_{PREFIX}agent_messages_conversation
    ON {SCHEMA}.{PREFIX}agent_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_{PREFIX}agent_messages_status
    ON {SCHEMA}.{PREFIX}agent_messages(status, created_at);
CREATE INDEX IF NOT EXISTS idx_{PREFIX}agent_messages_reply_to
    ON {SCHEMA}.{PREFIX}agent_messages(reply_to);

-- ── Метрики выполнения ChatTool'ов ────────────────────────────────────
-- Append-only журнал latency / status / ошибок для каждого вызова tool'а
-- из оркестратора. Используется для наблюдаемости (медленные tool'ы,
-- частые validation_error от LLM, спайки error-rate).
-- conversation_id хранится как VARCHAR(36) БЕЗ FK: метрики переживают
-- удаление беседы, чтобы не было каскадного исчезновения исторических
-- данных при cleanup'е чатов.
CREATE TABLE IF NOT EXISTS {SCHEMA}.{PREFIX}chat_tool_metrics (
    id              BIGSERIAL PRIMARY KEY,
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
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_{PREFIX}chat_tool_metrics_tool_created
    ON {SCHEMA}.{PREFIX}chat_tool_metrics(tool_name, created_at);
CREATE INDEX IF NOT EXISTS idx_{PREFIX}chat_tool_metrics_status_created
    ON {SCHEMA}.{PREFIX}chat_tool_metrics(status, created_at);

-- ── Audit-лог жизненного цикла беседы/файлов/стримов ──────────────────
-- Append-only журнал действий пользователя. Пишется глушащим сервисом:
-- сбой записи не должен ломать основную операцию (см. AuditService).
-- conversation_id хранится как VARCHAR(36) БЕЗ FK: записи о DELETE
-- беседы остаются после её удаления (forensic-trail).
CREATE TABLE IF NOT EXISTS {SCHEMA}.{PREFIX}chat_audit_log (
    id              BIGSERIAL PRIMARY KEY,
    username        VARCHAR(64) NOT NULL,
    action          VARCHAR(64) NOT NULL,
    conversation_id VARCHAR(36),
    details_json    JSONB,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_{PREFIX}chat_audit_log_username_created
    ON {SCHEMA}.{PREFIX}chat_audit_log(username, created_at);
CREATE INDEX IF NOT EXISTS idx_{PREFIX}chat_audit_log_action_created
    ON {SCHEMA}.{PREFIX}chat_audit_log(action, created_at);
CREATE INDEX IF NOT EXISTS idx_{PREFIX}chat_audit_log_conversation_created
    ON {SCHEMA}.{PREFIX}chat_audit_log(conversation_id, created_at);
