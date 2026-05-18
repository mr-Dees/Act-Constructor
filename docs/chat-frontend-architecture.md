# Frontend архитектура чата

## Обзор

Чат AI-ассистента в Act Constructor — это vanilla-JS приложение (ES6+) без
бандлера. Скрипты подключаются обычными `<script>`-тегами через Jinja2-шаблоны
в строгом порядке (см. раздел «Глобальные синглтоны и порядок скриптов»),
а модули общаются между собой через синхронную шину событий `ChatEventBus`.

Архитектура — event-driven, тонкий фасад `ChatManager` оркеструет 10 ядерных
модулей в `static/js/shared/chat/` и опциональный региональный модуль
`ChatPopupManager` для редактора актов. Бэкенд (`/api/v1/chat/...`) отдаёт
ответы через Server-Sent Events; фронт парсит их в `ChatStream`, маршрутизирует
по типам блоков в `ChatMessages._handleSSEEvent` и рендерит через
`ChatRenderer.renderBlock`. Список известных типов блоков (`KNOWN_BLOCK_TYPES`)
синхронизирован с `MessageBlock`-union в `app/core/chat/blocks.py`. Если бэк
прислал блок неизвестного типа — фронт не падает, а показывает
warning-плейсхолдер «⚠ Блок неизвестного типа …» (см. «Unknown-block
fallback»).

Чат имеет три режима отображения — inline (встроенный в правую панель портала),
modal (полноэкранный оверлей) и popup (плавающее окно с resize-углом
в конструкторе). Все три используют единый `ChatManager` и единый набор
ядерных модулей; различаются только обёртками-контейнерами.

## Модули

Все модули — синглтоны, публикующиеся в `window`. Файл за файлом:

### Ядерные модули (`static/js/shared/chat/`)

- **`chat-event-bus.js`** — pub/sub-шина событий чата. Объект-литерал
  `ChatEventBus` (`chat-event-bus.js:8`) с методами `on`, `off`, `offAll`,
  `emit`, `reset`. Хранит `_listeners: Set<function>` по имени события,
  ловит исключения из обработчиков и логирует их без останова рассылки
  (`chat-event-bus.js:60-65`). Подключается **первым** — все остальные
  модули используют его при инициализации.

- **`chat-renderer.js`** — рендерер блоков сообщений в DOM. Объект
  `ChatRenderer` (`chat-renderer.js:8`) с `renderBlock(block, opts)`
  (`chat-renderer.js:136-163`), `renderBlocks`, `appendBlock`,
  `createStreamingBlock(blockType)` (`chat-renderer.js:208`). Поддерживает
  типы text, code, reasoning, plan, file, image, buttons, client_action,
  error и default-ветку для неизвестных. Группирует подряд идущие reasoning
  в один сворачиваемый `<details class="chat-reasoning-group">`
  (`chat-renderer.js:74-127`). HTML, полученный из `_markdownToHtml`,
  санитизируется через DOMPurify в `_safeSetHtml` (`chat-renderer.js:25-42`).

- **`chat-client-actions.js`** — IIFE-модуль с реестром `ClientActionsRegistry`
  (`chat-client-actions.js:45`). Регистрирует стандартные команды
  `open_url`, `notify`, `trigger_sdk` (`chat-client-actions.js:153, 161, 178`).
  Обеспечивает идемпотентность через `block_id` и `sessionStorage`
  (`EXECUTED_STORAGE_KEY = 'chat:executedActions'`,
  `chat-client-actions.js:13-43`). Содержит whitelist URL-схем
  `ALLOWED_OPEN_URL_SCHEMES` (`chat-client-actions.js:124`) и `resolveProxyUrl`
  для подстановки JupyterHub-префикса (`chat-client-actions.js:142-151`).

