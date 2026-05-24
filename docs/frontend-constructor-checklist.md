# Frontend Constructor — Action Checklist

Сводный исполнительный чек-лист по результатам аудита [`frontend-constructor-as-is.md`](frontend-constructor-as-is.md).
Деталь, обоснование «почему плохо», сценарий bad-outcome и направление фикса — в указанной подсекции основного документа (Ctrl+F по строке вида `§7.2`).

## Легенда

| Колонка | Значения | Что значит |
|---|---|---|
| ✅ | ☐ / ☑ | Чек-бокс прогресса (вручную заменить ☐ → ☑ при готовности) |
| ID | — | Идентификатор находки из основного документа (§15) |
| Sev | C / H / M / L / I | CRITICAL / HIGH / MEDIUM / LOW / INFO |
| Wave | 1 / 2 / 3 / 4 / B | Wave 1 — Security & Data Loss, Wave 2 — Architecture & Performance, Wave 3 — Polish & a11y, Wave 4 — Дальнейшее, B — Backlog (см. §17) |
| Категория | — | Security · XSS · State · Persistence · Tree · UX · Perf · CSS · A11y · ActsManager · Admin · CK · Shared · Templates · ErrorHandling · Build · Contracts |
| Файл:строка | — | Точка входа для разработчика |
| Effort | XS / S / M / L | <1ч / 1-4ч / 4-16ч / >16ч (либо явные часы из документа) |
| Dependencies | — | ID, который нужно сделать ДО (`← X`) или после которого этот разблокируется (`блок. X`) |
| Verification | — | Как проверить, что починено (regression-тест, manual repro, lighthouse, axe-core, grep) |
| Ссылка | §X.Y | Подсекция в `frontend-constructor-as-is.md`; для подробного контекста Ctrl+F по `§X.Y` |

## Сводка

| Severity | Всего | Wave 1 | Wave 2 | Wave 3 | Wave 4 | Backlog |
|---|---:|---:|---:|---:|---:|---:|
| **C** — CRITICAL | 7 | 7 | — | — | — | — |
| **H** — HIGH | 32 | 10 | 14 | 7 | — | 1 |
| **M** — MEDIUM | 41 | — | — | 6 | 3 | 32 |
| **L** — LOW | 19 | — | — | 5 | — | 14 |
| **I** — INFO | 7 | — | — | — | — | 7 |
| **Итого** | **106** | **17** | **14** | **18** | **3** | **54** |

> Wave 1 закрывает все CRITICAL + security-критику. Wave 2 — главный архитектурный долг (`renderAll`) + perf-вины. Wave 3 — a11y, error-boundary, CSS-гигиена. Backlog — то, что выявлено, но не запланировано — берётся по мере необходимости.

---

## Wave 1 — Security & Data Loss (17)

