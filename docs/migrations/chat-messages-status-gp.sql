-- Миграция для существующих Greenplum-БД: добавить колонку status
-- в chat_messages для server-authoritative state assistant-сообщений
-- (Phase 0 «D»: streaming-материализация блоков).
--
-- Жизненный цикл: streaming → complete (норма) или streaming → failed.
-- User-сообщения создаются сразу со status='complete' благодаря DEFAULT.
--
-- На свежих БД миграцию делать не нужно — schema.sql уже создаёт колонку.
--
-- Подставить актуальную схему и префикс. На GP 6.x partial-индексы
-- не используем — полный композитный надёжнее.

BEGIN;

ALTER TABLE {SCHEMA}.t_db_oarb_audit_act_chat_messages
    ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'complete';

ALTER TABLE {SCHEMA}.t_db_oarb_audit_act_chat_messages
    ADD CONSTRAINT check_chat_messages_status_values
    CHECK (status IN ('streaming','complete','failed'));

CREATE INDEX idx_t_db_oarb_audit_act_chat_messages_status
    ON {SCHEMA}.t_db_oarb_audit_act_chat_messages(conversation_id, status);

COMMIT;
