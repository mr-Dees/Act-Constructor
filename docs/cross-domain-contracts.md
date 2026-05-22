# Cross-domain контракты

Документ описывает **скрытые контракты между доменами**: какие имена,
поля и форматы захардкожены так, что переименование в одном месте
ломает другой домен. Полезно перед рефакторингом — пробежать по
таблице и понять, что переименование `X` потребует синхронной правки
`Y`, `Z` и фронта.

См. также:
- `app/core/domain_registry.py` — реестр доменов и фабрик
- `app/core/chat/names.py` — централизованные имена ChatTool и client-actions
- `CLAUDE.md` — основные паттерны проекта

---

## 1. Принципы изоляции

Между доменами **нет прямых импортов**:

```bash
$ grep -rn "from app.domains.\(acts\|admin\|ck_\|ua_data\)" app/domains/chat
# пусто

$ grep -rn "from app.domains.acts" app/domains/admin
# пусто
```

Связь идёт через **2 механизма**:

1. **`domain_registry.register_factory(key, factory)`** — DI-реестр
   фабрик. Домен X регистрирует «как мне получить компонент Y», другой
   домен берёт фабрику по ключу `f"{producer_domain}.{component}"`.
2. **`ChatTool`-реестр** — каждый домен регистрирует свои tools через
   `DomainDescriptor.chat_tools`. Чат не знает о них в compile-time;
   `register_tools(...)` собирает всё в один реестр при старте.

---

## 2. Контракты factory-registry

### 2.1. `admin.user_directory` — справочник пользователей

| Аспект | Значение |
|---|---|
| **Регистрирует** | `app/domains/admin/_lifecycle.py` (или `__init__.py::_build_domain`) |
| **Использует** | `app/domains/acts/deps.py:132` (`get_factory("admin.user_directory")`) |
| **Контракт** | Фабрика возвращает `UserDirectoryRepository` с методом `get_user(username: str) -> UserInfo` |
| **Что сломается** | Удаление/переименование ключа → `acts` потеряет атрибуцию авторов актов. `RuntimeError: factory 'admin.user_directory' not registered` на старте. Чат **не затронут** (не использует) |

### 2.2. `ua_data.invoice_table_names` — реестр Hive-таблиц

| Аспект | Значение |
|---|---|
| **Регистрирует** | `app/domains/ua_data/_lifecycle.py` |
| **Использует** | `app/domains/acts/deps.py:96` (`get_factory("ua_data.invoice_table_names")()`) |
| **Контракт** | Фабрика возвращает callable, который при вызове отдаёт список имён таблиц для проверки фактур |
| **Что сломается** | `acts` не сможет валидировать фактуры. Workflow создания/обновления фактур упадёт |

---

## 3. Контракты `ChatTool` (через `app/core/chat/names.py`)

Все имена централизованы в `names.py`. **Переименование константы =
синхронное изменение во всех потребителях**, иначе runtime-warning
«ChatTool не зарегистрирован» (силент failure: LLM просто не получит tool).

### 3.1. `chat.forward_to_knowledge_agent` — терминальный tool с переключением в bridge

| Аспект | Значение |
|---|---|
| **Константа** | `TOOL_FORWARD_TO_KNOWLEDGE_AGENT` |
| **Создаётся в** | `app/domains/chat/services/forward_tool_factory.py` (per-request handler через замыкание) |
| **Перехватывается в** | `stream_loop.py` и `agent_loop.py` — особый case-bypass: возврат sentinel `<<forwarded_request:UUID>>` → переключение в `forward_bridge.handle_forward_call` |
| **Контракт** | Имя tool'а должно совпадать с константой в обоих местах. Если переименовать — оркестратор перестанет распознавать tool и forward не сработает |

### 3.2. `acts.open_act_page` (и аналогичные `open_*_page` tools)

| Аспект | Значение |
|---|---|
| **Константа** | `TOOL_OPEN_ACT_PAGE` (и аналогичные) |
| **Handler** | `app/domains/acts/integrations/action_handlers.py:open_act_page_handler` |
| **Параметр `km_number`** | Принимает строку формата `КМ-XX-XXXXX`. Если LLM или внешний агент передаст другой формат — handler вернёт ErrorBlock «не удалось извлечь цифры» |
| **Возвращает** | JSON ClientActionBlock `{action: "open_url", params: {url: "/constructor?act_id=<int>"}, ...}` |
| **Что сломается** | Переименование `km_number` параметра → LLM перестанет вызывать tool правильно (название параметра — часть LLM-описания). Изменение URL формата → фронтовый `chat-client-actions.js::resolveProxyUrl` может не распознать |

### 3.3. `admin.open_admin_panel` и тулы доменов ЦК

Тот же шаблон что и `acts.open_act_page`: action-tool с client_action.
Имена в `names.py`, handler'ы в `<domain>/integrations/action_handlers.py`,
бутон-транслейтор для кнопок от внешнего агента.

---

## 4. Контракты client-actions (Python ↔ JavaScript)

| Action | Python whitelist | JS handler |
|---|---|---|
| `open_url` | `app/core/chat/blocks.py:ALLOWED_CLIENT_ACTIONS` | `static/js/shared/chat/chat-client-actions.js` |
| `notify` | то же | то же |
| `trigger_sdk` | то же | то же |

**Синхронизация ручная** — фронт не импортирует Python.

| Что сломается | Симптом |
|---|---|
| Action добавлен в Python whitelist, но забыт во фронте | SSE-событие `client_action` пройдёт, но handler'а нет → `console.warn('ClientActionsRegistry: неизвестная команда X')` |
| Action добавлен во фронт, но забыт в Python whitelist | Pydantic-валидация `ClientActionBlock` отвергнет блок на парсинге → exception в orchestrator |

