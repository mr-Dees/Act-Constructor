# Наблюдаемость чата и обратная связь (лайк/дизлайк)

> Как устроены сбор обратной связи и наблюдаемость чата, и **как анализировать процесс общения пользователя с ИИ-ассистентом** — включая различение small-talk, вопросов не из базы знаний (БЗ) и форвардов во внешнего БЗ-агента.
> Дополняет developer-guide §7 (AI-ассистент) и §11 (Chat deep-dive).

## 1. Источники данных

Общение с ассистентом наблюдаемо через пять журналов (схема — `app/domains/chat/migrations/{postgresql,greenplum}/schema.sql`). Ниже `<prefix>` = `DATABASE__TABLE_PREFIX` (по умолчанию `t_db_oarb_audit_act_`).

| Таблица | Что хранит | Ключевые поля |
|---|---|---|
| `<prefix>chat_messages` | сырьё диалога: вопрос (`role='user'`) и ответ (`role='assistant'`) блоками JSONB | `id`, `conversation_id`, `role`, `content`, `model`, `token_usage`, `status` (streaming/complete/failed), `agent_ref`, `created_at` |
| `<prefix>chat_message_feedback` | **оценки лайк/дизлайк** | `(message_id, user_id)` PK, `rating` (up/down), `reasons` JSONB, `comment`, `source`, `route_type`, `agent_mode`, `model`, `created_at`, `updated_at` |
| `<prefix>chat_audit_log` | lifecycle-события | `username`, `action` (`message_sent`/`feedback_submitted`/…), `conversation_id`, `details_json`, `created_at` |
| `<prefix>chat_tool_metrics` | latency/ошибки вызовов ChatTool | `tool_name`, `status` (success/error/validation_error), `latency_ms`, `username`, `conversation_id`, `error_message` |
| `<bus>` (`CHAT__AGENT_CHANNEL__TABLE_NAME`) | обмен с внешним БЗ-агентом | `conversation_id` (=uid вопроса), `chat_id` (=тред), `role`, `content`, `metadata`, `status` (pending/in_progress/complete/error/timeout), `created_at`, `updated_at` |

**Связи для анализа:**
- Ответ ассистента → его оценки: `chat_message_feedback.message_id = chat_messages.id`.
- Ответ-форвард → обмен с агентом: `chat_messages.agent_ref` = `<bus>.conversation_id` (uid вопроса в шине).
- Все журналы режут по `conversation_id` (беседа) и `username`/`user_id` (пользователь).

## 2. Обратная связь: как работает

- **Где:** ряд действий под каждым завершённым ответом ассистента — «Копировать» · 👍 · 👎 (`static/js/shared/chat/chat-feedback.js`).
- **Лайк** — мгновенно, одним кликом. **Дизлайк** — мгновенно фиксирует оценку и раскрывает опциональную форму: категории причин + свободный комментарий (оба необязательны).
- **Идемпотентность:** одна активная оценка на пару `(message_id, user_id)` (составной PK). Повторный клик по активной кнопке — снятие оценки (`DELETE`); клик по противоположной — смена. На фронте — оптимистичный UI с откатом при ошибке.
- **Восстановление:** при загрузке истории `GET …/messages` отдаёт поле `feedback` (оценка текущего пользователя), и кнопки восстанавливают состояние.
- **Снимок маршрута:** при сохранении оценки бэкенд вычисляет `route_type` из сообщения и сохраняет вместе с `agent_mode` (позиция тумблера «База знаний ОАРБ») и `model` — для сегментации аналитики.
- **Аудит:** факт оценки пишется в `chat_audit_log` (`feedback_submitted`/`feedback_cleared`, best-effort, без текста комментария — PII).

### API обратной связи (для пользователя)
- `PUT /api/v1/chat/conversations/{cid}/messages/{mid}/feedback` — тело `{rating: "up"|"down", reasons?: [код], comment?: str, agent_mode?: str}`.
- `DELETE /api/v1/chat/conversations/{cid}/messages/{mid}/feedback` — снять оценку.

Коды причин дизлайка (словарь — `FEEDBACK_REASON_CODES` в `chat_feedback_service.py`, дублируется на фронте):
`inaccurate` (неточно/ошибка), `not_relevant` (не по теме), `incomplete` (неполно), `not_from_kb` (выдумано/не из БЗ), `formatting` (оформление), `unsafe` (некорректно/небезопасно), `other` (другое).

