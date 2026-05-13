-- ============================================================================
--  external-agent-imitation.sql
--  Хелпер-сниппеты для ручной имитации внешнего ИИ-агента в AuditWorkstation
--  (используется при разработке/тестировании моста запросов/событий/ответов)
--
--  Место: docs/external-agent-imitation.sql (НЕ часть продакшен-кода)
--  Целевая БД: PostgreSQL (dev) и Greenplum (prod) — все запросы GP-совместимы
--  Связанная документация: docs/developer-guide.md §7.8 (Мост к внешнему агенту)
--
--  ВАЖНО — имена таблиц:
--    Все таблицы приложения используют общий префикс `t_db_oarb_audit_act_`,
--    задаваемый через env-переменную `DATABASE__TABLE_PREFIX`. Префикс одинаков
--    для PG и GP. В сниппетах ниже имена указаны в полном виде, как они
--    выглядят в базе при дефолтном префиксе:
--      • t_db_oarb_audit_act_agent_requests
--      • t_db_oarb_audit_act_agent_response_events
--      • t_db_oarb_audit_act_agent_responses
--      • t_db_oarb_audit_act_chat_files
--      • t_db_oarb_audit_act_agent_response_events_id_seq  (sequence)
--    Если в .env задан другой префикс — замени глобально.
--    На GP к имени дополнительно прибавляется схема: `{SCHEMA}.<table>`.
--
--  ВАЖНО — различие форматов:
--    • Поле `payload` в `agent_response_events` (тип `reasoning`/`status`/`error`)
--      использует поля свободной формы: `text`, `is_chunk`, `stage`, `code`, `message`.
--      Эти события стримятся фронту как промежуточные delta/heartbeat.
--    • Поле `blocks` в `agent_responses` — это массив pydantic-моделей из
--      `app/core/chat/blocks.py`. Каноническое поле для `text`/`code`/`reasoning`
--      блоков — `content` (НЕ `text`/`code`).
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 0. ПОДГОТОВКА: посмотреть свежие запросы от AW
-- ────────────────────────────────────────────────────────────────────────────

-- Что AW уже отправила, но ещё не обработано.
--
-- СТАДИИ status в agent_requests:
--   pending     — INSERT от AW, фоновый раннер ещё не подхватил (~миллисекунды,
--                 почти не наблюдается на dev).
--   dispatched  — раннер запустил polling, ждёт первого события от внешнего
--                 агента. Эта стадия видна пока ты ещё не вставил INSERT в
--                 agent_response_events.
--   in_progress — пришло первое событие от агента (raw reasoning или status).
--                 Здесь видно «агент пишет».
--   done        — финальный ответ сохранён, ассистент-сообщение записано.
--   error       — раннер или агент сообщили об ошибке (error_message заполнен).
--   timeout     — сработал один из трёх гейтов wait_for_completion.
--
-- Для наблюдения «всё, что в работе» выбирай pending/dispatched/in_progress.
SELECT id, conversation_id, message_id, user_id, domain_name,
       last_user_message, status, started_at, created_at
FROM t_db_oarb_audit_act_agent_requests
WHERE status IN ('pending', 'dispatched', 'in_progress')
ORDER BY created_at DESC
LIMIT 20;

-- Полный payload одного запроса (история, файлы, knowledge_bases):
SELECT id, knowledge_bases, history, files, last_user_message
FROM t_db_oarb_audit_act_agent_requests
WHERE id = '<request_id>';


-- ────────────────────────────────────────────────────────────────────────────
-- 1. СЦЕНАРИЙ "успешный ответ агента" (нормальный поток)
-- ────────────────────────────────────────────────────────────────────────────

-- Шаг 1.1 — НЕ нужен при ручной имитации.
-- AW сама проходит pending → dispatched → in_progress:
--   * pending → dispatched ставит фоновый раннер при подхвате запроса
--     (заполняет started_at).
--   * dispatched → in_progress ставит раннер при получении первого
--     INSERT в agent_response_events (то есть после шага 1.2 ниже).
-- Вручную трогать status не нужно. Если очень хочется — UPDATE безопасен
-- (идемпотентен), но не отражает реальный поток.

-- Шаг 1.2 — стрим reasoning (несколько порций).
-- ВАЖНО: id берётся из sequence; seq монотонно растёт в рамках request_id.
INSERT INTO t_db_oarb_audit_act_agent_response_events (id, request_id, seq, event_type, payload, created_at)
VALUES (
    nextval('t_db_oarb_audit_act_agent_response_events_id_seq'),
    '<request_id>',
    1,
    'reasoning',
    '{"text":"Понимаю вопрос пользователя про КСО. Ищу в acts_default.","is_chunk":true}'::jsonb,
    now()
);