---

## 5. Контракт `block_id` для `ClientActionBlock`

| Аспект | Значение |
|---|---|
| **Формат** | `f"{message_id}:ca:{i}"` (детерминированный) |
| **Генерируется в** | `Orchestrator._parse_client_action_result` (`stream_loop.py` для streaming, `agent_loop.py` для non-streaming) и `block_emitter.emit_response_blocks` (forward-путь) |
| **Используется на фронте** | `chat-client-actions.js::executeBlock` — Set исполненных id в `sessionStorage` под ключом `chat:executedActions` |
| **Что сломается, если изменить формат** | Фронт перестанет распознавать «уже исполненный» при reload вкладки → бесконечный redirect-цикл (action `open_url` будет каждый раз заново переходить по URL). См. CLAUDE.md, раздел про `ClientActionBlock идемпотентен по block_id` |

**Симметрично для `block_id` reasoning-блоков** (форвард):
- Формат: `f"{message_id}:reasoning:{seq}"`
- Используется: (a) `MessageRepository.append_block` для server-side дедупа повторных reasoning-событий; (b) `ChatRenderer.appendBlock` для DOM-дедупа через `data-block-id` (replaceWith вместо append при коллизии).
- Что сломается: невозможность восстановить reasoning-блоки при reload/switch чатов из `GET /messages`; дубликаты в DOM при повторных Resume SSE (см. `docs/developer-guide.md §11.7`).

---

## 6. Контракты SSE-событий (backend → frontend)

| Событие | Поле / payload | Где используется |
|---|---|---|
| `message_start` | `{conversation_id, message_id}` | `chat-messages.js::_handleSSEEvent::case 'message_start'` — сброс `_streamingBlocks` |
| `block_start` | `{index, type, [block_id]}` | `chat-messages.js::_handleSSEEvent::case 'block_start'` — создание DOM-узла |
| `block_delta` | `{index, delta}` | то же — `block.appendText(delta)` |
| `block_end` | `{index}` | то же — `block.finalize()` |
| `block_complete` | `{index, block}` | те же типы блоков, но cellsouten одним событием (file/image/plan/error) |
| `client_action` | `{block}` | `chat-messages.js::case 'client_action'` — `ClientActionsRegistry.executeBlock(block)` |
| `buttons` | `{buttons: [...]}` | `chat-messages.js::case 'buttons'` — рендер группы кнопок |
| `tool_call` / `tool_result` / `tool_error` | `{tool_name, tool_call_id, ...}` | сейчас не используется фронтом (диагностические события) |
| `agent_request_started` | `{request_id, conversation_id}` | `chat-stream.js::_trackAgentEvent` — переход в Resume SSE |
| `message_end` | `{message_id, model, token_usage}` | `chat-messages.js::case 'message_end'` — сброс `_streamingBlocks` |
| `error` | `{error, code?}` | `chat-messages.js::case 'error'` — рендер ErrorBlock |

**Что сломается, если добавить новое событие на бэке без правки фронта**:
фронт пропустит его в `switch` без handler'а, ошибки не будет, но
функционал не отработает. Регрессия: TODO — добавить warning в `default`
ветку `_handleSSEEvent`.

---

## 7. URL-контракты под JupyterHub proxy

| Что | Где захардкожено | Что нельзя |
|---|---|---|
| Открытие страницы акта | `acts.open_act_page` handler возвращает `/constructor?act_id=<int>` | НЕ возвращать абсолютный URL `http://...` — фронт пройдёт мимо proxy-rewrite |
| Открытие админ-панели | `admin.open_admin_panel` → `/admin` | то же |
| API fetch от фронта | `chat-stream.js`, любые `fetch(...)` | Обязательно через `AppConfig.api.getUrl(endpoint)`, иначе под JupyterHub → 404 |

Подробнее — CLAUDE.md, разделы про `open_url` и про `Frontend fetch к
API под JupyterHub proxy`.

---

## 8. Регрессионные тесты (где проверяется)

| Контракт | Тест |
|---|---|
| `block_id` детерминизм для ClientAction | `tests/domains/chat/test_block_id_determinism.py` |
| `block_id` для reasoning + дедуп | `tests/domains/chat/test_agent_bridge_runner.py::test_run_saves_assistant_message_with_collected_blocks` |
| GP UNIQUE / PK правило | `tests/test_gp_compatibility.py::test_distributed_by_subset_of_primary_key` |
| Watchdog PollCoordinator | `tests/domains/chat/test_poll_coordinator.py::test_watchdog_restarts_dead_poll_loop` |
| Terminal-tool контракт | `tests/domains/chat/test_chat_streaming.py::TestTerminalToolContract::test_client_action_terminates_loop` |
| Whitelist client-actions | `tests/core/test_chat_blocks.py` |

---

## 9. Checklist для рефакторинга «переименовать X»

Прежде чем переименовать имя tool'а / action / поле в `*Handler` / FK:

1. **`grep -r "<old_name>" app/ tests/ static/`** — увидеть всех потребителей.
2. Если есть совпадения в `static/` — синхронно править frontend.
3. Если совпадение в `app/domains/<other>/` — перепроверить, что
   используется через `register_factory` или `ChatTool`-реестр, а не
   прямым импортом. Прямой импорт между доменами — баг.
4. Запустить полный тест-сет: `pytest tests/ -q`.
5. Поднять локально, проверить:
   - LLM может вызвать переименованный tool (если description совместимо)
   - Кнопки от внешнего агента не сломались (`button_translator`)
   - Client-action откликается на новом имени