| ✅ | ID | Sev | Категория | Описание | Файл:строка | Effort | Dependencies | Verification | Ссылка |
|---|---|---|---|---|---|---|---|---|---|
| ☐ | C-XSS-1 | C | Security/XSS | Stored XSS через `textBlock.content` в `editor.innerHTML` | `static/js/constructor/textblock/textblock-editor.js:27` | M / 4-8ч | разблок. H-HEADERS | `bleach.clean` на бэке + DOMPurify; payload `<img src=x onerror=alert(1)>` не должен исполниться | §7.2 |
| ☐ | C-XSS-2 | C | Security/XSS | Stored XSS в preview через violation-fields | `static/js/constructor/preview/preview-violation-renderer.js:177-185` | S / 1-2ч | разблок. H-HEADERS | preview-режим + XSS payload в нарушении | §7.3 |
| ☐ | C-PROXY | C | State | Proxy ловит только верхний уровень — ~92% правок не помечают dirty | `static/js/constructor/state/state-core.js:518-538` | L / 16-24ч | блок. рефактор C-RESTORE | manual repro: edit cell → внутренние мутации `node.tb`/`node.invoice` → save-indicator должен стать жёлтым; рекурсивный Proxy или ручные `markAsUnsaved()` в ~50 местах | §2.1 |
| ☐ | C-RESTORE | C | Persistence | `restoreSavedState()` — мёртвый метод, восстановление из LS не работает | `static/js/constructor/storage-manager.js:96-167` | S / 2ч | — | grep на вызовы — 0; решить: удалить или подключить как offline-fallback | §2.2 |
| ☐ | C-PATCH×2 | C | ActsManager | Двойной PATCH при сохранении метаданных | `static/js/portal/acts-manager/dialog-create-act.js:496-535` | XS / ~1 строка | — | regression-тест: 1 клик «Сохранить» → ровно 1 запрос PATCH в network tab | §5.3 |
| ☐ | C-URL×2 | C | ActsManager | Двойной `AppConfig.api.getUrl()` → битый URL при «новой части» | `static/js/portal/acts-manager/dialog-create-act.js:1378` | XS / ~1 строка | — | regression-тест: создать акт с новой частью; URL не должен содержать `/proxy/` дважды | §5.3 |
| ☐ | C-LOCK | C | ActsManager | `VersionPreviewOverlay` ломает lock `AuditLogDialog` | `static/js/portal/acts-manager/version-preview.js:288-323` | XS / удалить 4 строки | — | manual: открыть audit-log, открыть version-preview, закрыть preview — audit-log не должен потерять lock | §5.3 |
| ☐ | H-HEADERS | H | Security | Нет CSP / X-Frame-Options / HSTS / X-Content-Type-Options | `app/main.py`, `app/core/middleware.py` | S / 2-4ч | блок. для C-XSS-* (defence-in-depth) | `curl -i http://… \| grep -E 'CSP\|X-Frame'`; CSP сначала в `report-only`, затем enforce | §7.6 |
| ☐ | H-XSS-1 | H | Security/XSS | XSS в diff-режиме (added/removed/fallback ветки без sanitize) | `static/js/portal/acts-manager/diff-renderer.js:193-215` | S | блок. H-HEADERS | открыть версию + diff, вставить payload, проверить | §7.4 |
| ☐ | H-XSS-3 | H | Security/XSS | Preview-textblock без DOMPurify (как C-XSS-1) | `static/js/constructor/preview/preview-textblock-renderer.js:36-44` | S | блок. H-HEADERS | preview-панель + edited textblock с XSS payload | §7.5 |
| ☐ | H-EXTEND | H | Persistence | Одна сетевая ошибка `extend` → принудительный logout пользователя | `static/js/constructor/lock-manager.js:222-308` | M | — | mock 1 fail в extend — пользователь не должен быть выкинут; `MAX_FAILURES=3` | §2.7 |
| ☐ | H-NAV | H | Persistence | Несимметричный navigation interception (обходится `window.location.href`/popstate) | `static/js/constructor/storage-manager.js:269-337` | M | — | программная навигация при dirty-state должна показать confirm; popstate handler | §2.7 |
| ☐ | H-A11Y-LIVE | H | A11y | Notifications + save-indicator без `aria-live` | `static/js/shared/notifications.js`, `header_save_indicator.html:7` | XS / 30 мин | — | axe-core scan; NVDA озвучивает уведомление | §10.4 |
| ☐ | H-A11Y-MOTION | H | A11y | `prefers-reduced-motion` не реализована (0 вхождений) | `static/css/animations.css` | XS / 10 мин | — | DevTools → emulate reduced motion → анимации отключены | §10.5 |
| ☐ | N7-BACKEND | H | Security/Admin | `/api/v1/acts/users/search` без `Depends(get_username)` | `app/domains/acts/api/users.py` | XS / 30 мин | — | без auth-header → 401, не результат | §5.3 / Wave1 §17 |
| ☐ | I-CONSOLE | I | Security | `console.log(username)` видно в DevTools продакшен-юзеру | `static/js/shared/auth.js:164, 197` | XS | — | grep `console.log.*username`; удалить вызовы | §7.7 |
| ☐ | I-DOM-FB | I | Security | DOMPurify-fallback пишет non-sanitized HTML если vendor отсутствует | `static/js/shared/chat/chat-renderer.js:33-41` | XS | блок. H-HEADERS | принудительно убрать DOMPurify → fallback должен escape'ить | §7.7 |

---

## Wave 2 — Architecture & Performance (14)

