-- ============================================================================
--  external-agent-imitation.sql
--  Хелпер-сниппеты для ручной имитации внешнего ИИ-агента (nanobot) в AuditWorkstation
--  (используется при разработке/тестировании канала chat_agent_messages_bus)
--
--  Место: docs/integrations/external-agent-imitation.sql (НЕ часть продакшен-кода)
--  Целевая БД: PostgreSQL (dev) и Greenplum (prod) — все запросы GP-совместимы
--  Связанная документация: docs/guides/developer-guide.md (Chat domain deep-dive §11)
--
--  ВАЖНО — имена таблиц:
--    Bus-таблица канала — БЕЗ app-префикса: её имя задаётся настройкой
--    `CHAT__AGENT_CHANNEL__TABLE_NAME` целиком (дефолт `chat_agent_messages_bus`,
--    `DATABASE__TABLE_PREFIX` к ней НЕ приклеивается — шина общая с внешним
--    агентом). Остальные таблицы приложения (chat_files и др.) используют общий
--    префикс `t_db_oarb_audit_act_` (env `DATABASE__TABLE_PREFIX`, одинаков для
--    PG и GP). В сниппетах ниже:
--      • chat_agent_messages_bus            (шина — без префикса)
--      • t_db_oarb_audit_act_chat_files     (обычная таблица — с префиксом)
--    Если имя шины / префикс в .env другие — замени глобально.
--    На GP к имени дополнительно прибавляется схема: `{SCHEMA}.<table>`.
--
--  ВАЖНО — семантика колонок chat_agent_messages_bus
--  (структуру задаёт сторона агента — владелец таблицы; отдельной колонки
--   conversation_id в шине НЕТ):
--    • id       (uuid) = uid одного СООБЩЕНИЯ шины — уникальный идентификатор
--                        данной строки. Его же хранит chat_messages.agent_ref
--    • chat_id  (text) = uid треда (= chat_conversations.id,
--                        он же chat_messages.conversation_id)
--    • reply_to (uuid) = ссылка на id ВОПРОСА; проставляется агентом
--                        НА СТРОКЕ-ОТВЕТЕ — наличие ответа с
--                        reply_to=<id вопроса> и есть сигнал «ответ готов»
--    • role            = 'user' (вопрос от AW) | 'assistant' (ответ агента) | 'tool'
--    • metadata        = JSONB: у вопроса ключи {mode, kb}; у ответа ключ
--                        {thinking} — все рассуждения агента
--    • buttons         = JSONB: массив [{action_id, label, params}]
--    • media           = JSONB: [{file_id, filename, mime_type, file_size}]
--    • status          = pending | in_progress | completed | error
--    На ПРОМ-таблице владельца есть CHECK по status (полный список значений
--    у владельца; наблюдаемо разрешены 'pending'/'completed', ЗАПРЕЩЁН
--    'timeout') — записи статуса со стороны AW best-effort. DEFAULT'ов нет —
--    created_at/updated_at/status обе стороны передают явно.
--
--  ВАЖНО — поток данных:
--    1. AW INSERT'ит строку-вопрос (role='user', status='pending').
--    2. Агент UPDATE SET status='in_progress' на строке-вопросе (опционально).
--    3. Агент INSERT'ит строку-ответа (role='assistant', новый id,
--       reply_to=<id вопроса>, content, metadata.thinking,
--       опц. buttons/media, status='completed').
--    4. Агент UPDATE строки-вопроса: SET status='completed'.
--    5. AW поллит строку-ответ по reply_to=<id вопроса> (role='assistant')
--       и рисует ответ + рассуждения.
--    Таймаут 10 минут — AW сам закрывает зависший draft в chat_messages;
--    запись 'timeout' в шину best-effort (CHECK владельца может отклонить).
--    Шаги 3+4 можно объединить в одну транзакцию.
--
--  ВАЖНО — GP-ограничения (Greenplum 6.x = PostgreSQL 9.4):
--    БЕЗ ON CONFLICT DO UPDATE, БЕЗ gen_random_uuid(), БЕЗ jsonb_set,
--    БЕЗ CREATE INDEX IF NOT EXISTS. UUID генерируем через
--    md5(random()::text || clock_timestamp()::text)::uuid
--    (32 hex-символа без дефисов — валидный ввод для типа uuid).
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- 0. ПОДГОТОВКА: посмотреть свежие вопросы от AW (ещё не обработаны)
-- ────────────────────────────────────────────────────────────────────────────