- **`chat-stream.js`** — SSE-клиент. Объект `ChatStream` (`chat-stream.js:7`)
  с `send(conversationId, message, files, options)` (`chat-stream.js:37`),
  `sendJson` (для нестриминговых вызовов, `chat-stream.js:221`), `abort`.
  Внутри `_readSSE` читает `response.body.getReader()` чанками и парсит их
  через `_parseSSE` (`chat-stream.js:248`). При разрыве соединения во время
  forward'а к внешнему агенту автоматически переоткрывает resume-стрим
  (`/agent-request/{request_id}/stream?since=...`,
  `chat-stream.js:140-161`).

- **`chat-history.js`** — панель списка бесед. Объект `ChatHistory`
  (`chat-history.js:8`) с `loadConversations`, `createConversation`,
  `deleteConversation`, `selectConversation`, `resetToNew`. Все fetch'и идут
  через `AppConfig.api.getUrl(endpoint)` (`chat-history.js:57, 103, 141`).
  При смене беседы вызывает callback `onConversationChange`, который
  подключает `ChatContext.init()` (`chat-context.js:28-30`).

- **`chat-ui.js`** — UI-контроллер. Объект `ChatUI` (`chat-ui.js:8`) реагирует
  на события `ui:processing`, `ui:scroll-bottom`, `ui:typing-show`,
  `ui:typing-hide` (`chat-ui.js:35-38`). Управляет блокировкой input'а
  и кнопки отправки, авторесайзом textarea (`autoResizeInput`,
  `chat-ui.js:54-59`) и индикатором «печатает» (три точки).

- **`chat-files.js`** — менеджер прикрепляемых файлов. Объект `ChatFiles`
  (`chat-files.js:7`) с очередью `_pendingFiles`, валидацией размера
  и количества, drag-and-drop в `.chat-body`. Дефолтные лимиты `_FILE_LIMITS`
  (`chat-files.js:21-25`) перетягиваются с сервера через
  `/api/v1/chat/limits` (`chat-files.js:81-100`). Все DOM-listener'ы крепятся
  с `AbortController.signal` для чистого `destroy()`.

- **`chat-context.js`** — контекст беседы и domain-фильтр. Объект `ChatContext`
  (`chat-context.js:7`) с `ensureConversation()` (lazy-create с Promise-lock
  от двойной отправки, `chat-context.js:46-62`), `detectDomains()`
  (читает `<meta name="chat-domains">`, `chat-context.js:139-149`),
  `getEnabledKnowledgeBases()`. Также маппинг key→label баз знаний из
  `<meta name="chat-knowledge-bases">` либо из data-атрибутов
  (`chat-context.js:195-227`).

- **`chat-messages.js`** — оркестратор приёма SSE и рендер user/assistant
  сообщений. Объект `ChatMessages` (`chat-messages.js:29`) с публичным
  `KNOWN_BLOCK_TYPES` (`chat-messages.js:17-27`), `_handleSSEEvent`
  (`chat-messages.js:180-300`), `_createUnknownStreamingBlock`
  (`chat-messages.js:314-352`), `_renderUnknownBlock`
  (`chat-messages.js:362-381`). Запоминает welcome-сообщение как DOM-узел
  (`cloneNode`) для безопасного восстановления при `clearChat`
  (`chat-messages.js:58-61`).

- **`chat-manager.js`** — тонкий фасад. Класс `ChatManager`
  (`chat-manager.js:15`) со статикой `init()`, `destroy()`, `sendMessage()`,
  `clearChat()`. Атомарный флаг `_isSending` защищает от двойного
  клика/Enter до первого `await` (`chat-manager.js:23-28, 125-143`). Общий
  `AbortController` снимает все DOM-listener'ы одним `abort()`
  (`chat-manager.js:64-66, 102-105`).

- **`chat-modal.js`** — overlay-режим. Класс `ChatModalManager`
  (`chat-modal.js:8`) с `open`, `close`, ленивой инициализацией
  `ChatManager.init()` при первом открытии и Escape-handler'ом,
  который подключается только пока модалка открыта (`chat-modal.js:34-37,
  53-56`).

### Региональный модуль (`static/js/constructor/header/`)

