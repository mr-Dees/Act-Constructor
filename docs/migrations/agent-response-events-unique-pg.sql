-- Миграция для существующих PostgreSQL-БД: индекс по (request_id, seq)
-- вместо (request_id, id) + UNIQUE-констрейнт против дублей событий
-- внешнего агента.
--
-- На свежих БД эту миграцию делать не нужно — schema.sql уже создаёт
-- агенты с правильной структурой при первом старте.
--
-- ВАЖНО: перед добавлением UNIQUE убрать возможные дубли. Дубли могут
-- быть, если внешний агент когда-то делал retry с тем же seq, и оба
-- INSERT'а попали в таблицу.
--
-- Подставить актуальный префикс из DATABASE__TABLE_PREFIX, если он
-- отличается от t_db_oarb_audit_act_.

BEGIN;

-- 1. Удаляем дубли (request_id, seq), оставляя строку с минимальным id.
DELETE FROM t_db_oarb_audit_act_agent_response_events
WHERE id NOT IN (
    SELECT MIN(id)
    FROM t_db_oarb_audit_act_agent_response_events
    GROUP BY request_id, seq
);

-- 2. Добавляем UNIQUE-констрейнт (заодно создастся индекс по (request_id, seq)).
ALTER TABLE t_db_oarb_audit_act_agent_response_events
    ADD CONSTRAINT uniq_t_db_oarb_audit_act_agent_response_events_request_seq
    UNIQUE (request_id, seq);

-- 3. Дропаем старый «полу-индекс» (request_id, id) — он больше не покрывает
-- polling-фильтр по seq, а UNIQUE сверху создал нужный индекс.
DROP INDEX IF EXISTS idx_t_db_oarb_audit_act_agent_response_events_request;

COMMIT;