-- Активные вопросы, ждущие ответа от агента.
-- ┌────────────────────────────────────────────────────────────────────────┐
-- │ СКОПИРУЙ значение колонки `id` строки с role='user'.                     │
-- │ Именно его нужно подставить в <QUESTION_ID> ниже во всех сценариях 1–5.  │
-- │ Это uid сообщения-вопроса (его же хранит chat_messages.agent_ref).       │
-- └────────────────────────────────────────────────────────────────────────┘
SELECT id,   -- ← ЭТО копируем в <QUESTION_ID>
       chat_id, user_id,
       content, metadata, status, created_at
FROM chat_agent_messages_bus
WHERE role = 'user'
  AND status = 'pending'
ORDER BY created_at DESC
LIMIT 20;

-- СТАДИИ status на строке-вопросе:
--   pending     — вопрос вставлен AW, агент ещё не взял.
--   in_progress — агент взял (UPDATE после SELECT FOR UPDATE или просто UPDATE).
--   completed   — агент вставил ответ (reply_to=<id вопроса> НА ОТВЕТЕ) и закрыл вопрос.
--   error       — агент зафиксировал ошибку.
--   (timeout AW пишет best-effort — CHECK владельца на ПРОМе его отклоняет,
--    тогда строка остаётся в pending; слот лимита освобождает отсечка по возрасту).
--
-- Для наблюдения «всё, что в работе»:
SELECT id, chat_id, content, status, created_at
FROM chat_agent_messages_bus
WHERE role = 'user'
  AND status IN ('pending', 'in_progress')
ORDER BY created_at DESC
LIMIT 20;

-- Полная строка одного вопроса (metadata содержит mode и kb):
SELECT id, chat_id, user_id, content, metadata, status, created_at
FROM chat_agent_messages_bus
WHERE id = '<QUESTION_ID>';


-- ────────────────────────────────────────────────────────────────────────────
-- 1. СЦЕНАРИЙ "успешный ответ агента" (нормальный поток)
-- ────────────────────────────────────────────────────────────────────────────
--
-- Единый самодостаточный блок. Замени ТОЛЬКО <QUESTION_ID>
-- (значение id строки-вопроса из запроса 0). Всё остальное —
-- id строки-ответа, chat_id, user_id — вычисляется автоматически
-- и связывается внутри блока.
--
-- PL/pgSQL DO-блок работает и в PostgreSQL, и в Greenplum 6.x.

DO $$
DECLARE
    q_id    uuid := '<QUESTION_ID>';                                       -- ← подставь сюда
    a_id    uuid := md5(random()::text || clock_timestamp()::text)::uuid;  -- id ответа (авто)
    v_chat  text;
    v_user  text;
BEGIN
    -- Берём chat_id/user_id из строки-вопроса по её id:
    SELECT chat_id, user_id INTO v_chat, v_user
    FROM chat_agent_messages_bus
    WHERE id = q_id;

    -- Строка-ответ ассистента (reply_to = id ВОПРОСА — на ответе):
    INSERT INTO chat_agent_messages_bus
        (id, chat_id, user_id, role,
         content, metadata, reply_to, status, created_at, updated_at)
    VALUES (a_id, v_chat, v_user, 'assistant',
            'КСО — корпоративная социальная ответственность. По регламенту 2024 года...',
            '{"thinking": "Понимаю вопрос про КСО. Нашёл 3 релевантных документа, формирую ответ."}'::jsonb,
            q_id, 'completed', now(), now());

    -- Закрываем строку-вопрос:
    UPDATE chat_agent_messages_bus
    SET status     = 'completed',
        updated_at = now()
    WHERE id = q_id;
END$$;

-- После блока: AW найдёт строку-ответ по reply_to = id вопроса
-- и отрендерит content + metadata.thinking.


-- ────────────────────────────────────────────────────────────────────────────
-- 2. СЦЕНАРИЙ "ответ с кнопками"
-- ────────────────────────────────────────────────────────────────────────────
--
-- buttons — массив [{action_id, label, params}]. Сейчас поддерживается
-- action_id 'acts.open_act_page' (открывает страницу акта по km_number).
-- Кнопки рендерятся под текстом ответа как интерактивные элементы.
--
-- Замени ТОЛЬКО <QUESTION_ID> (id строки-вопроса из запроса 0).

DO $$
DECLARE
    q_id    uuid := '<QUESTION_ID>';                                       -- ← подставь сюда
    a_id    uuid := md5(random()::text || clock_timestamp()::text)::uuid;  -- id ответа (авто)
    v_chat  text;
    v_user  text;
