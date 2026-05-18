# Troubleshooting — типовые проблемы

Сборник симптомов и решений для частых ошибок. Если не нашёл свою проблему — проверь логи uvicorn, секцию Key Patterns в `CLAUDE.md` и `docs/developer-guide.md` по содержанию.

---

### 1. Kerberos билет протух (`kinit` expired)

**Симптом:** при работе с Greenplum в логе появляется сообщение `Kerberos токен протух. Выполните 'kinit' для обновления.`, запросы к БД падают с ошибкой инициализации пула либо при первом обращении к connection.

**Причина:** Kerberos билет имеет ограниченный TTL (обычно 8–24 часа). Pre-flight проверка `_is_kerberos_ticket_valid()` (см. `app/db/connection.py:65`) дёргает `klist -s` и при ненулевом exit-коде логирует инструкции через `_log_kerberos_instructions()`.

**Решение:**
1. В терминале выполни `kinit` (введи пароль доменной учётки).
2. Проверь билет: `klist` — должен быть валидный TGT.
3. Перезапусти приложение (`uvicorn ...`) либо повтори запрос; пул переинициализируется при следующей попытке.

**См. также:** `app/db/connection.py` строки 56–101, 219–246.

---

### 2. Greenplum: connection refused / pool init failure

**Симптом:** При старте uvicorn падает с `Kerberos билет отсутствует или истёк` или `asyncpg.exceptions.*ConnectionError` ещё до `Database pool ready:`.

**Причина:** одно из:
- Нет валидного Kerberos билета (см. п.1).
- Нет сетевой видимости до `DATABASE__GP__HOST`.
- Неверная схема в `DATABASE__GP__SCHEMA`.

**Решение:**
1. Проверь `klist`.
2. Проверь доступность хоста (`Test-NetConnection <gp_host> -Port 5432` в PowerShell).
3. Для локальной разработки переключись на PostgreSQL: в `.env` поставь `DATABASE__TYPE=postgresql` и заполни локальные креды.

**См. также:** `app/db/connection.py::_is_kerberos_ticket_valid`, `developer-guide.md §6.3`.

---

### 3. File upload в чат: 413 Payload Too Large

**Симптом:** Фронт показывает уведомление «файл слишком большой» или сервер возвращает 413/422 при загрузке вложения.

**Причина:** превышен один из лимитов:
- `CHAT__MAX_FILE_SIZE` (дефолт 10 МБ = 10485760 байт) — размер одного файла.
- `CHAT__MAX_TOTAL_FILE_SIZE` (дефолт 30 МБ = 31457280 байт) — суммарный размер файлов в сообщении.
- `CHAT__MAX_FILES_PER_MESSAGE` (дефолт 5) — количество файлов.
- MIME-тип не в whitelist `CHAT__ALLOWED_MIME_TYPES`.

**Решение:**
1. Уменьшить файл / разбить на несколько сообщений.
2. Если требование легитимное — увеличить лимит в `.env` и рестарт сервера. Помнить про `SECURITY__MAX_REQUEST_SIZE` (10 МБ дефолт) — он независимо ограничивает body запроса.

**См. также:** `.env.example` секция `# --- Файлы ---`, `app/domains/chat/exceptions.py::ChatFileValidationError`.

---

### 4. Agent bridge: запрос к внешнему агенту таймаутится

**Симптом:** В чате после форварда к knowledge-агенту приходит ошибка таймаута через 5/2/30 минут (в зависимости от гейта).

**Причина:** мост к внешнему ИИ-агенту имеет три независимых таймаута (см. `app/domains/chat/services/agent_bridge.py:112–212`):
- `initial_response_timeout_sec` (дефолт 300 = 5 мин) — гейт 1: время до первого события агента.
- `event_timeout_sec` (дефолт 120 = 2 мин) — гейт 2: heartbeat между событиями.
- `max_total_duration_sec` (дефолт 1800 = 30 мин) — гейт 3: общий hard cap.

**Решение:**
1. По тексту ошибки определи, какой гейт сработал (упомянут конкретный таймаут в секундах).
2. Если внешний агент действительно отвечает медленнее — поднять соответствующий `CHAT__AGENT_BRIDGE__*` в `.env`.
3. Если агент не запущен / не подхватывает запросы — проверить `agent_requests`-таблицу (есть ли записи в статусе `pending`) и agent_bridge_runner (фоновая задача lifespan).

**См. также:** `developer-guide.md §7.8`, `docs/manual-qa-external-agent-bridge.md`.

---

### 5. LLM возвращает 4xx (включая GigaChat 422)

**Симптом:** Чат падает на втором tool-вызове. В логе LLM-провайдер: `400 Input is a zero-length, empty document` (Qwen/SGLang) или `422 RequestInputValidationException` (GigaChat).

**Причина:** одна из двух известных проблем:
- assistant-сообщение в history содержит `content=null` + `tool_calls`.
- `arguments=""` для no-args tool_call'ов (`chat.list_pages` и т.п.) попало в эхо.