| ✅ | ID | Sev | Категория | Описание | Файл:строка | Effort | Dependencies | Verification | Ссылка |
|---|---|---|---|---|---|---|---|---|---|
| ☐ | H-RENDERALL | H | Perf/Architecture | Монолитный `ItemsRenderer.renderAll()` — 14 call-sites, 15-200 мс на вызов | `static/js/constructor/items/items-renderer.js:13` | L / по фазам S→L | блок. Playwright smoke + M7 verify + E-5/E-6 verify | Chrome DevTools Performance profile до/после; на типичном акте < 10 мс | §8.2 / §17 Phase 2.1-2.3 |
| ☐ | H-SCRIPTS | H | Perf/Build | 72 `<script>` без `defer` → 600-1200 мс белого экрана под HTTP/1.1 | `templates/constructor/base_constructor.html` | S | — | DevTools Network waterfall; cold-load < 700 мс | §8.3 |
| ☐ | H-PREVIEW | H | UX/Perf | RAF без de-dup + мёртвый listener `app:state-changed` | `static/js/constructor/preview/preview.js`, `preview-menu.js:345` | S | — | trace input в violation: 1 update/frame, не N; grep dispatchEvent `app:state-changed` | §4.3 |
| ☐ | H-CACHE | H | Build | Cache-busting не настроен — после деплоя нужен Ctrl+F5 | `base_constructor.html`, `portal.html` (124 url_for) | S / 1-2ч | — | bump `APP_VERSION` → `<link>`/`<script>` URL получают `?v=…` | §13.2 |
| ☐ | H2 | H | Templates | Дублирующие portal-партиалы в `base_constructor.html` | `templates/constructor/base_constructor.html:80-81, 155-160` | S | — | удалить дубль include; sidebar/header не ломаются | §1 |
| ☐ | H4 | H | Persistence | Activity-listeners `LockManager` без `removeEventListener` | `static/js/constructor/lock-manager.js:261-267` | S | — | switch актов 50 раз → DevTools Memory → listeners не растут | §2.7 |
| ☐ | H5-A | H | UX | Ctrl+S во время editing ячейки сохраняет неактуальный state | `static/js/constructor/app.js:149` | M | блок. H-RENDERALL (focus preservation) | edit cell + Ctrl+S → сохраняется значение из ячейки, не предыдущее | §4.3 |
| ☐ | H6-A | H | UX/Perf | Preview rebuild на каждый input (60 fps) | `static/js/constructor/violation/violation-core.js`, `items-title-editing.js:288-291` | S | — | trace набора в textarea — debounce 150 мс / RAF de-dup | §4.3 |
| ☐ | H7-A | H | UX | Магический `setTimeout(50)` перед `restoreTableSizes` | `static/js/constructor/context-menu/context-menu-cells.js:783-803` | S | — | заменить на `requestAnimationFrame` или явное событие | §4.3 |
| ☐ | H10 | H | ActsManager | `window.env` vs `AuthManager.getCurrentUser()` — две истины | `static/js/portal/acts-manager/dialog-create-act.js:61, 157` | S | — | grep `window.env`; стандартизировать на `AuthManager` | §5.3 |
| ☐ | H12 | H | Shared | Hardcoded `/api/v1/chat/...` (9 occurrences) | `static/js/shared/chat/*.js` (5 модулей) | S | — | вынести в `ChatConfig.endpoints.*`; grep на хардкод = 0 | §6 |
| ☐ | H-N1-UX | H | UX | `forceSave` не блокирует двойной POST | `static/js/constructor/app.js:127` | S | — | mash Ctrl+S 5 раз → 1 запрос, не 5; флаг `_saveInFlight` | §4.4 |
| ☐ | H-N8-UX | H | UX | Notifications без лимита — при шторме DOM лагает | `static/js/shared/notifications.js` | S | — | `MAX_NOTIFICATIONS=15` + ротация; стресс-тест 100 ошибок | §4.4 |
| ☐ | H-N3-ACTS | H | ActsManager | Нет cross-tab инвалидации после delete/duplicate | `static/js/portal/acts-manager/acts-manager-page.js:551-660` | M | — | BroadcastChannel; 2 вкладки → удаление → список обновляется | §5.3 |

---

## Wave 3 — Polish & a11y (18)