## 3. Различение типа ответа: small-talk / не-БЗ / БЗ-агент

Ключевой вопрос анализа: вопрос ушёл во внешнего БЗ-агента (через шину) или ассистент ответил локально (болталка / вопрос не про БЗ)? Маршрут восстанавливается из сохранённого сообщения **без изменения оркестратора** классификатором `app/domains/chat/services/route_classifier.py`:

| route_type | Признак | Смысл |
|---|---|---|
| `kb_agent` | `agent_ref IS NOT NULL` | ответ форвернут во внешнего БЗ-агента через шину |
| `non_kb_llm` | в `content` есть блок `client_action` или `buttons` | локальная LLM вызвала action-tool (навигация/команда интерфейса) |
| `smalltalk` | только текст/reasoning | локальный текстовый ответ: болталка **или** вопрос не про БЗ, на который LLM ответила без tool'ов |
| `unknown` | не assistant-сообщение | — |

`outcome`: `error`, если `status='failed'` или в `content` есть блок `error`; иначе `ok`.

**Ограничение эвристики:** `smalltalk` и «вопрос не про БЗ без tool-вызова» по сохранённым данным неотличимы (оба — текстовый блок). Для точного разделения интента нужен персист маршрута/интента в оркестраторе (см. «Будущие улучшения»). `agent_mode` (off/adaptive/always) **не** хранится на каждом сообщении — он снимается только на строке оценки; для несоценённых сообщений режим тумблера из БД невосстановим.

## 4. Витрина анализа (admin API)

Защищены `require_admin()`, размещены в chat-домене. Только чтение.

- **`GET /api/v1/chat/admin/feedback/stats`** `?route_type&agent_mode&from&to`
  → `{total, up, down, like_rate, by_route, by_model, by_reason}`.
- **`GET /api/v1/chat/admin/feedback`** `?rating&route_type&agent_mode&from&to&limit&offset`
  → список оценок с предпросмотром текста ответа (`answer_text`), причинами и комментарием. По умолчанию полезно фильтровать `rating=down` — самый actionable-сигнал.
- **`GET /api/v1/chat/admin/conversations/{cid}/inspect`**
  → полный диалог: каждое сообщение с `content` (что спрашивали/получали, включая error-блоки → «почему ошибка»), для ответов — `route_type`/`outcome`/`token_usage`/`model` и `feedback` всех пользователей.

## 5. Готовые SQL-запросы

> Замените `<prefix>` на `DATABASE__TABLE_PREFIX`. На Greenplum таблицы квалифицируются схемой (`<schema>.<prefix>…`).

**Доля положительных оценок (helpfulness / like rate):**
```sql
SELECT COUNT(*) FILTER (WHERE rating='up')                                    AS up,
       COUNT(*) FILTER (WHERE rating='down')                                  AS down,
       ROUND(COUNT(*) FILTER (WHERE rating='up')::numeric
             / NULLIF(COUNT(*),0), 3)                                         AS like_rate
FROM <prefix>chat_message_feedback;
```

**Удовлетворённость по маршруту (БЗ-агент vs болталка/не-БЗ) — главный срез:**
```sql
SELECT route_type,
       COUNT(*) FILTER (WHERE rating='up')   AS up,
       COUNT(*) FILTER (WHERE rating='down') AS down
FROM <prefix>chat_message_feedback
GROUP BY route_type ORDER BY route_type;
```

**Топ причин дизлайка (приоритизация фиксов):**
```sql
SELECT reason, COUNT(*) AS cnt
FROM <prefix>chat_message_feedback,
     jsonb_array_elements_text(reasons) AS reason
WHERE rating='down'
GROUP BY reason ORDER BY cnt DESC;
```
> `jsonb_array_elements_text` доступна в PG 9.4+/GP 6. Если на вашем стенде её нет — admin-API `/feedback/stats` считает причины в приложении.

**Дизлайки с комментариями (качественный сигнал):**
```sql
SELECT f.created_at, f.conversation_id, f.message_id, f.route_type,
       f.reasons, f.comment
FROM <prefix>chat_message_feedback f
WHERE f.rating='down' AND f.comment IS NOT NULL
ORDER BY f.created_at DESC LIMIT 100;
```

