-- ============================================================================
--  external-agent-imitation.sql
--  Хелпер-сниппеты для ручной имитации внешнего ИИ-агента (nanobot) в AuditWorkstation
--  (используется при разработке/тестировании канала agent_messages)
--
--  Место: docs/external-agent-imitation.sql (НЕ часть продакшен-кода)
--  Целевая БД: PostgreSQL (dev) и Greenplum (prod) — все запросы GP-совместимы
--  Связанная документация: docs/developer-guide.md (Chat domain deep-dive §11)
--
--  ВАЖНО — имена таблиц:
--    Все таблицы приложения используют общий префикс `t_db_oarb_audit_act_`,
--    задаваемый через env-переменную `DATABASE__TABLE_PREFIX`. Префикс одинаков
--    для PG и GP. В сниппетах ниже имена указаны в полном виде, как они
--    выглядят в базе при дефолтном префиксе:
--      • t_db_oarb_audit_act_agent_messages
--      • t_db_oarb_audit_act_chat_files
--    Если в .env задан другой префикс — замени глобально.
--    На GP к имени дополнительно прибавляется схема: `{SCHEMA}.<table>`.
--
--  ВАЖНО — семантика колонок agent_messages:
--    • chat_id         = uid треда (= chat_conversations.id, он же chat_messages.conversation_id)
--    • conversation_id = uid одного СООБЩЕНИЯ (уникальный строковый идентификатор
--                        данной строки в рамках диалога)
--    • reply_to        = conversation_id строки-ОТВЕТА; проставляется агентом
--                        на строке-вопросе — это сигнал «ответ готов»
--    • role            = 'user' (вопрос от AW) | 'assistant' (ответ агента) | 'tool'
--    • metadata        = JSONB: у вопроса ключи {mode, kb}; у ответа ключ
--                        {thinking} — все рассуждения агента
--    • buttons         = JSONB: массив [{action_id, label, params}]
--    • media           = JSONB: [{file_id, filename, mime_type, file_size}]
--
--  ВАЖНО — поток данных:
--    1. AW INSERT'ит строку-вопрос (role='user', status='pending').
--    2. Агент UPDATE SET status='in_progress' на строке-вопросе.
--    3. Агент INSERT'ит строку-ответа (role='assistant', новый conversation_id,
--       content, metadata.thinking, опц. buttons/media, status='complete').
--    4. Агент UPDATE строки-вопроса: SET reply_to=<uid ответа>, status='complete'.
--    5. AW поллит reply_to строки-вопроса (или status='complete'/'error'/'timeout')
--       и рисует ответ + рассуждения.
--    Таймаут 10 минут — AW сам ставит 'timeout'/'error' на зависших строках.
--    Шаги 2 и 3+4 можно объединить в одну транзакцию.
--
--  ВАЖНО — GP-ограничения (Greenplum 6.x = PostgreSQL 9.4):
--    БЕЗ ON CONFLICT DO UPDATE, БЕЗ gen_random_uuid(), БЕЗ jsonb_set,
--    БЕЗ CREATE INDEX IF NOT EXISTS. UUID генерируем через
--    md5(random()::text || clock_timestamp()::text).
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 0. ПОДГОТОВКА: посмотреть свежие вопросы от AW (ещё не обработаны)
-- ────────────────────────────────────────────────────────────────────────────

-- Активные вопросы, ждущие ответа от агента:
SELECT id, chat_id, user_id, conversation_id,
       content, metadata, status, created_at
FROM t_db_oarb_audit_act_agent_messages
WHERE role = 'user'
  AND status = 'pending'
ORDER BY created_at DESC
LIMIT 20;

-- СТАДИИ status на строке-вопросе:
--   pending     — вопрос вставлен AW, агент ещё не взял.
--   in_progress — агент взял (UPDATE после SELECT FOR UPDATE или просто UPDATE).
--   complete    — агент проставил reply_to и закончил ответ.
--   error       — агент зафиксировал ошибку.
--   timeout     — AW сам закрыл по таймауту (10 мин без ответа).
--
-- Для наблюдения «всё, что в работе»:
SELECT id, chat_id, conversation_id, content, status, created_at
FROM t_db_oarb_audit_act_agent_messages
WHERE role = 'user'
  AND status IN ('pending', 'in_progress')