**Решение:**
1. Обнови ветку до актуального master — оба бага закрыты (`_safe_args`, явная сборка dict с `content=raw_msg.content or ""`).
2. Если фикс уже есть, а ошибка повторяется — проверь, не делает ли твой новый код `messages.append(response.choices[0].message)` напрямую (Pydantic `ChatCompletionMessage` сериализует `content` как `null`).

**См. также:** `CLAUDE.md` → секции «Assistant content=null + tool_calls» и «arguments=\"\" для no-args tool_call'ов».

---

### 6. HTTP-метрики не пишутся в БД

**Симптом:** Таблица HTTP-метрик пустая, хотя запросы идут.

**Причина:** `ADMIN__HTTP_METRICS_ENABLED=false` (дефолт). Кроме того, поток батчится — запись в БД происходит каждые `OBSERVABILITY__METRICS_FLUSH_INTERVAL_SEC` секунд (дефолт 5.0) или при накоплении `OBSERVABILITY__METRICS_BATCH_SIZE` записей (дефолт 100).

**Решение:**
1. В `.env` поставь `ADMIN__HTTP_METRICS_ENABLED=true`.
2. Перезапусти сервер.
3. После запроса подожди ~5 секунд (один flush) — записи появятся.

**См. также:** `.env.example` секция Observability, `app/domains/admin/`.

---

### 7. 404 на `/api/v1/...` под JupyterHub-proxy

**Симптом:** В Greenplum-окружении (через JupyterHub) фронт стабильно ловит 404 на `/api/v1/<что-угодно>`. Локально всё работает.

**Причина:** Фронт делает `fetch('/api/v1/...')` без `AppConfig.api.getUrl(...)`. Браузер резолвит относительный URL против origin (`https://hub.example/`), JupyterHub роутит на `/hub/api/v1/...` минуя `/user/{user}/proxy/{port}/` → 404.

**Решение:**
1. Все fetch'и к API ОБЯЗАНЫ идти через `AppConfig.api.getUrl('/api/v1/...')`.
2. Симметрично client_action `open_url` — относительные URL прогонять через `resolveProxyUrl`.
3. Найти дыры: `grep "fetch\(\s*['\"\`]/api"` по `static/js/`.

**См. также:** `CLAUDE.md` → «Frontend fetch к API под JupyterHub proxy», `developer-guide.md §9.2`.

---

### 8. Валидация КМ-номера падает

**Симптом:** `ValueError: КМ номер должен содержать ровно 7 цифр, получено: N (...)`.

**Причина:** `KMUtils.extract_km_digits` (см. `app/domains/acts/utils/km_utils.py:13–36`) вырезает всё кроме цифр и проверяет, что осталось ровно 7 (2 для года/типа + 5 для порядкового номера). Формат, ожидаемый пользователем: `КМ-XX-XXXXX` (русские буквы К и М). Если вставлены латинские KM, дефис в неправильном месте или один лишний/недостающий разряд — не пройдёт.

**Решение:**
1. Проверь, что строка содержит ровно 7 цифр (всё остальное игнорируется при экстракции, но количество цифр должно совпасть).
2. Если вход — пользовательский, валидируй на фронте перед отправкой.

**См. также:** `app/domains/acts/utils/km_utils.py`.

---

### 9. `RuntimeError: Database pool не инициализирован`

**Симптом:** Любой запрос к API возвращает 500 с этим сообщением.

**Причина:** Lifespan приложения ещё не отработал (uvicorn недавно стартовал и пул в процессе прогрева) либо инициализация упала (Kerberos, сеть, неверные креды) — поищи в логах строку `Database pool ready: ...` (`app/db/connection.py:252`). Если её нет — пул не поднялся.

**Решение:**
1. Дождись `Database pool ready:` в логах перед первыми запросами.
2. Если не появляется — проверь предыдущие строки лога: там будет конкретная причина (Kerberos, ConnectionRefused, неверный пароль).

**См. также:** `app/db/connection.py::init_db`, `developer-guide.md §6.3`.

---

### 10. Greenplum: `InvalidTableDefinitionError` при `CREATE TABLE`

**Симптом:** При создании новой таблицы в GP-окружении схема не накатывается, в логе `InvalidTableDefinitionError: DISTRIBUTED BY columns must be subset of PRIMARY KEY / UNIQUE`.

**Причина:** GP требует, чтобы `DISTRIBUTED BY` был подмножеством каждого `PRIMARY KEY` и `UNIQUE` констрейнта. Иначе уникальность нельзя обеспечить без распределённой блокировки.

**Решение:**
1. Если данные нужно co-locate'ить по `foreign_id` (например `conversation_id`) — использовать составной PK `(id, foreign_id)`, `id` ведущий, `DISTRIBUTED BY (foreign_id)`.
2. Lookups `WHERE id = $1` по-прежнему идут через PK-индекс (`id` стоит первым).
3. Проверь регрессию: `tests/test_gp_compatibility.py::test_distributed_by_subset_of_primary_key`.

**См. также:** `CLAUDE.md` → «GP-правило констрейнтов», `developer-guide.md §6.2`.

---

### 11. Тесты падают из-за состояния между тестами

