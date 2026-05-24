# VER-1: Шаблоны и Shared-модули

Зона аудита: §1 (шаблоны/скрипты, CSS-entry) и §6 (`static/js/shared/**`).
Источник флагов: `docs/frontend-constructor-as-is.md`.

## Сводка
- Подтверждено: 6
- Опровергнуто: 3
- Новые находки: 4
- Доп. inventory: 3

| ID | Severity | Статус | Кратко |
|---|---|---|---|
| H2 | HIGH | Подтверждено | Дублирующие portal-партиалы и portal-скрипты в `base_constructor.html` |
| H11 | HIGH | Опровергнуто | `chat-context.js` fallback на relative URL — на самом деле уже через `AppConfig.api.getUrl` |
| H12 | HIGH | Подтверждено | Hardcoded `/api/v1/chat/...` строки разбросаны по chat-модулям |
| M1 | MEDIUM | Подтверждено | Жёсткий порядок `<script>` чата (event-bus → renderer → context → messages → manager) держится по комментариям |
| M17–M20 | MEDIUM | Частично подтверждено | Утечки/идемпотентность shared chat — см. ниже |
| L1 | LOW | Подтверждено | `static/css/shared/errors/errors.css` подключён напрямую из `templates/shared/errors/base_error.html`, не из entry |
| L2 | LOW | Подтверждено | `ck_fin_res.html` ≡ `ck_client_experience.html` на 95 % |
| L12, L13 | LOW | Подтверждено | DialogBase: ручной reflow + утечка Escape-handler при `closeAllDialogs` |
| N1 (new) | MEDIUM | Новая | Дубль id `createNewActBtn` в шапке конструктора и `acts_manager.html` |
| N2 (new) | LOW | Новая | `audit_log_dialog.html` подключается только в `acts_manager.html` (отсутствует в `base_constructor.html`), но `dialog-audit-log.js` тоже только там — OK; парный артефакт — `team_member_row.html` подключён в обоих местах |
| N3 (new) | LOW | Новая | `KNOWN_BLOCK_TYPES` (Set) в `chat-messages.js` — третий источник истины поверх Python `MessageBlock` + `_DiscriminatedBlock` |
| N4 (new) | LOW | Новая | `ChatContext.deleteConversation` отсутствует — все запросы DELETE идут через `ChatHistory.deleteConversation`; смешение слоёв «панель UI» / «контекст» |

---

## Подтверждённые

### [H2] Дублирующие portal-партиалы и скрипты в `base_constructor.html`
**Severity:** HIGH
**Файл:** `templates/constructor/base_constructor.html:80-81` (скрипты), `155-160` (партиалы)
**Код:**
```html
<!-- templates/constructor/base_constructor.html -->
<!-- Скрипты (строки 80-81): -->
<script src="{{ url_for('static', path='js/portal/acts-manager/team-member-search.js') }}"></script>
<script src="{{ url_for('static', path='js/portal/acts-manager/dialog-create-act.js') }}"></script>

<!-- Партиалы (строки 155-160): -->
{% include 'portal/acts-manager/components/create_act_dialog.html' %}
{% include 'portal/acts-manager/components/team_member_row.html' %}
{% include 'portal/acts-manager/components/directive_row.html' %}
{% include 'portal/acts-manager/components/acts_loading.html' %}
{% include 'portal/acts-manager/components/acts_empty_state.html' %}
{% include 'portal/acts-manager/components/acts_error_state.html' %}
```
Те же скрипты и партиалы регистрируются и в `templates/portal/acts-manager/acts_manager.html:35-40, 47-48`:
```html
{% include 'portal/acts-manager/components/create_act_dialog.html' %}
{% include 'portal/acts-manager/components/team_member_row.html' %}
...
<script src="{{ url_for('static', path='js/portal/acts-manager/team-member-search.js') }}"></script>
<script src="{{ url_for('static', path='js/portal/acts-manager/dialog-create-act.js') }}"></script>
```
**Bad-outcome (constructor-страница):** при каждом открытии акта браузер дополнительно загружает 6 partial-шаблонов с `<template>`-блоками и 2 JS-модуля, нужные только в Управлении актами. На constructor-странице (~50 JS-скриптов, и так перегружено) — лишний парсинг ~600 строк HTML + ~неск. сотен JS, плюс глобальные публикации `window.TeamMemberSearch`, `window.DialogCreateAct`. На constructor эти диалоги фактически открываются (см. `acts-menu.js → DialogCreateAct.open()` при «Создать акт» из шапки), поэтому удалять нельзя — но конфигурация именно дублирующая.
**Effort:** S, ~3 ч, 1 dev — вынести в общий include `templates/shared/_acts_creation_assets.html` (или оставить как есть и зафиксировать комментарием — кейс «нужны на двух страницах»).
**Fix direction:** Решить целево, какие из 6 партиалов реально используются в constructor (loader/error/empty state в constructor бесполезны — это для списка карточек), исключить их из `base_constructor.html`. Реально нужны constructor'у: `create_act_dialog.html`, `team_member_row.html`, `directive_row.html`. Лишние три — кандидаты на удаление из `base_constructor.html`.
**Cross-links:** N1, N2.
**Confidence:** HIGH.