| ✅ | ID | Sev | Категория | Описание | Файл:строка | Effort | Dependencies | Verification | Ссылка |
|---|---|---|---|---|---|---|---|---|---|
| ☐ | H-A11Y-TREE | H | A11y | Tree без ARIA-роли/tabindex/keyboard navigation | `templates/constructor/components/tree_panel.html:4` | L / 3-4 дня | — | APG Treeview pattern; axe-core scan; keyboard навигация Up/Down/Left/Right | §10.2 |
| ☐ | H-A11Y-DIALOGS | H | A11y | Диалоги без focus-trap/restore, без `aria-modal` | `static/js/shared/dialog/dialog-base.js:34-71` | M / 1 день | — | axe-core scan dialog; Tab не уходит за пределы; фокус возвращается на trigger | §10.3 |
| ☐ | H-A11Y-TABLE | H | A11y | Custom-таблица без `role="grid"` и keyboard cells | `static/js/constructor/table/table-core.js` | L / 2-3 дня | блок. H-RENDERALL | axe-core scan; навигация ячеек стрелками; merge/insert/delete с клавиатуры | §10.6 |
| ☐ | H-BOUNDARY | H | ErrorHandling | Нет глобального `window.onerror` / `unhandledrejection` | глобально | XS | — | искусственная ошибка → перехвачена + залогирована | §12.1 |
| ☐ | H-TIMEOUT | H | ErrorHandling | Нет fetch timeout (AbortController) | `static/js/shared/api.js` | S | — | tc qdisc slow backend → запрос завершается с timeout, а не висит | §12.3 |
| ☐ | H-422 | H | ErrorHandling | 422-ответ = `[object Object]` | `static/js/shared/api.js` | S | — | POST invalid form → юзер видит «поле X: …», не object | §12.4 |
| ☐ | H-SILENT-1 | H | ErrorHandling | `unlockAct().catch(()=>{})` — акт может остаться залочен | `static/js/portal/acts-manager/version-preview.js:305` | XS | — | mock unlock fail → юзер видит ошибку, акт не залочен «навсегда» | §12.5 |
| ☐ | H-SILENT-2 | H | ErrorHandling | `_saveDefaultStructure` catch не кидает — юзер не знает | `static/js/shared/api.js:472-475` | S | — | offline → save показывает explicit-ошибку | §12.5 |
| ☐ | A1 | H | Admin | Серверный gate на `/admin` отсутствует — non-admin доходит до клиента | `app/domains/admin/routes/portal.py:15-34` | XS / 10 мин | — | не-админ → 403 на HTML-роуте, не на API | §11.1 |
| ☐ | C1 | H | CK | 386 строк дублирования `ck-client-exp-page.js` ↔ `ck-fin-res-page.js` | `static/js/portal/ck/ck-*-page.js` | M / 0.5 дня | — | вынести `CkPage` базовый класс; regression обоих доменов | §11.2 |
| ☐ | CSS-VARS-BROKEN | H | CSS | `--duration-fast/normal` undefined (29 occurrences) | `chat.css`, `sidebar.css`, `landing.css` | XS / 10 мин | — | добавить токены в `variables.css`; grep no-op transitions = 0 | §9.2 |
| ☐ | CSS-Z-INDEX-CALC | M | CSS | `calc(var(--z-modal-backdrop) + 100)` пересекает `--z-modal` | `dialog-overlay.css:59,64`, `chat-blocks.css:421` | S / 30 мин | — | grep `calc.*z-index`; заменить на явный токен | §9.5 |
| ☐ | M8 | M | Tree | Магические строки nodeTypes в 92 местах | `state-content.js` (17), `state-tree.js` (9), `context-menu-tree.js` (13) | M / 0.5 дня | — | grep строковых литералов nodeType = 0; всё через `AppConfig.nodeTypes` | §3.5 |
| ☐ | N-DUP-ID | M | State/Templates | Дубль `id="createNewActBtn"` между шаблонами | `header_acts_menu.html:23`, `acts_manager.html:15` | XS / 10 мин | — | переименовать; `document.querySelectorAll('#createNewActBtn').length === 1` | §1 |
| ☐ | L1 | L | Templates | `errors.css` не входит в `entry/shared.css` | `templates/shared/errors/base_error.html:7` | XS | — | проверить стили на error-странице | §1 |
| ☐ | L7 | L | UX | `verifyInvoice` — заглушка без вывода warnings юзеру | `api.js:741-758`, `dialog-invoice.js:1147-1155` | S | — | вызвать verify → warnings inline в UI | §4.3 |
| ☐ | L12 | L | Templates | `DialogBase`: ручной reflow без присваивания | `dialog-base.js:40` | XS | — | lint может удалить; проверить, что dialog корректно открывается | §1 |
| ☐ | L13 | L | Templates | `DialogBase.closeAllDialogs` не удаляет Escape-handler | `dialog-base.js:273-280` | XS | — | открыть-закрыть 50 диалогов → DevTools Memory без роста listeners | §1 |

---

## Wave 4 — Дальнейшее (3)

