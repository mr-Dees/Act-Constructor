-- Миграция для существующих PostgreSQL-БД: расширить CHECK-констрейнт
-- агентских event_type значением 'final'.
--
-- 'final' — служебный push-сигнал от внешнего ИИ-агента в
-- agent_response_events, вставляемый ОДНОЙ транзакцией с
-- agent_responses. Фоновый раннер (agent_bridge_runner) ловит его
-- через PollCoordinator и мгновенно сохраняет ассистент-сообщение,
-- не дожидаясь срабатывания event_timeout (110-300 сек по умолчанию).
--
-- Без этого CHECK старой формы вставка 'final'-события упадёт с
-- ошибкой "Недопустимый тип события агента".
--
-- На свежих БД миграцию делать не нужно — schema.sql уже создаёт
-- таблицу с правильным CHECK при первом старте.
--
-- Подставить актуальный префикс из DATABASE__TABLE_PREFIX, если он
-- отличается от t_db_oarb_audit_act_.

BEGIN;

ALTER TABLE t_db_oarb_audit_act_agent_response_events
    DROP CONSTRAINT check_agent_response_events_event_type_values;

ALTER TABLE t_db_oarb_audit_act_agent_response_events
    ADD CONSTRAINT check_agent_response_events_event_type_values
    CHECK (event_type IN ('reasoning','status','error','final'));

COMMIT;