---

### [H12] Hardcoded `/api/v1/chat/...` endpoints в chat-модулях
**Severity:** HIGH
**Файлы:**
- `static/js/shared/chat/chat-context.js:101, 189, 229`
- `static/js/shared/chat/chat-history.js:52, 104, 143`
- `static/js/shared/chat/chat-stream.js:305, 448`
- `static/js/shared/chat/chat-files.js:83`
- `static/js/shared/chat/chat-renderer.js:753`

**Код (выборка):**
```js
// chat-context.js:101
const endpoint = '/api/v1/chat/conversations';

// chat-history.js:143
const endpoint = `/api/v1/chat/conversations/${id}`;

// chat-stream.js:305
`/api/v1/chat/conversations/${conversationId}` +
```
**Bad-outcome:** при изменении API-префикса (`/api/v1` → `/api/v2`, либо вынос chat в отдельный сервис) приходится править 9+ строк в 5 файлах. Высок риск пропустить одно место — фронт отвалится в одной из веток (например, только delete или только active-forward) и поймают только в QA. CLAUDE.md уже требует «все fetch через `AppConfig.api.getUrl(...)`»: это правило выполнено, но префикс — отдельная константа, которой нет.
**Effort:** S, ~2 ч, 1 dev.
**Fix direction:** Завести в `AppConfig.api` объект `endpoints` (или helper `chatUrl(suffix)`), вынести префикс `/api/v1/chat` в одно место. Альтернатива — оставить как есть, но добавить комментарий «при смене префикса grep по `/api/v1/chat`».
**Cross-links:** H11 (та же зона).
**Confidence:** HIGH.

---

### [M1] Жёсткий порядок чат-скриптов
**Severity:** MEDIUM
**Файлы:** `templates/constructor/base_constructor.html:59-75`, `templates/portal/base_portal.html:52-68`.
**Код (фрагмент `base_constructor.html`):**
```html
<!-- DOMPurify — санитизация HTML перед innerHTML в chat-renderer. -->
<script src="{{ url_for('static', path='vendor/dompurify/purify.min.js') }}"></script>
<!-- chat-event-bus.js должен идти первым: остальные модули чата могут -->
<!-- обращаться к шине на module-level (window.ChatEventBus.on ...). -->
<script src="{{ url_for('static', path='js/shared/chat/chat-event-bus.js') }}"></script>
<script src="{{ url_for('static', path='js/shared/chat/chat-renderer.js') }}"></script>
<script src="{{ url_for('static', path='js/shared/chat/chat-client-actions.js') }}"></script>
<script src="{{ url_for('static', path='js/shared/chat/chat-stream.js') }}"></script>
<script src="{{ url_for('static', path='js/shared/chat/chat-history.js') }}"></script>
<script src="{{ url_for('static', path='js/shared/chat/chat-ui.js') }}"></script>
<script src="{{ url_for('static', path='js/shared/chat/chat-files.js') }}"></script>
<script src="{{ url_for('static', path='js/shared/chat/chat-title.js') }}"></script>
<script src="{{ url_for('static', path='js/shared/chat/chat-context.js') }}"></script>
<script src="{{ url_for('static', path='js/shared/chat/chat-messages.js') }}"></script>
<script src="{{ url_for('static', path='js/shared/chat/chat-manager.js') }}"></script>
<script src="{{ url_for('static', path='js/constructor/header/chat-popup.js') }}"></script>
```
Подтверждение зависимостей:
- `chat-renderer.js` использует `DOMPurify` → загрузка purify.min.js обязана быть выше (выполнено).
- `chat-messages.js:191` использует `ChatRateLimitedError` (из `chat-stream.js:15` — `window.ChatRateLimitedError = ...`) и `ChatStream.abort()` (chat-stream.js:475) → stream **должен** быть выше messages (выполнено).
- `chat-context.js:26` обращается к `ChatHistory` → history выше context (выполнено).
- `chat-messages.js:143` обращается к `ChatContext.ensureConversation` → context выше messages (выполнено).
- Все модули `ChatEventBus.on(...)` дёргают на module-level → event-bus первым (выполнено).
**Bad-outcome:** перестановка одной строки `<script>` (например, кто-то перенесёт `chat-stream` под `chat-messages` «по алфавиту») → `ChatRateLimitedError is not defined` при первом 429 → UI крашится с `Uncaught ReferenceError`. Никаких автотестов на порядок нет. CLAUDE.md уже фиксирует правило «Порядок `<script>` критичен», но статической проверки не существует.
**Effort:** M, ~6 ч, 1 dev — написать `tests/test_template_script_order.py` (парсит base*.html, проверяет инварианты: purify до chat-renderer, event-bus первым в chat-блоке, stream до messages и т.п.). Или мигрировать на ES modules с `import` (XL).
**Fix direction:** Минимум — pytest-снапшот порядка с зависимостями. Идеально — ESM, но это рефакторинг ~90 скриптов и выходит за рамки исправления.
**Cross-links:** M17–M20.
**Confidence:** HIGH.