- **`chat-popup.js`** — popup-режим для редактора актов. Класс
  `ChatPopupManager` (`chat-popup.js:7`) с `setup`, `open`, `close`,
  `toggle`. Делает **полный re-init** `ChatManager` при каждом открытии
  и `destroy()` при закрытии (`chat-popup.js:81-83, 106-108`) — чтобы
  не накапливались подписки на шину. Сохраняет размеры панели
  в `localStorage['chat_popup_size']` (`chat-popup.js:11, 186-211`),
  поддерживает свободный resize за угол (`chat-popup.js:126-180`).

## Шина событий (ChatEventBus)

Шина — синхронный pub/sub: `emit` пробегает по `Set` обработчиков с try/catch
вокруг каждого вызова (`chat-event-bus.js:56-66`). События не сериализуются
и не буферизуются — модули должны быть инициализированы и подписаны до
первой эмиссии.

### Каталог событий

| Событие | Эмитит | Слушает | Payload |
|---|---|---|---|
| `chat:send-request` | `ChatManager.sendMessage` (`chat-manager.js:139`) | `ChatMessages._onSendRequest` (`chat-messages.js:83`) | `{text, files}` |
| `chat:clear` | `ChatManager.clearChat` (`chat-manager.js:152`) | `ChatMessages`, `ChatContext` (`chat-context.js:34`) | — |
| `context:conversation-switched` | `ChatContext._onConversationSwitch` (`chat-context.js:181`) | `ChatMessages`, `ChatFiles` (`chat-files.js:44`) | `{conversationId, messages}` |
| `context:conversation-cleared` | `ChatContext._onConversationSwitch` (`chat-context.js:160`) | `ChatMessages`, `ChatFiles` (`chat-files.js:43`) | — |
| `ui:processing` | `ChatMessages._send` (`chat-messages.js:124, 169`) | `ChatUI._setProcessing` (`chat-ui.js:35`) | `{state: boolean}` |
| `ui:scroll-bottom` | `ChatMessages` (множество мест) | `ChatUI._scrollToBottom` (`chat-ui.js:36`) | — |
| `ui:typing-show` | `ChatMessages._send` (`chat-messages.js:140, 295`) | `ChatUI._showTypingIndicator` (`chat-ui.js:37`) | — |
| `ui:typing-hide` | `ChatMessages` (после ошибки/завершения) | `ChatUI._removeTypingIndicator` (`chat-ui.js:38`) | — |
| `files:changed` | `ChatFiles` (drag-drop, picker, удаление чипа) | — (внешние слушатели) | `{files: File[]}` |
| `files:cleared` | `ChatFiles.clear` (`chat-files.js:116`) | — (внешние слушатели) | — |

`ChatEventBus.reset()` (`chat-event-bus.js:71-73`) сбрасывает все подписки —
используется только в тестах.

## Жизненный цикл сообщения

Последовательность от ввода пользователя до отображения ответа:

1. **Инициализация.** Шаблон портала или конструктора грузит скрипты
   в правильном порядке (см. ниже). Каждый модуль публикуется в `window`.
   Конкретный режим (inline / modal / popup) вызывает `ChatManager.init()`
   (`chat-manager.js:33-93`).

2. **Ввод.** Пользователь набирает текст в `.chat-input`, при необходимости
   прикрепляет файлы через `ChatFiles` (picker или drag-drop в `.chat-body`).
   Авторесайз textarea и валидация файлов — onChange.

3. **Отправка.** Enter (без shift) или клик по `.chat-send-btn` →
   `ChatManager.sendMessage()` (`chat-manager.js:125`). Атомарный флаг
   `_isSending` ставится до первого `await`, защищая от двойного клика,
   и эмиттится `chat:send-request` с `{text, files}`.

4. **Подписчик `ChatMessages._send`** (`chat-messages.js:123-171`):
   - эмиттит `ui:processing {state: true}` → `ChatUI` блокирует input/send;
   - вызывает `ChatContext.ensureConversation()` — ленивое создание беседы
     через `POST /api/v1/chat/conversations` (с Promise-lock от дублей);
   - рендерит user-сообщение в DOM;
   - очищает очередь файлов и эмиттит `ui:typing-show`;
   - создаёт пустой контейнер бот-сообщения и вызывает `ChatStream.send(...)`.