BEGIN
    SELECT chat_id, user_id INTO v_chat, v_user
    FROM chat_agent_messages_bus
    WHERE id = q_id;

    INSERT INTO chat_agent_messages_bus
        (id, chat_id, user_id, role,
         content, metadata, buttons, reply_to, status, created_at, updated_at)
    VALUES (a_id, v_chat, v_user, 'assistant',
            'Найдены 2 связанных акта:',
            '{"thinking": "Нашёл акты, формирую кнопки для навигации."}'::jsonb,
            '[{"action_id":"acts.open_act_page","label":"Открыть 11-11111","params":{"km_number":"11-11111"}},{"action_id":"acts.open_act_page","label":"Открыть 22-22222","params":{"km_number":"22-22222"}}]'::jsonb,
            q_id, 'completed', now(), now());

    UPDATE chat_agent_messages_bus
    SET status     = 'completed',
        updated_at = now()
    WHERE id = q_id;
END$$;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. СЦЕНАРИЙ "ответ с файлом/медиа"
-- ────────────────────────────────────────────────────────────────────────────
--
-- media — массив [{file_id, filename, mime_type, file_size}].
-- file_id ДОЛЖЕН указывать на реально существующую строку в chat_files
-- (с корректным conversation_id = chat_id треда), иначе
-- GET /api/v1/chat/files/{file_id} вернёт 404. AW определяет превью по mime_type:
--   image/* — встроенное изображение; остальные — иконка + кнопка «Скачать».
--
-- Замени ТОЛЬКО <QUESTION_ID> (id строки-вопроса из запроса 0).
-- Блок сам заливает реально скачиваемый TXT-файл в chat_files и связывает его
-- с ответом через media.

DO $$
DECLARE
    q_id     uuid := '<QUESTION_ID>';                                       -- ← подставь сюда
    a_id     uuid := md5(random()::text || clock_timestamp()::text)::uuid;  -- id ответа (авто)
    f_id     text := md5(random()::text || clock_timestamp()::text);        -- file_id (авто)
    f_name   text := 'отчёт.txt';
    f_mime   text := 'text/plain; charset=utf-8';
    f_body   bytea := convert_to(
                  'Сводный отчёт по КМ-12-32141.' || E'\n' ||
                  'Документ сформирован агентом базы знаний.', 'UTF8');
    v_chat   text;
    v_user   text;
BEGIN
    SELECT chat_id, user_id INTO v_chat, v_user
    FROM chat_agent_messages_bus
    WHERE id = q_id;

    -- Файл в chat_files (conversation_id в chat_files = chat_id треда;
    -- message_id NULL: у ответа агента ещё нет id chat-сообщения):
    INSERT INTO t_db_oarb_audit_act_chat_files
        (id, conversation_id, message_id, filename,
         mime_type, file_size, file_data, created_at)
    VALUES (f_id, v_chat, NULL, f_name, f_mime,
            octet_length(f_body), f_body, now());

    -- Строка-ответ с media, ссылающимся на свежий file_id:
    INSERT INTO chat_agent_messages_bus
        (id, chat_id, user_id, role,
         content, media, reply_to, status, created_at, updated_at)
    VALUES (a_id, v_chat, v_user, 'assistant',
            'Сформировал отчёт, прикладываю файл:',
            jsonb_build_array(
                jsonb_build_object(
                    'file_id',   f_id,
                    'filename',  f_name,
                    'mime_type', f_mime,
                    'file_size', octet_length(f_body)
                )
            ),
            q_id, 'completed', now(), now());

    UPDATE chat_agent_messages_bus
    SET status     = 'completed',
        updated_at = now()
    WHERE id = q_id;
END$$;

-- Другие типы файлов — замени f_mime/f_name и f_body на decode(...):
-- PDF:  f_body := decode('255044462D312E340A25E2E3CFD30A', 'hex'); -- "%PDF-1.4\n%...\n"
-- XLSX: f_body := decode('504B0304140000000000', 'hex');          -- "PK\x03\x04..." (ZIP)
-- (сигнатуры достаточно для иконки и скачивания; для открытия нужен полный файл).


-- ────────────────────────────────────────────────────────────────────────────
-- 4. СЦЕНАРИЙ "ошибка" (агент не смог получить ответ)
-- ────────────────────────────────────────────────────────────────────────────
--
-- Можно вставить строку-ответ со status='error' и текстом ошибки, либо просто
-- закрыть вопрос со status='error' без ответа — AW в обоих случаях покажет
-- error-блок (во втором — стандартный текст «Внешний агент вернул ошибку»).
-- Замени ТОЛЬКО <QUESTION_ID> (id строки-вопроса из запроса 0).

-- Вариант А — только закрыть вопрос (AW покажет стандартное сообщение об ошибке):
UPDATE chat_agent_messages_bus
SET status     = 'error',
    updated_at = now()
WHERE id = '<QUESTION_ID>';

-- Вариант Б — вставить строку-ответ со status='error' и текстом ошибки:
DO $$
DECLARE
    q_id    uuid := '<QUESTION_ID>';                                       -- ← подставь сюда
    a_id    uuid := md5(random()::text || clock_timestamp()::text)::uuid;  -- id ответа (авто)
    v_chat  text;
    v_user  text;
BEGIN
    SELECT chat_id, user_id INTO v_chat, v_user
    FROM chat_agent_messages_bus
    WHERE id = q_id;

    INSERT INTO chat_agent_messages_bus
        (id, chat_id, user_id, role,
         content, reply_to, status, created_at, updated_at)
    VALUES (a_id, v_chat, v_user, 'assistant',
            'Не удалось получить ответ: база знаний acts_default недоступна. Попробуйте позже.',
            q_id, 'error', now(), now());

    UPDATE chat_agent_messages_bus
    SET status     = 'error',
        updated_at = now()
    WHERE id = q_id;
END$$;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. СЦЕНАРИЙ "агент думает" (промежуточный статус)
-- ────────────────────────────────────────────────────────────────────────────
--
-- Если хочется увидеть индикатор «думает...» в UI — просто поставь in_progress.
-- AW показывает typing-индикатор, пока нет строки-ответа (role='assistant'
-- с reply_to = id вопроса) с терминальным статусом.
-- Замени ТОЛЬКО <QUESTION_ID> (id строки-вопроса из запроса 0).

UPDATE chat_agent_messages_bus
SET status     = 'in_progress',
    updated_at = now()
WHERE id = '<QUESTION_ID>'
  AND status = 'pending';

-- Затем в любой момент завершить через сценарии 1, 2, 3 или 4.


-- ────────────────────────────────────────────────────────────────────────────
-- 6. ДИАГНОСТИКА
-- ────────────────────────────────────────────────────────────────────────────

-- Счётчики по role + status:
SELECT role, status, COUNT(*)
FROM chat_agent_messages_bus
GROUP BY role, status
ORDER BY role, status;

-- Самые старые pending (потенциально зависшие):
SELECT id, chat_id, user_id, content,
       now() - created_at AS age,
       created_at
FROM chat_agent_messages_bus
WHERE role = 'user'
  AND status IN ('pending', 'in_progress')
ORDER BY created_at ASC
LIMIT 20;

-- Полная пара вопрос–ответ по id вопроса (<QUESTION_ID>):
-- (ответ ищется по reply_to НА ОТВЕТЕ — он ссылается на id вопроса)
SELECT am.id, am.role, am.status, am.reply_to,
       am.content,
       am.metadata,
       am.buttons,
       am.media,
       am.created_at
FROM chat_agent_messages_bus am
WHERE am.id = '<QUESTION_ID>'
   OR am.reply_to = '<QUESTION_ID>'
ORDER BY am.created_at;

-- Все сообщения одного треда (chat_id):
SELECT id, role, status, reply_to,
       content, created_at
FROM chat_agent_messages_bus
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
-- Удаляем только завершённые строки: completed / error / timeout.
-- pending и in_progress НЕ ТРОГАТЬ — это активные диалоги.
-- Видимая пользователю история чата живёт в chat_messages и НЕ затрагивается.
--
-- Рекомендуемые сроки хранения:
--   completed / error / timeout  — 180 дней
-- Подстройте под свои аудит-требования.

DELETE FROM chat_agent_messages_bus
WHERE status IN ('completed', 'complete', 'error', 'timeout')
  AND updated_at < now() - INTERVAL '180 days';

-- На Greenplum после массивных DELETE'ов полезен VACUUM ANALYZE
-- (PG обычно справляется автовакуумом, но не помешает):
-- VACUUM ANALYZE chat_agent_messages_bus;

-- Зависшие in_progress/pending дольше 2 часов — ручное закрытие:
-- (AW закрывает draft в chat_messages сам через 10 мин; статус в шине он пишет
-- best-effort, и на ПРОМе CHECK владельца отклоняет 'timeout' — тогда строки
-- остаются в pending. Если CHECK не пропускает 'timeout' — ставь 'error'.)
UPDATE chat_agent_messages_bus
SET status     = 'timeout',
    updated_at = now()
WHERE role = 'user'
  AND status IN ('pending', 'in_progress')
  AND created_at < now() - INTERVAL '2 hours';
