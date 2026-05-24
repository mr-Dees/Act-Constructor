# Retry: сценарии для тестов (Волна 3)

Документ описывает поведение `retry_on_transient`
(`app/domains/chat/services/retry.py`) после расширения coverage (Stream 3.8).

Конфигурация по умолчанию: `on_429=True, on_5xx=True, max_attempts=N, backoff_base=B`.

## Таблица сценариев

| # | Сценарий | Исключение / HTTP | Ожидание |
|---|----------|-------------------|----------|
| 1 | Rate-limit повторяемый | `APIStatusError(429)` | Ретрай, успех на 2-3 попытке |
| 2 | Rate-limit отключён | `APIStatusError(429)`, `on_429=False` | Без ретрая, проброс |
| 3 | Server error 500 | `APIStatusError(500)` | Ретрай |
| 4 | Server error 502 Bad Gateway | `APIStatusError(502)` | Ретрай |
| 5 | Server error 503 Service Unavailable | `APIStatusError(503)` | Ретрай |
| 6 | Server error 504 Gateway Timeout | `APIStatusError(504)` | Ретрай |
| 7 | 5xx отключены | `APIStatusError(503)`, `on_5xx=False` | Без ретрая |
| 8 | 408 Request Timeout | `APIStatusError(408)` | Ретрай (всегда, независимо от флагов) |
| 9 | 400 Bad Request | `APIStatusError(400)` | Без ретрая, проброс |
| 10 | 401 Unauthorized | `APIStatusError(401)` | Без ретрая |
| 11 | 403 Forbidden | `APIStatusError(403)` | Без ретрая |
| 12 | 404 Not Found | `APIStatusError(404)` | Без ретрая |
| 13 | 422 Unprocessable Entity | `APIStatusError(422)` | Без ретрая |
| 14 | Сеть: `httpx.ConnectError` | подключение оборвано | Ретрай |
| 15 | Сеть: `httpx.ReadTimeout` | чтение зависло | Ретрай |
| 16 | Сеть: `httpx.WriteTimeout` | запись зависла | Ретрай |
| 17 | Сеть: `httpx.RemoteProtocolError` | сервер закрыл соединение преждевременно | Ретрай |
| 18 | Сеть: `httpx.PoolTimeout` | исчерпан пул соединений | Ретрай |
| 19 | OpenAI SDK: `APITimeoutError` | обёртка над `httpx.ReadTimeout` | Ретрай |
| 20 | OpenAI SDK: `APIConnectionError` | обёртка над `httpx.ConnectError` | Ретрай |
| 21 | Доменное: `ChatLimitError` | лимит токенов/сообщений | Без ретрая |
| 22 | Доменное: `ChatFileValidationError` | невалидный файл | Без ретрая |
| 23 | Доменное: `ChatRateLimitError` | per-user rate-limit | Без ретрая |
| 24 | Произвольное `ValueError` / `RuntimeError` | бизнес-логика | Без ретрая |
| 25 | Исчерпание попыток | retryable, не успело — `max_attempts=2`, всегда 429 | Проброс последнего исключения |
| 26 | Без ошибок | функция возвращает результат сразу | Один вызов, результат отдан |
| 27 | Backoff растёт экспоненциально | retryable 3 раза подряд | Задержки `B*1`, `B*2`, `B*4` (+ jitter), capped at 60s |

## Edge-cases

- `code is None` в `APIStatusError` — не ретраить (на всякий случай защищены).
- `backoff_base=0.0` в тестах — задержка фактически равна jitter `[0, 0.5)`, тесты должны
  моки `asyncio.sleep`, чтобы не тормозили pytest.
- `_NEVER_RETRY_EXC` имеет приоритет над `_RETRYABLE_NETWORK_EXC`: если доменное
  исключение наследует `httpx.HTTPError`, оно всё равно не ретраится (на данный
  момент таких пересечений нет, проверка для будущего).

## Что НЕ покрыто (намеренно)

- Тесты, где провайдер возвращает 200 с пустым телом / битым JSON — это
  не retry-зона, а парсинг-логика оркестратора.
- `agent_bridge` polling — у него собственный retry-механизм через
  таймауты, см. `app/domains/chat/services/agent_bridge.py`.