INSERT INTO t_db_oarb_audit_act_agent_response_events (id, request_id, seq, event_type, payload, created_at)
VALUES (
    nextval('t_db_oarb_audit_act_agent_response_events_id_seq'),
    '<request_id>',
    2,
    'reasoning',
    '{"text":"Найдено 3 релевантных документа, формирую ответ.","is_chunk":true}'::jsonb,
    now()
);

-- Шаг 1.3 (опц.) — статус-event для прогресс-баннера в UI:
INSERT INTO t_db_oarb_audit_act_agent_response_events (id, request_id, seq, event_type, payload, created_at)
VALUES (
    nextval('t_db_oarb_audit_act_agent_response_events_id_seq'),
    '<request_id>',
    3,
    'status',
    '{"stage":"composing_answer"}'::jsonb,
    now()
);

-- Шаг 1.4 — ФИНАЛЬНЫЙ ответ. UUID генерируется автоматически
-- (md5(...) даёт уникальную строку, помещающуюся в VARCHAR(36); работает и на PG, и на GP).
INSERT INTO t_db_oarb_audit_act_agent_responses
    (id, request_id, blocks, finish_reason, model, token_usage, created_at)
VALUES (
    md5(random()::text || clock_timestamp()::text),
    '<request_id>',
    '[
        {"type":"text","content":"КСО — корпоративная социальная ответственность. По регламенту 2024 года..."}
    ]'::jsonb,
    'stop',
    'imitated-agent',
    '{"prompt_tokens":120,"completion_tokens":80}'::jsonb,
    now()
);

-- Шаг 1.5 — закрыть запрос:
UPDATE t_db_oarb_audit_act_agent_requests
SET status = 'done', finished_at = now()
WHERE id = '<request_id>';


-- ────────────────────────────────────────────────────────────────────────────
-- 2. СЦЕНАРИЙ "ответ с кнопками" (агент возвращает ButtonGroup в blocks)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO t_db_oarb_audit_act_agent_responses
    (id, request_id, blocks, finish_reason, model, token_usage, created_at)
VALUES (
    md5(random()::text || clock_timestamp()::text),
    '<request_id>',
    '[
        {"type":"text","content":"Найдены 3 связанных акта:"},
        {"type":"buttons","buttons":[
            {"action_id":"acts.open_act_page","label":"Открыть КМ-23-001",
             "params":{"km_number":"КМ-23-001"}},
            {"action_id":"acts.open_act_page","label":"Открыть КМ-23-002",
             "params":{"km_number":"КМ-23-002"}}
        ]}
    ]'::jsonb,
    'stop',
    'imitated-agent',
    '{"prompt_tokens":80,"completion_tokens":40}'::jsonb,
    now()
);

UPDATE t_db_oarb_audit_act_agent_requests SET status = 'done', finished_at = now()
WHERE id = '<request_id>';


-- ────────────────────────────────────────────────────────────────────────────
-- 3. СЦЕНАРИЙ "ошибка" (агент не смог получить ответ)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO t_db_oarb_audit_act_agent_response_events (id, request_id, seq, event_type, payload, created_at)
VALUES (
    nextval('t_db_oarb_audit_act_agent_response_events_id_seq'),
    '<request_id>',
    1,
    'error',
    '{"code":"kb_unavailable","message":"База знаний acts_default недоступна"}'::jsonb,
    now()
);

INSERT INTO t_db_oarb_audit_act_agent_responses
    (id, request_id, blocks, finish_reason, model, created_at)
VALUES (
    md5(random()::text || clock_timestamp()::text),
    '<request_id>',
    '[{"type":"text","content":"Не удалось получить ответ от баз знаний. Попробуйте позже."}]'::jsonb,
    'error',
    'imitated-agent',
    now()
);

UPDATE t_db_oarb_audit_act_agent_requests
SET status = 'error',
    error_message = 'kb_unavailable',
    finished_at = now()
WHERE id = '<request_id>';


-- ────────────────────────────────────────────────────────────────────────────
-- 4. РАБОТА С ФАЙЛАМИ
-- ────────────────────────────────────────────────────────────────────────────

-- Посмотреть, какие файлы пришли от пользователя (с уже извлечённым текстом):
SELECT
    file ->> 'file_id'        AS file_id,
    file ->> 'filename'       AS filename,
    file ->> 'mime_type'      AS mime,
    (file ->> 'size')::bigint AS size,
    length(file ->> 'extracted_text') AS extracted_text_len
FROM t_db_oarb_audit_act_agent_requests, jsonb_array_elements(files) AS file
WHERE t_db_oarb_audit_act_agent_requests.id = '<request_id>';

