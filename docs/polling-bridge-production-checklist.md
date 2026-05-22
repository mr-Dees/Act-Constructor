# Polling-bridge: production-checklist

Чек-лист для эксплуатации моста к внешнему ИИ-агенту через таблицы
`agent_requests` / `agent_response_events` / `agent_responses` в
Greenplum. Покрывает: ручную retention-чистку, мониторинг, ёмкости,
троblesh.

См. также `docs/forward-sequence.md` для понимания самого механизма.

---

## 1. Retention: ручная чистка (раз в N дней)

`agent_response_events` — append-only, **никогда не чистится автоматически**.
`agent_requests` после `status='done'/'error'/'timeout'` тоже остаются
вечно. На интенсивном использовании таблицы растут на ~10K строк/день
и через несколько месяцев упрутся в диск.

**Решение:** периодический ручной (или scheduled через cron / Datalab job)
DELETE по `created_at`.

### 1.1. PostgreSQL (dev-инсталляция)

```sql
-- Чистим события агента старше 30 дней.
-- На большой таблице желательно сначала добавить индекс по created_at:
--   CREATE INDEX IF NOT EXISTS idx_t_db_oarb_audit_act_agent_response_events_created_at
--       ON t_db_oarb_audit_act_agent_response_events(created_at);
-- (требуется один раз, выполнение DELETE без индекса = полный скан).

BEGIN;
DELETE FROM t_db_oarb_audit_act_agent_response_events
WHERE created_at < now() - interval '30 days';

-- Заодно — финализированные запросы. Сохраняем 90 дней для forensic-трейла.
DELETE FROM t_db_oarb_audit_act_agent_requests
WHERE status IN ('done', 'error', 'timeout')
  AND finished_at < now() - interval '90 days';
COMMIT;
```

### 1.2. Greenplum (прод-инсталляция)

```sql
-- Подставить актуальную схему (DATABASE__GP__SCHEMA, дефолт audit_workstation).

-- 1. (один раз) Индекс на created_at — без него DELETE на multi-segment таблице будет долгим.
CREATE INDEX idx_t_db_oarb_audit_act_agent_response_events_created_at
    ON audit_workstation.t_db_oarb_audit_act_agent_response_events(created_at);

-- 2. DELETE раз в N дней.
DELETE FROM audit_workstation.t_db_oarb_audit_act_agent_response_events
WHERE created_at < now() - interval '30 days';

DELETE FROM audit_workstation.t_db_oarb_audit_act_agent_requests
WHERE status IN ('done', 'error', 'timeout')
  AND finished_at < now() - interval '90 days';
```

### 1.3. Контрольные запросы (сколько съело места)

```sql
-- PG
SELECT
    pg_size_pretty(pg_total_relation_size('t_db_oarb_audit_act_agent_response_events')) AS events_size,
    pg_size_pretty(pg_total_relation_size('t_db_oarb_audit_act_agent_requests')) AS requests_size,
    (SELECT count(*) FROM t_db_oarb_audit_act_agent_response_events) AS events_rows,
    (SELECT count(*) FROM t_db_oarb_audit_act_agent_requests) AS requests_rows;

-- GP — то же, но с указанием схемы:
SELECT
    pg_size_pretty(pg_total_relation_size('audit_workstation.t_db_oarb_audit_act_agent_response_events')) AS events_size,
    ...
```

**Ориентир:** при 100 forward'ов в день в среднем ~10 reasoning-чанков
каждый. ~1000 строк/день в `agent_response_events`. За месяц — ~30K,
~30 МБ (с учётом payload-JSON). Чистка раз в месяц — комфортно.

---

## 2. Sizing

### 2.1. asyncpg-пул (`DATABASE__POOL_*`)

| Параметр | Дефолт | Объяснение |
|---|---|---|
| `POOL_MIN_SIZE` | 5 | Минимум коннектов в простое. При повышении не упирается в холодный старт |
| `POOL_MAX_SIZE` | 20 | Потолок. Расчёт: 4 батчера + PollCoordinator + 3 SSE-стрима × 3 фазы runner'а + 5 запас |

**Не увеличивай `POOL_MAX_SIZE` без необходимости.** Сейчас 20 — с запасом
для 6 параллельных пользователей. Сначала retention для `agent_response_events`
(п. 1), потом профилирование под нагрузкой, и только потом — увеличение.

### 2.2. Таймауты forward'а (`CHAT__AGENT_BRIDGE__*`)