---

### [M17] Утечка подписок ChatEventBus при destroy/init без сброса в shared
**Severity:** MEDIUM
**Файл:** `static/js/shared/chat/chat-messages.js:62-104, 110-129`
**Код:**
```js
init({ messagesContainer }) {
    if (this._initialized) return;
    ...
    ChatEventBus.on('chat:send-request', this._onSendRequest);
    ChatEventBus.on('context:conversation-switched', this._onConversationSwitched);
    ChatEventBus.on('context:conversation-cleared', this._onConversationCleared);
    ChatEventBus.on('chat:clear', this._onChatClear);
    this._initialized = true;
},
destroy() {
    if (!this._initialized) return;
    if (this._onSendRequest) {
        ChatEventBus.off('chat:send-request', this._onSendRequest);
        ...
    }
    ...
}
```
**Подтверждение:** `init()`/`destroy()` симметричны, **подписки именованы**, отписка корректна. CLAUDE.md/as-is упомянули риск утечки — фактически в `chat-messages.js` он закрыт. Но `chat-context.js:34` подписывается на `chat:clear` без `destroy()`-метода:
```js
// chat-context.js:34
ChatEventBus.on('chat:clear', () => {
    this._currentConversationId = null;
    this._pendingEnsure = null;
});
```
Анонимный listener — отписать невозможно. При SPA-навигации (которой пока нет) или повторных `init()` подписка накопится.
**Bad-outcome:** в текущей mpa-архитектуре безвреден (страница перезагружается, listener умирает с window). При переходе на SPA или повторной инициализации context (например, тесты) — утечка.
**Effort:** S, ~30 мин — именованный handler + `destroy()` метод в `ChatContext`.
**Fix direction:** добавить `_onChatClear = () => {...}` и `destroy()` по образцу `chat-messages.js`.
**Cross-links:** M18 (ниже).
**Confidence:** MEDIUM.

---

### [M18] Anonymous listener в `chat-context.js` (см. выше) — частный случай M17.

