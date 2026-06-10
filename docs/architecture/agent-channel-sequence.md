# Forward к внешнему ИИ-агенту — sequence-диаграмма

Документ описывает полный путь от пользовательского сообщения до ответа
внешнего ИИ-агента через единую bus-таблицу `chat_agent_messages_bus`. Транспорт —
**poll-only, без SSE**: POST на отправку сообщения отдаёт `message_id`, а фронт
затем поллит готовность ответа GET-запросом до терминального статуса и рендерит
ответ целиком с декоративным «эффектом печати» (token-стриминга нет).

См. также:
- [`docs/guides/developer-guide.md §7.8`](../guides/developer-guide.md#78-внешний-ии-агент-через-таблицы-бд) — внешний ИИ-агент через таблицы БД (обзор)
- [`docs/integrations/external-agent-imitation.sql`](../integrations/external-agent-imitation.sql) — SQL-стенд имитации внешнего агента
- [`docs/architecture/chat-frontend-architecture.md`](chat-frontend-architecture.md) — frontend-клиент чата

---

## 0. Модель данных и режимы

**Bus-таблица `chat_agent_messages_bus`** (структуру задаёт и таблицей владеет
сторона внешнего агента; отдельной колонки `conversation_id` нет):
`id` UUID — uid одного сообщения шины, `chat_id` TEXT — uid треда, `user_id` TEXT,
`role` (`user`/`assistant`/`tool`), `content` TEXT NOT NULL, `media` JSONB,
`metadata` JSONB, `reply_to` UUID — **на строке-ответе**, ссылается на id вопроса,
`buttons` JSONB, `status` (`pending`/`in_progress`/`completed`/`error`; на
ПРОМ-таблице CHECK владельца с неизвестным полным списком — записи статуса от AW
best-effort), `created_at`/`updated_at` TIMESTAMPTZ NOT NULL (DEFAULT'ов нет).
GP-имитация: без PK, `DISTRIBUTED BY (chat_id)`. Роль `tool` разрешена
протоколом, но приложением пока не обрабатывается.

**Связь с чатом**: `chat_messages.agent_ref VARCHAR(36)` — ссылка из
ассистент-сообщения (draft) на `id` строки-вопроса в шине.

**Режимы тумблера «База знаний ОАРБ»** (form-параметр `agent_mode`, localStorage
ключ `assistant_oarb_mode`, 3 позиции):

| Позиция UI | `agent_mode` | Поведение POST /messages |
|---|---|---|
| Выключен | `off` | Локальная LLM/GigaChat синхронно через `orchestrator.run(...)` |
| Адаптивный | `adaptive` | Оркестратор с forward-tool в наборе — сам решает, форвардить ли |
| Всегда | `always` | Прямой проброс вопроса в bus, оркестратор не запускается |

Две другие БЗ («источников», «инструментов») в UI выключены.

---

## 1. Режим «Всегда» (`always`): прямой проброс в агента

```mermaid
sequenceDiagram
    autonumber
    actor U as User (browser)
    participant F as Frontend<br/>(chat-stream.js)
    participant API as POST /messages<br/>(api/messages.py)
    participant CS as AgentChannelService<br/>(agent_channel.py)
    participant DB as БД<br/>(chat_agent_messages_bus + chat_messages)
    participant POLL as AgentChannelPoller<br/>(одна задача на процесс)
    participant EXT as Внешний ИИ-агент<br/>(другой процесс)

    U->>F: «расскажи про X» (agent_mode=always)
    F->>API: POST /messages (FormData)
    API->>CS: submit(conversation_id, user_id,<br/>assistant_message_id, text, mode='always', media)
    CS->>DB: INSERT chat_agent_messages_bus<br/>(role='user', status='pending') → question_uid
    CS->>DB: create_streaming chat_messages<br/>(status='streaming', agent_ref=question_uid)
    CS-->>API: question_uid
    API->>POLL: subscribe(assistant_message_id, question_uid)
    API-->>F: 200 {"message_id": assistant_message_id}

    par фронт поллит готовность
        loop пока status == 'streaming'
            F->>API: GET /messages/{message_id}
            API->>DB: SELECT chat_messages
            DB-->>API: {id, status, content}
            API-->>F: {id, status, content}
        end
        Note over F: при status='complete'/'failed'<br/>рендер ответа целиком + «эффект печати»
    and внешний агент
        EXT->>DB: UPDATE chat_agent_messages_bus вопроса<br/>status='in_progress'
        EXT->>DB: INSERT chat_agent_messages_bus ответа<br/>(role='assistant', reply_to=question_uid,<br/>status='completed') + UPDATE вопроса status='completed'
    and поллер шины
        loop adaptive backoff (без удержания conn в sleep)
            POLL->>CS: try_finalize(assistant_message_id, question_uid)
            CS->>DB: SELECT вопрос по question_uid
            alt строки-ответа ещё нет
                CS-->>POLL: 'pending'
            else агент ответил
                CS->>DB: SELECT ответ WHERE reply_to=question_uid<br/>AND role='assistant'
                alt answer.status == 'error'
                    CS->>DB: mark_failed (error-блок)
                else
                    CS->>DB: finalize chat_messages<br/>(status='complete', map_answer_to_blocks)
                end
                CS-->>POLL: терминальный статус → unsubscribe
            end
        end
    end
```

**Ключевые контракты:**

- **Поллер — единственный writer** в `chat_messages` для draft'а: `create_streaming`
  на старте, `finalize`/`mark_failed` по результату `try_finalize`. Фронт лишь
  опрашивает готовность.
- **Таймаут**: при превышении `ANSWER_TIMEOUT_SEC` (600) поллер вызывает
  `mark_timeout` → draft → `failed` с error-блоком (`build_timeout_error_block`);
  запись `status='timeout'` в шину best-effort (CHECK владельца может отклонить —
  тогда строка остаётся `pending`, слот лимита освобождает отсечка по возрасту
  в `count_active_for_user`).
- **Reconcile после рестарта**: поллер при старте поднимает подписки из
  streaming-черновиков `chat_messages` (`get_streaming_drafts`).

---

## 2. Режим «Адаптивный» (`adaptive`): оркестратор решает сам

```mermaid
sequenceDiagram
    autonumber
    actor U as User (browser)
    participant F as Frontend
    participant API as POST /messages<br/>(api/messages.py)
    participant ORCH as Orchestrator<br/>(orchestrator.run)
    participant FT as forward-tool<br/>(forward_tool_factory.py)
    participant CS as AgentChannelService
    participant DB as БД
    participant POLL as AgentChannelPoller

    U->>F: вопрос (agent_mode=adaptive)
    F->>API: POST /messages (FormData)
    API->>ORCH: run(message_id, agent_mode='adaptive', ...)
    Note over ORCH: forward-tool в наборе.<br/>LLM сама решает, форвардить ли.
    alt LLM отвечает локально
        ORCH->>DB: сохранить ответ chat_messages<br/>(status='complete')
    else LLM зовёт forward-tool
        ORCH->>FT: tool_call
        FT->>CS: submit(mode='adaptive', ...)
        CS->>DB: INSERT вопрос (pending)<br/>+ create_streaming draft (status='streaming')
        Note over POLL: поллер подхватит draft и<br/>финализирует через try_finalize<br/>(см. диаграмму §1)
    end
    API-->>F: 200 {"message_id": assistant_message_id}
    loop пока status == 'streaming'
        F->>API: GET /messages/{message_id}
        API-->>F: {id, status, content}
    end
```

Режим `off` идентичен `adaptive` по транспорту, но forward-tool в наборе нет:
оркестратор всегда отвечает локально, draft сразу сохраняется со
`status='complete'`.

---

## 3. Маппинг ответа агента в блоки сообщения

`AgentChannelService.map_answer_to_blocks(row)` собирает список блоков из
строки-ответа в порядке:

1. **reasoning** — из `metadata.thinking` (если есть);
2. **text** — `content` (обрезается до `MAX_BLOCK_TEXT_SIZE` = 262144);
3. **buttons** — из `buttons` JSONB, `block_id` шаблоном `{id}:btn:0`;
   `button_translator.translate_buttons` переводит `action_id` ChatTool в
   client-action `open_url`;
4. **media** — `image`/`file` из `media` JSONB;
5. **error** — если `answer.status == 'error'`.

---

## 4. Лимит одновременных запросов

`AgentMessageRepository.count_active_for_user` вызывается **до** записи в БД.
Если активных запросов пользователя `>= max_parallel_streams_per_user`
(`CHAT__MAX_PARALLEL_STREAMS_PER_USER`, default 3) — бросается `ChatLimitError`
→ HTTP 422 с дружелюбным сообщением, ни вопрос, ни draft не создаются.
Счёт идёт с отсечкой по возрасту (`created_after = now − ANSWER_TIMEOUT_SEC`):
вопрос, которому не удалось записать терминальный статус (CHECK владельца шины),
не занимает слот навсегда.

---

## 5. Граничные случаи

| Случай | Что произойдёт |
|---|---|
| Поллер ещё не дошёл до `try_finalize`, агент уже ответил | GET вернёт `status='streaming'` (draft не финализирован); следующий тик поллера выполнит `finalize`, фронт увидит `complete` на очередном опросе |
| Строка-ответ есть, но статус нетерминальный (`pending`/`in_progress`) | `try_finalize` возвращает `'pending'` — агент ещё пишет |
| Ответ агента со `status='error'` | `try_finalize` → `mark_failed` с error-блоком из ответа + best-effort закрывает вопрос (`status='error'`), фронт показывает крестик |
| Агент закрыл вопрос `status='error'` без строки-ответа | `try_finalize` → `mark_failed` со стандартным текстом «Внешний агент вернул ошибку» |
| Агент вставил ответ, но не закрыл вопрос терминальным `status` | `try_finalize` сам закрывает вопрос (`status='completed'`, best-effort) после финализации |
| CHECK владельца отклонил наш статус (`CheckViolationError`) | `_set_status_safe` глотает с warning'ом — финализация/таймаут не ломаются, поллер не зацикливается |
| Превышен `ANSWER_TIMEOUT_SEC` | `mark_timeout`: draft → `failed` (error-блок таймаута), запись `timeout` в шину best-effort |
| Поллер не инициализирован (lifespan-сбой) | Форвард **не выполняется**: вопрос в шину не пишется, draft не создаётся, сразу финализируется error-сообщение (`agent_unavailable`). Беседа остаётся удаляемой |
| Рестарт uvicorn посреди ожидания | Поллер при старте поднимает подписки из streaming-черновиков `chat_messages` и продолжает опрос; draft остаётся виден в истории как `streaming` |
| Пользователь отправил N форвардов параллельно | Каждый получает свой `message_id`/вопрос; при `>= max_parallel_streams_per_user` активных — `ChatLimitError` (422) до записей |

---

## 6. Где смотреть в коде

- POST/GET messages — `app/domains/chat/api/messages.py` (`send_message`, `get_message`)
- AgentChannelService — `app/domains/chat/services/agent_channel.py`
  (`submit`, `try_finalize`, `mark_timeout`, `map_answer_to_blocks`, `build_timeout_error_block`)
- AgentChannelPoller — `app/domains/chat/services/agent_channel_poller.py`
  (`subscribe`/`unsubscribe`/`_tick`/`_run` adaptive-backoff, reconcile из streaming-черновиков, `start`/`stop`/`get_status`)
- button_translator — `app/domains/chat/services/button_translator.py` (`translate_buttons`)
- forward-tool (adaptive) — `app/domains/chat/services/forward_tool_factory.py`
- bus-репозиторий — `app/domains/chat/repositories/agent_message_repository.py` (`count_active_for_user`, `get_by_uid`, `get_answer_for_question`)
- chat_messages streaming-методы — `app/domains/chat/repositories/message_repository.py`
  (`create_streaming`/`finalize`/`mark_failed`/`get_streaming_drafts`)
- настройки — `AgentChannelSettings` (`app/domains/chat/settings.py`),
  env-префикс `CHAT__AGENT_CHANNEL__`: `TABLE_NAME=chat_agent_messages_bus`,
  `POLL_MIN_INTERVAL_SEC=2.0`, `POLL_MAX_INTERVAL_SEC=10.0`,
  `POLL_BACKOFF_MULTIPLIER=1.5`, `ANSWER_TIMEOUT_SEC=600`, `MAX_BLOCK_TEXT_SIZE=262144`
- фоновый хук — `chat.agent_channel_poller`
- Frontend — `static/js/shared/chat/chat-stream.js`, `chat-messages.js`
