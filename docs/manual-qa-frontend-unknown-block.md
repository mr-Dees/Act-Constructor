# Manual QA — fallback на неизвестные типы блоков чата

Чек-лист ручной проверки graceful degradation фронт-чата, когда бэк добавляет
новый тип блока (например `chart`, `table_advanced`), которого ещё нет в
whitelist'е `KNOWN_BLOCK_TYPES` в `static/js/shared/chat/chat-messages.js`.

Ожидание: вместо падения или пропажи блока пользователь видит плашку
«⚠ Блок неизвестного типа: <type>. Обновите страницу.» и полный payload
блока в `<pre>` для отладки. Сообщение чата остаётся читаемым.

## Подготовка

1. Запустить приложение (`uvicorn app.main:app --reload`), открыть портал
   в браузере, открыть любой чат (inline, modal или popup).
2. Открыть DevTools → Console.
3. Удостовериться, что глобальные синглтоны подцеплены:
   ```js
   typeof ChatEventBus    // 'object'
   typeof ChatMessages    // 'object'
   typeof ChatRenderer    // 'object'
   ChatMessages.KNOWN_BLOCK_TYPES  // Set из 9 типов
   ```

## Сценарий 1 — нестримуемый блок (`block_complete`)

Имитируем приход одного `block_complete` с неизвестным `type`. Для
выполнения нужен открытый контейнер сообщения — можно отправить любое
безобидное сообщение в чат и сразу выполнить snippet ниже **до** того,
как стрим закроется, либо использовать сценарий 3.

Простейший способ — вручную дёрнуть `ChatRenderer.renderBlock` и вставить
результат в DOM:

```js
const block = {
  type: 'chart_v2',
  block_id: 'qa-unknown-1',
  payload: { series: [1, 2, 3], title: 'demo' },
};
const el = ChatRenderer.renderBlock(block);
document.querySelector('.chat-message-content:last-of-type').appendChild(el);
```

**Ожидание:**
- В DOM появляется блок с классом `chat-block-unknown`.
- Текст: `⚠ Блок неизвестного типа: chart_v2. Обновите страницу.`
- Ниже — `<pre>` с pretty-printed JSON всего блока.
- В консоли: `ChatRenderer: неизвестный тип блока chart_v2 {...}`.
- Стилизация: жёлтый warning-фон (`--warning-subtle`), `border-left`
  толщиной `--border-width-thick` цвета `--warning`, текст плашки курсивом.

## Сценарий 2 — стримовый блок (`block_start` + `block_delta` + `block_end`)

Имитируем приход триплета SSE-событий для блока неизвестного типа.

```js
// Нужно поймать живой контейнер бот-сообщения; самый простой способ —
// отправить «привет» в чат, дождаться появления нового message и
// выполнить вызовы ниже до завершения стрима.
const container = document.querySelector(
  '.chat-message-bot:last-of-type .chat-message-content'
);

// 1) block_start: создаём fallback-streaming-блок
ChatMessages._handleSSEEvent(
  { type: 'block_start', data: { type: 'table_advanced', index: 99 } },
  container,
);

// 2) block_delta: дописываем кусок payload'а
ChatMessages._handleSSEEvent(
  { type: 'block_delta', data: { index: 99, delta: '{"rows":' } },
  container,
);
ChatMessages._handleSSEEvent(
  { type: 'block_delta', data: { index: 99, delta: ' [1,2,3]}' } },
  container,
);

// 3) block_end: финализируем
ChatMessages._handleSSEEvent(
  { type: 'block_end', data: { index: 99 } },
  container,
);
```

**Ожидание:**
- В консоли: `ChatMessages: unknown block type table_advanced {...}`.
- В DOM — блок `.chat-block-unknown` с плашкой
  `⚠ Блок неизвестного типа: table_advanced. Обновите страницу.`
- В `<pre>` накапливается delta: `{"rows": [1,2,3]}`.

Проверить, что delta-чанк нестандартной формы (`object` без `text`)
не валит handler:

```js
ChatMessages._handleSSEEvent(
  { type: 'block_start', data: { type: 'widget_x', index: 100 } },
  container,
);
ChatMessages._handleSSEEvent(
  { type: 'block_delta', data: { index: 100, delta: { foo: 'bar' } } },
  container,
);
```

В `<pre>` должен появиться `[object Object]` — нет, JSON-stringify:
`{"foo":"bar"}` (хелпер `_createUnknownStreamingBlock.appendText` пытается
вытащить `.text`, иначе JSON.stringify).

## Сценарий 3 — рендер истории с неизвестным типом

Имитируем загрузку беседы, в которой одно из сохранённых сообщений
ассистента содержит блок неизвестного типа (типичный регресс: пользователь
переключил браузерную вкладку на старую версию фронта после деплоя
нового бэка).

```js
ChatEventBus.emit('context:conversation-switched', {
  conversationId: 'qa-fake-conv',
  messages: [
    {
      role: 'assistant',
      content: [
        { type: 'text', content: 'Обычный текст до неизвестного блока.' },
        { type: 'future_block', block_id: 'qa-2', some_field: 42 },
        { type: 'text', content: 'И ещё текст после.' },
      ],
    },
  ],
});
```

**Ожидание:**
- Сообщение ассистента рендерится целиком: два текстовых блока + между ними
  fallback-плашка для `future_block`.
- В консоли: `ChatRenderer: неизвестный тип блока future_block {...}`.
- Старые типы блоков (`text`, `code`, `reasoning`, …) продолжают
  рендериться штатно.

## Регресс — известные типы не сломаны

Отправить обычное сообщение в чат, убедиться, что:
- text-блоки приходят через `block_start`+`block_delta`+`block_end` и
  рендерятся в `chat-block-text` (НЕ в `chat-block-unknown`).
- `file`/`image`/`plan`/`error` приходят через `block_complete` и
  рендерятся в свои классы.
- `buttons` и `client_action` отображаются как раньше.
- В консоли НЕТ warning'ов про unknown block type.
