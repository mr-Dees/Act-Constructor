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
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_{PREFIX}chat_messages_conversation ON {SCHEMA}.{PREFIX}chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_{PREFIX}chat_messages_created ON {SCHEMA}.{PREFIX}chat_messages(conversation_id, created_at);

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

-- ── Sequence для id событий агента (генерация на нашей стороне или у агента) ──
CREATE SEQUENCE IF NOT EXISTS {SCHEMA}.{PREFIX}agent_response_events_id_seq;

-- ── Очередь запросов от AW к внешнему агенту ───────────────────────────
-- ВАЖНО: id всегда генерируется Python (uuid.uuid4()) как строка VARCHAR(36),
-- чтобы код был одинаковым между PG и GP и совпадал по типу с chat_*.
CREATE TABLE IF NOT EXISTS {SCHEMA}.{PREFIX}agent_requests (
    id                VARCHAR(36) PRIMARY KEY,
    conversation_id   VARCHAR(36) NOT NULL,
    message_id        VARCHAR(36) NOT NULL,
    user_id           VARCHAR(50) NOT NULL,
    domain_name       VARCHAR(100),
    knowledge_bases   JSONB NOT NULL DEFAULT '[]'::jsonb,
    last_user_message TEXT NOT NULL,
    history           JSONB NOT NULL DEFAULT '[]'::jsonb,
    files             JSONB NOT NULL DEFAULT '[]'::jsonb,
    status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CONSTRAINT check_agent_requests_status_values
                      CHECK (status IN ('pending','dispatched','in_progress','done','error','timeout')),
    error_message     TEXT,
    -- Идентификатор воркера, заклеймившего запрос (UUID-строка).
    -- NULL означает «никто ещё не взял»; устанавливается атомарным UPDATE
    -- в claim_pending() и защищает от double-claim между раннерами.
    worker_token      VARCHAR(64),
    -- Optimistic locking: при каждом успешном update_status версия
    -- инкрементируется. Параллельный апдейт со старой версией
    -- получит «0 строк затронуто» и должен прервать итерацию.
    version           INTEGER NOT NULL DEFAULT 0,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at        TIMESTAMP,
    finished_at       TIMESTAMP,
    updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    -- Идентификатор HTTP-запроса (из RequestIdMiddleware / X-Request-ID),
    -- в рамках которого был создан agent_request. Нужен для сквозной
    -- трассировки: HTTP-запрос ↔ строка agent_requests ↔ логи фонового
    -- runner'а. NULL — если запрос создан вне HTTP-контекста.
    parent_request_id VARCHAR(64)
);

-- Идемпотентная миграция колонки для уже существующих БД, где CREATE TABLE
-- IF NOT EXISTS выше не сработал. DO-блок работает в PG 9.4+ — синтаксис
-- ADD-COLUMN-IF-NOT-EXISTS появился только в 9.6, так что использовать
-- его нельзя.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = '{SCHEMA}.{PREFIX}agent_requests'::regclass
          AND attname = 'parent_request_id'
          AND NOT attisdropped
    ) THEN
        ALTER TABLE {SCHEMA}.{PREFIX}agent_requests
            ADD COLUMN parent_request_id VARCHAR(64);
    END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_{PREFIX}agent_requests_status_created
    ON {SCHEMA}.{PREFIX}agent_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_{PREFIX}agent_requests_conversation
    ON {SCHEMA}.{PREFIX}agent_requests(conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_{PREFIX}agent_requests_message
    ON {SCHEMA}.{PREFIX}agent_requests(message_id);
-- Индекс под claim_pending: WHERE status IN ('pending','dispatched')
-- AND worker_token IS NULL — ищет «свободные» задачи на reconcile-проход.
CREATE INDEX IF NOT EXISTS idx_{PREFIX}agent_requests_pending
    ON {SCHEMA}.{PREFIX}agent_requests(status, updated_at)
    WHERE worker_token IS NULL;
-- Индекс под фильтр по parent_request_id (трассировка HTTP-запрос → agent_requests).
CREATE INDEX IF NOT EXISTS idx_{PREFIX}agent_requests_parent_request_id
    ON {SCHEMA}.{PREFIX}agent_requests(parent_request_id);

-- ── Append-only лента событий от агента ────────────────────────────────
-- UNIQUE(request_id, seq) защищает от сетевого retry внешнего агента:
-- если он повторно INSERT-нёт событие с тем же seq, СУБД отвергнет дубль,
-- polling не размножит его на фронт двойным reasoning-блоком.
CREATE TABLE IF NOT EXISTS {SCHEMA}.{PREFIX}agent_response_events (
    id            BIGINT PRIMARY KEY DEFAULT nextval('{SCHEMA}.{PREFIX}agent_response_events_id_seq'),
    request_id    VARCHAR(36) NOT NULL,
    seq           INTEGER NOT NULL,
    event_type    VARCHAR(20) NOT NULL
                  CONSTRAINT check_agent_response_events_event_type_values
                  CHECK (event_type IN ('reasoning','status','error')),
    payload       JSONB NOT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uniq_{PREFIX}agent_response_events_request_seq
        UNIQUE (request_id, seq)
);

-- Индекс под polling-запрос: WHERE request_id = $1 AND seq > $2 ORDER BY seq.
-- Был (request_id, id) — фильтр по seq шёл в памяти после index scan.
-- UNIQUE-констрейнт выше сам создаёт btree-индекс на (request_id, seq),
-- так что отдельный CREATE INDEX больше не нужен.

-- ── Финальный ответ агента (однократный INSERT, stop-сигнал) ──────────
CREATE TABLE IF NOT EXISTS {SCHEMA}.{PREFIX}agent_responses (
    id             VARCHAR(36) PRIMARY KEY,
    request_id     VARCHAR(36) NOT NULL UNIQUE,
    blocks         JSONB NOT NULL,
    finish_reason  VARCHAR(20) NOT NULL DEFAULT 'stop'
                   CONSTRAINT check_agent_responses_finish_reason_values
                   CHECK (finish_reason IN ('stop','length','content_filter','error')),
    token_usage    JSONB,
    model          VARCHAR(100),
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
