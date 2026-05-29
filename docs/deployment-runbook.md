# Deployment Runbook — Act Constructor

> Closed-network deploy. JupyterHub Datalab + Greenplum 6.x для прода; PostgreSQL — для dev.
> Single-tenant per process: один Python-процесс на JupyterHub-юзера, защита через singleton-lock в БД.

Документ — пошаговый чек-лист «как развернуть» / «как обновить» / «как проверить, что взлетело». Глубокая архитектура — [`developer-guide.md`](developer-guide.md). Симптомы и фиксы — [`troubleshooting.md`](troubleshooting.md). Что делать когда сломалось — [`operations-recovery.md`](operations-recovery.md).

---

## 1. Pre-deploy checklist

Перед запуском (или рестартом) уверенно прогнать:

- [ ] **Kerberos** (только GP-окружение). `kinit <user>` для получения тикета. `klist` показывает валидный TGT, срок жизни > планируемого аптайма (обычно 8-24 часа). Без тикета `_is_kerberos_ticket_valid()` (`app/db/connection.py:65`) залогирует инструкции и init БД упадёт.
- [ ] **`JUPYTERHUB_USER`** в окружении процесса. Без неё username по умолчанию `unknown_user`, RBAC сломается. В JupyterHub Datalab переменная ставится автоматически; при запуске вне JupyterHub — выставить вручную (`export JUPYTERHUB_USER=<digits>_<...>`).
- [ ] **`.env` сверен с `.env.example`**. После предыдущего деплоя в `.env.example` мог появиться обязательный ключ или поменяться дефолт. Команда быстрой сверки на Windows PowerShell:
  ```powershell
  Compare-Object (Get-Content .env.example) (Get-Content .env)
  ```
  Особо проверить: `CHAT__*`, `ACTS__*`, `OBSERVABILITY__*`, `SECURITY__*`. Wave 1 добавил `CHAT__AGENT_BRIDGE__MAX_BLOCK_TEXT_SIZE=262144` (см. dev-guide §9.5).
- [ ] **`DATABASE__TABLE_PREFIX`** соответствует БД. Дефолт `t_db_oarb_audit_act_`. При смене окружения проверить, что таблицы существуют под тем же префиксом — иначе `create_tables_if_not_exist` поднимет новый набор пустых таблиц и фактические данные «исчезнут».
- [ ] **Свободен ли singleton-lock**. См. `troubleshooting.md` №20: если предыдущий процесс упал по kill -9, строка в `app_singleton_lock` живёт до `SECURITY__SINGLETON_LOCK_STALE_TTL_SEC` сек (default 60). В пределах окна старт упадёт.
- [ ] **Версия миграций**. Все одноразовые SQL из `docs/migrations/` для апгрейда с предыдущей версии применены (см. §3).
- [ ] **Внешний ИИ-агент жив**. Если деплой завязан на forward'ы — убедиться, что внешний worker подхватывает `agent_requests`. Без него все forward'ы будут зависать по `INITIAL_RESPONSE_TIMEOUT_SEC` (5 мин default).

---

## 2. Старт и старт-проверка

**Запуск:**

```powershell
# Standalone (см. dev-guide §9.1)
python -m app.main
# или через uvicorn (с явным портом)
uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8005
```

**Старт-проверка (по порядку):**

1. **Лог жизненного цикла**. В выводе uvicorn должны последовательно появиться:
   - `Database pool ready: ...` (`app/db/connection.py:252`) — пул асинкпг поднят.
   - `Схема базы данных проверена` — `create_tables_if_not_exist` отработала.
   - Сообщение о захвате singleton-lock без ошибок (`Не удалось захватить singleton-lock` → стоп, см. troubleshooting №20).
   - Каждый startup-hook — `poll_coordinator: запущен (...)`, `audit_log_batcher: started`, и аналогичные. Полный набор для Wave 1:

     | Hook | Что |
     |---|---|
     | `acts.audit_log_batcher` | `MetricsBatcher` для аудита актов |
     | `acts.expired_locks_cleanup` | Фоновая cleanup-задача lock'ов |
     | `admin.http_metrics_batcher` | `MetricsBatcher` HTTP-метрик |
     | `admin.access_denied_audit_batcher` | `MetricsBatcher` отказов доступа |
     | `admin.db_pool_monitor` | Мониторинг asyncpg-пула |
     | `chat.tool_metrics_batcher` | `MetricsBatcher` метрик tool-вызовов |
     | `chat.audit_log_batcher` | `MetricsBatcher` chat-аудита |
     | `chat.poll_coordinator` | Единый цикл polling событий внешнего агента |
     | `chat.agent_events_cleanup` | TTL-cleanup `agent_response_events` |