| Параметр | Дефолт | Что значит |
|---|---|---|
| `INITIAL_RESPONSE_TIMEOUT_SEC` | 300 (5 мин) | Сколько ждать **первого** события от агента. После — timeout |
| `EVENT_TIMEOUT_SEC` | 120 (2 мин) | Heartbeat-гейт: тишина между событиями. После — timeout |
| `MAX_TOTAL_DURATION_SEC` | 1800 (30 мин) | Жёсткий потолок длительности одного forward'а |
| `POLL_MIN_INTERVAL_SEC` | 5.0 | Минимум между SELECT'ами PollCoordinator (старт adaptive backoff) |
| `POLL_MAX_INTERVAL_SEC` | 10.0 | Максимум после backoff'а на пустых тиках |
| `POLL_BACKOFF_MULTIPLIER` | 1.5 | Множитель backoff'а |

Worst case: 30 минут от начала до жёсткого timeout. На практике — 5-15
секунд для коротких ответов, ~5 минут для длинных reasoning-chain'ов
вроде RAG-агента.

### 2.3. Per-user лимиты

- `CHAT__MAX_PARALLEL_STREAMS_PER_USER` (default 3) — одновременных POST SSE.
  Resume SSE (`/forward-stream/{rid}`) НЕ учитывается в этом счётчике — это
  read-only наблюдатель уже зарегистрированного `agent_request`, а не «новый
  запрос». Иначе при POST forward'е, ещё в полёте, + переключении обратно
  на ту же беседу счётчик удваивался бы и пользователь ловил 429 просто
  просматривая свои чаты.
- `UserRateLimiter` — скользящее окно 60с на POST `/messages`.

---

## 3. Мониторинг

### 3.1. Метрики, которые уже пишутся в БД

| Таблица | Что мониторить |
|---|---|
| `chat_tool_metrics` | Latency / status / username вызовов ChatTool — медленные tools, спайки validation_error |
| `admin_http_metrics` | Latency / status HTTP-запросов — медленные эндпоинты, спайки 5xx |
| `chat_audit_log` | Жизненный цикл бесед: created / deleted / message_sent / stream_started / stream_completed / stream_aborted |
| `agent_requests.status` | Распределение `pending`/`dispatched`/`in_progress`/`done`/`error`/`timeout` — алёрт на залипшие |

### 3.2. Алерты (рекомендации)

| Сигнал | Запрос | Когда дёргать |
|---|---|---|
| Зависшие forward'ы | `SELECT count(*) FROM agent_requests WHERE status IN ('dispatched','in_progress') AND updated_at < now() - interval '10 minutes'` | > 0 |
| Спайки timeout'ов | `SELECT count(*) FROM agent_requests WHERE status='timeout' AND created_at > now() - interval '1 hour'` | > 5/час |
| Рост events | `SELECT count(*) FROM agent_response_events` | > 5M (≈ 5 ГБ при средней нагрузке) |
| Orphan сообщений | `SELECT count(*) FROM chat_files WHERE conversation_id NOT IN (SELECT id FROM chat_conversations)` | > 0 |
| Watchdog рестарты | grep `poll_coordinator: цикл перезапущен` в логах | > 1/день |

### 3.3. WARNING'и по приближению к лимиту пула

`DbPoolMonitor` (admin-домен, lifespan-hook `admin.db_pool_monitor`) раз
в 30 секунд проверяет `pool.get_size()` / `pool.get_idle_size()`.
Когда `acquired/max_size >= warn_ratio` (default 0.9) — WARNING в лог:

```
db_pool_monitor: пул близок к лимиту — acquired=18/20 (size=20, idle=2, ratio=0.90)
```

Throttle: один WARNING на серию подряд идущих high-usage замеров; при
возврате к норме — INFO «нагрузка на пул нормализована». Логи доступны
для агрегатора (Loki/syslog), там и строится алёрт.

Конфиг (`.env`):

```
ADMIN__DB_POOL_MONITOR__ENABLED=true
ADMIN__DB_POOL_MONITOR__CHECK_INTERVAL_SEC=30.0
ADMIN__DB_POOL_MONITOR__WARN_RATIO=0.9
```

### 3.4. Логи, на которые смотреть

```
# Запущенные/упавшие подзадачи (info / warning)
audit_workstation.domains.chat.services.poll_coordinator
audit_workstation.domains.chat.agent_bridge_runner
audit_workstation.domains.chat.forward_stream

# Стримы:
audit_workstation.domains.chat.api.messages         # POST SSE
audit_workstation.domains.chat.api.forward_resume   # Resume SSE

# Ошибки LLM:
audit_workstation.domains.chat.stream_loop          # exception в стрим-петле
audit_workstation.domains.chat.agent_loop           # exception в non-stream петле
```