5. **`ChatStream.send`** (`chat-stream.js:37-115`):
   - строит `FormData` (`message`, `domains` JSON-string, `files[]`)
     и URL `POST /api/v1/chat/conversations/{id}/messages` через
     `AppConfig.api.getUrl` (`chat-stream.js:316-321`);
   - читает SSE-поток через `response.body.getReader()`;
   - на каждое распарсенное событие вызывает `wrappedOnEvent`, который
     дополнительно отслеживает `agent_request_started` для авто-resume.

6. **`ChatMessages._handleSSEEvent`** (`chat-messages.js:180-300`) —
   маршрутизация по `event.type` (см. таблицу ниже). Стримящиеся блоки
   собираются в `_streamingBlocks` по `index` и склеиваются через
   `appendText`; нестримящиеся приходят целиком в `block_complete`;
   `buttons` и `client_action` имеют собственные SSE-события.

7. **Завершение.** `message_end` сбрасывает `_streamingBlocks`. `onDone`
   эмиттит `ui:typing-hide`, `ui:scroll-bottom`. `_send` в `finally`
   эмиттит `ui:processing {state: false}` — `ChatUI` снова разрешает ввод.

8. **Resume при разрыве.** Если соединение оборвалось пока ассистент ждёт
   ответа внешнего агента (поймали `agent_request_started`), `ChatStream`
   сам переоткроет SSE через GET `/agent-request/{req_id}/stream?since=...`
   (`chat-stream.js:88-106, 140-161`). Бэкенд продолжает фон-polling
   через `agent_bridge_runner` независимо от состояния фронта.

## SSE-протокол: типы блоков

Бэкенд эмиттит SSE-события трёх семейств:

| Событие | Семантика | Рендер на фронте |
|---|---|---|
| `message_start` | Старт ответа | `_streamingBlocks = {}`, прячется индикатор «печатает», показывается контейнер |
| `block_start` + `block_delta`+ `block_end` | **Стримящийся** блок (текст идёт чанками) | `ChatRenderer.createStreamingBlock(type)` → `appendText(delta)` → `finalize()` (`chat-messages.js:189-225`). Применяется к `text`, `code`, `reasoning` |
| `block_complete` | **Нестримящийся** блок с полным payload | `ChatRenderer.renderBlock(block)` сразу (`chat-messages.js:227-247`). Применяется к `file`, `image`, `plan`, `error` |
| `buttons` | Группа интерактивных кнопок | Собственное SSE-событие → `_renderButtons` (`chat-messages.js:255-259`) |
| `client_action` | Команда клиенту (`open_url`, `notify`, …) | Собственное SSE-событие → `_renderClientAction` + немедленное исполнение через реестр (`chat-messages.js:261-270`) |
| `tool_call` / `tool_result` | Отладочные события tool-вызовов | Игнорируются фронтом (`chat-messages.js:249-253`) |
| `error` | Доменная ошибка | Рендерится как ErrorBlock через `renderBlock({type:'error',...})` (`chat-messages.js:272-284`) |
| `agent_request_started` | Forward к внешнему агенту зарегистрирован | `_pendingAgentRequestId` сохраняется в `ChatStream`, показывается typing-индикатор (`chat-messages.js:290-296`, `chat-stream.js:121-127`) |
| `message_end` | Завершение ответа | Сброс `_streamingBlocks` (`chat-messages.js:286-288`) |

> **Важно.** Если эмитить нестримящийся блок как пару `block_start`+`block_end`
> без `block_delta`, фронт создаст пустой text-контейнер и сам блок появится
> только после перезагрузки истории. Это документировано в `CLAUDE.md` как
> регрессионная зона. Поэтому бэк (`app/domains/chat/services/streaming.py`)
> жёстко разделяет: text/code/reasoning → триплет; file/image/plan/error →
> один `block_complete`; buttons/client_action → свои события.