-- Прочитать BYTEA бинарного файла (изображение и т.п.):
SELECT filename, mime_type, length(file_data) AS bytes
FROM t_db_oarb_audit_act_chat_files
WHERE id = '<file_uuid_из_files_jsonb>';


-- ────────────────────────────────────────────────────────────────────────────
-- 4a. СЦЕНАРИЙ "агент отправляет пользователю файл"
-- ────────────────────────────────────────────────────────────────────────────
--
-- Идея: агент кладёт BYTEA в chat_files (в ту же conversation_id, что в
-- agent_requests) и в agent_responses.blocks возвращает FileBlock со ссылкой
-- на свежий file_id. AW отдаёт файл через GET /api/v1/chat/files/{file_id},
-- проверяя что conversation принадлежит текущему пользователю.
--
-- Требования к строке chat_files:
--   - id              VARCHAR(36): UUID/строка; должна совпасть с FileBlock.file_id
--   - conversation_id: ОБЯЗАТЕЛЬНО взять из agent_requests того же request_id
--                      (иначе скачивание упрётся в проверку user_id)
--   - message_id      NULL — у ответа агента ещё нет id чат-сообщения
--   - filename        до 500 символов; UI берёт расширение для иконки
--   - mime_type       до 200 символов; превью на фронте работает по mime
--   - file_size       > 0; INTEGER (PG/GP: до 2 ГБ; на практике лимитируется
--                     настройками chat upload)
--   - file_data       BYTEA — само содержимое
--
-- Чтобы упростить ручную имитацию, ниже используются короткие inline-данные
-- (TXT — literal, PDF/XLSX — заголовок файла). Для реальной отдачи замени
-- bytea-значение на полноценное содержимое (pg_read_binary_file и т.п.).


-- 4a.1 — TXT: простейший случай, тело — utf8 в convert_to():
WITH new_file AS (
    INSERT INTO t_db_oarb_audit_act_chat_files
        (id, conversation_id, message_id, filename,
         mime_type, file_size, file_data, created_at)
    SELECT
        md5(random()::text || clock_timestamp()::text),
        r.conversation_id,
        NULL,
        'отчёт.txt',
        'text/plain; charset=utf-8',
        octet_length(convert_to(
            'Сводный отчёт по КМ-12-32141.' || E'\n' ||
            'Документ сформирован агентом базы знаний.', 'UTF8'
        )),
        convert_to(
            'Сводный отчёт по КМ-12-32141.' || E'\n' ||
            'Документ сформирован агентом базы знаний.', 'UTF8'
        ),
        now()
    FROM t_db_oarb_audit_act_agent_requests r
    WHERE r.id = '<request_id>'
    RETURNING id, filename, mime_type, file_size
)
INSERT INTO t_db_oarb_audit_act_agent_responses
    (id, request_id, blocks, finish_reason, model, created_at)
SELECT
    md5(random()::text || clock_timestamp()::text),
    '<request_id>',
    jsonb_build_array(
        jsonb_build_object('type', 'text',
            'content', 'Сформировал отчёт, прикладываю файл:'),
        jsonb_build_object(
            'type',      'file',
            'file_id',   nf.id,
            'filename',  nf.filename,
            'mime_type', nf.mime_type,
            'file_size', nf.file_size
        )
    ),
    'stop', 'imitated-agent', now()
FROM new_file nf;

UPDATE t_db_oarb_audit_act_agent_requests SET status = 'done', finished_at = now()
WHERE id = '<request_id>';


-- 4a.2 — PDF: подкладываем только сигнатуру (для UI достаточно, чтобы
-- определить mime; полноценное содержимое подставь сам).
WITH new_file AS (
    INSERT INTO t_db_oarb_audit_act_chat_files
        (id, conversation_id, message_id, filename,
         mime_type, file_size, file_data, created_at)
    SELECT
        md5(random()::text || clock_timestamp()::text),
        r.conversation_id,
        NULL,
        'регламент-2024.pdf',
        'application/pdf',
        octet_length(decode('255044462D312E340A25E2E3CFD30A', 'hex')),
        decode('255044462D312E340A25E2E3CFD30A', 'hex'),  -- "%PDF-1.4\n%...\n"
        now()
    FROM t_db_oarb_audit_act_agent_requests r
    WHERE r.id = '<request_id>'
    RETURNING id, filename, mime_type, file_size
)
INSERT INTO t_db_oarb_audit_act_agent_responses
    (id, request_id, blocks, finish_reason, model, created_at)
