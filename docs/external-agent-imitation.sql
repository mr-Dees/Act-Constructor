-- ============================================================================
--  external-agent-imitation.sql
--  Хелпер-сниппеты для ручной имитации внешнего ИИ-агента в AuditWorkstation
--  (используется при разработке/тестировании моста agent_requests/events/responses)
--
--  Место: docs/external-agent-imitation.sql (НЕ часть продакшен-кода)
--  Целевая БД: PostgreSQL (dev) и Greenplum (prod) — все запросы GP-совместимы
--  Связанная документация: docs/developer-guide.md §7.8 (Мост к внешнему агенту)
--
--  ВАЖНО — различие форматов:
--    • Поле `payload` в `agent_response_events` (тип `reasoning`/`status`/`error`)
--      использует поля свободной формы: `text`, `is_chunk`, `stage`, `code`, `message`.
--      Эти события стримятся фронту как промежуточные delta/heartbeat.
--    • Поле `blocks` в `agent_responses` — это массив pydantic-моделей из
--      `app/core/chat/blocks.py`. Каноническое поле для `text`/`code`/`reasoning`
--      блоков — `content` (НЕ `text`/`code`).
--
--  ВАЖНО — Greenplum-плейсхолдеры:
--    На GP реальные имена объектов — `{SCHEMA}.{PREFIX}<name>` (адаптер подставляет).
--    В этой шпаргалке имена даны в развёрнутом виде для удобства; на GP замените
--    `agent_response_events_id_seq` → `<schema>.<prefix>agent_response_events_id_seq`.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 0. ПОДГОТОВКА: посмотреть свежие запросы от AW
-- ────────────────────────────────────────────────────────────────────────────

-- Что AW уже отправила, но ещё не обработано:
SELECT id, conversation_id, message_id, user_id, domain_name,
       last_user_message, status, created_at
FROM agent_requests
WHERE status = 'pending'
ORDER BY created_at DESC
LIMIT 20;

-- Полный payload одного запроса (история, файлы, knowledge_bases):
SELECT id, knowledge_bases, history, files, last_user_message
FROM agent_requests
WHERE id = '<request_id>';


-- ────────────────────────────────────────────────────────────────────────────
-- 1. СЦЕНАРИЙ "успешный ответ агента" (нормальный поток)
-- ────────────────────────────────────────────────────────────────────────────

-- Шаг 1.1 (опц.) — пометить, что агент взял в работу.
-- На GP UPDATE дорог; в продакшене реальный агент может сразу писать events.
UPDATE agent_requests
SET status = 'in_progress', started_at = now()
WHERE id = '<request_id>';

-- Шаг 1.2 — стрим reasoning (несколько порций).
-- ВАЖНО: id берётся из sequence; seq монотонно растёт в рамках request_id.
INSERT INTO agent_response_events (id, request_id, seq, event_type, payload, created_at)
VALUES (
    nextval('agent_response_events_id_seq'),
    '<request_id>',
    1,
    'reasoning',
    '{"text":"Понимаю вопрос пользователя про КСО. Ищу в acts_default.","is_chunk":true}'::jsonb,
    now()
);

INSERT INTO agent_response_events (id, request_id, seq, event_type, payload, created_at)
VALUES (
    nextval('agent_response_events_id_seq'),
    '<request_id>',
    2,
    'reasoning',
    '{"text":"Найдено 3 релевантных документа, формирую ответ.","is_chunk":true}'::jsonb,
    now()
);

-- Шаг 1.3 (опц.) — статус-event для прогресс-баннера в UI:
INSERT INTO agent_response_events (id, request_id, seq, event_type, payload, created_at)
VALUES (
    nextval('agent_response_events_id_seq'),
    '<request_id>',
    3,
    'status',
    '{"stage":"composing_answer"}'::jsonb,
    now()
);

-- Шаг 1.4 — ФИНАЛЬНЫЙ ответ. UUID генерируется автоматически
-- (md5(...) даёт уникальную строку, помещающуюся в VARCHAR(36); работает и на PG, и на GP).
INSERT INTO agent_responses
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
UPDATE agent_requests
SET status = 'done', finished_at = now()
WHERE id = '<request_id>';


-- ────────────────────────────────────────────────────────────────────────────
-- 2. СЦЕНАРИЙ "ответ с кнопками" (агент возвращает ButtonGroup в blocks)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO agent_responses
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

UPDATE agent_requests SET status = 'done', finished_at = now()
WHERE id = '<request_id>';


