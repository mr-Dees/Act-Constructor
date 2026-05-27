# Архитектура фронтенда Act Constructor

> Единый документ по всему фронту проекта (зоны `shared/`, `portal/`, `constructor/`). Чат описан отдельно — см. главу 14 и [`docs/chat-frontend-architecture.md`](chat-frontend-architecture.md).
>
> Источник истины — код в `static/js/`, `static/css/`, `templates/`. Все ссылки `file:line` сверены grep'ом на момент написания. При расхождении документа и кода — источник истины код.

## Оглавление

1. [Обзор](#1-обзор)
2. [Глобальные синглтоны и порядок скриптов](#2-глобальные-синглтоны-и-порядок-скриптов)
3. [`AppConfig` и проксирование (JupyterHub)](#3-appconfig-и-проксирование-jupyterhub)
4. [`AppState` и состояние конструктора](#4-appstate-и-состояние-конструктора)
5. [`StorageManager` и persistence](#5-storagemanager-и-persistence)
6. [`LockManager` и inactivity](#6-lockmanager-и-inactivity)
7. [Tree, items, per-node render API](#7-tree-items-per-node-render-api)
8. [`PreviewManager`](#8-previewmanager)
9. [Диалоги](#9-диалоги)
10. [Acts manager и кросс-доменная навигация](#10-acts-manager-и-кросс-доменная-навигация)
11. [Безопасность и санитизация](#11-безопасность-и-санитизация)
12. [Accessibility и i18n](#12-accessibility-и-i18n)
13. [CSS-архитектура](#13-css-архитектура)
14. [Чат](#14-чат)
15. [Открытые техдолги](#15-открытые-техдолги)

---

## 1. Обзор

Act Constructor — Server-side rendered (Jinja2) + vanilla JS приложение **без бандлера и без npm-зависимостей**. Браузер грузит десятки `<script defer>`-тегов в строго заданном порядке; модули общаются через глобальные синглтоны на `window`. ES-modules не используются (исторически, чтобы упростить деплой в JupyterHub-окружении без node-tooling'а).

### 1.1 Цифры (на момент аудита)

| Параметр | Значение |
|---|---|
| Всего JS-файлов | 101 (`static/js/**/*.js`) |
| `constructor/` (редактор актов) | 54 файла |
| `shared/` (cross-zone модули + чат) | 25 файлов (включая 12 модулей чата) |
| `portal/` (sidebar-страницы) | 22 файла |
| Всего CSS-файлов | 78 |
| `constructor/` CSS | 42 файла |
| `portal/` CSS | 15 файлов |
| `shared/` CSS | 14 файлов |
| `base/` CSS | 4 файла |
| CSS-переменных в `variables.css` | 576 |

### 1.2 Три зоны

```
static/js/
├── shared/      # Cross-zone: AppConfig, APIClient, AuthManager,
│   │            #   Notifications, SafeHTML, ErrorBoundary, DialogBase/Manager,
│   │            #   FilterEngine, ck/* (CkTable, CkForm, CkPagination, CkProcessPicker)
│   ├── dialog/  # DialogBase + DialogManager (confirm/alert)
│   ├── ck/      # Реюзаемые компоненты ЦК-страниц
│   └── chat/    # 12 модулей чата — реестр в docs/chat-frontend-architecture.md
│
├── portal/      # Sidebar-страницы: landing, acts-manager, admin, ck-fin-res, ck-client-exp
│   ├── acts-manager/   # ActsManagerPage, CreateActDialog, AuditLogDialog,
│   │                   #   VersionPreviewOverlay, DiffEngine/Renderer, ActsBroadcast
│   ├── admin/          # AdminPage (roles/diagnostics/audit-log)
│   ├── ck-fin-res/     # ЦК «финансовые результаты»
│   └── ck-client-exp/  # ЦК «клиентский опыт»
│
└── constructor/ # Редактор актов (`/constructor?act_id=...`)
    ├── state/        # AppState (state-core + state-tree + state-content),
    │                 #   MetricsRiskCoordinator
    ├── tree/         # TreeManager, TreeRenderer, TreeDragDrop, TreeUtils
    ├── items/        # ItemsRenderer (per-node DOM updates),
    │                 #   ItemsTitleEditing
    ├── table/        # TableManager + cells-operations + sizes
    ├── textblock/    # TextBlockManager + editor + formatting + toolbar
    │                 #   + links-footnotes
    ├── violation/    # ViolationManager (10 файлов)
    ├── preview/      # PreviewManager + per-type renderer'ы
    ├── dialog/       # HelpManager, InvoiceDialog
    ├── context-menu/ # 5 файлов (tree, cells, violation, links-footnotes, core)
    ├── header/       # Топбар: acts-menu, settings-menu, preview-menu,
    │                 #   format-menu-manager, header-exit, chat-popup
    ├── validation/   # 5 модулей (act/tree/table/core/result)
    └── services/     # id-generator (audit_point_id)
```

CSS повторяет тройное разделение — см. главу 13.

### 1.3 Backend-routes

| URL | Шаблон | Что грузится |
|---|---|---|
| `/` | `landing/landing.html` (extends `base_portal.html`) | inline-чат |
| `/acts` | `acts-manager/acts_manager.html` | список актов |
| `/admin` | `admin/admin.html` | 3 таба |
| `/ck-fin-res`, `/ck-client-exp` | `ck/ck_*.html` (extends `_ck_layout.html`) | редактор записей ЦК |
| `/constructor?act_id={int}` | `constructor/constructor.html` (extends `base_constructor.html`) | редактор актов |

`/constructor` принимает обязательный `act_id: int` — обработчик в `app/domains/acts/routes/constructor.py` редиректит на `/acts` при невалидном значении.

### 1.4 Связанные документы

- [`docs/chat-frontend-architecture.md`](chat-frontend-architecture.md) — чат-фронт (565 строк, 12 модулей, SSE).
- [`docs/developer-guide.md`](developer-guide.md) §4 — высокоуровневый обзор фронта.
- [`docs/developer-guide.md`](developer-guide.md) §10 — UX/persistence/lock.
- [`docs/forward-sequence.md`](forward-sequence.md) — sequence-диаграммы forward'а к внешнему агенту.
- [`docs/cross-domain-contracts.md`](cross-domain-contracts.md) — контракты между бэк-доменами.
- `tests/test_template_script_order.py` — pytest snapshot инвариантов порядка `<script>` тегов.

---

## 2. Глобальные синглтоны и порядок скриптов

### 2.1 Почему так

Без бандлера/ES-modules модули не могут импортировать друг друга. Контракт коммуникации:

1. Каждый модуль на module-level либо явно публикует синглтон в `window` (`window.X = ...`), либо объявляет top-level `const X = ...`.
2. Потребители обращаются к `window.X` или просто `X` (Script-scope в DOM-document'е).
3. Порядок `<script defer>` тегов в шаблоне гарантирует, что зависимости загружены первыми.

### 2.2 Ловушка `const` ≠ `window.X`

`const X = new ...` в `<script>`-блоке создаёт переменную в **Script-scope**, которая видна как голое имя `X`, но **не** становится свойством `window`. Обращения `window.X.method()` для таких объектов вернут `undefined`. Это load-bearing инвариант: при добавлении новых синглтонов выбирайте паттерн осознанно.

Случаи в коде:

| Паттерн | Пример | Видно как |
|---|---|---|
| `window.X = new ...` | `window.Notifications = new NotificationManager()` (`shared/notifications.js:436`) | `Notifications` (Script-scope) **и** `window.Notifications` |
| `class X { static ... }; window.X = X;` | `window.AuthManager = AuthManager;` (`shared/auth.js:303`) | `AuthManager` **и** `window.AuthManager` |
| `const X = new ...` | `const treeManager = new TreeManager('tree')` (`constructor/tree/tree-core.js:449`) | только `treeManager` (Script-scope) |
| IIFE + `window.X = ...` | `(function(){ ... window.SafeHTML = {...}; })()` (`shared/sanitize.js:14,98`) | только `window.SafeHTML` |

`new ...` на module-level выполняется **сразу** после загрузки скрипта — это значит, что `tree-core.js` упадёт с `TreeRenderer is not defined`, если `tree-renderer.js` ещё не загрузился. Поэтому порядок `<script>` в шаблоне load-bearing.

### 2.3 Реестр window-экспортов

**`shared/` (общедоступны на всех страницах):**

| File:Line | Объект | Тип |
|---|---|---|
| `shared/api.js` | `APIClient`, `LockLostError` | static class + Error subclass |
| `shared/auth.js:303` | `window.AuthManager` | static class |
| `shared/notifications.js:436` | `window.Notifications` | **instance** |
| `shared/sanitize.js:98` | `window.SafeHTML` | object literal |
| `shared/error-boundary.js:86` | `window.ErrorBoundary` | static class |
| `shared/filter-engine.js:68` | `window.FilterEngine` | static class |
| `shared/dialog/dialog-base.js:438` | `window.DialogBase` | static class |
| `shared/dialog/dialog-confirm.js:296` | `window.DialogManager` | static class |
| `shared/ck/ck-pagination.js` | `window.CkPagination` | static class |
| `shared/ck/ck-table.js` | `window.CkTable` | static class |
| `shared/ck/ck-form.js` | `window.CkForm` | static class |
| `shared/ck/ck-process-picker.js` | `window.CkProcessPicker` | static class (extends DialogBase) |

**`shared/chat/`** — 13 синглтонов на `window`. Полный реестр и подробности — [`docs/chat-frontend-architecture.md`](chat-frontend-architecture.md). Cross-zone-точки сцепки (`ChatEventBus`, `ChatPopupManager`, `ChatManager`, `ChatModalManager`) — см. §14.

**Top-level classes, НЕ на `window`:**

| File:Line | Объект | Где доступен |
|---|---|---|
| `shared/app-config.js:7` | `AppConfig` (`class AppConfig { static ... }`) | Везде, где загружен `app-config.js` (portal + constructor) |
| `constructor/storage-manager.js` | `StorageManager` (`class StorageManager { static ... }`) | Только constructor-зона (`base_constructor.html`); в `portal/` НЕ существует |

В classic-скрипте top-level `class X {}` доступен как **global binding** (голое имя `X`), но **не** становится свойством `window`. Поэтому `window.AppConfig` / `window.StorageManager` всегда `undefined` — проверки через `window.X` мертвы. Корректный гард: `typeof X !== 'undefined'`. Cross-zone обращения (например, из `portal/*` к `StorageManager`) всегда дают `undefined` — учитывай при добавлении новой логики.

**`constructor/` — явные `window.X = ...`:**

| File:Line | Объект |
|---|---|
| `constructor/changelog-tracker.js:160` | `window.ChangelogTracker` |
| `constructor/lifecycle-helper.js:58` | `window.LifecycleHelper` |
| `constructor/lock-manager.js:761` | `window.LockManager` |
| `constructor/state/metrics-risk-coordinator.js:141` | `window.MetricsRiskCoordinator` |
| `constructor/dialog/dialog-help.js:229` | `window.HelpManager` |
| `constructor/dialog/dialog-invoice.js:1302` | `window.InvoiceDialog` |
| `constructor/header/acts-menu.js:668` | `window.ActsMenuManager` |
| `constructor/header/chat-popup.js:219` | `window.ChatPopupManager` |
| `constructor/header/header-exit.js:186` | `window.HeaderExit` |
| `constructor/header/settings-menu.js:304` | `window.SettingsMenuManager` |
| `constructor/header/preview-menu.js:342` | `window.previewMenuManager` (единственный lowercase singleton) |

**`constructor/` — top-level `const` (НЕ свойства `window`):**

| File:Line | Объект |
|---|---|
| `constructor/state/state-core.js:8` | `const AppState = {...}` |
| `constructor/tree/tree-utils.js:7` | `const TreeUtils = {...}` |
| `constructor/tree/tree-core.js:449` | `const treeManager = new TreeManager('tree')` |
| `constructor/table/table-core.js:340` | `const tableManager = new TableManager('tablesContainer')` |
| `constructor/textblock/textblock-core.js:106` | `const textBlockManager = new TextBlockManager()` |
| `constructor/violation/violation-init.js:7` | `const violationManager = new ViolationManager(); violationManager.initialize();` |
| `constructor/context-menu/context-menu-links-footnotes.js` (через `textblock-links-footnotes.js:6`) | `const linkFootnoteContextMenu = new LinkFootnoteContextMenu()` |

Доступ к ним — голое имя (`treeManager.render()`, `AppState.treeData`), `window.treeManager` вернёт `undefined`.

Дополнительно `base_constructor.html:37` мутирует `window.actMetadata = null` (заполняется в `APIClient.loadActContent`) и `window.currentActId` (выставляется в `acts-menu.js`).

### 2.4 Канонический порядок `<script>`

#### `templates/portal/base_portal.html` (~23 тега, включая 12 chat-модулей)

1. `app-config.js`, `auth.js`, `api.js`, `notifications.js` — базовая инфраструктура.
2. `error-boundary.js` — **сразу** после `notifications.js` (boundary использует `Notifications.error` для toast'ов).
3. `dialog/dialog-base.js`, `dialog/dialog-confirm.js`.
4. `portal-sidebar.js`.
5. `dompurify/purify.min.js` → `sanitize.js` (SafeHTML обязан видеть `window.DOMPurify`).
6. `chat-event-bus.js` (первым среди чата — остальные модули подписываются на шину на module-level).
7. Остальные 11 чат-модулей в порядке зависимостей (renderer → client-actions → stream → history → ui → files → title → context → messages → manager → modal).
8. `portal-settings.js`.

`base_portal.html:46-78`. Все теги — `defer`.

#### `templates/constructor/base_constructor.html` (~79 тегов)

`app-config.js` и `auth.js` — sync (без `defer`), потому что следом идёт sync inline-блок (`base_constructor.html:34-54`), инициализирующий `window.__authReady` (promise готовности авторизации). Все init-обработчики, использующие `AuthManager.getCurrentUser()`, обязаны `await window.__authReady` — иначе при пустом/истёкшем localStorage первый API-вызов уйдёт без `X-JupyterHub-User`.

После inline-блока (`base_constructor.html:56–165`) — defer-каскад:

| Группа | Строки шаблона | Комментарий |
|---|---|---|
| `header-exit.js` | 56 | |
| `notifications.js` → `error-boundary.js` | 59–63 | error-boundary СРАЗУ после Notifications |
| `changelog-tracker.js`, `lifecycle-helper.js`, `storage-manager.js` | 64–66 | До `app.js` (использует все три) |
| `api.js`, `app.js`, `navigation-manager.js`, `format-menu-manager.js`, `settings-menu.js` | 67–71 | |
| `dompurify` → `sanitize.js` | 74–77 | |
| 12 chat-модулей + `chat-popup.js` | 80–91 | `chat-event-bus.js` первым |
| Диалоги: `dialog-base`, `dialog-confirm`, `team-member-search`, `appendix-number-dropdown`, `dialog-create-act`, `dialog-help`, `dialog-invoice` | 94–100 | |
| Контекстные меню: `core` → tree/cells/violation/links-footnotes | 103–107 | core первым |
| `services/id-generator.js` | 110 | |
| State: `state-core` → `state-tree` → `state-content` → `metrics-risk-coordinator` | 113–116 | `state-tree`/`state-content` делают `Object.assign(AppState, ...)` — требуют state-core |
| Tree: `tree-drag-drop` → `tree-renderer` → `tree-core` → `tree-utils` | 119–122 | `tree-core.js:449` создаёт singleton, требует все три |
| Items: `items-title-editing` → `items-renderer` | 125–126 | |
| Table: `table-cells-operations` → `table-sizes` → `table-core` | 129–131 | core инстанцирует TableCellsOperations и TableSizes |
| Preview: `preview` → table/textblock/violation-renderer | 134–137 | |
| Textblock: `core` → editor → formatting → toolbar → links-footnotes | 140–144 | |
| Violation: `core` → paste → additional-content → rendering → drag-drop → file-upload → `violation-init` | 147–153 | `violation-init.js` ОБЯЗАН быть последним: `new ViolationManager().initialize()` |
| Validation: `validation` → act → core → table → tree | 156–160 | |
| `lock-manager.js`, `acts-broadcast.js`, `acts-menu.js`, `preview-menu.js` | 162–165 | `acts-menu.js` последним — на `DOMContentLoaded` парсит `?act_id=` и автозагружает акт (`acts-menu.js:655-664`) |

После всех скриптов — render-time includes для шаблонов диалогов и контекстных меню (`base_constructor.html:168–181`).

### 2.5 Snapshot-тест

`tests/test_template_script_order.py` парсит оба `base_*.html` regex'ом по `<script>`-тегам и фиксирует инварианты (например, `dompurify` до `chat-renderer.js`, `chat-event-bus.js` до остальных chat-модулей). Тест работает на сыром HTML без рендеринга Jinja — при добавлении новых тегов или перестановке существующих обязательно прогнать `pytest tests/test_template_script_order.py`.

---

## 3. `AppConfig` и проксирование (JupyterHub)

### 3.1 Зачем нужен AppConfig

Single source of truth для констант, тайминговых магических чисел и URL-builder'а. Декларации:

| Секция | Что в ней |
|---|---|
| `AppConfig.api` | `getBaseUrl()`, `getUrl(endpoint)` — единственная точка построения URL под JupyterHub-proxy |
| `AppConfig.chatEndpoints` | URL-шаблоны всех чат-эндпоинтов (`/api/v1/chat/conversations/...`) |
| `AppConfig.timings` | Магические `setTimeout`-задержки (`redirectAfterUnlock=300`, `enableTrackingAfterLoad=500` и т.п.) |
| `AppConfig.lock` | fallback-конфиг блокировок и сообщения для inactivity-диалога |
| `AppConfig.preview` | `defaultTrimLength=30`, `trimLengths={default, short, extended}` |
| `AppConfig.notifications` | `maxConcurrent=15`, длительности, иконки |
| `AppConfig.tree` | `maxDepth=4`, `defaultSections`, presets icons, validation messages |
| `AppConfig.content` | Лимиты (`tablesPerNode=10` и т.д.), table presets (metrics/regularRisk/operationalRisk/taxRisk/otherRisk/qualityAssessment/dataTools/...) |
| `AppConfig.localStorage` | `stateKey`, `autoSaveDebounce=3000`, `periodicSaveInterval=120000`, `maxStorageSize=4MB` |
| `AppConfig.readOnlyMode` | Флаги read-only сессии для роли «Участник» + сообщения |
| `AppConfig.hotkeys` | `save = {key:'KeyS', ctrlOrMeta:true}` |

`app-config.js:147-154` — все load-bearing тайминги в одном месте; меняются здесь, не в callsite'ах.

### 3.2 `AppConfig.api.getUrl()` — единая точка

```js
getBaseUrl() {
    if (this._baseUrlCache !== null) return this._baseUrlCache;
    const origin = window.location.origin;
    const pathname = window.location.pathname;
    // JupyterHub-proxy формат: /user/{username}/proxy/{port}/...
    const proxyMatch = pathname.match(/^(\/user\/[^\/]+\/proxy\/\d+)/);
    this._baseUrlCache = proxyMatch ? `${origin}${proxyMatch[1]}` : origin;
    return this._baseUrlCache;
}

getUrl(endpoint) {
    const cleanEndpoint = endpoint.startsWith('/') ? endpoint.slice(1) : endpoint;
    return `${this.getBaseUrl()}/${cleanEndpoint}`;
}
```
(`shared/app-config.js:51-91`)

**Регрессионный инвариант:** все `fetch('/api/v1/...')` и навигационные `window.location.href = '/...'` обязаны идти через `AppConfig.api.getUrl()`. Прямой относительный URL под JupyterHub уходит на `/hub/api/...`, минуя `/user/{user}/proxy/{port}/` → 404. Текущий статус: `Grep "fetch\(\s*['\"\`]/api"` по `static/js/` → **0 совпадений**. `Grep "AppConfig.api.getUrl"` → **89 совпадений в 19 файлах**.

### 3.3 `chatEndpoints`

`app-config.js:112-133` — реестр URL для чата. Параметризованные — функции (`messages(cid)`), статические — строки. Полные URL получаются комбинацией: `AppConfig.api.getUrl(AppConfig.chatEndpoints.messages(cid))`. Магические строки `/api/v1/chat/...` в callsite'ах — рефакторинг-запах.

### 3.4 `timings`

```js
static timings = {
    enableTrackingAfterLoad: 500,       // пауза перед re-enable Proxy после loadActContent
    enableTrackingAfterGenerate: 100,
    enableTrackingAfterSave: 100,
    redirectAfterUnlock: 300,           // setTimeout перед window.location.href = /acts
    redirectAfterDelete: 1500,
    showMenuRetry: 500
};
```

Эти числа — компромиссы UX (notification успевает мелькнуть) vs тесты (не зависают). Менять только с пониманием контекста.

---

## 4. `AppState` и состояние конструктора

### 4.1 Декларация и расширение через `Object.assign`

`AppState` объявлен как **object literal** в `constructor/state/state-core.js:8`. Поля:

| Поле | Тип | Trackable? |
|---|---|---|
| `treeData` | `{id:'root', children: Node[]}` | ✅ |
| `tables` | `{[tableId]: TableData}` | ✅ |
| `textBlocks` | `{[blockId]: TextBlockData}` | ✅ |
| `violations` | `{[violationId]: ViolationData}` | ✅ |
| `tableUISizes` | `{[tableId]: {colWidths, rowHeights}}` | ✅ |
| `currentStep` | `1` или `2` | ✅ |
| `selectedNode` | текущий выбранный узел | ✅ |
| `selectedCells` | выделенные ячейки таблицы | ✅ |
| `_dragInProgress` | bool | ❌ (координационный флаг, не trackable) |

Методы CRUD добавлены через `Object.assign`:

- `state-tree.js:8` — `generateNumbering`, `addNode`, `deleteNode`, `moveNode`, `setNodeTb`, `setNodeInvoice`, и др.
- `state-content.js:9` — `addTableToNode`, `removeTable`, `addTextBlockToNode`, `addViolationToNode`, `_updateMetricsTablesAfterRiskTableCreated`, и др.

Порядок загрузки `state-core → state-tree → state-content` обязателен (см. §2.4).

### 4.2 Deep-tracking через Proxy

`state-core.js:497-659` — модуль рекурсивно оборачивает `trackedProperties` в `Proxy`, чтобы любая мутация (включая `AppState.tables[id].cells[r][c] = ...` или `node.children.push(...)`) триггерила `StorageManager.markAsUnsaved()`.

Реализация — функция `_wrapDeep(value)` (`state-core.js:526-565`): trap'ы `get` (lazy-wrap на первом обращении), `set` (вызывает `_notifyDirty` при реальной смене значения), `deleteProperty`. Кэш через `_stateProxyCache: WeakMap` для стабильности ссылок. Детали — см. state-core.js:526-565.

**Гарантии:**

- `_isTrackable` (`:505-513`) исключает `Node`, `Date`, `RegExp`, `Map`, `Set`, `WeakMap`, `WeakSet` — у них собственная семантика.
- `_stateProxyCache: WeakMap` обеспечивает стабильность ссылок (повторный `get` той же ветки возвращает тот же proxy).
- `_stateProxyOriginals: WeakSet` ловит повторную обёртку proxy → proxy.

### 4.3 Bootstrap-race

`_initStateTracking` (`state-core.js:639-659`) вызывается на `DOMContentLoaded` через `setTimeout(..., 0)` — это ставит обёртку в очередь после всех module-level `Object.assign(AppState, ...)`. Гарантия: к моменту обёртки `AppState` уже содержит все методы.

Но bootstrap-структура дерева (создание дефолтных секций 1–5 в `app.js`) выполняется до загрузки данных акта и тоже триггерит `markAsUnsaved`. Поэтому `App.init()` (`app.js:61`) **первым делом** вызывает `StorageManager.disableTracking()`; tracking повторно включается после `loadActContent` + `markAsSyncedWithDB()` с задержкой `AppConfig.timings.enableTrackingAfterLoad=500ms`.

### 4.4 Pinned tables (metrics/risk)

В дереве конструктора некоторые таблицы **закреплены** вверху children-массива:

- Metrics-таблицы: флаги `isMetricsTable`, `isMainMetricsTable` (на node).
- Risk-таблицы: флаги `isRegularRiskTable`, `isOperationalRiskTable`, `isTaxRiskTable`, `isOtherRiskTable` (на node).

API:

| Метод | Где | Что делает |
|---|---|---|
| `TreeUtils.isPinnedTable(node)` | `tree/tree-utils.js:309-322` | Учитывает все 6 флагов |
| `AppState._getFirstNonPinnedIndex(parent)` | `state/state-tree.js:739-745` | Возвращает индекс первого нон-pinned ребёнка (точка вставки) |
| `TreeUtils.findRiskTables(node, {firstOnly})` | `tree/tree-utils.js:335-357` | Единая утилита; **other-таблицы НЕ считаются риском** для metrics-risk-coordinator |

**Защита от drag:** `tree-drag-drop.js:106-111` — при `dragstart` если `_hasRiskTablesInSubtree(node) && !isUnderSection5(node)` → `e.preventDefault()` + Notification. Drop **перед** pinned заблокирован (`tree-drag-drop.js:234-247`).

### 4.5 Protected nodes (секции 1–5)

Создаются через `_createProtectedSection(id, label)` (`state-core.js:70-79`) с `protected:true, deletable:false`.

| Барьер | Где |
|---|---|
| API-страховка удаления | `state-tree.js:228-232` (`deleteNode` ловит `node.protected \|\| node.deletable === false`) |
| Каскад-исключение | `_deleteNodeUnchecked` (`state-tree.js:248`) пропускает проверку для каскадного удаления |
| Move-валидация | `state-tree.js:454-456` |
| CSS-класс | `tree-renderer.js:120-122` — `li.classList.add('protected')` |

### 4.6 MetricsRiskCoordinator

`state/metrics-risk-coordinator.js:27-141` — фасад над каскадной логикой metrics ↔ risk. Принципиально:

1. Полная экстракция reconcile-логики из `state-content.js` / `state-tree.js` / `context-menu-tree.js` / `tree-drag-drop.js` признана **слишком рискованной без e2e-покрытия** (см. техдолги §15). Coordinator — единая точка входа в каскад, но реализация делегирована методам `AppState`.
2. **Snapshot/rollback safety**: каждый хук обёрнут в `_withSnapshot(name, fn)` (`:63-76`), который делает shallow JSON-копию §5 и `AppState.tables`, ловит исключение и откатывает.

Публичные хуки:

| Метод | Когда вызывается |
|---|---|
| `onRiskTableAdded(nodeId)` | Добавлена risk-таблица — создаёт metrics на 5.X (если risk на 5.X.Y+) и main metrics в §5 |
| `onRiskTableRemoved()` | Risk-таблица удалена — реконсилит metrics во всём §5 |
| `onSubtreeMoved(draggedNode, oldAncestor5x)` | Поддерево перемещено внутри §5 — пересчитывает metrics для старого и нового предка 5.X |
| `validateAddRiskTable(node)` | Возвращает `{allowed, reason?}`. Делегирует на `TreeContextMenu._isRiskTableAllowedForNode` |

Все callsite'ы каскада (`state-tree.deleteNode`, `state-tree.moveNode`, context-menu, drag-drop) обязаны идти через coordinator — раньше часть кода звала `AppState._...AfterRiskTableDeleted` напрямую, что порождало partial-state при exception'е.

---

## 5. `StorageManager` и persistence

`constructor/storage-manager.js` (699 строк) — менеджер двухуровневого хранилища: localStorage (быстро, локально) + БД через `APIClient.saveActContent` (медленно, надёжно).

### 5.1 State machine

```
'saved'      ─── markAsUnsaved() ──▶ 'unsaved'
   ▲                                      │
   │                                      │ _debouncedSave (3s) или
   │                              periodic save (120s) или forceSave()
   │                                      ▼
markAsSyncedWithDB()  ◀──── PUT /content ──── 'local-only'
   │                          (success)         (LS-only, БД ещё не синхронизирована)
   │                                      ▲
   │                                      │
   └─────────────────────────── _markAsSaved() (из saveState)
```

Единое поле `_state ∈ {'saved'|'local-only'|'unsaved'}` (`storage-manager.js:33-45`). Зеркала `_hasUnsavedChanges` и `_isSyncedWithDB` (`:53, :61`) сохраняются только для backward-совместимости со старыми консьюмерами (beforeunload-warning, `hasUnsavedChanges()`); единая точка перехода — `_setState(newState)` (`:284-295`).

UI:

| Состояние | Цвет индикатора (`_updateSaveIndicator`) |
|---|---|
| `saved` | белый (всё синхронизировано) |
| `local-only` | жёлтый (есть в LS, ещё не в БД) |
| `unsaved` | красный (есть мутации, ещё даже не в LS) |

### 5.2 Debounce и периодические сохранения

| Таймер | Период | Что делает |
|---|---|---|
| `_saveTimeout` | `AppConfig.localStorage.autoSaveDebounce = 3000ms` | `saveState(true)` — пишет в LS |
| `_periodicSaveInterval` | `AppConfig.localStorage.periodicSaveInterval = 120000ms` | `saveState(true)` если `_hasUnsavedChanges` |
| `_periodicDbSaveInterval` | 120s | `APIClient.saveActContent(window.currentActId, {saveType:'periodic'})` |

Оба периодических таймера пропускают тик при `AppState._dragInProgress` — иначе во время DnD получим лишнюю запись с промежуточным состоянием.

`forceSaveAsync()` (`storage-manager.js:473-489`) — синхронный hotkey Ctrl+S: пишет в LS немедленно, дожидается ответа и возвращает Promise.

### 5.3 Navigation interception

`_setupNavigationInterception()` (`storage-manager.js:183-273`) защищает от навигации с несохранёнными изменениями двумя слоями:

1. **`popstate`-страж** — `history.replaceState({_lockNavGuard:true}, ...)` плюс `history.pushState`. Перехватывает «Назад» в браузере и предлагает диалог сохранения.
2. **Click-handler на `<a href>` с внутренним hostname** — захватывает клик до навигации, показывает диалог.

`confirmNavigation(targetUrl, opts)` (`:653-669`) — публичный API: показать диалог «Сохранить и уйти / уйти без сохранения / отменить», вернуть Promise<bool>. Используется в `LockManager._lockAct` (на 409), `acts-menu.js` (при switch'е акта).

`allowUnload()` — снимает `_lockNavGuard`, разрешая `window.location.href = ...` без диалога. Вызывается в `LockManager._initiateExit` (`lock-manager.js:658-660`) — сессия завершается принудительно, диалог здесь блокировал бы автоэкзит.

### 5.4 ChangelogTracker

`constructor/changelog-tracker.js` (160 строк) — гранулярный аудит-лог локальных операций. Операции:

| Источник | Операции |
|---|---|
| `state-tree.js` | `add_node`, `delete_node`, `move_node`, `tb_change`, `invoice_set`, `invoice_remove` |
| `state-content.js` | `add_table` |

Persistence: `localStorage['act_changelog_{actId}']` (`:21`), debounce 1s (`:108-132`), MAX 500 entries (`:10, 48-50`).

**`flush()`** (`:83-102`) — собирает все pending записи, возвращает массив. Вызывается в `LockManager._initiateExit` (`lock-manager.js:682-687`) и прикрепляется к телу `PUT /content` (`data.changelog = changelog`) — серверная аудит-запись синхронна с фактическим сохранением, без отдельного запроса.

**`destroy()`** (`:139-156`) — полный сброс при switch'е акта. `acts-menu.js:377-380` делает `destroy() → init(actId)`.

### 5.5 LifecycleHelper

`constructor/lifecycle-helper.js` (58 строк) — единый реестр `beforeunload`-обработчиков (`Map<name, handler>`). Без него каждый менеджер вешал бы свой listener на `window.addEventListener('beforeunload', ...)`, что усложняет снятие.

API: `registerBeforeUnload(name, handler)`, `unregister(name)`, `list()`. Использует `lock-manager.js` (имя `'lock:manual-unlock'`) и `storage-manager.js` (имя `'storage:warn-unsaved'`).

---

## 6. `LockManager` и inactivity

`constructor/lock-manager.js` (761 строка) — клиентская часть оптимистичного блока актов. На бэке три поля на `acts`: `locked_by`, `locked_at`, `lock_expires_at`. На фронте:

| Цикл | Что делает |
|---|---|
| **Init** | `_loadConfig` → `_lockAct` (POST /lock) → activity-tracker → heartbeat → beforeunload → visibilitychange |
| **Heartbeat** | Каждые `inactivityCheckIntervalSeconds` секунд (`setInterval` в `_startAutoExtension`), если активность была — `_extendLockSafely` (POST /extend-lock) |
| **Inactivity** | При превышении `inactivityTimeoutMinutes` минут без активности — диалог «Продолжить?» с countdown'ом; нет ответа → autoExit |
| **Exit** | `_initiateExit(action)` — save + unlock + redirect `/acts` |

### 6.1 Состояние

`lock-manager.js:9-29`. Все поля **static** (LockManager используется как singleton-class):

| Поле | Назначение |
|---|---|
| `_actId` | Текущий заблокированный акт |
| `_config` | Полученный с бэка `{lockDurationMinutes, inactivityTimeoutMinutes, inactivityCheckIntervalSeconds, minExtensionIntervalMinutes, inactivityDialogTimeoutSeconds}` |
| `_inactivityCheckInterval`, `_extensionInterval`, `_countdownInterval` | Таймеры |
| `_lastActivity`, `_lastExtensionAt` | timestamp'ы для оценки idle |
| `_isExiting`, `_exitPromise` | Идемпотентность `_initiateExit` |
| `_manualUnlockTriggered` | Блокирует sendBeacon |
| `_beforeUnloadHandler`, `_activityHandler`, `_visibilityHandler` | Bound-handler'ы для корректного `removeEventListener` |
| `_activityEvents` | `['mousedown', 'keydown', 'scroll', 'touchstart']` |
| `_inactivityDialogDeadline` | `Date.now() + timeoutSeconds*1000`, null если диалог не показан |
| `_inactivityDialogClose` | Программный close активного inactivity-диалога |

### 6.2 Lock (POST /lock)

`_lockAct()` (`lock-manager.js`):

- 409 → 403/...: показать диалог с username владельца, `error.code === 'act-locked'` и `error.extra?.locked_by` (контракт envelope `{detail, code, extra}` из `api.js`); fallback на regex по `error.detail` для старых non-AppError ответов (`lock-manager.js:180-183`).
- После диалога — `confirmNavigation('/acts')` если StorageManager доступен, иначе жёсткий редирект (`lock-manager.js:196-202`).
- 5xx → диалог «Ошибка блокировки», редирект (`:206-225`).

### 6.3 Heartbeat с retry

`_extendLock` (`lock-manager.js:256-288`) делит ответы на два класса: 4xx — лок потерян, сразу выход; 5xx/network — transient, можно ретраить.

`_extendLockSafely` (`:295-314`) копит подряд-неудачи до `_MAX_EXTEND_FAILURES=3` (`:246`). Транзиентный DNS/proxy reset не выкидывает пользователя сразу — retry на следующем тике.

### 6.4 Inactivity-диалог с Date.now-countdown

`_handleInactivity(minutesInactive)` (`lock-manager.js:548-639`):

1. **Capture actId**: `const capturedActId = this._actId;` ДО `await dialogPromise`. Закрывает кейс «switch актов во время открытого диалога inactivity».
2. **Deadline по Date.now**: `const deadline = Date.now() + timeoutSeconds * 1000`. `setInterval(250ms)` обновляет UI countdown'а, решение об exit принимается по `Date.now() >= deadline` — устойчиво к Chrome background throttling (`setTimeout/setInterval` в фоне throttle'ятся до ~раза в минуту, decrement-counter разъезжается с реальностью).
3. **Orphan-protection**: после `await dialogPromise` проверяется `this._actId !== capturedActId || this._isExiting` — если за время ожидания состояние изменилось, ветка extend/exit не выполняется.
4. **Программный close**: handler `close` сохраняется в `_inactivityDialogClose` (через `onMount`), чтобы `_closeInactivityDialog()` мог программно закрыть overlay при autoExit'е — иначе диалог «висит» поверх редиректа.

### 6.5 visibilitychange

`_handleVisibilityChange()` (`lock-manager.js:487-518`) реагирует на возврат вкладки из фона:

- **Случай A**: диалог открыт и `Date.now() >= _inactivityDialogDeadline` → немедленный `_closeInactivityDialog()` + `_initiateExit('autoExit')`.
- **Случай B**: диалога нет, но `idleMs >= inactivityTimeoutMinutes*60*1000` → сразу autoExit без промежуточного диалога. Лок мог быть уже снят бэком (`expired_locks_cleanup`, TTL `lockDurationMinutes`); спрашивать «остаться?» бессмысленно — extend упадёт 4xx → fatal → exit.

Никаких HTTP-запросов в visibility-handler'е не делается; решение принимается локально по `Date.now()`.

### 6.6 beforeunload и beacon-unlock

`_setupBeforeUnload()` (`lock-manager.js:391-416`):

- Регистрируется через `LifecycleHelper.registerBeforeUnload('lock:manual-unlock', ...)`.
- Игнорирует beacon при `_isExiting || _manualUnlockTriggered || !_actId` (избегаем дубликата с `_initiateExit`).
- `navigator.sendBeacon(unlockUrl, blob)` — гарантирует доставку даже при закрытии вкладки.
- В `finally` всегда вызывает `destroy()` — снимает 4 listener'а на document плюс активные интервалы (иначе при back-button оставались).

### 6.7 Идемпотентный exit с fallback

`_initiateExit(action)` (`lock-manager.js:645-758`) — единственная точка выхода из сессии. Сигнатура и ключевой инвариант:

```js
static async _initiateExit(action) {
    if (this._isExiting) return this._exitPromise;  // идемпотентность
    this._isExiting = true;
    this._closeInactivityDialog();  // ДО destroy, иначе handle обнулится
    // далее: destroy → allowUnload → save (+changelog flush) → unlock → жёсткий редирект
    // детали — см. lock-manager.js:645-758
}
```

Что важно помнить:

- **Идемпотентность**: повторный вызов отдаёт тот же promise.
- **Fallback на `window.currentActId`**: страхует, если `_actId` уже сброшен после `destroy()` (`:662`).
- **Save идёт с `ChangelogTracker.flush()`** — одной транзакцией на сервере (`:682-687`).
- **Редирект жёсткий, без `confirmNavigation`** — сессия закрывается принудительно. Если save упал (409 при чужом локе), `confirmNavigation` показал бы «Несохранённые изменения. Уйти?» и заблокировал бы выход. `allowUnload()` снимает страж явно (`:751`).
- **`messageFlag`**: `'sessionAutoExited'` или `'sessionExitedWithSave'` пишется в sessionStorage; `acts-manager-page.js` показывает toast на следующей загрузке.

### 6.8 NavigationManager и LockLostError

`constructor/navigation-manager.js` (223 строки) — только step-кнопки + save+export pipeline. `_handleSaveAndExport` ловит `LockLostError` из `APIClient.saveActContent` (409 → custom Error subclass из `shared/api.js`) → ставит `sessionStorage['sessionAutoExited']` и делает жёсткий редирект на `/acts` (`navigation-manager.js:112-126`).

`beforeunload` и `confirmNavigation` — у `StorageManager`, не у NavigationManager.

---

## 7. Tree, items, per-node render API

### 7.1 Зоны

| Зона | Узлы DOM | Менеджер | Renderer |
|---|---|---|---|
| Дерево (шаг 1) | `#tree > ul > li[data-node-id]` | `treeManager: TreeManager` | `TreeRenderer` |
| Items (шаг 2) | `#itemsContainer > .item-block[data-node-id]` | `static class ItemsRenderer` | себя |
| Таблицы | `.table-section[data-table-id]` (внутри items) | `tableManager: TableManager` | себя |
| Preview | `#preview` | `static class PreviewManager` | preview-table-renderer + preview-textblock-renderer + preview-violation-renderer |

### 7.2 TreeManager

`constructor/tree/tree-core.js:449` — `const treeManager = new TreeManager('tree')` (top-level const, не `window`). Координирует `TreeRenderer`, `TreeDragDrop`, `TreeContextMenu`.

`TreeRenderer` (`tree/tree-renderer.js`):

- `render(node = AppState.treeData)` — полный rebuild контейнера `#tree`. Тяжёлая операция; вызывается из 5 точек (см. §7.5).
- **Точечные публичные API** (заменяют полный `render()`):
  - `updateInvoiceBadge(node)` (`tree-renderer.js:486-496`) — subscriber `node:invoice-changed`. Снимает старый бейдж, ставит новый.
  - `updateTbBadge(node)` (`:627-653`) — обновляет узел и всех родителей под §5 (computed TB вверх по дереву).

### 7.3 TreeUtils (object literal)

`tree/tree-utils.js:7` — `const TreeUtils = {...}`. Не класс, не singleton-instance — **plain object**. Ключевые функции:

| Метод | Назначение |
|---|---|
| `findNodeById(id, node?)` | Поиск узла, default root = `AppState.treeData` |
| `findParentNode(id)` | Родитель узла |
| `isUnderSection5(node)` | Проверка попадания узла под §5 (через путь номеров) |
| `isPinnedTable(node)` (`:309-322`) | Проверка по 6 флагам metrics/risk |
| `isTbLeaf(node)` | Узел может иметь чекбокс TB |
| `findRiskTables(node, {firstOnly})` (`:335-357`) | Единая утилита, **other-таблицы не считаются риском** для metrics-risk-coordinator |

### 7.4 ItemsRenderer и `_domIndex`

`items/items-renderer.js` (987 строк). Static class, не имеет singleton-instance.

**`_domIndex: Map<string, HTMLElement>`** (`items-renderer.js:16`) — индекс адресуемых DOM-узлов, ключи вида `item:${nodeId}`, `table:${tableId}` и т.п. Заполняется в `_createItemContainer/renderTable`, очищается в начале `renderAll()` и при удалении узлов.

Per-node API (вместо полного `renderAll()`):

| Метод | Когда вызывать | Fallback |
|---|---|---|
| `updateItem(nodeId)` (`:47-71`) | После структурных изменений в пределах одного узла (add/delete child, move) | `renderAll()` если узел не в `_domIndex` или `AppState` |
| `updateTable(tableId)` (`:77-...`) | Только пересоздать table-section, сохраняя размеры колонок | `renderAll()` |
| `updateTextBlock(blockId)` | Пересоздать textblock | `renderAll()` |
| `updateViolation(violationId)` | Пересоздать violation-карточку | `renderAll()` |
| `updateNodeTitle(nodeId)` | Только заголовок узла | — |

Также:

- `_updateTbBadgeInItems(badge, node)` (`:553-567`) — апдейт чекбокса TB в шаге 2.
- `_updateParentTbInItems(node)` (`:574-...`) — каскад вверх.
- `syncDataToState()` — обратная синхронизация DOM → AppState (после inline-редактирования).

### 7.5 `renderAll` — оставшиеся call-sites

Полный `treeManager.render()` (тяжёлый rebuild всего `#tree`):

| Точка | Контекст |
|---|---|
| `app.js:134` | Bootstrap при `App.init()` |
| `items/items-title-editing.js:114, 167, 295` | После inline-редактирования заголовков |
| `context-menu/context-menu-tree.js:481` | `updateTreeViews(scopeNodeId)` — fallback для каскадных операций (без `scopeNodeId`) |

Полный `ItemsRenderer.renderAll()` (`#itemsContainer`):

| Точка | Контекст |
|---|---|
| `app.js:301` | Bootstrap шага 2 |
| `items-renderer.js:809` | Внутренний rebuild при сложной операции |
| `context-menu/context-menu-tree.js:487` | Каскадный fallback |
| `tree/tree-drag-drop.js:355` | После DnD, если не удалось определить старого/нового родителя |

Прочее (`updateXxx`-методы внутри items-renderer.js, `table-core.js:57 renderAll`, `context-menu-cells.js:809 tableManager.renderAll`) — это локальные rebuilds, не полные.

### 7.6 Event-driven моменты

Конструктор почти не использует CustomEvent через `dispatchEvent`:

- `header/preview-menu.js:257, 269` — `preview-menu:opened` / `preview-menu:closed`. **Потребителей в конструкторе нет.**

Основная event-шина — `window.ChatEventBus` (опубликован модулем чата в `shared/`). Конструктор использует её **как общий event bus** — явно прокомментировано в `state-tree.js:884-885`:

**Эмиттеры:**

| File:Line | Событие | Контекст |
|---|---|---|
| `state/state-tree.js:886` | `node:tb-changed` | `AppState.setNodeTb(nodeId, abbr, checked)` |
| `state/state-tree.js:925` | `node:invoice-changed` | `AppState.setNodeInvoice(nodeId, invoiceData, opts)` |

Оба через `window.ChatEventBus?.emit?.(...)` (optional chaining — emit срабатывает даже если чат не загружен).

**Подписчики:**

| File:Line | Событие | Действие |
|---|---|---|
| `tree/tree-renderer.js:19-22` | `node:invoice-changed` | `this.updateInvoiceBadge(node)` |

Подписчика на `node:tb-changed` **нет**; обновление badge'а делается imperative-вызовами `updateTbBadge` / `_updateTbBadgeInItems` / `_updateParentTbInItems` из callsite'ов — technical debt, см. §15.

---

## 8. `PreviewManager`

`constructor/preview/preview.js` (356 строк) — рендер финальной версии акта в правую панель (шаг 1) или в overlay version-preview. Static class. Per-type renderer'ы (`preview-table-renderer.js`, `preview-textblock-renderer.js`, `preview-violation-renderer.js`) — рядом в той же папке.

### 8.1 RAF-дедупликация (`update`)

`preview.js:23-46`:

```js
static update(options = {}) {
    if (typeof options === 'string') {
        options = {previewTrim: AppConfig.preview.defaultTrimLength};
    }
    if (this._pendingUpdate) {
        Object.assign(this._pendingOptions, options);  // мерж и выход
        return;
    }
    this._pendingUpdate = true;
    this._pendingOptions = {...options};
    requestAnimationFrame(() => {
        const opts = this._pendingOptions;
        this._pendingUpdate = false;
        this._pendingOptions = null;
        this._performUpdate(opts.previewTrim ?? AppConfig.preview.defaultTrimLength);
    });
}
```

На N подряд идущих вызовов в одном кадре выполняется ровно один `_performUpdate` с последними опциями.

### 8.2 Debounce 150мс для typing (`scheduleTyping`)

`preview.js:69-75`:

```js
static scheduleTyping(options = {}) {
    clearTimeout(this._typingTimer);
    this._typingTimer = setTimeout(() => {
        this._typingTimer = null;
        this.update(options);
    }, this._TYPING_DEBOUNCE_MS);  // 150
}
```

Используется в обработчиках `input`-событий (textblock-editor, violation textarea). Серия мутаций при наборе текста не запускает рендер на каждый кадр — только через 150мс тишины.

`update` и `scheduleTyping` — взаимозаменяемые для callsite'а: тяжёлая структурная операция (add/delete table) использует `update` (немедленный RAF), typing-flow — `scheduleTyping` (debounce).

---

## 9. Диалоги

### 9.1 DialogBase

`shared/dialog/dialog-base.js` (438 строк) — базовый класс модалок. Все диалоги в системе **обязаны** наследоваться от него, чтобы получить focus-trap, ARIA, ESC-handling и стек.

**Возможности (`shared/dialog/dialog-base.js`):**

| Что | Где |
|---|---|
| `_activeDialogs: HTMLElement[]` | `:16` — стек overlay'ев для вложенных диалогов |
| `_createOverlay()` | `:23-27` |
| `_FOCUSABLE_SELECTOR` | `:35-42` — `a[href]`, `button:not([disabled])`, input/textarea/select без disabled, `[tabindex]` без `-1` |
| `_setupFocusTrap(overlay)` | `:74-105` — Tab на последнем focusable → first; Shift+Tab на первом → last. Trap работает **только** на верхнем диалоге стека |
| `_setupEscapeHandler(overlay, onClose)` | `:255-...` — ESC закрывает топовый overlay (`_activeDialogs[length-1] === overlay`) |
| `_setupOverlayClickHandler(...)` | `:233-...` — клик по overlay вне dialog'а → close |
| `_lockBodyScroll() / _unlockBodyScroll()` | `:287-...` — `overflow:hidden` на `<body>` пока есть открытые диалоги |
| `_showDialog(overlay, dialog)` | `:115-...` — навешивает `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, focus-trap, сохраняет `_previousFocus` |
| `_hideDialog(overlay, delay=closeDelay)` | `:185-...` — снимает trap, восстанавливает фокус |
| `_createElement(tag, attrs, text)`, `_createButton(...)`, `_cloneTemplate(id)` | DOM-хелперы |
| `_fillField(...)` / `_fillFields(element, data)` | `:392-413` — заполнение полей по `data-field` атрибуту |
| `getActiveDialogsCount()` | `:419-421` |
| `closeAllDialogs()` | `:426-434` — копия `_activeDialogs` для безопасной итерации |

### 9.2 DialogManager (confirm/alert)

`shared/dialog/dialog-confirm.js` (296 строк) — `extends DialogBase`. Promise-based confirm/alert:

```js
const ok = await DialogManager.show({
    title, message, icon, type: 'warning'|'danger'|'info',
    confirmText, cancelText, hideCancel: bool,
    allowEscape: bool, allowOverlayClose: bool,
    onMount: ({overlay, close}) => { ... }
});
```

`onMount` хук используется `LockManager._handleInactivity` (`lock-manager.js:568-603`) для получения handle к программному `close()` диалога — чтобы при autoExit'е programmatically закрыть overlay без user-click'а.

### 9.3 Крупные диалоги конструктора

| Диалог | File | LOC | Особенности |
|---|---|---|---|
| `InvoiceDialog` | `constructor/dialog/dialog-invoice.js` | 1302 | Кеши справочников (метрики, процессы, БП-таблицы), TTL 15min, AJAX-валидация |
| `HelpManager` | `constructor/dialog/dialog-help.js` | 229 | extends DialogBase; параллельная иерархия (см. техдолги). Init на `DOMContentLoaded` (`:227-229`) — без него кнопка help не привяжется |

### 9.4 Крупные диалоги portal

| Диалог | File | LOC | Особенности |
|---|---|---|---|
| `CreateActDialog` | `portal/acts-manager/dialog-create-act.js` | 1735 | Сложная форма: КМ-валидация, секции из API, team-members с autocomplete, поручения |
| `AuditLogDialog` | `portal/acts-manager/dialog-audit-log.js` | 732 | Два таба (Лог/Версии), `FilterEngine` для фильтров, load-more 50/стр. |
| `VersionPreviewOverlay` | `portal/acts-manager/version-preview.js` | 337 | extends DialogBase; 3 режима (UI/JSON/Diff) через `DiffEngine` + `DiffRenderer` |
| `AdminAddUserDialog` | `portal/admin/admin-add-user-dialog.js` | 239 | Search → выбор → assign |
| `CkProcessPicker` | `shared/ck/ck-process-picker.js` | 173 | Popup выбора БП для CkForm |

### 9.5 HelpManager — параллельная иерархия (техдолг)

`HelpManager` наследуется от `DialogBase`, но реализует свой жизненный цикл (`window.HelpManager.show(stepNumber)`) — не использует общий `DialogManager.show()`. Историческое решение; ярких проблем нет, но при унификации UI-стека стоит переписать через `DialogManager`. Подробнее — §15.

---

## 10. Acts manager и кросс-доменная навигация

### 10.1 ActsManagerPage

`portal/acts-manager/acts-manager-page.js` (785 строк) — главная страница `/acts`. Координирует:

- Загрузку списка актов через `GET /api/v1/acts/list` (фильтрация по статусу/КМ/датам).
- Карточки актов из template'а `acts_card.html` (`_cloneTemplate` + `_fillFields` из DialogBase).
- Действия `open` / `edit` / `history` / `duplicate` / `delete` — с проверкой роли пользователя в команде акта.
- Cross-tab subscribe на `ActsBroadcast` — событиях `act:deleted/duplicated/updated` инвалидирует и перезагружает список.
- Перехват `CreateActDialog._closeDialog` через `safeClose` — обвязка, чтобы после успешного создания/редактирования сразу обновить список.

### 10.2 Role-checks (роль «Участник»)

`acts-manager-page.js:354-430` — кнопки `edit`/`delete` **скрываются** (`hidden = true`) для роли «Участник»:

```js
const canEdit = act.user_role !== 'Участник';
if (!canEdit) {
    if (editBtn) editBtn.hidden = true;
    if (deleteBtn) deleteBtn.hidden = true;
}
```

Дополнительно при клике (на случай гонок состояния) — `Notifications.warning('Редактирование недоступно для роли "Участник"')`.

- **Дублирование** — доступно всем; Участник станет Редактором в новом акте (`:408-409`).
- **История** — только Куратору/Руководителю (`:397`).

Серверная страховка — `require_domain_access('acts')` плюс role-check в `app/domains/acts/services/permissions.py`; UI-логика выше — UX-слой.

### 10.3 BroadcastChannel `'acts'`

`portal/acts-manager/acts-broadcast.js` (36 строк) — `ActsBroadcast.CHANNEL = 'acts'`. События `act:deleted`, `act:duplicated`, `act:updated`.

Использование:
- `acts-manager-page.js:619-620, 683-684, 731-737` — notify на duplicate/delete; subscribe → `loadActs()`.
- Сценарий: открыто две вкладки `/acts`, удалили акт в одной → вторая инвалидирует и перезагружается.

Подключается **и в конструкторе** через `acts-menu.js` (`base_constructor.html:163`) — бургер-меню актов в конструкторе тоже реагирует на cross-tab события.

Fallback: если `BroadcastChannel` недоступен (старый Safari), модуль логирует `console.warn` и работает no-op (`acts-broadcast.js:14`).

### 10.4 Cross-zone зависимость: portal → constructor

`templates/portal/acts-manager/acts_manager.html:46` подключает `static/js/constructor/lock-manager.js` — портальная страница использует constructor's `LockManager` для редактирования **метаданных** акта (через `CreateActDialog` в edit-режиме) без открытия конструктора. Сценарий:

1. Юзер на `/acts` нажимает «Редактировать» (карандаш).
2. `ActsManagerPage.editAct(actId, status)` — `LockManager.init(actId)` берёт лок.
3. Открывается `CreateActDialog` в edit-режиме (форма метаданных без contents).
4. На submit / close — `LockManager.manualUnlock()` снимает лок.

Это единственная cross-zone зависимость: `portal/` импортирует один файл из `constructor/`. Документируем явно — без неё рефакторинг папок может сломать edit-flow.

### 10.5 `portal.css` подсасывает `constructor/preview/*`

Аналогично — `static/css/entry/portal.css:22-25` импортит `constructor/preview/{preview-base, preview-table, preview-typography, preview-violation}.css` для `VersionPreviewOverlay`, который реюзает preview-renderer'ы конструктора.

### 10.6 Diff engine

`portal/acts-manager/diff-engine.js` (300 строк) — чистый utility без DOM. `DiffEngine.compute(oldData, newData)` возвращает `{tree, tables, textblocks, violations, hasChanges}`.

- `_diffTree` — flatten оба дерева в map по id, `node._diff = added/modified/unchanged`.
- `_diffTables` — cell-level (row × col matrix).
- `_diffTextBlocks` — word-level через LCS на `Uint16Array`, fallback на coarse-diff если `m*n > 250000`.
- `_diffViolations` — поле-за-полем.

`portal/acts-manager/diff-renderer.js` (290 строк) — DOM-рендер с подсветкой.

---

## 11. Безопасность и санитизация

### 11.1 SafeHTML (frontend)

`shared/sanitize.js` (99 строк) — единый wrapper над `window.DOMPurify` (`static/vendor/dompurify/purify.min.js`):

```js
window.SafeHTML = { set, sanitize, escapeHtml };
```

**`SafeHTML.set(el, html, extraConfig?)`** — основной API. Если `DOMPurify` загружен: `el.innerHTML = DOMPurify.sanitize(...)`; иначе fallback на `el.textContent = ...` (безопасно — не raw HTML) с warn-once-логом.

**Конфигурация (`DEFAULT_CONFIG`, `sanitize.js:17-38`):**

- `USE_PROFILES: { html: true }` (SVG/MathML отключены — не используются).
- `FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'input', 'button']` — даже из «trusted» источника.
- `FORBID_ATTR` — полный список 60+ inline event-handlers (`onerror`, `onload`, `onclick`, `onpointerdown`, и т.п.) — главный XSS-вектор.

**Потребители**: `textblock-editor.js`, `preview-violation-renderer.js`, `preview-textblock-renderer.js`, `diff-renderer.js`, `chat-renderer.js`. Все `innerHTML`-sink'и в коде обязаны идти через `SafeHTML.set` или (если HTML заведомо безопасен) через `textContent` напрямую.

### 11.2 bleach (backend)

Defense in depth: на бэке HTML-поля акта проходят повторную санитизацию через `bleach.clean` (whitelist тегов/атрибутов) перед записью в БД — даже если фронтовый SafeHTML обойдут, script-tag не сохранится. Детали — `app/domains/acts/services/act_content_service.py::ActContentService._sanitize_html_fields` и dev-guide.

### 11.3 Security headers (CSP report-only)

Класс `SecurityHeadersMiddleware` в `app/core/middleware.py` (единый модуль, не директория) подключает 5 заголовков в **report-only** режиме + 6-й (`Strict-Transport-Security`) условно при HTTPS:

- `Content-Security-Policy-Report-Only`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: ...`
- `X-Frame-Options: SAMEORIGIN`
- `Strict-Transport-Security` — только при HTTPS-соединении (условный 6-й).

Путь к enforce: убрать все inline `onclick=` из templates (уже сделано — `Grep onclick` по `templates/` даёт 0 совпадений) и протестировать неделю в report-only режиме на стейдже.

### 11.4 Error boundary

`shared/error-boundary.js` (121 строка). Перехватывает:

- `window.addEventListener('error', ...)` — синхронные ошибки.
- `window.addEventListener('unhandledrejection', ...)` — неперехваченные Promise rejection'ы.

На каждую ошибку:

1. `console.error('[GlobalError]'|'[UnhandledPromise]', ...)`.
2. `Notifications.error('Произошла непредвиденная ошибка. Обновите страницу.')` (если уже загружен).
3. `POST /api/v1/system/client-error` с rate-limit 5s (`REPORT_INTERVAL_MS = 5000`) и `keepalive: true` (отчёт уйдёт даже при закрытии вкладки).

Подключается через `<script defer>` **сразу** после `notifications.js` (`base_*.html`), чтобы успеть поймать ошибки инициализации остальных модулей.

### 11.5 Fetch timeout

`shared/api.js:889-914` — `_fetchWithTimeout(url, opts, timeoutMs=30000)`:

```js
const controller = new AbortController();
const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
try {
    return await fetch(url, {...opts, signal: controller.signal});
} catch (err) {
    if (timedOut && (err?.name === 'AbortError' || err?.code === 20)) {
        throw this._createError(408, 'Превышено время ожидания ответа сервера');
    }
    throw err;
} finally { clearTimeout(timer); }
```

Default 30s; уважает пользовательский `signal` (если уже передан — не оборачивает). **SSE-вызовы** (chat-stream, forward-resume) **не должны** использовать этот wrapper — у них свой жизненный цикл с долгим body-стримом.

### 11.6 Envelope `{detail, code, extra}`

`shared/api.js:850-869, 921-955` — единый формат ошибок API:

```js
static _createError(status, detail, code = null, extra = null) {
    const error = new Error(detail);
    error.status = status;
    error.code = code;
    error.extra = extra;
    return error;
}
```

Бэк бросает `AppError`, `to_envelope()` сериализует в `{detail, code, extra?}` (см. dev-guide). На фронте:

- `code` — машинный код kebab-case (например, `'act-locked'`, `'chat-limit-reached'`).
- `extra` — словарь дополнительных полей (например, `{locked_by: 'username'}`).

Текущие потребители `extra`:

- `constructor/lock-manager.js:181-182` — `error.code === 'act-locked'` + `error.extra?.locked_by`.

Других чтений `extra` нет — паттерн пока используется только LockManager'ом.

### 11.7 FastAPI 422 нормализация

`api.js:942-946` — `detail` от pydantic-валидаторов приходит как массив `[{loc, msg, type, ...}, ...]`. Без нормализации в UI прилетал `"[object Object]"`. Складываем в строку через `; ` (msg уже на русском).

### 11.8 PaginatedResponse

Бэк (`app/core/responses.py:14-27`) возвращает `{items, total, limit, offset}` для пагинированных эндпоинтов. Лимиты диапазоном `1..200`, дефолт `50`. Потребители на фронте: `dialog-audit-log.js`, `admin-audit-log.js`, `admin-roles.js`, ЦК-страницы.

---

## 12. Accessibility и i18n

### 12.1 i18n

Весь user-facing текст — **на русском**. `<html lang="ru">` в обоих `base_*.html`. Серверный pluralizer для минут — `AppConfig.lock._pluralizeMinutes(n)` (склонения «минуту/минуты/минут»).

### 12.2 ARIA tree (treeitem pattern)

`tree-renderer.js` рендерит `#tree` как `role="tree"` (шаблон), каждый `<li>` — `role="treeitem"` с `aria-level=N`, `aria-expanded=true/false`, `aria-selected=...`. Поддерживаются клавиатурные сокращения ArrowUp/ArrowDown/Right/Left/Enter (открытие).

### 12.3 Dialog ARIA

`DialogBase._showDialog` (`dialog-base.js:115-...`) автоматически проставляет на overlay:

- `role="dialog"` (если не задан),
- `aria-modal="true"`,
- `aria-labelledby` на первый заголовок (`data-dialog-title` или h1..h4).

Focus-trap: Tab cycle (`_setupFocusTrap`, `:74-105`) работает только на верхнем диалоге стека.

При закрытии — фокус возвращается на `_previousFocus` (запоминается перед открытием).

### 12.4 Notifications ARIA live

`shared/notifications.js:38-46` — контейнер озвучивается screen reader'ом как ARIA live region:

```js
container.setAttribute('role', 'region');
container.setAttribute('aria-label', 'Уведомления');
```

Per-notification роль (`alert` для error/warning, `status` для info/success) — в `_buildNotificationElement`.

### 12.5 prefers-reduced-motion

Анимации в `static/css/base/animations.css` обёрнуты `@media (prefers-reduced-motion: reduce)` — для пользователей с включённой опцией ОС переходы отключены.

### 12.6 Contrast

Цветовая палитра в `static/css/base/variables.css` проверена на AAA-контраст для основного текста, AA — для тонкого UI-текста. Конкретные WCAG-aliases:

- `--text-primary`, `--text-secondary` — основной текст.
- `--text-tertiary` — приведён к AA-контрасту (Wave 3, HIGH#O).
- `--duration-fast`, `--duration-normal`, `--duration-slow` — алиасы durations для предсказуемой темизации.

### 12.7 Адаптивность

Constructor **не адаптивен** (0 media queries в `constructor/*`). Это **осознанное решение** — редактор актов является desktop-only продуктом (B2B-приложение для аудиторов внутри Сбербанка). Portal-страницы (acts-manager, admin, ck) — частично адаптивны (sidebar collapses), но критическая работа всё равно идёт в desktop-конструкторе.

---

## 13. CSS-архитектура

### 13.1 Entry points

Два корневых файла-агрегатора `@import`'ов:

- `static/css/entry/portal.css` — для всех portal-страниц (загружается в `base_portal.html:12`).
- `static/css/entry/constructor.css` — для редактора (загружается в `base_constructor.html:12`).

Третий entry `static/css/entry/shared.css` — реюзается `portal.css` через первый `@import './shared.css'`. Содержит базу (variables/reset/animations), shared-кнопки/уведомления/диалоги, shared-чат-стили.

### 13.2 Каскад constructor.css

```
@import './shared.css';
@import '../constructor/layout/*.css';                    # 6 файлов
@import '../shared/layout/settings-menu.css';             # 1
@import '../constructor/tree/*.css';                      # 5
@import '../constructor/table/*.css';                     # 4
@import '../constructor/violation/*.css';                 # 4
@import '../constructor/preview/*.css';                   # 5
@import '../constructor/help/*.css';                      # 3
@import '../constructor/buttons/buttons-save-group.css';  # 1
@import '../constructor/items/*.css';                     # 4
@import '../constructor/textblock/*.css';                 # 3
@import '../constructor/context-menu/*.css';              # 2
@import '../constructor/dialog/dialog-invoice.css';       # 1
@import '../shared/dialog/acts-modal.css';                # 1
@import '../portal/acts-manager/team-member-search.css';  # 1 (reuse)
@import '../constructor/chat/chat-popup.css';             # 1
@import '../constructor/utilities/*.css';                 # 3
```

≈45 файлов через каскад.

### 13.3 Каскад portal.css

```
@import './shared.css';
├── portal/layout/sidebar.css
├── shared/layout/settings-menu.css
├── portal/landing/landing.css
├── portal/acts-manager/{base, cards, team-member-search,
│                        audit-log-dialog, version-preview}.css
├── shared/dialog/acts-modal.css
├── constructor/preview/{preview-base, preview-table,
│                        preview-typography, preview-violation}.css  # см. §10.5
├── portal/admin/{admin-page, admin-search,
│                 admin-roles, admin-add-user}.css
└── portal/ck/{ck-page, ck-table, ck-form, ck-process-picker}.css
```

### 13.4 Переменные

`static/css/base/variables.css` (1 файл, **576 переменных**) — единый файл с цветовой схемой, размерами, spacing, тенями, durations, z-index'ами. Декомпозиция этого файла на тематические части — в backlog (§15).

### 13.5 Z-index map

Управляется через CSS-переменные (`--z-tooltip`, `--z-overlay`, `--z-modal`, `--z-popover`, `--z-modal-elevated`, `--z-popover-elevated`). Wave 3 ввёл `*-elevated`-уровни для вложенных диалогов поверх обычных модалок. Локальный `calc(var(--z-modal) + 1)` в нескольких CSS-файлах — потенциальная проблема пересечения с соседними layer'ами (§15, M-Z-CALC).

### 13.6 Cache-busting

Jinja-фильтр `versioned` (применяется ко всем `url_for('static', path='...')`) добавляет `?v={APP_VERSION}` к URL. `APP_VERSION` берётся из `app.core.config.Settings`. При смене версии браузер форсированно перезагружает статику.

### 13.7 `<meta name="app-version">`

`base_*.html:8` — `<meta name="app-version" content="{{ app_version }}">`. Бейдж версии в topbar и admin-diagnostics tab читают это значение.

---

## 14. Чат

Полный гайд по чат-фронту — [`docs/chat-frontend-architecture.md`](chat-frontend-architecture.md) (565 строк, 12 модулей, SSE-маршрутизация, режимы inline/modal/popup, forward к внешнему агенту, типы блоков, ClientActionsRegistry, BlockEmitter, status state machine).

Здесь — только load-bearing **точки сцепки** с остальным фронтом:

### 14.1 `AppConfig.chatEndpoints`

См. §3.3. Все URL чата — в `app-config.js:112-133`, callsite'ы обязаны брать оттуда (`AppConfig.api.getUrl(AppConfig.chatEndpoints.messages(cid))`).

### 14.2 `ChatEventBus` — общий event bus

Хотя модуль чатовский, конструктор использует его как cross-module шину (§7.6). Эмиттеры: `node:invoice-changed`, `node:tb-changed` (`constructor/state/state-tree.js:886, 925`). Подписчики: `tree-renderer.js:19-22`.

### 14.3 `KNOWN_BLOCK_TYPES` — 3 места sync

Новый тип блока чата добавлять синхронно в **трёх** местах:

1. `MessageBlock` union в `app/core/chat/blocks.py` (Python).
2. `_DiscriminatedBlock` в `app/core/chat/schemas.py` (Python).
3. `KNOWN_BLOCK_TYPES` Set во фронте `static/js/shared/chat/chat-messages.js:17-27`.

Без бэка — `parse_message_blocks` не распознает. Без фронта — `_handleSSEEvent` / `ChatRenderer.renderBlock` упадут на default-ветку с fallback-блоком («⚠ Блок неизвестного типа …»).

### 14.4 `ChatPopupManager` в конструкторе

`constructor/header/chat-popup.js` (219 строк) — lazy-init обёртка над `ChatManager` для всплывающего popup-чата в шапке конструктора. Static class. Не singleton-instance — отличие от popup'ов на portal (где `ChatModalManager`).

---

## 15. Открытые техдолги

Перечень нереализованных пунктов с финального аудита.

### Security

| # | Описание | Где |
|---|---|---|
| M4-LS-EXPOSURE | localStorage содержит полное содержимое акта в clear-text. Опции: encrypt / IndexedDB / accept risk. Требует бизнес-решения | — |
| L1-JUPYTERHUB-HEADER | `X-JupyterHub-User` header кое-где dead/misleading. Low-priority cleanup | — |
| DOMPURIFY-CVE | Нет dependabot/snyk — обновление DOMPurify ручное | — |

### Performance

| # | Описание |
|---|---|
| K.2-LAZY-DIALOGS | Lazy-load `dialog-invoice.js` (1302 LOC) и `dialog-help.js` — грузятся всегда |
| K.3-BUNDLER | Bundle через esbuild/vite — противоречит «без бандлера», но даёт treeshaking и source-maps. Не сделано |

### Архитектурные

| # | Описание | Где |
|---|---|---|
| E-3-MRC-EXTRACT | Полная extraction `MetricsRiskCoordinator` отложена (risk-too-high). Реализован только snapshot+rollback | — |
| TB-EVENT-LISTENER | `node:tb-changed` эмитится, но подписчиков нет — реальное обновление imperative-вызовами (§7.6) | — |
| L9-A-ESCAPE-STACK | 9 Escape listeners без `stopImmediatePropagation` — конфликты при вложенных диалогах. Современная Grep даёт 20 совпадений в 20 файлах. **Не закрывалось** | — |
| M10-A-HELP-VS-DIALOG | `HelpManager` и `DialogBase` — параллельные иерархии. Унификация откладывалась | — |
| CK-HARDCODED-LISTS | `ck-fin-res-config.js:7-14` — `FR_ASSIGNMENT_FORMAT_OPTIONS` / `FR_USED_PM_OPTIONS` hardcoded, надо вынести в API | — |

### CSS

| # | Описание |
|---|---|
| #6 — variables-decompose | 576 переменных в одном `variables.css` — нужна декомпозиция |
| M-Z-CALC | Z-index `calc(var(--z-modal) + 1)` в `dialog-overlay.css`, `chat-blocks.css` — частично закрыто введением `-elevated`-уровней, остатки нужно проверить |
| #8 — no-media-queries | Constructor desktop-only — задокументировано (§12.7), не считается багом |

### UX

| # | Описание |
|---|---|
| N9 — merge/delete UX | Smart auto-unmerge при удалении ряда — backlog |
| N11 — configured-chip null | Configured-chip на null-state в Invoice dialog — backlog |

### Infra

| # | Описание |
|---|---|
| LandingSidebar-NAMING | Класс `LandingSidebar` (`portal/portal-sidebar.js:7`) обслуживает все portal-страницы, имя историческое — переименовать в `PortalSidebar` |
