-- ============================================================================
-- agent-bridge-cleanup.sql — очистка hot-таблиц моста к внешнему ИИ-агенту
-- ============================================================================
-- Назначение
--   Удаляет старые строки из трёх таблиц моста:
--     {PREFIX}agent_response_events  — лента событий стрима (reasoning/status/error)
--     {PREFIX}agent_responses        — финальные ответы агента
--     {PREFIX}agent_requests         — очередь запросов AW → агент
--
--   Удаляются ТОЛЬКО завершённые запросы (status IN ('done','error','timeout'));
--   активные (pending/dispatched/in_progress) НИКОГДА не трогаются — даже
--   если они «зависли», их разрулит сам раннер по таймауту (см. §7.8 в
--   docs/developer-guide.md) или lifespan reconcile при рестарте uvicorn.
--
--   Видимая пользователю история ЧАТА живёт в {PREFIX}chat_messages
--   (поле content::jsonb). Раннер агрегирует reasoning + текст + ошибки
--   и сохраняет туда финальные блоки ассистент-сообщения
--   (см. app/domains/chat/services/agent_bridge_runner.py:120-206).
--   Эта чистка таблицы chat_messages НЕ трогает.
--
-- Совместимость
--   Скрипт совместим И с PostgreSQL И с Greenplum 6.x (= PG 9.4):
--     БЕЗ ON CONFLICT, БЕЗ gen_random_uuid(), БЕЗ jsonb_set,
--     БЕЗ CREATE INDEX IF NOT EXISTS и других «удобств» PG 9.5+.
--
-- Подстановка плейсхолдеров
--   В миграциях проекта используются плейсхолдеры {SCHEMA}. и {PREFIX},
--   которые подменяются адаптерами при старте приложения. Этот скрипт
--   запускается ВНЕ приложения (cron/Datalab/ручной psql) — плейсхолдеры
--   нужно подставить вручную, например через sed:
--
--     sed 's/{SCHEMA}/s_grnplm_ld_audit_da_project_4/g; \
--          s/{PREFIX}/t_db_oarb_audit_act_/g' \
--          docs/agent-bridge-cleanup.sql | psql ...
--
--   Или, если префикс и схема стабильны, скопировать файл и заменить один раз.
--
-- Срок хранения
--   Фиксированный интервал ниже — 30 дней. Для других сроков замените
--   "INTERVAL '30 days'" во всех трёх DELETE-ах. (Один параметр сверху —
--   единственный, который рекомендуется править под аудит-требования.)
--
-- Порядок удаления (важно)
--   Между таблицами agent_response_events / agent_responses / agent_requests
--   формальных FK нет, но логическая зависимость такая:
--     agent_response_events.request_id  ──┐
--     agent_responses.request_id        ──┤──► agent_requests.id
--   Поэтому удаляем сверху вниз: сначала события, затем финальные ответы,
--   и только в конце — сами запросы. Если поменять порядок — orphan-строки
--   в events/responses сохранятся и продолжат занимать место.
--
-- Периодичность
--   Рекомендуется cron раз в неделю в окне низкой нагрузки. После массивной
--   чистки полезно VACUUM ANALYZE (PG) — раскомментируйте в конце.
-- ============================================================================

BEGIN;

-- ── 1. События стрима (самая объёмная таблица: ~10–20 KB на запрос) ──────────
DELETE FROM {SCHEMA}.{PREFIX}agent_response_events
WHERE request_id IN (
    SELECT id
    FROM {SCHEMA}.{PREFIX}agent_requests
    WHERE status IN ('done', 'error', 'timeout')
      AND finished_at IS NOT NULL
      AND finished_at < CURRENT_TIMESTAMP - INTERVAL '30 days'
);

-- ── 2. Финальные ответы агента ───────────────────────────────────────────────
DELETE FROM {SCHEMA}.{PREFIX}agent_responses
WHERE request_id IN (
    SELECT id
    FROM {SCHEMA}.{PREFIX}agent_requests
    WHERE status IN ('done', 'error', 'timeout')
      AND finished_at IS NOT NULL
      AND finished_at < CURRENT_TIMESTAMP - INTERVAL '30 days'
);

-- ── 3. Сами запросы (после events/responses) ─────────────────────────────────
DELETE FROM {SCHEMA}.{PREFIX}agent_requests
WHERE status IN ('done', 'error', 'timeout')
  AND finished_at IS NOT NULL
  AND finished_at < CURRENT_TIMESTAMP - INTERVAL '30 days';

COMMIT;

-- ── Опционально: дефрагментация после массовой чистки ───────────────────────
-- PostgreSQL (autovacuum обычно справится сам, но при больших объёмах):
--   VACUUM ANALYZE {SCHEMA}.{PREFIX}agent_response_events;
--   VACUUM ANALYZE {SCHEMA}.{PREFIX}agent_responses;
--   VACUUM ANALYZE {SCHEMA}.{PREFIX}agent_requests;
--
-- Greenplum (VACUUM FULL — только при заметной фрагментации, требует exclusive lock):
--   VACUUM ANALYZE {SCHEMA}.{PREFIX}agent_response_events;
--   VACUUM ANALYZE {SCHEMA}.{PREFIX}agent_responses;
--   VACUUM ANALYZE {SCHEMA}.{PREFIX}agent_requests;
