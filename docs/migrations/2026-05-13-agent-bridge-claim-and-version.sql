-- =============================================================================
-- Migration: 2026-05-13 — agent_requests claim worker + optimistic locking
-- =============================================================================
--
-- Что делает:
--   В таблицу {PREFIX}agent_requests добавляются:
--     * worker_token VARCHAR(64) NULL     — идентификатор раннера, заклеймившего
--                                           задачу; защищает от double-claim при
--                                           reconcile в multi-worker конфиге.
--     * version INTEGER NOT NULL DEFAULT 0 — optimistic locking для update_status;
--                                           параллельный апдейт со старой версией
--                                           получит 0 строк затронуто.
--     * updated_at TIMESTAMP              — нужно для отбора «зависших» строк
--                                           в claim_pending() по интервалу.
--   А также индекс idx_{PREFIX}agent_requests_pending под отбор свободных задач.
--
-- Зачем:
--   Фикс 4.1 (race condition в agent_bridge_runner.schedule_pending — несколько
--   uvicorn-воркеров после lifespan-restart могут одновременно подхватить тот же
--   request_id) и фикс 4.2 (потерянные апдейты статуса при конкурентных
--   изменениях со стороны раннера и agent_bridge).
--
-- ВАЖНО:
--   * Эта миграция предназначена для УЖЕ установленных инсталляций.
--     Для свежей установки schema.sql сам создаст таблицу с нужными колонками.
--   * {SCHEMA} и {PREFIX} подставьте руками под свой деплой (DATABASE__TABLE_PREFIX
--     и схему БД из .env).
--   * Для Greenplum 6.x (= PostgreSQL 9.4) не используем IF NOT EXISTS,
--     ON CONFLICT и partial-index с WHERE — см. секцию GREENPLUM ниже.
--
-- =============================================================================
-- PostgreSQL
-- =============================================================================

ALTER TABLE {SCHEMA}.{PREFIX}agent_requests
    ADD COLUMN IF NOT EXISTS worker_token VARCHAR(64);

ALTER TABLE {SCHEMA}.{PREFIX}agent_requests
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE {SCHEMA}.{PREFIX}agent_requests
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL
    DEFAULT CURRENT_TIMESTAMP;

-- Подстраховка: для уже существующих строк, у которых updated_at могла быть
-- NULL до миграции, выставим текущее время.
UPDATE {SCHEMA}.{PREFIX}agent_requests
   SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
 WHERE updated_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_{PREFIX}agent_requests_pending
    ON {SCHEMA}.{PREFIX}agent_requests(status, updated_at)
    WHERE worker_token IS NULL;

-- =============================================================================
-- Greenplum 6.x  (PostgreSQL 9.4 совместимый)
-- =============================================================================
--
-- В GP нет ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS.
-- Перед запуском убедитесь, что колонок/индекса ещё нет
-- (иначе получите DuplicateColumn/DuplicateObject), либо запускайте по одному
-- statement-у и игнорируйте «already exists».
--
-- ALTER TABLE {SCHEMA}.{PREFIX}agent_requests
--     ADD COLUMN worker_token VARCHAR(64);
--
-- ALTER TABLE {SCHEMA}.{PREFIX}agent_requests
--     ADD COLUMN version INTEGER NOT NULL DEFAULT 0;
--
-- ALTER TABLE {SCHEMA}.{PREFIX}agent_requests
--     ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP;
--
-- UPDATE {SCHEMA}.{PREFIX}agent_requests
--    SET updated_at = COALESCE(updated_at, created_at, CURRENT_TIMESTAMP)
--  WHERE updated_at IS NULL;
--
-- CREATE INDEX idx_{PREFIX}agent_requests_pending
--     ON {SCHEMA}.{PREFIX}agent_requests(status, worker_token, updated_at);