### Маппинг типов на рендереры

Все типы блоков перечислены в `KNOWN_BLOCK_TYPES`
(`chat-messages.js:17-27`) и обрабатываются в `ChatRenderer.renderBlock`
(`chat-renderer.js:140-163`):

| `block.type` | Метод | DOM-класс |
|---|---|---|
| `text` | `_renderText` | `.chat-block-text` |
| `code` | `_renderCode` (с заголовком: язык + «Копировать») | `.chat-block-code` |
| `reasoning` | `_renderReasoning` (свёрнутый `<details>`) | `.chat-block-reasoning` |
| `plan` | `_renderPlan` (список шагов со статусами) | `.chat-block-plan` |
| `file` | `_renderFile` (карточка + предпросмотр + скачать) | `.chat-block-file` |
| `image` | `_renderImage` (lazy + клик → viewer) | `.chat-block-image` |
| `buttons` | `_renderButtons` (группа кнопок → замена на бейдж после клика) | `.chat-block-buttons` |
| `client_action` | `_renderClientAction` (label-чип + опц. исполнение) | `.chat-block-client-action` |
| `error` | `_renderError` | `.chat-block-error` |
| (любой другой) | `_renderUnknown` | `.chat-block-unknown` |

## Unknown-block fallback

Бэк может ввести новый тип блока (например `chart`, `table_advanced`)
до того, как соответствующий фронт раскатится на всех пользователей. Чтобы
старая версия не падала — для неизвестных типов работает fallback:

- **Стримящийся неизвестный блок.** `_handleSSEEvent` на `block_start`
  с `type ∉ KNOWN_BLOCK_TYPES` вызывает
  `_createUnknownStreamingBlock(startType)` (`chat-messages.js:194-212`).
  Возвращается объект с тем же интерфейсом, что и
  `ChatRenderer.createStreamingBlock`: `{element, appendText, finalize}`
  (`chat-messages.js:314-352`). `appendText` пытается извлечь `delta.text`,
  иначе `JSON.stringify(delta)`, иначе `String(delta)` — содержимое
  накапливается в `<pre>` для отладки.

- **Нестримящийся неизвестный блок.** На `block_complete` с неизвестным
  `block.type` вызывается `_renderUnknownBlock(block)`
  (`chat-messages.js:232-244, 362-381`). Полный payload показывается в
  `<pre>` через `JSON.stringify(block, null, 2)`.

- **История из БД.** `ChatRenderer._renderUnknown(block)`
  (`chat-renderer.js:177-196`) делает то же самое для блоков из
  `_renderConversationMessages` — то есть случай «сообщение сохранено
  с неизвестным типом» обрабатывается симметрично live-стриму.

В DOM получается:

```html
<div class="chat-block chat-block-unknown">
  <div class="chat-block-unknown-notice">⚠ Блок неизвестного типа: chart. Обновите страницу.</div>
  <pre class="chat-block-unknown-payload">{...}</pre>
</div>
```

Стили — `static/css/shared/chat/chat-blocks.css:384-412` (жёлто-оранжевый
warning-бордер слева, моноширинный шрифт для payload, перенос длинных слов).

Console.warn пишется для каждого неизвестного блока — без падения
с trace'ом. Сценарий ручной проверки описан в
`docs/manual-qa-frontend-unknown-block.md`.

> **Синхронизация.** При добавлении нового типа блока в бэк
> (`MessageBlock` union в `app/core/chat/blocks.py` И `_DiscriminatedBlock`
> в `app/core/chat/schemas.py`) — обязательно добавить тип в
> `KNOWN_BLOCK_TYPES` (`chat-messages.js:17`) и в `switch` в
> `ChatRenderer.renderBlock` (`chat-renderer.js:140`).

## Режимы: inline / modal / popup

Все три режима используют **один и тот же** `ChatManager` и одни и те же
ядерные модули. Различаются только DOM-обёрткой и стратегией
инициализации:

### Inline