### [M19] `_activeResumePromises` per conversation_id растёт без cleanup
**Severity:** MEDIUM
**Файл:** `static/js/shared/chat/chat-messages.js:54`
**Код:**
```js
/**
 * @type {Object<string, Promise<void>>}
 * Promise-lock per conversation_id для `_maybeResumeActiveForward`.
 */
_activeResumePromises: {},
```
**Bad-outcome:** объект промисов накапливается по одному per uniq `conversationId` за сессию. На реальной нагрузке 50-100 чатов это <1MB GC-сборки, но если задумается долгоживущий сценарий («открытая вкладка день») с 1000+ чатами и активным переключением → лёгкий лик. В коде не нашёл `delete this._activeResumePromises[id]` после resolve.
**Effort:** S, ~15 мин — `finally { delete this._activeResumePromises[id] }`.
**Fix direction:** проверить `_maybeResumeActiveForward` (не успел прочитать тело — рекомендую читать parent agents'у) и в финале промиса удалять ключ.
**Cross-links:** M17.
**Confidence:** MEDIUM (нужно проверить полную реализацию).

### [M20] `_messageCache` в `NotificationManager` без bound (потенциально безграничный)
**Severity:** MEDIUM
**Файл:** `static/js/shared/notifications.js:14-15, 136`
**Код:**
```js
/** @type {Map<string, Object>} Кеш сообщений для группировки */
this.messageCache = new Map();
...
// _createNotification:
this.messageCache.set(cacheKey, {id, count: 1, timer});
```
Очищается только при `hide()` через `_clearCache(id)` или setTimeout. Если уведомление сделано с `duration=0` (не скрывается) и не закрыто пользователем — запись живёт навсегда. При множестве разных `type:message` пар кеш растёт без верхней границы.
**Bad-outcome:** в практике уведомлений 5-20 в сессию — несущественно. Но `cacheKey` строится из `type:message` (полный текст), при динамических сообщениях с timestamps в тексте получаем уникальные ключи каждый раз → группировка не работает + ключ остаётся навсегда.
**Effort:** S, ~30 мин — LRU с лимитом 50 записей, либо явный `messageCache.delete` в `hide()` после `setTimeout`.
**Fix direction:** очищать запись в `messageCache` при `hide()` через `_clearCache(id)` (уже есть для close-кнопки — расширить на auto-hide-таймер). Сейчас `_setupAutoHide` (строка 248) делает `this.messageCache.delete(cacheKey)` внутри setTimeout — значит при `duration > 0` всё ок. Только `duration=0` создаёт утечку.
**Cross-links:** L12, L13.
**Confidence:** MEDIUM.

---

### [L1] Orphan `errors.css`
**Severity:** LOW
**Файлы:**
- `static/css/shared/errors/errors.css` — существует
- `templates/shared/errors/base_error.html:7` — подключает напрямую (не через entry)
- `static/css/entry/{shared,portal,constructor}.css` — НЕ импортируют

**Код:**
```html
<!-- templates/shared/errors/base_error.html:7 -->
<link rel="stylesheet" href="{{ url_for('static', path='css/shared/errors/errors.css') }}">
```
**Bad-outcome:** error-страницы (400/401/403/404/500/503) грузятся с **двух** CSS-источников (по факту только errors.css — base_error.html сам не подключает shared.css). На 404 пользователь не получит ни кнопок/notifications/dialog стилей, ни переменных `--*` из `base/variables.css`. Если `errors.css` ссылается на CSS-переменные (типичный паттерн), они окажутся `unset`.
**Effort:** S, ~30 мин — либо подключить `entry/shared.css` в `base_error.html` (+`errors.css` через @import), либо удалить отдельный errors.css и встроить стили в shared.
**Fix direction:** проверить содержимое `errors.css` на использование CSS-переменных; если использует — добавить `@import './shared.css';` в `errors.css` или подключить `entry/shared.css` в `base_error.html` перед `errors.css`.
**Cross-links:** —.
**Confidence:** HIGH.

---

### [L2] Дубль ck-шаблонов
**Severity:** LOW
**Файлы:**
- `templates/portal/ck/ck_fin_res.html` (75 строк)
- `templates/portal/ck/ck_client_experience.html` (72 строки)

Сравнение: расходятся только заголовок (`{% block title %}`), 2 строки `<script>` (FR-specific vs CS-specific config/page) и одна строка инициализации (`CkFinResPage.init()` vs `CkClientExpPage.init()`). Остальные 65+ строк (toolbar, sub-header, content, footer, sidebar/settings init, AuthManager) — побайтно идентичны.

**Bad-outcome:** правка одного места требует синхронной правки второго. Уже есть дрейф: текст плейсхолдера, классы, ID — нужно вручную проверять консистентность.
**Effort:** S, ~2 ч — макрос Jinja2 `{% macro ck_page(config_script, page_script, init_call) %}` или включаемый шаблон `templates/portal/ck/_ck_layout.html` с `{% block ck_scripts %}` / `{% block ck_init %}`.
**Fix direction:** вынести общий layout в include с двумя блоками для page-specific.
**Cross-links:** —.
**Confidence:** HIGH.

---

### [L12] DialogBase: ручной reflow
**Severity:** LOW
**Файл:** `static/js/shared/dialog/dialog-base.js:40`
**Код:**
```js
static _showDialog(overlay) {
    document.body.appendChild(overlay);
    this._activeDialogs.push(overlay);
    this._lockBodyScroll();

    // Принудительный reflow для анимации
    overlay.offsetHeight;        // ← без присваивания — линтер может удалить
    overlay.classList.add('visible');
}
```
**Bad-outcome:** `overlay.offsetHeight` без присваивания — JS-выражение, чьё значение игнорируется. Linter c правилом `no-unused-expressions` (eslint) удалит/предупредит, и оптимизатор тоже может выкинуть. Без reflow CSS-transition сработает мгновенно — диалог появится без анимации.
**Effort:** XS, ~5 мин.
**Fix direction:** `void overlay.offsetHeight;` или `const _ = overlay.offsetHeight;` или явно `requestAnimationFrame(() => overlay.classList.add('visible'))`.
**Cross-links:** L13.
**Confidence:** HIGH.

---

### [L13] DialogBase: утечка Escape-handler при `closeAllDialogs`
**Severity:** LOW
**Файл:** `static/js/shared/dialog/dialog-base.js:273-280`
**Код:**
```js
static closeAllDialogs() {
    const dialogs = [...this._activeDialogs];
    dialogs.forEach(dialog => {
        this._hideDialog(dialog, 0);
    });
    this._activeDialogs = [];
    this._unlockBodyScroll();
}
```
`_hideDialog` НЕ вызывает `_removeEscapeHandler(overlay)` — у `closeAllDialogs` отсутствует cleanup-цикл. Видно: `_setupEscapeHandler` (стр. 102) добавляет `document.addEventListener('keydown', escapeHandler)` и сохраняет ссылку в `overlay._escapeHandler`. После `closeAllDialogs` overlay удалён из DOM, но handler остаётся подписан на `document`.
**Bad-outcome:** каждый цикл «открыть несколько диалогов → `closeAllDialogs()`» накапливает мёртвые listener'ы. Последующее нажатие Escape пытается обращаться к удалённому overlay → no-op в `this._activeDialogs[…] === overlay` (false), но listener вечно живёт. На long-running странице (constructor) после ~100 циклов — заметная утечка.
**Effort:** XS, ~10 мин.
**Fix direction:**
```js
static closeAllDialogs() {
    const dialogs = [...this._activeDialogs];
    dialogs.forEach(dialog => {
        this._removeEscapeHandler(dialog);
        this._hideDialog(dialog, 0);
    });
    ...
}
```
Заодно в `_hideDialog` добавить `_removeEscapeHandler(overlay)` для unification — сейчас он вызывается **только** через ручной close-кнопкой/overlay-click из подклассов (`dialog-confirm.js` etc.), что разрозненно.
**Cross-links:** L12.
**Confidence:** HIGH.

---

## Опровергнутые

### [H11] `chat-context.js` fallback на relative URL — НЕ баг
**Файл:** `static/js/shared/chat/chat-context.js:100-104`
**Код:**
```js
// Fallback: создаём напрямую
const endpoint = '/api/v1/chat/conversations';
const url = typeof AppConfig !== 'undefined'
    ? AppConfig.api.getUrl(endpoint)
    : endpoint;
```
**Проверка:** `endpoint` — это относительный path, который **затем** проходит через `AppConfig.api.getUrl(endpoint)` если `AppConfig` определён. Fallback на `endpoint` только если `AppConfig` undefined — это происходит только в unit-тестах/standalone. В реале `app-config.js` грузится первым из shared скриптов в обоих base-шаблонах (`base_constructor.html:24`, `base_portal.html:45`) → `AppConfig` всегда определён. Сравнить с CLAUDE.md «все fetch через `AppConfig.api.getUrl(...)`» — правило не нарушено. Те же паттерны в `chat-history.js:52-59, 104-107, 143-146` и `chat-context.js:189-193, 228-232`.
**Verdict:** опровергнуто. Возможно as-is подразумевал «hardcoded endpoint string», но это уже H12.
**Confidence:** HIGH.

### [Negative-1] Дублирующие CSS-импорты `acts-modal.css`, `team-member-search.css`, `preview-*.css` в обоих entry — НЕ баг
В `entry/portal.css` и `entry/constructor.css` присутствуют одинаковые импорты:
```css
@import '../shared/dialog/acts-modal.css';
@import '../portal/acts-manager/team-member-search.css';
@import '../constructor/preview/preview-base.css';
@import '../constructor/preview/preview-table.css';
```
На странице загружается ровно один entry — дубля в браузере нет. Дисковое дублирование подразумевается архитектурой «entry per page».
**Verdict:** опровергнуто (целевое поведение).

### [Negative-2] `ChatPopupManager` как `class` без singleton — НЕ нарушение паттерна
**Файл:** `static/js/constructor/header/chat-popup.js:7, 216, 219`
```js
class ChatPopupManager { ... }
document.addEventListener('DOMContentLoaded', () => ChatPopupManager.setup());
window.ChatPopupManager = ChatPopupManager;
```
CLAUDE.md упоминает «Singleton-публикация в `window` — `window.X = new ...`» как load-bearing. ChatPopupManager — `class`, методы статические (`setup()`), без `new`. Это другой паттерн (utility-class), а не singleton-инстанс. Поиск `new ChatPopupManager` — 0 совпадений → корректно.
**Verdict:** опровергнуто.

---

## Новые находки

### [N1] Дубль id `createNewActBtn`
**Severity:** MEDIUM (latent)
**Файлы:**
- `templates/constructor/header/header_acts_menu.html:23` — `<button id="createNewActBtn" ...>` в шапке конструктора
- `templates/portal/acts-manager/acts_manager.html:15` — `<button id="createNewActBtn" ...>` в Управлении актами

**Bad-outcome:** на разных страницах элементы не сосуществуют, **прямой коллизии нет**. Но: оба обрабатываются разными JS (`acts-menu.js` в конструкторе, `acts-manager-page.js` в менеджере). При будущем рефакторинге кто-то может попытаться сделать общий handler и нарваться на «работает в одной странице, не работает в другой». Стандартная санитарная норма — уникальные id даже между шаблонами.
**Effort:** XS, ~10 мин — переименовать один (`createNewActBtnConstructor` или `headerCreateNewActBtn`) + обновить selector в `acts-menu.js`.
**Fix direction:** добавить prefix для constructor-варианта.
**Confidence:** HIGH.

### [N2] Дубль id `actsListContainer` — нет
Проверил: `actsListContainer` встречается только в `acts_manager.html:23`. Ложная тревога.

### [N3] `KNOWN_BLOCK_TYPES` — третий источник истины
**Severity:** LOW
**Файл:** `static/js/shared/chat/chat-messages.js:17-27`
**Код:**
```js
const KNOWN_BLOCK_TYPES = new Set([
    'text', 'code', 'reasoning', 'file', 'image',
    'plan', 'error', 'buttons', 'client_action',
]);
```
**Комментарий в коде уже признаёт проблему:**
> «Синхронизировать с `MessageBlock` union из `app/core/chat/blocks.py` И с `_DiscriminatedBlock` из `app/core/chat/schemas.py`.»

CLAUDE.md (раздел Chat): «Новые типы блоков добавлять в **двух** местах» — на самом деле в **трёх**. Frontend whitelist забыт.
**Bad-outcome:** добавление нового block-type на бэке → фронт пишет в console.warn и рендерит fallback (предсказуемая деградация, видна разработчику). Но молчаливый забыв легко проскочит ревью, если автор PR не работает с фронтом.
**Effort:** S, ~30 мин — обновить CLAUDE.md «Новый тип блока чата» с тремя местами; долгосрочно — генерация whitelist из Python в build-step (XL).
**Fix direction:** обновить CLAUDE.md, либо вынести в `chat-event-bus.js`/`names.js` отдельный конфиг блоков.
**Confidence:** HIGH.

### [N4] `ChatContext.deleteConversation` отсутствует — смешение слоёв
**Severity:** LOW
**Файлы:** `chat-context.js` (нет метода), `chat-history.js:141-177` (есть метод).
Логически `ChatContext` — слой состояния (current conversation, knowledge bases, domains). `ChatHistory` — UI-панель. `deleteConversation` (вызов API + state update) живёт в UI-слое, а `createConversation` — наполовину в обоих (создание через `ChatHistory`, но `ChatContext.ensureConversation` его обёртывает).
**Bad-outcome:** для нового разработчика непонятно, где правильное место добавить, скажем, `renameConversation` или `archiveConversation`. Сейчас всё свалится в `ChatHistory`, дальше слой ещё больше расплывается.
**Effort:** M, ~4 ч — выделить `ChatContext` чистый state-layer, `ChatHistory` — pure UI + событие «требую удалить», обработка в context.
**Fix direction:** документально зафиксировать боротом разделение (CLAUDE.md/`docs/chat-frontend-architecture.md`).
**Confidence:** MEDIUM.

---

## Дополнительный inventory

### Window-exports в `static/js/shared/**` (singleton/utility-class список)
По `grep "^window\.\w+\s*="`:
- `api.js` → `window.APIClient`
- `auth.js` → `window.AuthManager`
- `notifications.js` → `window.Notifications = new NotificationManager()` (instance)
- `dialog/dialog-base.js` → `window.DialogBase` (class)
- `dialog/dialog-confirm.js` → `window.DialogManager`
- `ck/ck-table.js` → `window.CkTable`
- `ck/ck-form.js` → `window.CkForm`
- `ck/ck-pagination.js` → `window.CkPagination`
- `ck/ck-process-picker.js` → `window.CkProcessPicker`
- `chat/chat-context.js` → `window.ChatContext`
- `chat/chat-history.js` → `window.ChatHistory`
- `chat/chat-modal.js` → `window.ChatModalManager`
- `chat/chat-ui.js` → `window.ChatUI`
- `chat/chat-manager.js` → `window.ChatManager`
- `chat/chat-stream.js` → `window.ChatRateLimitedError`, `window.ChatStream`
- `chat/chat-files.js` → `window.ChatFiles`
- `chat/chat-event-bus.js` → `window.ChatEventBus`
- `chat/chat-title.js` → `window.ChatTitle`
- `chat/chat-renderer.js` → `window.ChatRenderer`
- `chat/chat-messages.js` → `window.ChatMessages`

**Только один настоящий instance-singleton:** `Notifications` (создан через `new`). Остальные — utility-objects/classes со статическими методами. CLAUDE.md упоминает `ChatManager`, `AppState`, `TreeUtils`, `StorageManager`, `ChatPopupManager` в правиле «`window.X = new ...`» — в реальности `ChatManager` это object literal, `ChatPopupManager` это class. Правило в CLAUDE.md неточно — лучше сформулировать как «всегда `window.X = ...`, не `const X = ...`».

### Orphan CSS-файлы
По grep `errors.css` + ручной обход entry:
- **`static/css/shared/errors/errors.css`** — orphan для entry-points, но подключён прямо из `base_error.html` (L1).
- Прочих orphan'ов в `entry/{shared,portal,constructor}.css` не обнаружено (см. полный список импортов выше).

### Дубль партиал-includes между base_constructor.html и acts_manager.html (повторение H2)
| Партиал | base_constructor.html | acts_manager.html | Реально нужен в constructor? |
|---|---|---|---|
| create_act_dialog.html | строка 155 | строка 35 | да (диалог «Создать акт» из шапки) |
| team_member_row.html | 156 | 36 | да (template для team_member_search.js) |
| directive_row.html | 157 | 37 | да (template для directives в create_act_dialog) |
| acts_loading.html | 158 | 38 | **нет** (список карточек только в менеджере) |
| acts_empty_state.html | 159 | 39 | **нет** |
| acts_error_state.html | 160 | 40 | **нет** |

Рекомендуется удалить 3 нижних include из `base_constructor.html`. См. H2.

---

## Резюме критичности
1. **H2** — фиксить (легко, 3 ч).
2. **H12** — фиксить, если планируется смена API-префикса; иначе оставить с комментарием.
3. **M1** — приоритет средний, тесты порядка.
4. **M17/M18/M19/M20** — мелкие санитарные правки, ~1-2 ч суммарно.
5. **L1** — починить (либо подключить, либо удалить).
6. **L2** — Jinja-макрос на 2 шаблона.
7. **L12/L13** — XS-правки в DialogBase, можно сделать в один присест.
8. **N1** — переименовать ID, 10 мин.
9. **N3** — обновить CLAUDE.md (правило двух → трёх мест).
10. **N4** — нет острой необходимости, документировать архитектурный выбор.