ORDER BY created_at DESC
LIMIT 20;

-- Полная строка одного вопроса (metadata содержит mode и kb):
SELECT id, chat_id, user_id, conversation_id, content, metadata, status, created_at
FROM t_db_oarb_audit_act_agent_messages
WHERE id = '<question_id>';


-- ────────────────────────────────────────────────────────────────────────────
-- 1. СЦЕНАРИЙ "успешный ответ агента" (нормальный поток)
-- ────────────────────────────────────────────────────────────────────────────

-- Шаг 1.1 — агент берёт вопрос в работу.
-- Атомарно занять строку и пометить «в работе»:
UPDATE t_db_oarb_audit_act_agent_messages
SET status = 'in_progress',
    updated_at = now()
WHERE id = '<question_id>'
  AND status = 'pending';

-- Если UPDATE затронул 0 строк — вопрос уже взял другой агент или он закрыт.

-- Шаг 1.2 — вставить строку-ответ и закрыть строку-вопрос (одна транзакция).
-- ОБА действия в BEGIN/COMMIT — AW увидит reply_to только после COMMIT,
-- что гарантирует атомарность: либо оба видны, либо ни один.
BEGIN;

-- Генерируем uid ответа заранее (подставь конкретное значение вместо переменной;
-- в psql можно использовать \set, в Python — str(uuid.uuid4())).
-- Для примера используем md5-генерацию, совместимую с GP:
-- \set answer_uid '''$(md5(random()::text || clock_timestamp()::text))'''
--
-- Ниже uid ответа задан явно — замени '<answer_uid>' на реальное значение.

INSERT INTO t_db_oarb_audit_act_agent_messages
    (id, chat_id, user_id, conversation_id, role,
     content, metadata, status, created_at, updated_at)
SELECT
    md5(random()::text || clock_timestamp()::text),       -- id строки-ответа
    am.chat_id,
    am.user_id,
    md5(random()::text || clock_timestamp()::text),       -- conversation_id ответа
    'assistant',
    'КСО — корпоративная социальная ответственность. По регламенту 2024 года...',
    '{"thinking":"Понимаю вопрос про КСО. Нашёл 3 релевантных документа, формирую ответ."}'::jsonb,
    'complete',
    now(),
    now()
FROM t_db_oarb_audit_act_agent_messages am
WHERE am.id = '<question_id>'
RETURNING id AS answer_row_id, conversation_id AS answer_conv_id;

-- Затем на строке-вопросе проставляем reply_to = conversation_id строки-ответа.
-- Так как RETURNING в GP не всегда удобно использовать в цепочке,
-- при ручном запуске: сначала выполни INSERT выше, запомни answer_conv_id
-- из результата RETURNING, и вставь его ниже вручную:
UPDATE t_db_oarb_audit_act_agent_messages
SET reply_to   = '<answer_conv_id>',   -- conversation_id только что вставленной строки-ответа
    status     = 'complete',
    updated_at = now()
WHERE id = '<question_id>';

COMMIT;

-- После COMMIT: AW увидит reply_to на вопросе → загрузит строку-ответ
-- по conversation_id и отрендерит content + metadata.thinking.


-- ────────────────────────────────────────────────────────────────────────────
-- 2. СЦЕНАРИЙ "ответ с кнопками"
-- ────────────────────────────────────────────────────────────────────────────
--
-- buttons — массив [{action_id, label, params}]. Сейчас поддерживается
-- action_id 'acts.open_act_page' (открывает страницу акта по km_number).
-- Кнопки рендерятся под текстом ответа как интерактивные элементы.

BEGIN;

INSERT INTO t_db_oarb_audit_act_agent_messages
    (id, chat_id, user_id, conversation_id, role,
     content, metadata, buttons, status, created_at, updated_at)
SELECT
    md5(random()::text || clock_timestamp()::text),
    am.chat_id,
    am.user_id,
    md5(random()::text || clock_timestamp()::text),
    'assistant',
    'Найдены 3 связанных акта:',
    '{"thinking":"Нашёл акты, формирую кнопки для навигации."}'::jsonb,
    '[
        {"action_id":"acts.open_act_page","label":"Открыть КМ-23-001",
         "params":{"km_number":"КМ-23-001"}},
        {"action_id":"acts.open_act_page","label":"Открыть КМ-23-002",
         "params":{"km_number":"КМ-23-002"}},
        {"action_id":"acts.open_act_page","label":"Открыть КМ-23-003",
         "params":{"km_number":"КМ-23-003"}}
    ]'::jsonb,
    'complete',
    now(),
    now()