-- ────────────────────────────────────────────────────────────────────────────
-- 3. СЦЕНАРИЙ "ошибка" (агент не смог получить ответ)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO agent_response_events (id, request_id, seq, event_type, payload, created_at)
VALUES (
    nextval('agent_response_events_id_seq'),
    '<request_id>',
    1,
    'error',
    '{"code":"kb_unavailable","message":"База знаний acts_default недоступна"}'::jsonb,
    now()
);

INSERT INTO agent_responses
    (id, request_id, blocks, finish_reason, model, created_at)
VALUES (
    md5(random()::text || clock_timestamp()::text),
    '<request_id>',
    '[{"type":"text","content":"Не удалось получить ответ от баз знаний. Попробуйте позже."}]'::jsonb,
    'error',
    'imitated-agent',
    now()
);

UPDATE agent_requests
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
FROM agent_requests, jsonb_array_elements(files) AS file
WHERE agent_requests.id = '<request_id>';

-- Прочитать BYTEA бинарного файла (изображение и т.п.):
SELECT filename, mime_type, length(file_data) AS bytes
FROM chat_files
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
    INSERT INTO chat_files
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
    FROM agent_requests r
    WHERE r.id = '<request_id>'
    RETURNING id, filename, mime_type, file_size
)
INSERT INTO agent_responses
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

UPDATE agent_requests SET status = 'done', finished_at = now()
WHERE id = '<request_id>';


-- 4a.2 — PDF: подкладываем только сигнатуру (для UI достаточно, чтобы
-- определить mime; полноценное содержимое подставь сам).
WITH new_file AS (
    INSERT INTO chat_files
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
    FROM agent_requests r
    WHERE r.id = '<request_id>'
    RETURNING id, filename, mime_type, file_size
)
INSERT INTO agent_responses
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

UPDATE agent_requests SET status = 'done', finished_at = now()
WHERE id = '<request_id>';


-- 4a.3 — XLSX: подкладываем сигнатуру ZIP (xlsx — это ZIP-контейнер).
-- Excel сам файл не откроет, но в чате он отрендерится с иконкой и
-- кнопкой "Скачать". Для боевого сценария подставь реальные bytes.
WITH new_file AS (
    INSERT INTO chat_files
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
    FROM agent_requests r
    WHERE r.id = '<request_id>'
    RETURNING id, filename, mime_type, file_size
)
INSERT INTO agent_responses
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

UPDATE agent_requests SET status = 'done', finished_at = now()
WHERE id = '<request_id>';


-- ────────────────────────────────────────────────────────────────────────────
-- 5. ОЧИСТКА (для админов; в коде приложения retention НЕ реализован)
-- ────────────────────────────────────────────────────────────────────────────

-- 5.1 — Удалить события старше 30 дней:
DELETE FROM agent_response_events
WHERE created_at < now() - INTERVAL '30 days';

-- 5.2 — Удалить старые завершённые запросы и их финальные ответы (180 дней):
DELETE FROM agent_responses
WHERE created_at < now() - INTERVAL '180 days';

DELETE FROM agent_requests
WHERE created_at < now() - INTERVAL '180 days'
  AND status IN ('done', 'error', 'timeout');

-- 5.3 — На Greenplum после массивных DELETE'ов запустить vacuum
--       (PG он тоже не помешает, но обычно автовакуум справится):
VACUUM ANALYZE agent_response_events;
VACUUM ANALYZE agent_responses;
VACUUM ANALYZE agent_requests;

-- 5.4 — Иногда нужно "зависшие" pending дольше N часов перевести в timeout:
UPDATE agent_requests
SET status = 'timeout',
    error_message = 'manual cleanup: stuck in pending',
    finished_at = now()
WHERE status IN ('pending', 'in_progress')
  AND created_at < now() - INTERVAL '1 hour';


-- ────────────────────────────────────────────────────────────────────────────
-- 6. ДИАГНОСТИКА
-- ────────────────────────────────────────────────────────────────────────────

-- Сколько запросов в каком статусе:
SELECT status, COUNT(*) FROM agent_requests
GROUP BY status ORDER BY status;

-- Самые медленные завершённые запросы (top 20):
SELECT id, last_user_message,
       finished_at - created_at AS duration,
       status
FROM agent_requests
WHERE finished_at IS NOT NULL
ORDER BY duration DESC
LIMIT 20;

-- Сколько событий в среднем на запрос:
SELECT
    AVG(cnt)::numeric(10,2) AS avg_events_per_request,
    MAX(cnt)                AS max_events
FROM (
    SELECT request_id, COUNT(*) AS cnt
    FROM agent_response_events
    GROUP BY request_id
) t;