| ✅ | ID | Sev | Категория | Описание | Файл:строка | Effort | Dependencies | Verification | Ссылка |
|---|---|---|---|---|---|---|---|---|---|
| ☐ | CONTRACT-LIST | M | Contracts | Response shape list-endpoints несогласован (`{items,total}` vs `[...]`) | `app/domains/acts/api/*.py` | M | — | audit всех list-эндпоинтов; единый shape | §14.4 |
| ☐ | CONTRACT-LIMITS | M | Contracts | Pagination limits разные: 2000 vs 200 vs 500 без системы | `app/domains/acts/api/*.py` | M | — | документировать или стандартизировать (например, 1..200) | §14.5 |
| ☐ | CONTRACT-ERROR | M | Contracts | Error response envelope несогласован (FastAPI vs domain vs Kerberos) | `app/core/handlers.py` | M | — | единый `{detail, code, ...extra}`; client-parser обновить | §14.6 |

---

## Backlog (54)

> Найдено в аудите, не запланировано в Wave 1-4. Брать по мере необходимости, при касании соответствующего кода или появлении соответствующей боли.

### MEDIUM (32)

| ✅ | ID | Sev | Категория | Описание | Файл:строка | Effort | Dependencies | Verification | Ссылка |
|---|---|---|---|---|---|---|---|---|---|
| ☐ | M1 | M | Templates | Жёсткий порядок chat-скриптов без проверки | `base_constructor.html` | M | — | unit-тест парсинга script order | §1 |
| ☐ | M2 | M | Persistence | Дубль логики dirty/clean | `storage-manager.js`, state-*  | S | — | grep `markAsUnsaved`; единый helper | §2.7 |
| ☐ | M3 | M | State | Несимметричные `beforeunload` хендлеры (3 источника) | `app.js:243`, `storage-manager.js:227`, `lock-manager.js:328` | S | — | прогнать программный выход — единый код-путь | §2.7 |
| ☐ | M5 | M | Tree | Дублирование логики нумерации в 3 местах | items/tree/preview-renderers | S | — | унифицировать `getNodeDisplayName` | §3.5 |
| ☐ | M6 | M | Tree | TreeRenderer cross-zone TB-sync через приватные методы | `tree-renderer.js:586-598` | M | — | event-bus вместо private методов | §3.5 |
| ☐ | M7 | M | Tree | Dead-parameter в `_cleanupMetricsTablesAfterRiskTableDeleted` | tree | XS | блок. Wave 2 verify | удалить параметр, переименовать | §3.5 |
| ☐ | M9 | M | Tree | `AppState.deleteNode` не проверяет protected | state | XS | — | unit-тест удаления секций 1-5 | §3.5 |
| ☐ | M10 | M | UX | HelpManager vs DialogManager — параллельные иерархии | shared | M | — | миграция на единый `_activeDialogs` | §4.3 |
| ☐ | M11 | M | State | Read-only disabled vs save-indicator конфликт | `app.js:303-307`, `storage-manager.js:672,678` | S | — | read-only режим → кнопка save не «оживает» | §2.7 / §4.3 |
| ☐ | M12 | M | UX | Нет sync preview ↔ side-panel | preview | M | — | manual: правка в side-panel отражается в preview | §4.3 |
| ☐ | M13 | M | ActsManager | Ручная фильтрация audit-log без FilterEngine | acts-manager | S | — | документировать или вынести в FilterEngine | §5.3 |
| ☐ | M14 | M | ActsManager | Неявная зависимость от `window.currentActId` | acts-manager | S | — | передавать явно через ctor/arg | §5.3 |
| ☐ | M15 | M | ActsManager | Silent fail автозаполнения «Руководителя» | dialog-create-act | S | — | mock 500 на запрос — юзер видит warning | §5.3 |
| ☐ | M16 | M | ActsManager | Нет debounce на фильтрах audit-log | dialog-audit-log | S | — | debounce 300 мс; trace input → 1 запрос | §5.3 |
| ☐ | M17 | M | Shared | Утечки подписок `ChatEventBus` | `chat-context.js:34` | S | — | DevTools Memory: 50 mount/unmount → listeners не растут | §6.3 |
| ☐ | M18 | M | Shared | Утечки подписок `ChatEventBus` в `chat-messages` | chat | S | — | проверить `destroy()` снимает все handlers | §6.3 |
| ☐ | M19 | M | Shared | `_activeResumePromises` без cleanup | chat-stream | S | — | `delete` в `finally` | §6.3 |
| ☐ | M20 | M | Shared | `NotificationManager.messageCache` leak | `notifications.js` | S | — | очищать при `hide()` | §6.3 |
| ☐ | M-ESC-1 | M | Security | `username` без escape в audit-log, `<img onerror>` сработает | `dialog-audit-log.js:415,503` | XS | блок. H-HEADERS | grep `username` → `document.createTextNode` | §7.7 |
| ☐ | M-ESC-2 | M | Security | Unquoted `data-*` атрибут в admin-add-user | `admin-add-user-dialog.js:119` | XS | блок. H-HEADERS | проверить HTML output на quoting | §7.7 |
| ☐ | M-OPEN-REDIR | M | Security | `open_url` whitelist `https://*` → любой external | `chat-client-actions.js:142-158` | S | — | prompt с `https://evil.com` → blocked | §7.8 |
| ☐ | M-LS-EXPOSE | M | Security | localStorage содержит полное содержимое акта — видно XSS-вектору | `storage-manager.js`, `acts-menu.js:75` | M | — | DevTools Storage tab; решить: encrypt, IndexedDB, или принять риск | §7.7 |
| ☐ | N-LS-PREFIX | M | State | LS-ключи без префикса `actId` (cross-act коллизии) | storage | M | — | grep `localStorage.setItem` — все ключи содержат actId | §2.7 |
| ☐ | N-BLOCK-3 | M | Shared | `KNOWN_BLOCK_TYPES` — третий источник истины (бэк/JS/whitelist) | `chat-messages.js:17-27` | S | — | обновить CLAUDE.md о двух+одном источниках | §6 |
| ☐ | N2-STATE | M | State | `ActsMenuManager` кеш 1 мин показывает удалённые акты | acts-menu | M | блок. H-N3-ACTS | storage-event cross-tab инвалидация | §4.4 |
| ☐ | N5-STATE | M | Persistence | Двойной PUT `/content` при exit | `header-exit.js:74-82`, `lock-manager.js:438-519` | S | — | logirovat' requests; exit → 1 запрос, не 2 | §2.7 |
| ☐ | N6-EXIT | M | Persistence | `header-exit` не ждёт фоновую save | header-exit | S | — | `await _pendingSavePromise` перед exit | §4.4 |
| ☐ | N7-INIT | M | State | Race между `_autoLoadAct` и `_initStateTracking` | `state-core.js:563-571` | M | — | unit-тест DOMContentLoaded timing | §2.7 |
| ☐ | N7-INVOICE | M | UX | `InvoiceDialog` leak Promise при закрытии во время AJAX | invoice | M | — | AbortController на fetch | §4.4 |
| ☐ | N8-STATE | M | State | `ChangelogTracker` без `destroy` при switch актов | changelog | S | — | switch акт 50 раз — listeners не растут | §2.7 |
| ☐ | E-1 | M | Tree | `node.tb` мутируется в 3 местах без координации | `tree-renderer.js:533-546`, `items-renderer.js:279-296`, `state-tree.js` | M | — | ввести `AppState.setNodeTb()` единственной точкой | §3.6 |
| ☐ | E-2 | M | Tree | `TreeUtils.isPinnedTable` асимметричен | tree | S | — | унифицировать флаги на node-уровне | §3.6 |