**Симптом:** Отдельные тесты проходят, но при запуске всего набора падают с непонятными ассертами (например про `_user_locks`, `domain_registry`, `settings_registry`).

**Причина:** Доменная система использует глобальные реестры. Без autouse-фикстуры сброса состояние течёт между тестами.

**Решение:**
1. В файле теста добавь autouse-фикстуру, сбрасывающую нужный реестр:
   - `domain_registry.reset_registry()` — для тестов доменов/навигации.
   - `settings_registry.reset()` — для тестов настроек.
   - `reset()` из `app.core.chat.tools` — для chat tools.
   - `get_settings.cache_clear()` — если используется `@lru_cache()` декорированный геттер.
2. In-process `asyncio.Lock` (например `_user_locks`) — сбрасывай через autouse-фикстуру, инициализируй lazily (НЕ `defaultdict(asyncio.Lock)`).

**См. также:** `CLAUDE.md` → секция Testing, `tests/conftest.py`.

---

### 12. На фронте появился «⚠ Блок неизвестного типа»

**Симптом:** В сообщении ассистента вместо контента видно warning-fallback вида «⚠ Блок неизвестного типа …».

**Причина:** Бэк добавил новый тип блока (например `chart`, `table_grid`), но фронт ещё не знает о нём — он отсутствует в `KNOWN_BLOCK_TYPES` (см. `static/js/shared/chat/chat-messages.js:17–27`). Текущие известные типы: `text`, `code`, `reasoning`, `file`, `image`, `plan`, `error`, `buttons`, `client_action`.

**Решение:**
1. Добавить новый тип в `KNOWN_BLOCK_TYPES` Set.
2. Добавить handler в `ChatRenderer.renderBlock` (`static/js/shared/chat/chat-renderer.js:136`).
3. Параллельно на бэке тип должен быть зарегистрирован И в `MessageBlock` union (`app/core/chat/blocks.py`), И в `_DiscriminatedBlock` (`app/core/chat/schemas.py`) — иначе `parse_message_blocks` не распознает.

**См. также:** `CLAUDE.md` → «Новые типы блоков чата», `docs/manual-qa-frontend-unknown-block.md`.

---

### 13. `pytest` падает на `test_settings_*`

**Симптом:** Тесты доменных Settings падают c неожиданными значениями полей. Локально у одного разработчика проходят, у другого — нет.

**Причина:** pydantic-settings при инстанцировании через `_load_from_env` подсасывает реальный `.env` пользователя. Тест ловит твой локальный конфиг вместо дефолтов.

**Решение:**
1. Для проверки дефолтов инстанцируй модель напрямую с минимально нужными required-полями: `ChatDomainSettings(api_base="...", api_key="...", model="...")`.
2. `_load_from_env` используй ТОЛЬКО для проверки nested env-override (типа `CHAT__RETRY__ON_429`) с явным `monkeypatch.setenv(...)`.

**См. также:** `CLAUDE.md` → «Тесты доменных Settings».

---

### 14. GigaChat: 422 `RequestInputValidationException` на втором tool-вызове

**Симптом:** Профиль `gigachat`, первый вызов с function_call успешен, второй валится с 422.

**Причина:** Нативная схема GigaChat-proxy валидирует request строго: `function_call.arguments` в assistant-сообщении должно быть **dict**, не JSON-string. На пути ответа `_translate_response` делает `dict → JSON-string` (для OpenAI SDK-схемы), а на обратном пути (эхо history) `_translate_messages` через `_args_to_dict(raw)` должен делать `JSON-string → dict`.

**Решение:**
1. Обнови ветку до master — фикс есть в `gigachat_adapter.py::_args_to_dict`.
2. Если ошибка повторяется — проверь, что в твоём коде `arguments` для GigaChat-request не сериализуется в строку повторно.
3. Регрессия: `tests/test_gigachat_adapter.py` — должен быть roundtrip-тест.

**См. также:** `CLAUDE.md` → «GigaChat: arguments в request — DICT, не JSON-string».

---

### 15. Акт не сохраняется (yellow → white не происходит)

**Симптом:** В UI редактора индикатор сохранения завис в жёлтом цвете (локально сохранено, в БД не записано). Никаких 4xx/5xx в Network tab.

**Причина:** `StorageManager` (`static/js/state/storage-manager.js`) использует dual-tracking save: red (несохранено) → yellow (в localStorage) → white (в БД). DB-save идёт через debounce 3 секунды + periodic 2 минуты. Если индикатор завис в yellow дольше 2 минут — либо есть JS-ошибка в момент DB-save, либо сервер вернул не 200/204.

**Решение:**
1. Открой DevTools Console — поищи ошибки от `StorageManager`.
2. Открой Network — найди PUT/PATCH на эндпоинт сохранения акта, проверь status и response.
3. Если запрос не уходит вообще — проверь, что `AppState.markAsUnsaved()` действительно дёргается (proxy-based tracking).
4. В крайнем случае — `localStorage.getItem('act_<id>')` содержит последнюю валидную версию, можно восстановить.

**См. также:** `CLAUDE.md` → «Dual-tracking save», `developer-guide.md §4.6`.