Используется на лендинге и в портале. Контейнер `.chat-messages`,
input `.chat-input` и кнопка `.chat-send-btn` уже присутствуют в DOM при
загрузке страницы. Инициализация вызывается из page-script'а явно
(`ChatManager.init()`). `destroy()` обычно не вызывается — чат живёт
вместе со страницей.

### Modal (`ChatModalManager`)

Используется на страницах, где нет встроенной чат-панели (acts-manager,
admin). DOM модального оверлея (`#chatModalOverlay`) присутствует в
шаблоне портала, но скрыт. `open()` (`chat-modal.js:19-41`):

1. показывает оверлей (убирает `.hidden`, ставит `body.chat-modal-open`);
2. при первом открытии — `ChatManager.init()` + `_setupCloseHandlers()`,
   флаг `_chatInitialized = true`;
3. подписывает Escape-handler **только на время открытия**, флаг
   `_escapeAttached` защищает от двойного `addEventListener`
   (`chat-modal.js:34-37`).

`close()` снимает Escape-handler через `removeEventListener` (защита
от утечки слушателя), но не вызывает `ChatManager.destroy()` — состояние
переживает повторные open/close.

### Popup (`ChatPopupManager`, конструктор)

Только на странице конструктора актов (`/constructor`). Подключается
из `templates/constructor/header/header_chat_panel.html` через
`#chatPopupPanel`. Региональный модуль `chat-popup.js` (не в shared) —
потому что popup имеет специфичную для редактора фичу: свободное
изменение размера за угол и сохранение размера в
`localStorage['chat_popup_size']`.

Ключевое отличие от modal: `ChatPopupManager.open` / `close` делают
**полный re-init** ChatManager при каждом открытии — `ChatManager.init()`
в `open`, `ChatManager.destroy()` в `close` (`chat-popup.js:81-83,
106-108`). Это нужно, чтобы каждое открытие давало свежий
`AbortController` и не накапливались подписки на шину после многократных
toggle'ов.

## Client actions

`ClientActionsRegistry` (`chat-client-actions.js:45-116`) — реестр
исполнителей чисто-клиентских команд. Бэк генерирует блок типа
`client_action`, фронт показывает label-чип в чате и опционально
выполняет действие.

### Стандартные handler'ы

Регистрируются в самом модуле (`chat-client-actions.js:153-188`):

- `open_url({url})` — навигация. Проверяет URL через `isAllowedUrl`
  (whitelist схем `ALLOWED_OPEN_URL_SCHEMES = ['http://', 'https://',
  'mailto:', '/']` (`chat-client-actions.js:124`)) — это **defense in
  depth** относительно `ALLOWED_OPEN_URL_SCHEMES` в
  `app/core/chat/blocks.py`. Запрещены `javascript:`, `data:`,
  `vbscript:`, `file:`. Перед `window.location.href` относительный путь
  прогоняется через `resolveProxyUrl` (см. ниже).

- `notify({message, level})` — показ уведомления через
  `window.Notifications.show`, с консольным fallback если модуль не
  подключён.

- `trigger_sdk({method, args})` — вызов произвольной `window`-функции.
  Защищён whitelist'ом `ALLOWED_SDK_METHODS = new Set([])`
  (`chat-client-actions.js:173-176`) — **пустой по умолчанию**. Метод
  добавляется в whitelist явно перед использованием. Без этого LLM мог
  бы вызвать `alert`, `fetch`, eval-аналоги — критично для безопасности.

Домен может зарегистрировать собственный handler через
`ClientActionsRegistry.register('my_action', fn)`.

### Идемпотентность через `block_id`

Бэк генерирует `block_id: uuid4` на каждый `ClientActionBlock`
(`app/core/chat/blocks.py:141`). Фронт ведёт `Set<string>` исполненных id,
сериализуется в `sessionStorage['chat:executedActions']`
(`chat-client-actions.js:13-43`). Soft cap — 500 элементов, при
переполнении выкидываются самые старые.