### Wave-2-pre-check (3, MEDIUM)

| ✅ | ID | Sev | Категория | Описание | Файл:строка | Effort | Dependencies | Verification | Ссылка |
|---|---|---|---|---|---|---|---|---|---|
| ☐ | E-3 | M | Tree | Каскадная логика metrics↔risk в 4 файлах | context-menu-tree, state-content, state-tree, tree-drag-drop | L | блок. Wave 2 готовности | ввести `MetricsRiskCoordinator` | §3.6 |
| ☐ | E-5 | M | Tree | Drag-drop race с async `moveNode` | tree-drag-drop | M | блок. Wave 2 verify | синхронизация drag state | §3.6 |
| ☐ | E-6 | M | Tree | Drag-drop race при auto-reload | tree-drag-drop | M | блок. Wave 2 verify | отслеживать `draggedElement` | §3.6 |

### CK MEDIUM (5) + Admin MEDIUM (2)

| ✅ | ID | Sev | Категория | Описание | Файл:строка | Effort | Dependencies | Verification | Ссылка |
|---|---|---|---|---|---|---|---|---|---|
| ☐ | C2 | M | CK | `_loadData` грузит ВСЕ записи без server paging | `ck-client-exp-page.js` | M | — | тест с 1000 записей; network tab показывает пагинацию | §11.2 |
| ☐ | C3 | M | CK | `Promise.all` без AbortController при switch CE↔FR | `ck-*-page.js` | L | — | быстрый swap tab → нет race/errors | §11.2 |
| ☐ | C4 | M | CK | Пустое number-поле = 0 вместо null | `ck-form.js:64-65` | S | — | edit form, очистить число → value=null | §11.2 |
| ☐ | C5 | M | CK | Legacy справочник без подсветки «устарело» | `ck-form.js:357-369` | S | — | выбрать legacy → визуальный warning | §11.2 |
| ☐ | C6 | M | CK | Empty-state одинаков для «пусто» и «фильтр не дал» | `ck-table.js:111-114` | S | — | apply filter → message ясно различает кейсы | §11.2 |
| ☐ | A2 | M | Admin | Init-ошибка одно сообщение, не разветвлено по 403/5xx/network | `admin-page.js:23-26` | S | — | тест: (1) no auth, (2) 403, (3) 5xx — разные сообщения | §11.1 |
| ☐ | A3 | M | Admin | Оптимистичное обновление откатывается, `_users` не sync | `admin-roles.js:274-306` | M | — | toggle role + network error → state соответствует UI | §11.1 |

