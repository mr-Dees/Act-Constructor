-- Миграция для существующих PostgreSQL-БД: добавить колонку status
-- в chat_messages для server-authoritative state assistant-сообщений
-- (Phase 0 «D»: streaming-материализация блоков).
--
-- Жизненный цикл: streaming → complete (норма) или streaming → failed
-- (оборвалось ошибкой). User-сообщения создаются сразу со status='complete'
-- благодаря DEFAULT, поэтому миграция не ломает уже накопленные строки.
--
-- На свежих БД миграцию делать не нужно — schema.sql уже создаёт колонку
-- при первом старте.
--
-- Подставить актуальный префикс из DATABASE__TABLE_PREFIX, если он
-- отличается от t_db_oarb_audit_act_.

BEGIN;

ALTER TABLE t_db_oarb_audit_act_chat_messages
    ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'complete';

ALTER TABLE t_db_oarb_audit_act_chat_messages
    ADD CONSTRAINT check_chat_messages_status_values
    CHECK (status IN ('streaming','complete','failed'));

-- Partial-индекс под выборку «висящих» streaming-сообщений беседы
-- (resume / восстановление после рестарта).
CREATE INDEX IF NOT EXISTS idx_t_db_oarb_audit_act_chat_messages_streaming
    ON t_db_oarb_audit_act_chat_messages(conversation_id, status)
    WHERE status = 'streaming';

COMMIT;
