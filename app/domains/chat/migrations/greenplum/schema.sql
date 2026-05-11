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

CREATE TABLE IF NOT EXISTS {SCHEMA}.{PREFIX}chat_files (
    id              VARCHAR(36) PRIMARY KEY,
    conversation_id VARCHAR(36) NOT NULL REFERENCES {SCHEMA}.{PREFIX}chat_conversations(id),
    message_id      VARCHAR(36) REFERENCES {SCHEMA}.{PREFIX}chat_messages(id) ON DELETE SET NULL,
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

-- Sequence для id событий агента; адаптер ловит DuplicateObjectError
CREATE SEQUENCE agent_response_events_id_seq;

-- Очередь запросов от AW к внешнему агенту
-- DISTRIBUTED BY (conversation_id): данные одной беседы лежат на одном
-- сегменте — все poll-запросы по conversation_id остаются локальными.
CREATE TABLE agent_requests (
    id              UUID NOT NULL,
    conversation_id UUID NOT NULL,
    message_id      UUID NOT NULL,
    user_id         TEXT NOT NULL,
    domain_name     TEXT,
    knowledge_bases JSONB NOT NULL DEFAULT '[]'::jsonb,
    last_user_message TEXT NOT NULL,
    history         JSONB NOT NULL DEFAULT '[]'::jsonb,
    files           JSONB NOT NULL DEFAULT '[]'::jsonb,
    status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','in_progress','done','error','timeout')),
    error_message   TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    started_at      TIMESTAMPTZ,
    finished_at     TIMESTAMPTZ,
    PRIMARY KEY (id)
) DISTRIBUTED BY (conversation_id);

CREATE INDEX ix_agent_requests_status_created
    ON agent_requests (status, created_at);
CREATE INDEX ix_agent_requests_message
    ON agent_requests (message_id);


CREATE TABLE agent_response_events (
    id            BIGINT NOT NULL DEFAULT nextval('agent_response_events_id_seq'),
    request_id    UUID NOT NULL,
    seq           INTEGER NOT NULL,
    event_type    TEXT NOT NULL
                  CHECK (event_type IN ('reasoning','status','error')),
    payload       JSONB NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id)
) DISTRIBUTED BY (request_id);

CREATE INDEX ix_agent_response_events_request_id
    ON agent_response_events (request_id, id);


CREATE TABLE agent_responses (
    id             UUID NOT NULL,
    request_id     UUID NOT NULL,
    blocks         JSONB NOT NULL,
    finish_reason  TEXT NOT NULL DEFAULT 'stop'
                   CHECK (finish_reason IN ('stop','length','content_filter','error')),
    token_usage    JSONB,
    model          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id),
    UNIQUE (request_id)
) DISTRIBUTED BY (request_id);

CREATE INDEX ix_agent_responses_request_id
    ON agent_responses (request_id);