`ClientActionsRegistry.executeBlock(block)` (`chat-client-actions.js:83-99`)
— **единая точка** для исполнения с идемпотентностью:

```js
if (executed.has(blockId)) return;  // молча выходим, уже сделано
executed.add(blockId);
_persistExecuted();
this.execute(block.action, block.params || {});
```

Это закрывает три сценария: повтор SSE-события (например при retry),
рендер истории с уже исполненными блоками, перезагрузка вкладки
с открытым чатом (sessionStorage переживает reload).

**Старая семантика `{execute: true/false}`** через `_renderClientAction(opts)`
(`chat-renderer.js:584-614`) сохранена для совместимости. Новый код
должен вызывать `ClientActionsRegistry.executeBlock(block)` напрямую —
NOT `execute(action, params)`, иначе обойдётся `block_id`-проверка
и получится redirect-цикл.

### Sync с backend `names.py`

Имена действий — это магические строки. На бэке они вынесены в
`app/core/chat/names.py` (`ACTION_OPEN_URL`, `ACTION_NOTIFY`, …). На фронте
имена прибиты в `ClientActionsRegistry.register('open_url', ...)`
(`chat-client-actions.js:153, 161, 178`). Импорт из Python невозможен —
при переименовании action'а в `names.py` **обязательно** обновить строку
в `chat-client-actions.js` вручную. Иначе SSE-событие `client_action`
с новым именем молча перестанет исполняться (console.warn без падения).

## JupyterHub proxy: `AppConfig.api.getUrl`

В деплое на Greenplum приложение работает через JupyterHub proxy:
`/user/{user}/proxy/{port}/...`. Это значит, что относительный URL
`/api/v1/chat/...` браузер резолвит против origin'а — то есть на
`/api/v1/chat/...`, минуя `/user/{user}/proxy/{port}/`. Результат — 404.

`AppConfig.api.getUrl(endpoint)` подставляет правильный префикс.
В standalone-PG-деплое (`root_path = ''`) он возвращает endpoint как есть.

### Обязательные точки

**Все fetch к API** должны идти через `getUrl`:

| Модуль | Места вызова |
|---|---|
| `ChatFiles._loadLimits` | `chat-files.js:83` |
| `ChatContext._createConversation` (fallback ветка) | `chat-context.js:83` |
| `ChatContext._onConversationSwitch` | `chat-context.js:168` |
| `ChatStream._buildUrl` | `chat-stream.js:316-321` |
| `ChatStream._resumeAgentRequest` | `chat-stream.js:147-149` |
| `ChatHistory.loadConversations` | `chat-history.js:57` |
| `ChatHistory.createConversation` | `chat-history.js:103` |
| `ChatHistory.deleteConversation` | `chat-history.js:141` |
| `ChatRenderer._getFileUrl` | `chat-renderer.js:644-647` |

**Все `open_url` client-actions** с относительным URL — через
`resolveProxyUrl` (`chat-client-actions.js:142-151, 158`). Это нужно потому,
что бэк-handler'ы (`admin.open_admin_panel`, `acts.open_act_page`, …) отдают
URL вида `/admin`, `/constructor?act_id=...` (без знания о proxy-префиксе).

### Симптомы дыры

Если новый fetch использует относительный URL напрямую (`fetch('/api/v1/...')`),
то под JupyterHub'ом запрос уходит на `/api/v1/...`, JupyterHub роутит на
`/hub/api/v1/...` минуя `/user/{user}/proxy/{port}/` → **404**. На локальном
PG-деплое всё работает, баг проявится только в продакшене.

Поиск всех дыр в проекте:

```bash
grep -rn "fetch(\s*['\"\`]/api" static/js/
```

Каждый найденный `fetch` без `AppConfig.api.getUrl` — баг.

## Глобальные синглтоны и порядок скриптов

### Почему `window.X = ...`

Все ядерные модули объявляют свой объект и публикуют его в `window`:

```js
const ChatEventBus = { ... };
window.ChatEventBus = ChatEventBus;
```