**Что спрашивали и что ответили (для конкретного дизлайка):** используйте admin-API инспектор `/admin/conversations/{cid}/inspect` — он отдаёт диалог целиком с derive-маршрутом. Через SQL — сообщения беседы:
```sql
SELECT role, status, created_at, content
FROM <prefix>chat_messages
WHERE conversation_id = $1
ORDER BY created_at;
```

**Ошибки ответов (почему «не получилось»):**
```sql
-- доля failed-ответов
SELECT COUNT(*) FILTER (WHERE status='failed')::numeric / NULLIF(COUNT(*),0) AS fail_rate
FROM <prefix>chat_messages WHERE role='assistant';

-- ошибки/таймауты внешнего БЗ-агента
SELECT status, COUNT(*) FROM <bus> WHERE status IN ('error','timeout') GROUP BY status;

-- ошибки tool'ов
SELECT tool_name, status, COUNT(*), AVG(latency_ms)
FROM <prefix>chat_tool_metrics
WHERE status IN ('error','validation_error')
GROUP BY tool_name, status ORDER BY 3 DESC;
```

**Время ожидания ответа БЗ-агента (волатильный участок):**
```sql
SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (updated_at-created_at))) AS p50_sec,
       PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (updated_at-created_at))) AS p95_sec
FROM <bus> WHERE status='complete';
```
> `PERCENTILE_CONT` есть в PG 9.4+/GP 6. Иначе считайте перцентили на стороне приложения.

## 6. Метрики и интерпретация (best practices)

- **Не оптимизируйте по одному thumbs-up rate** — он измеряет вовлечённость, не качество (довольные молчат, дизлайкают недовольные → selection bias). Главный actionable-сигнал — **дизлайки** и их причины. Комбинируйте с покрытием (доля оценённых ответов) и анализом ошибок.
- **Сегментируйте по `route_type`.** Для БЗ-ответов важна обоснованность (groundedness — оценивается на стороне агента/вручную по сэмплу); для болталки она неприменима. Общий агрегат без сегментации смешивает быструю болталку и медленные БЗ-ответы и вводит в заблуждение.
- **Покрытие фидбэка** обычно мало (<5–10%) — метрики на нём шумны; дополняйте ручным разбором логов диалогов (инспектор) и анализом ошибок/таймаутов.
- **Latency** меряйте перцентилями (p50/p95), не средним; для БЗ-ветки — отдельно время ожидания агента из шины.
- **Срезы:** по `route_type`, `agent_mode`, `model`, причине дизлайка, дате.

## 7. Конвенции реализации (для разработчиков)

- Таблица: PK `(message_id, user_id)`, GP `DISTRIBUTED BY (message_id)` ⊆ PK; без FK на `chat_messages` (оценка переживает удаление беседы, как tool_metrics/audit_log). UPSERT — read-modify-write (на GP нет upsert-синтаксиса). CHECK на `rating`/`source` замаплены в `CHECK_CONSTRAINT_MESSAGES`.
- Surfacing: `MessageResponse.feedback` наполняется только в `GET …/messages` (история), best-effort; poll-эндпоинт одиночного сообщения не обогащается.
- Фронт: запросы через `AppConfig.api.getUrl` (JupyterHub-proxy); фидбэк — UI-элемент, **не** блок сообщения (`KNOWN_BLOCK_TYPES`/`MessageBlock` не трогаются).
- Словарь причин синхронизируется вручную: `FEEDBACK_REASON_CODES` (Python) ↔ `REASONS` (`chat-feedback.js`).

## 8. Будущие улучшения

- **Персист `route_type`/`agent_mode`/`finish_reason` на каждое сообщение** (в оркестраторе) — даст точную сегментацию по всем сообщениям и устранит ограничение эвристики (раздел 3). Требует аккуратной правки LLM-критичного кода (dev-guide §7.1a).
- **Авто-эвалы** (LLM-as-judge, groundedness БЗ-ответов) — поле `source` уже предусматривает `auto`/`llm`.
- **Графический admin-дашборд** (тренды/чарты) поверх готового API.
- **Implicit-сигналы** (copy-rate, regenerate-rate) как `source='auto'`.
- **Ретеншн/партиционирование** журналов (общесистемный вопрос для DBA).
