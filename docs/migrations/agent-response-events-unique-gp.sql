-- Миграция для существующих Greenplum-БД: UNIQUE(request_id, seq) на
-- agent_response_events + замена индекса с (request_id, id) на
-- (request_id, seq) (новый создастся автоматически UNIQUE-констрейнтом).
--
-- На свежих БД миграцию делать не нужно — schema.sql создаёт таблицу
-- с UNIQUE при первом старте.
--
-- GP-требование уже соблюдено: DISTRIBUTED BY (request_id) — подмножество
-- UNIQUE (request_id, seq).
--
-- Подставить актуальную схему (DATABASE__GP__SCHEMA, дефолт audit_workstation)
-- и префикс (DATABASE__TABLE_PREFIX, дефолт t_db_oarb_audit_act_).

-- 1. Удаляем дубли (request_id, seq), оставляя строку с минимальным id.
-- GP не поддерживает DELETE...WHERE id NOT IN (SELECT MIN ...) с
-- self-reference в подзапросе так же, как PG — используем temp-таблицу.
CREATE TEMP TABLE _keep_ids AS
SELECT MIN(id) AS id
FROM audit_workstation.t_db_oarb_audit_act_agent_response_events
GROUP BY request_id, seq;

DELETE FROM audit_workstation.t_db_oarb_audit_act_agent_response_events
WHERE id NOT IN (SELECT id FROM _keep_ids);

DROP TABLE _keep_ids;

-- 2. Добавляем UNIQUE-констрейнт (заодно создастся индекс).
ALTER TABLE audit_workstation.t_db_oarb_audit_act_agent_response_events
    ADD CONSTRAINT uniq_t_db_oarb_audit_act_agent_response_events_request_seq
    UNIQUE (request_id, seq);

-- 3. Дропаем старый индекс (request_id, id).
-- GP 6.x: IF EXISTS поддерживается для DROP INDEX.
DROP INDEX IF EXISTS audit_workstation.idx_t_db_oarb_audit_act_agent_response_events_request;