Это сделано **намеренно**. Если объявить просто `const ChatEventBus = ...`
в `<script>`-блоке (без `window.X =`), переменная попадёт в Script-scope —
изолированную область видимости тега `<script>`. Обращения вида
`window.ChatEventBus.on(...)` из другого `<script>`-тега вернут `undefined`
и упадут.

То же касается `class ChatManager { ... }` — это объявление **не** создаёт
свойство `window.ChatManager` автоматически. Поэтому в конце каждого
модуля стоит явное `window.ChatManager = ChatManager`.

Эта особенность отдельно прибита в `CLAUDE.md`: пропуск `window.X =` —
типовая ошибка при добавлении нового модуля.

### Порядок подключения

Без бандлера порядок `<script>`-тегов критичен. `ChatEventBus` нужен всем
остальным, `ChatRenderer` — `ChatMessages`, `ClientActionsRegistry` — нужен
`ChatRenderer` (на момент `executeBlock`), и так далее.

Канонический порядок (`templates/portal/base_portal.html:57-67`,
`templates/constructor/base_constructor.html:64-74`):

```html
<script src="js/shared/chat/chat-event-bus.js"></script>
<script src="js/shared/chat/chat-renderer.js"></script>
<script src="js/shared/chat/chat-client-actions.js"></script>
<script src="js/shared/chat/chat-stream.js"></script>
<script src="js/shared/chat/chat-history.js"></script>
<script src="js/shared/chat/chat-ui.js"></script>
<script src="js/shared/chat/chat-files.js"></script>
<script src="js/shared/chat/chat-context.js"></script>
<script src="js/shared/chat/chat-messages.js"></script>
<script src="js/shared/chat/chat-manager.js"></script>
<!-- portal-only: chat-modal.js -->
<!-- constructor-only: js/constructor/header/chat-popup.js -->
```

Логика порядка:

1. `chat-event-bus.js` — первым (его использует каждый).
2. `chat-renderer.js` — раньше всех модулей, которые рендерят
   (`ChatMessages`, `ChatHistory`).
3. `chat-client-actions.js` — раньше `ChatRenderer._renderClientAction`
   (фактически — раньше любого исполнения, но проще держать сразу за
   renderer'ом).
4. `chat-stream.js` — независим, но удобно поставить рядом с renderer.
5. `chat-history.js` — используется `ChatContext.init`, поэтому раньше
   `chat-context.js`.
6. `chat-ui.js`, `chat-files.js` — слушают шину, могут быть в любом порядке
   между event-bus и manager'ом, но `ChatFiles` использует
   `ChatUI.isProcessing()` в drop-handler'е.
7. `chat-context.js` — использует `ChatHistory`, но `ChatHistory.init`
   вызывается уже из `ChatContext.init`, так что `ChatHistory` должен быть
   определён к моменту вызова `ChatContext.init()` (а не к моменту
   объявления).
8. `chat-messages.js` — использует `ChatRenderer`, `ChatStream`, `ChatUI`,
   `ChatFiles`, `ChatContext` через `init` — должен идти последним из
   ядра.
9. `chat-manager.js` — фасад, инициализирует все остальные.
10. `chat-modal.js` (только в портале) — использует `ChatManager`.
11. `chat-popup.js` (только в конструкторе) — использует `ChatManager`.

### Точки риска при добавлении модуля

- Забыть `window.X = X` → `undefined` при доступе из другого `<script>`.
- Вставить `<script>` до `chat-event-bus.js` → ReferenceError на
  `ChatEventBus` в `init()`.
- Добавить новый тип блока на бэк, забыть `KNOWN_BLOCK_TYPES` и
  `ChatRenderer.renderBlock` switch — пользователь увидит unknown-block
  fallback. Это не критично (graceful), но повод обновить фронт.
- Добавить новый client-action на бэк (`names.py`), забыть
  `ClientActionsRegistry.register(...)` — действие молча перестанет
  работать (console.warn).
- Добавить новый fetch с относительным URL без `AppConfig.api.getUrl` →
  404 под JupyterHub.