SELECT
    md5(random()::text || clock_timestamp()::text),
    '<request_id>',
    jsonb_build_array(
        jsonb_build_object('type', 'text',
            'content', 'Нашёл регламент в базе знаний:'),
        jsonb_build_object(
            'type',      'file',
            'file_id',   nf.id,
            'filename',  nf.filename,
            'mime_type', nf.mime_type,
            'file_size', nf.file_size
        )
    ),
    'stop', 'imitated-agent', now()
FROM new_file nf;

UPDATE t_db_oarb_audit_act_agent_requests SET status = 'done', finished_at = now()
WHERE id = '<request_id>';


-- 4a.3 — XLSX: подкладываем сигнатуру ZIP (xlsx — это ZIP-контейнер).
-- Excel сам файл не откроет, но в чате он отрендерится с иконкой и
-- кнопкой "Скачать". Для боевого сценария подставь реальные bytes.
WITH new_file AS (
    INSERT INTO t_db_oarb_audit_act_chat_files
        (id, conversation_id, message_id, filename,
         mime_type, file_size, file_data, created_at)
    SELECT
        md5(random()::text || clock_timestamp()::text),
        r.conversation_id,
        NULL,
        'метрики-КМ-12-32141.xlsx',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        octet_length(decode('504B0304140000000000', 'hex')),
        decode('504B0304140000000000', 'hex'),  -- "PK\x03\x04..." — ZIP header
        now()
    FROM t_db_oarb_audit_act_agent_requests r
    WHERE r.id = '<request_id>'
    RETURNING id, filename, mime_type, file_size
)
INSERT INTO t_db_oarb_audit_act_agent_responses
    (id, request_id, blocks, finish_reason, model, created_at)
SELECT
    md5(random()::text || clock_timestamp()::text),
    '<request_id>',
    jsonb_build_array(
        jsonb_build_object('type', 'text',
            'content', 'Подготовил выгрузку метрик в xlsx:'),
        jsonb_build_object(
            'type',      'file',
            'file_id',   nf.id,
            'filename',  nf.filename,
            'mime_type', nf.mime_type,
            'file_size', nf.file_size
        )
    ),
    'stop', 'imitated-agent', now()
FROM new_file nf;

UPDATE t_db_oarb_audit_act_agent_requests SET status = 'done', finished_at = now()
WHERE id = '<request_id>';


-- ────────────────────────────────────────────────────────────────────────────
-- 5. ОЧИСТКА (для админов; в коде приложения retention НЕ реализован)
-- ────────────────────────────────────────────────────────────────────────────

-- 5.1 — Удалить события старше 30 дней:
DELETE FROM t_db_oarb_audit_act_agent_response_events
WHERE created_at < now() - INTERVAL '30 days';

-- 5.2 — Удалить старые завершённые запросы и их финальные ответы (180 дней):
DELETE FROM t_db_oarb_audit_act_agent_responses
WHERE created_at < now() - INTERVAL '180 days';

DELETE FROM t_db_oarb_audit_act_agent_requests
WHERE created_at < now() - INTERVAL '180 days'
  AND status IN ('done', 'error', 'timeout');

-- 5.3 — На Greenplum после массивных DELETE'ов запустить vacuum
--       (PG он тоже не помешает, но обычно автовакуум справится):
VACUUM ANALYZE t_db_oarb_audit_act_agent_response_events;
VACUUM ANALYZE t_db_oarb_audit_act_agent_responses;
VACUUM ANALYZE t_db_oarb_audit_act_agent_requests;

-- 5.4 — Иногда нужно "зависшие" pending дольше N часов перевести в timeout:
UPDATE t_db_oarb_audit_act_agent_requests
SET status = 'timeout',
    error_message = 'manual cleanup: stuck in pending',
    finished_at = now()
WHERE status IN ('pending', 'in_progress')
  AND created_at < now() - INTERVAL '1 hour';


-- ────────────────────────────────────────────────────────────────────────────
-- 6. ДИАГНОСТИКА
-- ────────────────────────────────────────────────────────────────────────────

-- Сколько запросов в каком статусе:
SELECT status, COUNT(*) FROM t_db_oarb_audit_act_agent_requests
GROUP BY status ORDER BY status;

-- Самые медленные завершённые запросы (top 20):
SELECT id, last_user_message,
       finished_at - created_at AS duration,
       status
FROM t_db_oarb_audit_act_agent_requests
WHERE finished_at IS NOT NULL
ORDER BY duration DESC
LIMIT 20;

-- Сколько событий в среднем на запрос:
SELECT
    AVG(cnt)::numeric(10,2) AS avg_events_per_request,
    MAX(cnt)                AS max_events
FROM (
    SELECT request_id, COUNT(*) AS cnt
    FROM t_db_oarb_audit_act_agent_response_events
    GROUP BY request_id
) t;