---

## 4. Фоновые задачи (хуки в lifespan)

При старте `uvicorn` поднимаются (в порядке регистрации):

1. `acts.audit_log_batcher` — батч-INSERT в `audit_log` (50 шт / 30 сек)
2. `acts.expired_locks_cleanup` — UPDATE expired locks раз в 60 сек
3. `admin.http_metrics_batcher` — батч-INSERT в `admin_http_metrics`
4. `chat.tool_metrics_batcher` — батч-INSERT в `chat_tool_metrics`
5. `chat.poll_coordinator` + **watchdog** — единый цикл polling + heartbeat-стораж
6. `chat.audit_log_batcher` — батч-INSERT в `chat_audit_log`
7. (lifespan) `agent_bridge_runner.schedule_pending` — reconcile зависших forward'ов после рестарта

**Shutdown** — в обратном порядке. Если что-то не остановилось за 5с —
warning в лог.

---

## 5. Troubleshooting

### 5.1. «Чат завис, никто не отвечает»

1. Проверь `app_singleton_lock` — есть ли активный воркер:
   ```sql
   SELECT * FROM t_db_oarb_audit_act_app_singleton_lock;
   ```
2. Проверь PoolCoordinator в логах: ищи `poll_coordinator: запущен`,
   потом — `_restart_count`. Если > 1 — координатор зависал и
   рестартовался watchdog'ом. Это симптом сетевой проблемы к GP.
3. Проверь пул: количество `acquire`-таймаутов в логах
   asyncpg.

### 5.2. «Юзер видит "Внутренняя ошибка SSE-стрима" при любом сообщении»

1. Логи: `audit_workstation.domains.chat.stream_loop` уровня
   `exception` — там реальная причина (timeout LLM, 5xx от провайдера, etc).
2. Проверь circuit breaker (`CHAT__CIRCUIT_BREAKER_*`). Если он в `open`
   — fallback-провайдер тоже недоступен.

### 5.3. «Reasoning дублируется по 2-3 раза в одном сообщении»

Не должно происходить после фикса дедупа reasoning (см.
`docs/developer-guide.md §11.7`). Если всё-таки видишь:

1. Проверь, что `block_id` присутствует в `messages.content` reasoning-блоков:
   ```sql
   SELECT id, content
   FROM t_db_oarb_audit_act_chat_messages
   WHERE role='assistant'
   ORDER BY created_at DESC LIMIT 5;
   ```
   Каждый `reasoning` должен иметь поле `block_id` формата
   `{message_id}:reasoning:{seq}`.
2. Если `block_id` отсутствует — у тебя сообщения **до** фикса дедупа.
   Это нормально для исторических данных, фикс работает только для
   новых.

### 5.4. «Чат тормозит при N+ пользователях»

1. Pool exhausted: смотри в логах `asyncpg.pool` warning'и.
2. Если pool в порядке, проверь `chat_tool_metrics` — нет ли tool'а с
   аномально большим `latency_ms`.

### 5.5. «UNIQUE-нарушение при INSERT в agent_response_events»

Это ОЖИДАЕМОЕ поведение: на таблице висит `UNIQUE (request_id, seq)`
(определён в `app/domains/chat/migrations/{postgresql,greenplum}/schema.sql`)
— внешний агент пытается дважды записать одно событие (network retry).
Приложение этим не управляет. Если ошибка прорастает в логи
сервиса агента — это сигнал ему включить idempotent-INSERT (например,
через `ON CONFLICT DO NOTHING` или предварительный SELECT).

---

## 6. Контракты, которые НЕ ломать

- **POST SSE короткий**: эмитит только `agent_request_started` и
  завершается. Если делаешь правки в `forward_bridge.handle_forward_call`
  и хочется добавить ещё SSE-события — НЕ нужно. Реальный ответ всегда
  через Resume SSE (Chrome HTTP/1.1 connection limit).
- **Раннер — единственный source of truth** для save'а ассистент-message.
  Не добавляй save в Resume SSE или другие места.
- **Phase-разделение раннера** (initial / polling / finalize) — не сливать
  обратно: иначе pool deadlock при N параллельных forward'ах.
- **`_active_streams_per_user` лимит** только для POST SSE, не для Resume.
- **UNIQUE(request_id, seq)** на `agent_response_events` — не убирать.
  Без него сетевой retry агента → двойной reasoning во фронте.