### ErrorHandling MEDIUM (5)

| ✅ | ID | Sev | Категория | Описание | Файл:строка | Effort | Dependencies | Verification | Ссылка |
|---|---|---|---|---|---|---|---|---|---|
| ☐ | H6 | M | ErrorHandling | Rollback message не информативен (admin-roles) | admin-roles | S | — | network fail → юзер видит explicit-ошибку | §12.5 |
| ☐ | H7 | M | ErrorHandling | `lock-manager.extendLock` silent | lock-manager | S | блок. H-EXTEND | связано с H-EXTEND retry | §12.5 |
| ☐ | H8 | M | ErrorHandling | `dialog-invoice` config error silent | dialog-invoice | S | — | config-fail → юзер видит ошибку | §12.5 |
| ☐ | H9 | M | ErrorHandling | `chat-stream` resume error silent | chat-stream | S | — | разрыв SSE → notice показан | §12.5 |
| ☐ | H10-INVOICE | M | ErrorHandling | `dialog-invoice` verify/save warn silent | dialog-invoice | S | — | warn → юзер видит inline | §12.5 |
| ☐ | G.4 | M | ErrorHandling | `AuditLogDialog.show` silent fail на locked акте | audit-log | S | — | open audit-log на locked → message об ошибке | §5.6 |

### LOW (14)

| ✅ | ID | Sev | Категория | Описание | Файл:строка | Effort | Dependencies | Verification | Ссылка |
|---|---|---|---|---|---|---|---|---|---|
| ☐ | L2 | L | Templates | Дубли ck-шаблонов на ~95% | `ck_fin_res.html` vs `ck_client_experience.html` | M | блок. C1 | вынести partial | §1 |
| ☐ | L3 | L | State | Магические задержки `setTimeout(50/100/300)` | state/storage | S | — | grep `setTimeout.*\d{2,3}\b` → константы | §2.7 |
| ☐ | L4 | L | UX | Магические задержки в UX-flow | preview, dialogs | S | — | то же — вынести в константы | §4 |
| ☐ | L8 | L | ErrorHandling | Silent fail справочников Invoice | api.js, dialog-invoice | S | — | кешировать null, показывать ошибку | §4.3 |
| ☐ | L9 | L | UX | Множественные Escape-listeners (9 источников) | shared/dialog | M | — | единый ESC-handler в `DialogManager` | §4 |
| ☐ | N4 | L | Shared | `ChatContext.deleteConversation` отсутствует | chat-context | S | — | документировать или реализовать | §6.6 |
| ☐ | L-AUTH-HDR | L | Security | `X-JupyterHub-User` header dead/misleading | `auth.js:262-267` | S | — | grep в backend; удалить мёртвый код | §7.7 |
| ☐ | L-HDR-FB | L | Security | `portal.py` landing принимает header вместо ENV | `app/routes/portal.py:39-43` | XS | — | использовать `JUPYTERHUB_USER` env | §7.7 |
| ☐ | L-LS-USER | L | Security | LS `auth_username` доступен XSS-вектору | `auth.js:13` | M | — | заменить на `/api/v1/auth/me` | §7.7 |
| ☐ | A4 | L | Admin | `searchUsers` без AbortController — race в detached DOM | `admin-add-user-dialog.js:111` | L | — | close dialog во время поиска → console чист | §11.1 |
| ☐ | A5 | L | Admin | Ошибка поиска без `Notifications.error` | `admin-add-user-dialog.js:134-137` | XS | — | trigger 500 → user видит notification | §11.1 |
| ☐ | A6 | L | Admin | `chip.title` без escape (XSS-вектор) | admin chip-rendering | XS | блок. H-HEADERS | XSS payload в title attr | §11.1 |
| ☐ | A7 | L | Admin | Admin scripts без `defer` | admin templates | XS | — | связано с H-SCRIPTS, scope admin | §11.1 |
| ☐ | C7 | L | CK | Магическое число 7 страниц, нет `…` при >7 | `ck-pagination.js:76` | S | — | pagination с >7 страниц → ellipsis | §11.2 |
| ☐ | C8 | L | CK | Inline-стили через `btn.style.*`, не CSS | `ck-pagination.js` | M | — | рефактор → toggle CSS-класс | §11.2 |
| ☐ | C9 | L | CK | KM-маска дублирует логику из acts-manager | `ck-form.js:411-432` | M | — | вынести в `utils/formatting.js` | §11.2 |
| ☐ | C10 | L | CK | Глобальные `const` в module-scope без `window.X` | `ck-fin-res-config.js:7-14` | S | — | `window.CK_CONFIG` единая точка | §11.2 |
| ☐ | C11 | L | CK | `getElementById` напрямую, не через `containerEl.querySelector` | `ck-form.js:51-84` | S | — | scope к контейнеру | §11.2 |
| ☐ | CSS-TRANSITION-ALL | L | CSS | `transition: all` 38 раз (антипаттерн) | audit-log-dialog, version-preview, etc | S | — | find-replace → `opacity/transform` | §9.8 |
| ☐ | CSS-VARS-SWAMP | M | CSS | 572 переменные в одном `variables.css`, дубли (`--accent`≡`--info`) | `variables.css` | L | — | декомпозиция в `tokens/`; grep синонимов | §9.3 |
| ☐ | CSS-RESPONSIVE | M | CSS | Constructor 0 media queries (рассчитан ≥1280px), landing partial | `constructor.css` | M | — | явно задокументировать min-width в CLAUDE.md или добавить media | §9.7 |

