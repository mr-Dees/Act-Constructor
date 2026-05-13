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
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)
WITH (appendonly=false)
DISTRIBUTED BY (id);

CREATE INDEX idx_{PREFIX}chat_messages_conversation
    ON {SCHEMA}.{PREFIX}chat_messages(conversation_id);

CREATE INDEX idx_{PREFIX}chat_messages_created
    ON {SCHEMA}.{PREFIX}chat_messages(conversation_id, created_at);

-- ============================================================================
-- ТАБЛИЦА ФАЙЛОВ
-- ============================================================================

-- В GP FK referential actions не enforce-ятся, поэтому REFERENCES
-- и cascade-действия опущены — выровнено с acts/greenplum-схемой.
-- Целостность поддерживается на уровне репозитория: conversation_repository
-- сам удаляет файлы беседы.
CREATE TABLE IF NOT EXISTS {SCHEMA}.{PREFIX}chat_files (
    id              VARCHAR(36) PRIMARY KEY,
    conversation_id VARCHAR(36) NOT NULL,
    message_id      VARCHAR(36),
    filename        VARCHAR(500) NOT NULL,
    mime_type       VARCHAR(200) NOT NULL,
    file_size       INTEGER NOT NULL CHECK (file_size > 0),
    file_data       BYTEA NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)
WITH (appendonly=false)
DISTRIBUTED BY (id);

CREATE INDEX idx_{PREFIX}chat_files_conversation
    ON {SCHEMA}.{PREFIX}chat_files(conversation_id);

-- ============================================================================
-- ОЧЕРЕДЬ ЗАПРОСОВ К ВНЕШНЕМУ ИИ-АГЕНТУ
-- ============================================================================

-- Sequence для id событий агента; адаптер ловит DuplicateObjectError
CREATE SEQUENCE {SCHEMA}.{PREFIX}agent_response_events_id_seq;

-- Очередь запросов от AW к внешнему агенту.
-- DISTRIBUTED BY (conversation_id): данные одной беседы — на одном сегменте.
CREATE TABLE IF NOT EXISTS {SCHEMA}.{PREFIX}agent_requests (
    id                VARCHAR(36) NOT NULL,
    conversation_id   VARCHAR(36) NOT NULL,
    message_id        VARCHAR(36) NOT NULL,
    user_id           VARCHAR(50) NOT NULL,
    domain_name       VARCHAR(100),
    knowledge_bases   JSONB NOT NULL DEFAULT '[]'::jsonb,
    last_user_message TEXT NOT NULL,
    history           JSONB NOT NULL DEFAULT '[]'::jsonb,
    files             JSONB NOT NULL DEFAULT '[]'::jsonb,
    status            VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','dispatched','in_progress','done','error','timeout')),
    error_message     TEXT,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at        TIMESTAMP,
    finished_at       TIMESTAMP,
    PRIMARY KEY (id)
)
WITH (appendonly=false)
DISTRIBUTED BY (conversation_id);

CREATE INDEX idx_{PREFIX}agent_requests_status_created
    ON {SCHEMA}.{PREFIX}agent_requests(status, created_at);
-- В PG этот индекс был, в GP отсутствовал — agent_bridge ищет запросы
-- беседы по conversation_id + сортирует по created_at DESC.
CREATE INDEX idx_{PREFIX}agent_requests_conversation
    ON {SCHEMA}.{PREFIX}agent_requests(conversation_id, created_at DESC);
CREATE INDEX idx_{PREFIX}agent_requests_message
    ON {SCHEMA}.{PREFIX}agent_requests(message_id);

-- Append-only лента событий от агента.
CREATE TABLE IF NOT EXISTS {SCHEMA}.{PREFIX}agent_response_events (
    id            BIGINT NOT NULL
                  DEFAULT nextval('{SCHEMA}.{PREFIX}agent_response_events_id_seq'),
    request_id    VARCHAR(36) NOT NULL,
    seq           INTEGER NOT NULL,
    event_type    VARCHAR(20) NOT NULL
                  CHECK (event_type IN ('reasoning','status','error')),
    payload       JSONB NOT NULL,
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id)
)
WITH (appendonly=false)
DISTRIBUTED BY (request_id);

CREATE INDEX idx_{PREFIX}agent_response_events_request
    ON {SCHEMA}.{PREFIX}agent_response_events(request_id, id);

-- Финальный ответ агента (однократный INSERT, stop-сигнал).
CREATE TABLE IF NOT EXISTS {SCHEMA}.{PREFIX}agent_responses (
    id             VARCHAR(36) NOT NULL,
    request_id     VARCHAR(36) NOT NULL,
    blocks         JSONB NOT NULL,
    finish_reason  VARCHAR(20) NOT NULL DEFAULT 'stop'
                   CHECK (finish_reason IN ('stop','length','content_filter','error')),
    token_usage    JSONB,
    model          VARCHAR(100),
    created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE (request_id)
)
WITH (appendonly=false)
DISTRIBUTED BY (request_id);
