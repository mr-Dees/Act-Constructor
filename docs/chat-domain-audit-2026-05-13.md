# Аудит домена Чата — 2026-05-13

**Ветка:** `feature/external-agent-bridge`
**Метод:** параллельный аудит 4 агентами: backend, frontend, cross-domain+docs, tests
**Глубина:** глубокий аудит; фокус — безопасность, архитектура, race conditions, качество кода/тестов

---

## 0. Сводный вердикт

| Область | Состояние | Главное |
|---|---|---|
| Backend | 🟡 Хорошо с критическими дырами | Multi-worker race, нетранзакционные записи, утечка стектрейсов |
| Frontend | 🟡 В целом хорошо после hardening | XSS в `_welcomeHtml`, утечки слушателей в `ChatManager`/`ChatFiles` |
| Cross-domain coupling | 🟢 Отлично | Полная изоляция, чистые контракты через `names.py` |
| Документация | 🟡 Нужны уточнения | Расхождение «11 модулей», слабый onboarding для button_translator |
| Тесты | 🔴 Есть критические дыры | 11 race-condition тестов как xfail; нет API e2e; нет frontend-тестов |

**Топ-5 блокеров для прод-релиза:**
1. Race в `agent_bridge_runner._running` при multi-worker (потеря/дублирование ответов)
2. 11 xfail race-condition тестов — обход лимитов конкурентными запросами (BUG #9, #10, #14, #15)
3. `_welcomeHtml` кэшируется/восстанавливается через `innerHTML` без DOMPurify
4. Утечка стектрейсов наружу при exception в `save_assistant_message`
5. Отсутствие транзакции для `create message + touch conversation`

---

## 1. Backend (app/domains/chat, app/core/chat)

### 🔴 Критические

**1.1 Race condition в `agent_bridge_runner._running` registry**
`app/domains/chat/services/agent_bridge_runner.py:26-54`
In-process `_running: dict[str, asyncio.Task]` — не работает между uvicorn-воркерами. БД-уровневая защита через `worker_token` блокирует двойное обновление статуса, но **не предотвращает параллельный polling и попытки сохранить message** в двух процессах.
*Риск:* потеря/дублирование ответов агента в мультипроцессной среде.
*Фикс:* distributed lock (Redis/PG advisory lock) либо явный single-worker в supervisor + проверка в startup.

**1.2 Нетранзакционная связка message + conversation.touch**
`app/domains/chat/services/message_service.py:60-69`, `orchestrator.py:771-775`
`msg_repo.create(...)` и `conv_repo.touch(...)` — два отдельных запроса. При падении второго: сообщение в БД, `updated_at` устарел, `get_history()` может вернуть неверный порядок.
*Фикс:* `async with conn.transaction(): create(); touch()`.

**1.3 Tool-call от LLM: нет валидации required-параметров**
`app/domains/chat/services/orchestrator.py:618-639, 728-749`
`_execute_tool_call()` конвертирует типы через `_convert_param()`, но не проверяет, что все required-поля из `ChatToolParam` присутствуют. LLM может отправить `chat.forward_to_knowledge_agent` без `knowledge_bases` — handler получит `None`.
*Фикс:* добавить проверку required перед вызовом handler'а; кидать `ChatToolValidationError`.

**1.4 Утечка stacktrace при exception в save_assistant_message**
`app/domains/chat/services/orchestrator.py:771-775`, `app/domains/chat/api/messages.py:217-227`
`except: logger.exception(...); raise` — клиент получает сырой HTTP 500 с трейсом (имена переменных, SQL-фрагменты).
*Фикс:* перехватывать в API-handler'е и эмитить нейтральное SSE-`error` (паттерн уже использован для tool-ошибок в коммите d7850e7 — применить и тут).

### 🟡 Серьёзные

**1.5** `download_file` ставит `application/octet-stream` + `X-Content-Type-Options: nosniff`, но **в resume-сценарии** SSE может прислать блок `file` с другим mime_type — фронт может попытаться его открыть. `app/domains/chat/api/files.py:45-68`

**1.6** Polling `agent_response_events`: нет очистки старых строк по завершении request. Для Greenplum (append-only) — деградация производительности; теоретический DoS-вектор через зависшие requests. `app/domains/chat/services/agent_bridge.py:94-150`

**1.7** Возможный UNIQUE-конфликт `agent_responses.request_id` при гонке runner ↔ resume. Не обработан явно — превращается в 500.

**1.8** Нет rate-limit на `POST /messages`. SSE + 10 параллельных соединений = DoS-вектор. `app/domains/chat/api/messages.py:33-228`

**1.9** При version-conflict в `agent_request.update_status()` логируется только `warning` без трассировки причины — отладка race conditions в проде будет болью. `agent_bridge_runner.py:155-170`

### 🟢 Что хорошо

- **Строгий MIME-whitelist без wildcards** (`settings.py:83-97`) — отличная защита от HTML под `text/*`
- **Defense-in-depth авторизация**: проверка в роутере + повторная в `conversation_repo.get_by_id(user_id=...)`
- **Явное удаление children в `delete()`** — обход отсутствия CASCADE в GP
- **Корректный SSE-lifecycle**: `GeneratorExit`/`CancelledError` отправляет финальные события, освобождает ресурсы (`messages.py:163-181`)
- **Optimistic locking версией agent_request** — правильная защита от параллельных раннеров

---

## 2. Frontend (static/js/shared/chat + templates)

### 🔴 Критические

**2.1 XSS через `_welcomeHtml`**
`static/js/shared/chat/chat-messages.js:33, 414`
```js
this._welcomeHtml = welcomeEl.outerHTML;      // несанитизированный кэш
this._messagesContainer.innerHTML = this._welcomeHtml;  // на clearChat()
```
Если шаблон welcome содержит динамику (имя пользователя, домен) — XSS-вектор при `clearChat()`.
*Фикс:* кэшировать как DOM-узел (`cloneNode(true)`), либо `DOMPurify.sanitize(...)` при кэшировании.

**2.2 Inline `onclick` в шаблоне**
`templates/shared/chat_content.html:63`
`onclick="document.getElementById('chatFileInput').click()"` — не XSS сегодня, но запах + блокирует CSP `script-src 'self'`.
*Фикс:* `addEventListener` в `ChatFiles.init()` с сохранением ссылки.

**2.3 Утечка обработчиков в `ChatManager.init()`**
`chat-manager.js:59, 63, 70, 74` — addEventListener без destroy. Повторный `init()` (переключение режимов) множит слушатели.
*Фикс:* добавить `destroy()`, хранить именованные функции/AbortController.

### 🟡 Серьёзные

**2.4** `ChatFiles._initDragAndDrop()` — анонимные стрелочные функции; `destroy()` не может их снять (`chat-files.js:117, 141-178`)
**2.5** Гонка двойного клика на send: `isProcessing()`-проверка и установка флага не атомарны. `chat-manager.js:86-97`
**2.6** SSE reader при разрыве: `controller.abort()` не гарантирует немедленное закрытие `reader`. `chat-stream.js:74, 161`
**2.7** `_formatDate(conv.updated_at)` без валидности даты — UX-баг при кривом payload, не XSS. `chat-history.js:246-256`
**2.8** `ChatClientActionsRegistry.window[method]`-вызов опирается на whitelist (`ALLOWED_SDK_METHODS` пуст) — безопасно сейчас, но защита держится на code review при расширении. `chat-client-actions.js:156-166`

### 🟢 Что хорошо

- **DOMPurify через `_safeSetHtml()` для markdown/code** — правильный паттерн в `chat-renderer.js`
- **Идемпотентность client_action через sessionStorage по block_id** (`chat-client-actions.js:16-18, 72-92`) — корректное закрытие redirect-цикла
- **Event-driven decoupling** через `ChatEventBus` — модули заменяемы, тестируемы
- **URL-whitelist для `open_url` (http/https/mailto)** — defense-in-depth с бэком
- **Корректный SSE-парсинг триплетов и block_complete** — нет фантомных text-контейнеров

---

## 3. Cross-domain coupling и контракты

### 🟢 Что хорошо

- **Нет импортов** из `app.domains.chat` в другие домены и обратно. Связи только через `app.core.chat.names`/`tools` и `app.core.navigation`.
- **Реестр tools (`app/core/chat/tools.py:100-115`)**: detect-and-fail на дубликаты, фасеты `get_all/get_tool/get_tools_by_domain` — чисто.
- **Action-tools правильно изолированы по доменам** (`acts.open_act_page` в `app/domains/acts/integrations/chat_tools.py`, и т.п.).
- **SSE-маршрутизация типов блоков** консистентна между `streaming.py` и `chat-client-actions.js`.

### 🟡 Расхождения и слабые места

**3.1 Документация: «11 модулей» — неточно**
`CLAUDE.md:81` перечисляет 11, но `static/js/constructor/header/chat-popup.js` (`ChatPopupManager`) — 12-й, и не описан как региональный. `developer-guide.md:660` уже упоминает 12.

**3.2 button_translator плохо находится по navigation документации**
`developer-guide.md §7.8a` детально, но `§7.6 «добавление нового tool»` не ссылается на §7.8a. Новый разработчик обнаружит механизм только наткнувшись.

**3.3 `names.py` упомянут в CLAUDE.md, но полный список констант — нигде**
Список: `TOOL_FORWARD_TO_KNOWLEDGE_AGENT`, `TOOL_NOTIFY`, `TOOL_OPEN_ACT_PAGE`, `TOOL_OPEN_ADMIN_PANEL`, `TOOL_OPEN_CK_FIN_RES_PAGE`, `TOOL_OPEN_CK_CLIENT_EXP_PAGE`, `ACTION_OPEN_URL`, `ACTION_NOTIFY`, `ACTION_TRIGGER_SDK`. Frontend держит копию вручную — нет инвариант-теста синхронизации.

**3.4 Нет архитектурной диаграммы потока чата**
Пояснения раскиданы в `developer-guide.md:1490-2150`. Нужна одна схема: `Browser → SSE → API → Orchestrator → (LLM | AgentBridge → external)`.

**3.5 `manual-qa-external-agent-bridge.md` неполный**
Не покрывает: `CHAT__SMALLTALK_MODE=forward`, комбинацию `INITIAL_RESPONSE_TIMEOUT_SEC + MAX_TOTAL_DURATION_SEC + tool_rounds`.

**3.6 `.env.example` синхронизирован с `settings.py`** — проверено, все `CHAT__*` присутствуют. Минор: комментарии «есть значение по умолчанию» не указывают, какое.

---

## 4. Тесты

### 🔴 Критические дыры

**4.1 11 xfail race-condition тестов в `test_chat_race_conditions.py`** (коммит ccac5bf, `strict=False`)
Это не «технический долг», это реальные баги:
- **BUG #9, #10**: `count_by_user + create` без блокировки — конкурентные запросы превышают лимиты сообщений/бесед
- **BUG #14**: `ensureConversation` на фронте создаёт дубликаты (нет server-side check+create lock)
- **BUG #15**: удаление беседы во время стриминга возможно
*Фикс:* DB-constraints или optimistic locking.

**4.2 API endpoints не покрыты e2e**
`POST /conversations/{id}/messages` (SSE), `GET/POST/DELETE /conversations`, `POST /files`, `GET /files/download` — нет `TestClient(app)` тестов. Тестируется логика сервисов, но не маршрутизация + статус-коды.

**4.3 SSE error-path: 2 xfail в `test_chat_orchestrator.py`**
- `test_stream_error_guarantees_message_end` (BUG #6) — `message_end` не гарантирован при ошибке стрима
- `test_run_api_error_returns_200_with_error_payload` (BUG #7) — текущее поведение 200 + error payload вместо 500/503 не подтверждено как намеренное

**4.4 Frontend-тесты отсутствуют полностью**
`static/js/shared/chat/` — 0 тестов, нет Jest/Vitest. `ensureConversation`, SSE listener, idempotency client_action — без автоматизации.

**4.5 AgentBridgeRunner: только happy path**
Не покрыты: retry при `max_total_duration_sec`, переходы pending→error→timeout, reconciliation после рестарта uvicorn, конкурентные `request_id` с одним `conversation_id`.

**4.6 File validation: нет тестов границ**
`max_file_size` (10 MB), невалидный UTF-8 charset fallback, повреждённые PDF/ZIP — не покрыто.

### 🟡 Качество существующих тестов

- **Слабые asserts**: `assert_called_once()` без `assert_called_with(...)` — `test_agent_bridge_runner.py:82`, `test_chat_services.py:70`
- **Моки слишком глубокие**: `test_orchestrator_forward_integration.py` мокает `AgentBridgeService._run` — тестируется мок, не интеграция
- **Hardcoded testdata**: `"rid-1"`, `"u"`, `"conv-1"`, `"user1"` — нет factory-функций
- **Копипаста `clean_registries`** в 8+ файлах; должно быть в `tests/conftest.py`
- **`asyncio.sleep(0.01)`** в `test_chat_race_conditions.py:105` — недетерминированно; нужен `asyncio.Event`/`Condition`

### 🟢 Что хорошо

- Хорошее разделение по компонентам, явные fixture-сигнатуры, docstrings
- Покрытие repositories: правильный mock через `get_adapter`, проверка SQL-параметров
- File extraction: 35 тестов на маршрутизацию MIME
- `test_chat_security.py`: проверка ownership, injection prevention в action-handlers, UploadFile mime check
- Доменные исключения ловятся с проверкой `status_code` — это критически важно

---

## 5. План фиксов (приоритезация)

### P0 — блокеры релиза (1-2 спринта)

1. **Race conditions с лимитами** (BUG #9, #10, #14, #15) → починить, перевести xfail→pass
   - DB-уровневые constraints (UNIQUE для conv.title+user) **или** SELECT FOR UPDATE с проверкой лимита внутри транзакции
2. **Multi-worker safety для agent_bridge_runner** — выбрать стратегию: distributed lock или единственный воркер (`--workers 1`) + явная проверка
3. **XSS в `_welcomeHtml`** → `DOMPurify.sanitize` при кэшировании или DOM-клонирование
4. **Нейтральные SSE-error** при exception в orchestrator (паттерн из d7850e7)
5. **Транзакция `create message + touch conversation`**

### P1 — важно (следующие 2 спринта)

6. **API e2e-тесты** для всех chat-endpoints с `TestClient` + проверкой статус-кодов
7. **Required-параметр валидация в `_execute_tool_call`**
8. **Inline onclick → addEventListener** в `chat_content.html`
9. **`destroy()` в `ChatManager` и `ChatFiles`** + именованные функции для drag/drop
10. **Frontend Jest/Vitest** — минимум для `ensureConversation`, SSE error-handling, idempotency client_action
11. **AgentBridgeRunner**: тесты retry, reconciliation, timeout-переходы

### P2 — улучшения качества (бэклог)

12. Janitor для очистки `agent_response_events` (cron, > 7 дней done/error)
13. Rate-limit на `POST /messages` (sliding window per user)
14. Factory-функции для тестовых данных, перенос `clean_registries` в `conftest.py`
15. Event-based sync в race-condition тестах вместо `sleep()`
16. Заменить глубокие моки в `test_orchestrator_forward_integration.py` на реальные внутренние сервисы

### P3 — документация

17. Обновить CLAUDE.md §«Chat event-driven»: 11 ядерных + ChatPopupManager как региональный
18. developer-guide.md §7.6 → добавить чек-лист «новый action-tool» со ссылкой на §7.8a и пример button_translator
19. CLAUDE.md §Key Patterns → пункт про `names.py` как единственный источник правды + правило ручной синхронизации с фронтом
20. Добавить ASCII/Mermaid-диаграмму потока чата в `developer-guide.md §7.1`
21. Расширить `manual-qa-external-agent-bridge.md`: `SMALLTALK_MODE=forward`, комбинация всех таймаутов, max_tool_rounds
22. Documented Versioning Policy для tool/action names (что делать при переименовании)

---

## 6. Метрики аудита

- Файлов прочитано: ~70 (backend), ~15 (frontend), ~12 (docs), ~25 (tests)
- Найдено: **4 критических backend**, **3 критических frontend**, **6 критических тест-дыр**, **6 серьёзных backend**, **5 серьёзных frontend**, **6 doc-расхождений**
- Подтверждённые сильные стороны: изоляция домена, защита MIME, DOMPurify, optimistic locking, SSE-lifecycle, event-bus

---

*Сгенерировано четырьмя параллельными агентами Explore + консолидация тим-лидом. Это рабочий артефакт — обновляйте при фиксах.*