### INFO (7)

| ✅ | ID | Sev | Категория | Описание | Файл:строка | Effort | Dependencies | Verification | Ссылка |
|---|---|---|---|---|---|---|---|---|---|
| ☐ | A8 | I | Admin | `/admin/audit-log` endpoint orphan — фронт не использует | `app/domains/admin/api/roles.py:102-123` | INFO | — | решить: подключить UI или удалить эндпоинт | §11.1 |
| ☐ | C12 | I | CK | Inline стили на кнопках в HTML | `templates/portal/ck/*.html` | S | — | вынести в CSS-классы | §11.2 |
| ☐ | C13 | I | CK | Лишние endpoints dictionaries, фронт не дёргает | `app/domains/ck_*/api/dictionaries.py` | INFO | — | документировать или удалить | §11.2 |
| ☐ | C14 | I | CK | `clear()` vs `renderEmpty()` — confusing именование | `ck-table.js` | S | — | переименовать (clear/render) | §11.2 |

---

## Wave 4 (опционально) — расширения из §17

Не имеют конкретного ID (общий backlog):

- ☐ **Wave 2.7** — bundling через esbuild (12 RTT → 2-3 под HTTP/1.1) — §17
- ☐ **Backend response envelope унификация** (CONTRACT-ERROR + CONTRACT-LIST) — частично в Wave 4 выше
- ☐ **Дельта-сериализация для localStorage** или переход на IndexedDB — §17
- ☐ **Подключить `/admin/diagnostics` + `/admin/audit-log` в UI** — связано с A8
- ☐ **WebSocket/SSE для cross-tab инвалидации** acts list — связано с H-N3-ACTS
- ☐ **Frontend error tracking endpoint** (`POST /api/v1/system/client-error`) — §17
- ☐ **CI/CD pipeline** — `.github/workflows/test.yml` — §17
- ☐ **Decomposition `variables.css`** в отдельные модули — связано с CSS-VARS-SWAMP

---

## Что НЕ в этом чек-листе (см. §18)

- Реальный профайл под Chrome DevTools Performance / Lighthouse — все цифры расчётные
- Сетевой профайл под фактическим RTT/bandwidth JupyterHub
- Memory snapshot длинной сессии (1+ час) — для подтверждения утечки `ViolationManager.activeViolations`
- Реальная частота `markAsUnsaved` при активном вводе — для подтверждения масштаба C-PROXY

Эти исследования стоит проделать перед/во время Wave 2 для подтверждения приоритетов.
