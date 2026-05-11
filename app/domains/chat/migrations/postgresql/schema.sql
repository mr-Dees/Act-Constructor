CREATE TABLE IF NOT EXISTS chat_conversations (
    id              VARCHAR(36) PRIMARY KEY,
    user_id         VARCHAR(50) NOT NULL,
    title           VARCHAR(500),
    domain_name     VARCHAR(100),
    context         JSONB,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_user ON chat_conversations(user_id);

CREATE TABLE IF NOT EXISTS chat_messages (
    id              VARCHAR(36) PRIMARY KEY,
    conversation_id VARCHAR(36) NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    role            VARCHAR(20) NOT NULL,
    content         JSONB NOT NULL,
    model           VARCHAR(100),
    token_usage     JSONB,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation ON chat_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created ON chat_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS chat_files (
    id              VARCHAR(36) PRIMARY KEY,
    conversation_id VARCHAR(36) NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    message_id      VARCHAR(36) REFERENCES chat_messages(id) ON DELETE SET NULL,
    filename        VARCHAR(500) NOT NULL,
    mime_type       VARCHAR(200) NOT NULL,
    file_size       INTEGER NOT NULL CHECK (file_size > 0),
    file_data       BYTEA NOT NULL,
    created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_chat_files_conversation ON chat_files(conversation_id);

-- ── Sequence для id событий агента (генерация на нашей стороне или у агента) ──
CREATE SEQUENCE IF NOT EXISTS agent_response_events_id_seq;

-- ── Очередь запросов от AW к внешнему агенту ───────────────────────────
-- ВАЖНО: id всегда генерируется Python (uuid.uuid4()), не БД, чтобы код был
-- одинаковым между PG и GP (в GP нет pgcrypto по умолчанию).
CREATE TABLE IF NOT EXISTS agent_requests (
    id              UUID PRIMARY KEY,
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
    finished_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_agent_requests_status_created
    ON agent_requests (status, created_at);
CREATE INDEX IF NOT EXISTS ix_agent_requests_conversation
    ON agent_requests (conversation_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_agent_requests_message
    ON agent_requests (message_id);


-- ── Append-only лента событий от агента ────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_response_events (
    id            BIGINT PRIMARY KEY
                  DEFAULT nextval('agent_response_events_id_seq'),
    request_id    UUID NOT NULL,
    seq           INTEGER NOT NULL,
    event_type    TEXT NOT NULL
                  CHECK (event_type IN ('reasoning','status','error')),
    payload       JSONB NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_agent_response_events_request_id
    ON agent_response_events (request_id, id);


-- ── Финальный ответ агента (однократный INSERT, stop-сигнал) ──────────
CREATE TABLE IF NOT EXISTS agent_responses (
    id             UUID PRIMARY KEY,
    request_id     UUID NOT NULL UNIQUE,
    blocks         JSONB NOT NULL,
    finish_reason  TEXT NOT NULL DEFAULT 'stop'
                   CHECK (finish_reason IN ('stop','length','content_filter','error')),
    token_usage    JSONB,
    model          TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_agent_responses_request_id
    ON agent_responses (request_id);
