# Manual QA — feature/external-agent-bridge

Чек-лист ручной проверки моста к внешнему ИИ-агенту перед merge'ом ветки.

## Подготовка

1. Поднять PostgreSQL и применить миграцию (`app/domains/chat/migrations/postgresql/schema.sql`):
   - Должны появиться таблицы `agent_requests`, `agent_response_events`, `agent_responses` и sequence `agent_response_events_id_seq`.

2. Заполнить `.env.local` (dev на OpenRouter):
   ```
   CHAT__PROFILE=openrouter
   CHAT__API_BASE=https://openrouter.ai/api/v1
   CHAT__API_KEY=<твой ключ>
   CHAT__MODEL=minimax/minimax-m2:free
   CHAT__SMALLTALK_MODE=local
   CHAT__RETRY__ON_429=true
   CHAT__RETRY__ON_5XX=true
   CHAT__AGENT_BRIDGE__POLL_INTERVAL_SEC=1.0
   CHAT__AGENT_BRIDGE__INITIAL_RESPONSE_TIMEOUT_SEC=300
   CHAT__AGENT_BRIDGE__EVENT_TIMEOUT_SEC=120
   CHAT__AGENT_BRIDGE__MAX_TOTAL_DURATION_SEC=1800
   ```

3. Запустить `uvicorn app.main:app --reload`, открыть портал в браузере.

## Чек-лист

### 1. Small-talk локально
- Написать в чат: «Привет, как дела?»
- Ожидаемо: LLM отвечает локально (без записи в `agent_requests`).
- Проверить: `SELECT count(*) FROM agent_requests` — не должно увеличиться.

### 2. Forward на внешнего агента
- Написать: «Расскажи про регламент 2024 года».
- Ожидаемо: появилась строка `pending` в `agent_requests`.
- Через DBeaver выполнить сценарий §1 из `external-agent-imitation.sql`:
  имитировать reasoning + финальный ответ агента.
- Ожидаемо: в чате появились блоки reasoning и финальный текст.

### 3. Action-tool — открыть акт
- Написать: «Открой акт КМ-23-00001».
- Ожидаемо: LLM вызывает `acts.open_act_page`, фронт переходит на `/constructor?act_id={id}` (где `id` — INTEGER из `acts.id`).

### 4. Action-tool — уведомление
- Написать: «Покажи уведомление "Готово"».
- Ожидаемо: появляется toast «Готово» через `window.Notifications.show`.

### 5. Файлы
- Прикрепить PDF (≤1 МБ) и спросить про его содержимое.
- Ожидаемо: в `agent_requests.files[0].extracted_text` — извлечённый текст PDF; `extracted_text` для PNG равен `null`.

### 6. Таймаут агента
- Forward'нуть вопрос, но НЕ имитировать ответ агента дольше `EVENT_TIMEOUT_SEC` (по умолчанию 120с — гейт 2 «heartbeat между событиями»).
- Ожидаемо: SSE содержит ошибку «Внешний агент не ответил вовремя»; `agent_requests.status='timeout'`.
- Можно проверить остальные гейты отдельно: `INITIAL_RESPONSE_TIMEOUT_SEC` (нет первого события) и `MAX_TOTAL_DURATION_SEC` (общая длительность). Подробнее — `docs/developer-guide.md` §7.8.

### 7. Восстановление SSE
- Forward'нуть вопрос, во время ожидания перезагрузить страницу.
- В DevTools / curl выполнить:
  ```
  GET /api/v1/chat/conversations/<id>/agent-request/<rid>/stream?since=0
  ```
- Ожидаемо: стрим возобновляется, видны накопленные events + финал.

### 8. Profile-switch на SGLang
- Сменить `.env` на профиль `sglang` (внутренний адрес), перезапустить.
- Повторить сценарии 1–4.
- Ожидаемо: всё работает без правки кода.