FROM t_db_oarb_audit_act_agent_messages am
WHERE am.id = '<question_id>'
RETURNING conversation_id AS answer_conv_id;

UPDATE t_db_oarb_audit_act_agent_messages
SET reply_to   = '<answer_conv_id>',
    status     = 'complete',
    updated_at = now()
WHERE id = '<question_id>';

COMMIT;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. СЦЕНАРИЙ "ответ с файлом/медиа"
-- ────────────────────────────────────────────────────────────────────────────
--
-- media — массив [{file_id, filename, mime_type, file_size}].
-- file_id ДОЛЖЕН указывать на реально существующую строку в chat_files
-- (с корректным chat_id/conversation_id), иначе GET /api/v1/chat/files/{file_id}
-- вернёт 404. AW определяет превью по mime_type:
--   image/* — встроенное изображение; остальные — иконка + кнопка «Скачать».
--
-- Шаг 3.1 — залить файл в chat_files:
WITH new_file AS (
    INSERT INTO t_db_oarb_audit_act_chat_files
        (id, conversation_id, message_id, filename,
         mime_type, file_size, file_data, created_at)
    SELECT
        md5(random()::text || clock_timestamp()::text),  -- file_id
        am.chat_id,    -- conversation_id в chat_files = chat_id треда
        NULL,          -- message_id NULL: у ответа агента ещё нет id chat-сообщения
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
    FROM t_db_oarb_audit_act_agent_messages am
    WHERE am.id = '<question_id>'
    RETURNING id AS file_id, filename, mime_type, file_size
)
-- Шаг 3.2 — вставить строку-ответ с media:
INSERT INTO t_db_oarb_audit_act_agent_messages
    (id, chat_id, user_id, conversation_id, role,
     content, media, status, created_at, updated_at)
SELECT
    md5(random()::text || clock_timestamp()::text),
    am.chat_id,
    am.user_id,
    md5(random()::text || clock_timestamp()::text),
    'assistant',
    'Сформировал отчёт, прикладываю файл:',
    jsonb_build_array(
        jsonb_build_object(
            'file_id',   nf.file_id,
            'filename',  nf.filename,
            'mime_type', nf.mime_type,
            'file_size', nf.file_size
        )
    ),
    'complete',
    now(),
    now()
FROM t_db_oarb_audit_act_agent_messages am
CROSS JOIN new_file nf
WHERE am.id = '<question_id>'
RETURNING conversation_id AS answer_conv_id;

-- Шаг 3.3 — закрыть вопрос:
UPDATE t_db_oarb_audit_act_agent_messages
SET reply_to   = '<answer_conv_id>',
    status     = 'complete',
    updated_at = now()
WHERE id = '<question_id>';

-- PDF — подставить сигнатуру; для скачивания достаточно, для открытия нужен
-- полный файл:
-- decode('255044462D312E340A25E2E3CFD30A', 'hex')  -- "%PDF-1.4\n%...\n"
--
-- XLSX — ZIP-сигнатура; иконка рендерится, открытие в Excel требует полного файла:
-- decode('504B0304140000000000', 'hex')  -- "PK\x03\x04..."


-- ────────────────────────────────────────────────────────────────────────────
-- 4. СЦЕНАРИЙ "ошибка" (агент не смог получить ответ)
-- ────────────────────────────────────────────────────────────────────────────
--
-- Можно вставить строку-ответ с описанием ошибки и/или просто закрыть вопрос
-- со status='error'. AW рендерит статусный блок на основе статуса вопроса.

-- Вариант А — только закрыть вопрос (AW покажет стандартное сообщение об ошибке):
UPDATE t_db_oarb_audit_act_agent_messages
SET status     = 'error',
    updated_at = now()
WHERE id = '<question_id>';

-- Вариант Б — вставить строку-ответ с текстом ошибки + закрыть вопрос:
BEGIN;

INSERT INTO t_db_oarb_audit_act_agent_messages
    (id, chat_id, user_id, conversation_id, role,
     content, status, created_at, updated_at)
SELECT
    md5(random()::text || clock_timestamp()::text),
    am.chat_id,
    am.user_id,
    md5(random()::text || clock_timestamp()::text),
    'assistant',
    'Не удалось получить ответ: база знаний acts_default недоступна. Попробуйте позже.',
    'complete',
    now(),
    now()
FROM t_db_oarb_audit_act_agent_messages am
WHERE am.id = '<question_id>'
RETURNING conversation_id AS answer_conv_id;

UPDATE t_db_oarb_audit_act_agent_messages
SET reply_to   = '<answer_conv_id>',
    status     = 'error',
    updated_at = now()
WHERE id = '<question_id>';

COMMIT;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. СЦЕНАРИЙ "агент думает" (промежуточный статус)
-- ────────────────────────────────────────────────────────────────────────────
--
-- Если хочется увидеть индикатор «думает...» в UI — просто поставь in_progress.
-- AW показывает typing-индикатор, пока reply_to = NULL и status = 'in_progress'.

UPDATE t_db_oarb_audit_act_agent_messages
SET status     = 'in_progress',
    updated_at = now()
WHERE id = '<question_id>'
  AND status = 'pending';

-- Затем в любой момент завершить через сценарии 1, 2, 3 или 4.


-- ────────────────────────────────────────────────────────────────────────────
-- 6. ДИАГНОСТИКА
-- ────────────────────────────────────────────────────────────────────────────

-- Счётчики по role + status:
SELECT role, status, COUNT(*)
FROM t_db_oarb_audit_act_agent_messages
GROUP BY role, status
ORDER BY role, status;

-- Самые старые pending (потенциально зависшие):
SELECT id, chat_id, user_id, content,
       now() - created_at AS age,
       created_at
FROM t_db_oarb_audit_act_agent_messages
WHERE role = 'user'
  AND status IN ('pending', 'in_progress')
ORDER BY created_at ASC
LIMIT 20;

-- Полная пара вопрос–ответ по question_id:
SELECT am.id, am.role, am.status, am.reply_to,
       am.content,
       am.metadata,
       am.buttons,
       am.media,
       am.created_at
FROM t_db_oarb_audit_act_agent_messages am
WHERE am.id = '<question_id>'
   OR am.conversation_id = (
       SELECT reply_to
       FROM t_db_oarb_audit_act_agent_messages
       WHERE id = '<question_id>'
   )
ORDER BY am.created_at;

-- Все сообщения одного треда (chat_id):
SELECT id, role, status, conversation_id, reply_to,
       content, created_at
FROM t_db_oarb_audit_act_agent_messages
WHERE chat_id = '<chat_id>'
ORDER BY created_at;

-- Проверить, что chat_files принадлежит нужному треду:
SELECT id, conversation_id, filename, mime_type, file_size, created_at
FROM t_db_oarb_audit_act_chat_files
WHERE conversation_id = '<chat_id>'
ORDER BY created_at DESC
LIMIT 10;


-- ────────────────────────────────────────────────────────────────────────────
-- 7. ОЧИСТКА ПО TTL (для админов)
-- ────────────────────────────────────────────────────────────────────────────
--
-- Удаляем только завершённые строки: complete / error / timeout.
-- pending и in_progress НЕ ТРОГАТЬ — это активные диалоги.
-- Видимая пользователю история чата живёт в chat_messages и НЕ затрагивается.
--
-- Рекомендуемые сроки хранения:
--   complete / error / timeout  — 180 дней
-- Подстройте под свои аудит-требования.

DELETE FROM t_db_oarb_audit_act_agent_messages
WHERE status IN ('complete', 'error', 'timeout')
  AND updated_at < now() - INTERVAL '180 days';

-- На Greenplum после массивных DELETE'ов полезен VACUUM ANALYZE
-- (PG обычно справляется автовакуумом, но не помешает):
-- VACUUM ANALYZE t_db_oarb_audit_act_agent_messages;

-- Зависшие in_progress/pending дольше 2 часов — ручное закрытие:
-- (AW обычно закрывает сам через 10 мин, но при рестарте uvicorn может остаться)
UPDATE t_db_oarb_audit_act_agent_messages
SET status     = 'timeout',
    updated_at = now()
WHERE role = 'user'
  AND status IN ('pending', 'in_progress')
  AND created_at < now() - INTERVAL '2 hours';
