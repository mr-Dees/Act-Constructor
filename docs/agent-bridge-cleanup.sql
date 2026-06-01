-- ============================================================================
-- agent-bridge-cleanup.sql — очистка bus-таблицы канала к внешнему ИИ-агенту
-- ============================================================================
-- Назначение
--   Удаляет старые завершённые строки из bus-таблицы:
--     {PREFIX}agent_messages — единый канал «вопрос ↔ ответ» между AW и агентом
--
--   Удаляются ТОЛЬКО завершённые строки (status IN ('complete','error','timeout'));
--   активные (pending/in_progress) НИКОГДА не трогаются — даже если «зависли»:
--   AW сам закроет их по таймауту (10 мин), а при рестарте uvicorn lifespan
--   reconcile подхватит оставшиеся.
--
--   Видимая пользователю история ЧАТА живёт в {PREFIX}chat_messages.
--   Эта чистка chat_messages НЕ трогает.
--
-- Совместимость
--   Скрипт совместим И с PostgreSQL, И с Greenplum 6.x (= PG 9.4):
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
--   Дефолт: 180 дней для всех завершённых строк (complete/error/timeout).
--   Подстройте интервал под свои аудит-требования.
--   Критерий удаления — updated_at (момент последнего изменения строки),
--   а не created_at, чтобы не трогать строки, закрытые позднее создания.
--
-- Периодичность
--   Рекомендуется cron раз в неделю в окне низкой нагрузки. После массивной
--   чистки полезно VACUUM ANALYZE (Greenplum — раскомментируйте в конце).
-- ============================================================================

BEGIN;

-- ── Завершённые строки старше 180 дней ──────────────────────────────────────
-- role охватывает и вопросы ('user'), и ответы ('assistant'), и 'tool':
-- все они закрываются через status, поэтому один DELETE покрывает всё.
DELETE FROM {SCHEMA}.{PREFIX}agent_messages
WHERE status IN ('complete', 'error', 'timeout')
  AND updated_at IS NOT NULL
  AND updated_at < CURRENT_TIMESTAMP - INTERVAL '180 days';

COMMIT;

-- ── Опционально: дефрагментация после массовой чистки ───────────────────────
-- PostgreSQL (autovacuum обычно справится сам, но при больших объёмах):
--   VACUUM ANALYZE {SCHEMA}.{PREFIX}agent_messages;
--
-- Greenplum (VACUUM FULL — только при заметной фрагментации, требует exclusive lock):
--   VACUUM ANALYZE {SCHEMA}.{PREFIX}agent_messages;

-- ── Опционально: закрыть зависшие pending/in_progress старше 2 часов ────────
-- AW закрывает сам через 10 мин, но при долгом даунтайме uvicorn могут остаться.
-- Запускать ОТДЕЛЬНО (не в основной транзакции выше), только осознанно:
--
-- UPDATE {SCHEMA}.{PREFIX}agent_messages
-- SET status     = 'timeout',
--     updated_at = CURRENT_TIMESTAMP
-- WHERE role = 'user'
--   AND status IN ('pending', 'in_progress')
--   AND created_at < CURRENT_TIMESTAMP - INTERVAL '2 hours';