2. **Базовый health.**
   ```bash
   curl http://localhost:8005/api/v1/health
   # → {"status": "ok", "service": "Audit Workstation", "version": "1.0.0"}
   ```
   Под JupyterHub-proxy путь будет `http://<hub>/user/<user>/proxy/8005/api/v1/health`.

3. **Diagnostics (Wave 1).** Требует роль `Админ` (`ADMIN__USER_DIRECTORY__DEFAULT_ADMIN`):
   ```bash
   curl -H "Cookie: ..." http://localhost:8005/api/v1/admin/diagnostics | jq
   ```
   - `batchers.*.running` — все `true`.
   - `batchers.*.dropped_count` — все `0` сразу после старта.
   - `background_tasks.*.running` — все `true`.

   Подробности — dev-guide §9.5b.

4. **Smoke-проверка домена.** Открыть UI портала, убедиться что:
   - Sidebar показывает доменные пункты (если они зарегистрированы для роли пользователя).
   - Чат отвечает на «привет» (LLM-провайдер доступен).
   - Открытие любого акта (`/constructor?act_id=<id>`) не валится с 5xx.

---

## 3. Миграции БД (одноразовые)

При апгрейде с предыдущих версий могут понадобиться SQL-миграции — `create_tables_if_not_exist` создаёт **только новые** таблицы, не дописывает колонки/индексы в существующие.

Текущий каталог миграций — `docs/migrations/`:

| Файл | Когда применять |
|---|---|
| `drop-all-tables.md` | Тотальная очистка под пересоздание схемы (только dev) |

**Wave 1 backend-hardening** не требует ALTER на существующих БД: таблица `access_denied_audit` создаётся `schema.sql` через стандартный `IF NOT EXISTS`, новый Setting `CHAT__AGENT_BRIDGE__MAX_BLOCK_TEXT_SIZE` живёт только в коде. Если БД пустая или таблица `access_denied_audit` уже создана прошлой версией — никаких ручных действий не нужно.

**Если таблица не создалась автоматически** (старая версия create_tables, специфичные права):

```sql
-- PostgreSQL
\i app/domains/admin/migrations/postgresql/schema.sql
-- Greenplum (через sed на плейсхолдерах)
sed 's/{SCHEMA}/<gp_schema>/g; s/{PREFIX}/t_db_oarb_audit_act_/g' \
    app/domains/admin/migrations/greenplum/schema.sql | psql ...
```

(Linux/JupyterHub окружение. Под Windows эквивалент — ручная замена в редакторе или PowerShell `(Get-Content ...) -replace ...`.)

---

## 4. Rollback protocol

Если новый деплой ломает прод, и нужно откатиться:

1. **`SIGTERM`** на текущий процесс (uvicorn ждёт ≤5с graceful drain). Singleton-lock освободится в lifespan-shutdown (`app/main.py:266-280`).
2. **`git checkout <previous-tag>`** в рабочем каталоге.
3. **Проверить совместимость БД-схемы.** Если в новой версии были `ALTER TABLE` / новые колонки, и старая версия их не ждёт — это OK (старая версия читает подмножество колонок). Если же старая версия пишет в колонку, которой в новой версии нет — деплой нельзя откатывать без backup'а.
4. **Старт по §2.**
5. **Проверить zombie streaming-сообщения.** Подробный recovery для зависших streaming-сообщений — см. [operations-recovery.md §1](operations-recovery.md#1-зависший-forward-runner). Здесь — только проверка факта: `SELECT count(*) FROM t_db_oarb_audit_act_chat_messages WHERE status='streaming' AND created_at < now() - interval '5 minutes';`. Если ненулевое — открыть operations-recovery §1.

---

## 5. Известные проблемы

Сборник симптомов — [`troubleshooting.md`](troubleshooting.md). Особо актуально на деплое:

- №1, №2 — Kerberos / GP connection refused.
- №3 — file upload 413.
- №7 — 404 на API под JupyterHub-proxy (`AppConfig.api.getUrl(...)`).
- №9 — `Database pool не инициализирован` (lifespan ещё не отработал).
- №17 — `TooManyConnectionsError` (поднять `POOL_MAX_SIZE`).
- №20 — Singleton-lock застрял (см. также §1 этого runbook'а).
- №21 — Записи теряются в батчерах (Wave 1: проверить `/admin/diagnostics`).
