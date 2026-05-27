# Operations Recovery Playbook — Act Constructor

> Реальные сценарии «что-то не так в проде». У каждого: **симптом**, **как диагностировать**, **как починить**.
> Документ — для оператора, не для разработчика. Глубокая архитектура — [`developer-guide.md`](developer-guide.md). Симптомы со стандартным фиксом — [`troubleshooting.md`](troubleshooting.md).
> Плейсхолдеры в SQL: `{SCHEMA}` — `DATABASE__GP__SCHEMA` (например `s_grnplm_ld_audit_da_project_4`); `{PREFIX}` — `DATABASE__TABLE_PREFIX` (default `t_db_oarb_audit_act_`).

---

## 1. Зависший forward-runner

**Симптом.** Пользователь жалуется: «Ассистент завис на печати». В UI крутится typing-индикатор, ответа нет > 5 минут. В чате стоит forward к внешнему ИИ-агенту (`chat.forward_to_knowledge_agent`).

**Диагностика.**

```sql
-- 1. Активные runner'ы, которые давно не двигались.
SELECT id, conversation_id, user_id, status, worker_token,
       created_at, updated_at, version
FROM {SCHEMA}.{PREFIX}agent_requests
WHERE status IN ('pending', 'dispatched', 'in_progress')
  AND updated_at < now() - interval '5 minutes'
ORDER BY updated_at;

-- 2. Streaming-сообщения, которые так и не дошли до финала.
SELECT id, conversation_id, status, created_at
FROM {SCHEMA}.{PREFIX}chat_messages
WHERE status = 'streaming'
  AND created_at < now() - interval '5 minutes';

-- 3. Сколько вообще событий прилетело от агента — может быть просто долгий reasoning.
SELECT request_id, count(*) AS events, max(seq) AS max_seq, max(created_at)
FROM {SCHEMA}.{PREFIX}agent_response_events
WHERE request_id IN (... id из шага 1 ...)
GROUP BY request_id;
```

**Recovery.**

1. **Не торопиться.** Если процесс жив и `chat.poll_coordinator` запущен (см. `/admin/diagnostics`), а внешний агент ещё работает — runner может догнать. Гейты таймаутов: `INITIAL_RESPONSE_TIMEOUT_SEC=300`, `EVENT_TIMEOUT_SEC=120`, `MAX_TOTAL_DURATION_SEC=1800` (dev-guide §9.5). Дать им сработать.
2. **Если рестартовали uvicorn** — `schedule_pending(older_than_sec=30)` в lifespan автоматически подхватит зависшие `pending`/`dispatched` запросы (`app/domains/chat/services/agent_bridge_runner.py:755`). Дождаться 30 сек после старта.
3. **Forcibly закрыть.** Если runner точно мёртв и автоматика не помогает:
   ```sql
   -- PostgreSQL (поддерживает || для jsonb):
   UPDATE {SCHEMA}.{PREFIX}chat_messages
   SET status = 'failed',
       content = COALESCE(content, '[]'::jsonb) ||
                 '[{"type":"error","message":"runner timeout (manual recovery)","block_id":"recovery:1"}]'::jsonb
   WHERE id = '<message_id>';

   -- Greenplum 6.x (PG 9.4, без ||):
   -- jsonb-конкатенация не поддерживается. Простейший вариант — пометить status,
   -- блоки оставить как есть; финализирующий блок добавит lifespan reconcile при следующем рестарте:
   UPDATE {SCHEMA}.{PREFIX}chat_messages
   SET status = 'failed'
   WHERE id = '<message_id>';

   -- Перевести запрос в timeout.
   UPDATE {SCHEMA}.{PREFIX}agent_requests
   SET status = 'timeout', finished_at = now()
   WHERE id = '<request_id>';
   ```
   На GP блок с error-сообщением не дописывается inline. Если нужен — выполнить Python-recovery через `MessageRepository.append_block(..., type='error', ...)` или дождаться рестарта приложения (lifespan reconcile подхватит зависшие через `schedule_pending(older_than_sec=30)`).

   После этого фронт при reload увидит ErrorBlock вместо typing-индикатора.

**См. также:** dev-guide §11.6, §11.7 (`chat_messages.status` state machine), `docs/forward-sequence.md`.

---

## 2. Singleton-lock застрял

См. [`troubleshooting.md` №20](troubleshooting.md#20-singleton-lock--приложение-не-стартует--зависший-процесс).

Короткая выжимка: `app_singleton_lock`-строка живёт после kill -9 до `SECURITY__SINGLETON_LOCK_STALE_TTL_SEC` (default 60 сек). Старт в окне TTL упадёт. Если реального процесса нет — дождаться TTL или вручную:

```sql
DELETE FROM {SCHEMA}.{PREFIX}app_singleton_lock
WHERE service_name = 'act_constructor';
```

---

## 3. `agent_response_events` распух

**Симптом.** GP-таблица `agent_response_events` стала большой, SELECT-запросы `PollCoordinator`'а заметно медленнее (видно по `last_flush_ago_sec` в `/admin/diagnostics` для `chat.poll_coordinator`, и по росту нагрузки на GP).

**Диагностика.**

```sql
-- Размер таблицы.
SELECT count(*) AS rows,
       pg_size_pretty(pg_total_relation_size('{SCHEMA}.{PREFIX}agent_response_events')) AS size
FROM {SCHEMA}.{PREFIX}agent_response_events;

-- Распределение по статусам родителя.
SELECT r.status, count(e.*) AS events
FROM {SCHEMA}.{PREFIX}agent_response_events e
JOIN {SCHEMA}.{PREFIX}agent_requests r ON e.request_id = r.id
GROUP BY r.status;
```

**Recovery.**

1. **Автоматический cleanup.** Фоновая задача `chat.agent_events_cleanup` (hook `app/domains/chat/__init__.py:262`) каждые `CHAT__AGENT_BRIDGE__AGENT_EVENTS_CLEANUP_INTERVAL_SEC` сек (default 3600 = 1 час) удаляет события старше `CHAT__AGENT_BRIDGE__AGENT_EVENTS_CLEANUP_TTL_HOURS` (default 24). Проверить в `/admin/diagnostics`, что задача `running: true` и `last_run_ago_sec` разумный.
2. **Ручная очистка** (если задача не справляется или была остановлена):
   ```sql
   DELETE FROM {SCHEMA}.{PREFIX}agent_response_events
   WHERE created_at < now() - interval '24 hours';
   ```
3. **Глубокая чистка с retention** — отдельный SQL [`docs/agent-bridge-cleanup.sql`](agent-bridge-cleanup.sql), TTL 30 дней, чистит все три таблицы в правильном порядке (events → responses → requests). Запускать кроном раз в неделю.
4. **VACUUM ANALYZE** после массовой чистки (для PG; на GP лучше партиционирование, см. dev-guide §7.8.6).

---

## 4. Записи теряются в батчерах

См. [`troubleshooting.md` №21](troubleshooting.md#21-записи-в-audit_log--metrics-пропадают--что-проверить).

**Когда дроп ожидаем.** Прод с высокой нагрузкой: например `metrics_max_buffer_size=10000`, поток 100 событий/сек, GP в нагрузке отстаёт. Через ~100 сек overflow начинает дропать старые записи. Это безопаснее, чем OOM процесса.

**Митигация:**

- Поднять `OBSERVABILITY__METRICS_MAX_BUFFER_SIZE` (больше буфера, дольше выдерживает пик).
- Уменьшить `OBSERVABILITY__METRICS_FLUSH_INTERVAL_SEC` (быстрее опустошение → меньше шансов накопить overflow).
- Поднять `OBSERVABILITY__METRICS_BATCH_SIZE` (больше за раз — меньше round-trip'ов в GP).
- Найти источник нагрузки (`batcher.name` в overflow-WARNING; для admin.http_metrics_batcher — проверить нет ли DDoS / спам-бота).

**Дополнительно для `last_error` ≠ null.** Это значит, что flush в БД стабильно падает. Чаще всего — CHECK constraint без mapping (см. dev-guide §6.5a), сетевой обрыв до GP, или права на таблицу. Логи покажут точный exception.

---

## 5. Восстановление после рестарта uvicorn

**Что автоматически:**

- `agent_bridge_runner.schedule_pending(older_than_sec=30)` в lifespan подхватывает зависшие forward'ы. Запускается через 30 сек после старта.
- `chat_messages.status='streaming'` старше 30 сек — runner либо дописывает финал и `finalize`, либо `mark_failed` по таймауту.
- Singleton-lock освобождается мягко в shutdown-hook (`app/main.py:266-280`).

**Что НЕ автоматически:**

- Записи, дропнутые батчерами при shutdown'е без graceful drain — ушли в /dev/null. `stop()` каждого батчера делает финальный flush (`app/core/metrics_batcher.py:118-138`), но если процесс получил SIGKILL, до stop() не дошло.
- Если рестарт занял > `INITIAL_RESPONSE_TIMEOUT_SEC` (5 мин), активные forward'ы уже превысили гейт 1; они уйдут в `failed` сразу при возобновлении runner'а.

**Что проверить после рестарта:**

1. По §2 чек-листа из `deployment-runbook.md` — все hook'и запустились, `/admin/diagnostics` чистый.
2. SQL по §1 из этого playbook'а — нет ли «зомби» streaming-сообщений.
3. Логи на WARNING/ERROR за первые 5 минут — особо `metrics_batcher` overflow, `poll_coordinator` ошибки, Kerberos.

---

## 6. Просмотр denied access (Wave 1)

Когда поступила жалоба «кто-то ломится в админку» или «юзер видит чужой ЦК-домен»:

```sql
-- Последние сутки отказов.
SELECT username, domain, path, method, reason, created_at
FROM {SCHEMA}.{PREFIX}access_denied_audit
WHERE created_at > now() - interval '24 hours'
ORDER BY created_at DESC
LIMIT 100;

-- Конкретный пользователь.
SELECT domain, path, method, reason, created_at
FROM {SCHEMA}.{PREFIX}access_denied_audit
WHERE username = '<username>'
  AND created_at > now() - interval '7 days'
ORDER BY created_at DESC;

-- Топ-доменов по отказам.
SELECT domain, count(*) AS denied
FROM {SCHEMA}.{PREFIX}access_denied_audit
WHERE created_at > now() - interval '7 days'
GROUP BY domain
ORDER BY denied DESC;
```

Каждая запись — это случай, когда `require_domain_access(domain)` вернул 403 (`app/api/v1/deps/role_deps.py:118-141`). Поле `reason` показывает роли пользователя и какой `domain_name` ему не хватило.

См. dev-guide §9.5c.

---

## 7. Полная остановка пользовательского процесса

Если процесс висит и не реагирует на нормальный shutdown.

**Сначала gracefully — `SIGTERM`.** Uvicorn ждёт ≤5 сек для graceful drain (закрытие SSE-стримов, финальный flush батчеров, release singleton-lock). Большинство сценариев обрабатываются.

**Forcibly — `SIGKILL`.** Если SIGTERM не сработал за 30 сек:

```bash
# Найти процесс.
ps -u <user> -f | grep "uvicorn\|app.main"
kill -9 <pid>
```

После SIGKILL:

- **Singleton-lock**: строка в `app_singleton_lock` останется. Следующий старт через `SECURITY__SINGLETON_LOCK_STALE_TTL_SEC` сек (default 60) перезапишет её автоматически. Если нужно стартовать раньше — DELETE вручную (см. §2).
- **Активные forward'ы**: соответствующие `chat_messages` останутся в `status='streaming'`. При следующем старте `schedule_pending` подхватит их в течение 30 сек.
- **Дропнутые метрики**: всё, что было в буферах батчеров — потеряно.

**Не делать SIGKILL когда:**

- Активный сохранение акта в `acts.audit_log_batcher` (потеряется аудит). Подождать ~30 сек после последней пользовательской активности.
- Активный долгий forward с reasoning (`chat_messages.status='streaming'` с заполняющимся content). После SIGKILL уже накопленные блоки сохранены, но `mark_failed` не отработает — состояние подвиснет до lifespan reconcile следующего старта.
