# VER-5: Acts Manager — верификация и расширение

> Зона: `static/js/portal/acts-manager/*` (7 файлов, 4023 строки), `templates/portal/acts-manager/**`, `app/domains/acts/routes/portal.py`.
> База сравнения: `docs/frontend-constructor-as-is.md` §5 + 9 флагов H8/H9/H10/M13–M16/L10/L11.
> Метод: чтение исходников полностью, перекрёстная проверка backend (`app/domains/acts/api/*`, `app/domains/acts/services/*`).

---

## Сводка

| Метрика | Значение |
|---|---|
| Флагов проверено | 9 |
| Подтверждено | 8 |
| Опровергнуто | 1 (L11 уточнено) |
| Новых находок | 7 |
| Из них CRITICAL | 3 |
| Из них HIGH | 2 |
| Из них MEDIUM | 2 |

---

## §A. CreateActDialog deep-dive (1413 строк)

### A.1 Карта получения username

Грепы `window.env` vs `AuthManager.getCurrentUser()` в зоне:

| Файл | Метод | Источник username |
|---|---|---|
| `dialog-create-act.js:61` | `_loadSection5Points` | `window.env?.JUPYTERHUB_USER \|\| AppConfig?.auth?.jupyterhubUser \|\| ""` |
| `dialog-create-act.js:157` | `_showActDialog` (передаёт во все handler'ы как `currentUser`) | `window.env?.JUPYTERHUB_USER \|\| AppConfig?.auth?.jupyterhubUser \|\| ""` |
| `acts-manager-page.js:212` | `loadActs` | `AuthManager.getCurrentUser()` |
| `acts-manager-page.js:461` | `editAct` (передаёт в перехваченный `_handleFormSubmit`) | `AuthManager.getCurrentUser()` |
| `acts-manager-page.js:563` | `duplicateAct` | `AuthManager.getCurrentUser()` |
| `acts-manager-page.js:632` | `deleteAct` | `AuthManager.getCurrentUser()` |
| `static/js/shared/api.js:1030` | `APIClient.searchTeamUsers` | `AuthManager.getCurrentUser()` |

**Вывод по H10:** [HIGH] **ПОДТВЕРЖДЕНО.** В CreateActDialog 2 места используют `window.env`, при этом ВСЕ соседние файлы единообразно идут через `AuthManager`. `editAct` в `acts-manager-page.js:461` получает username через `AuthManager` и передаёт его в перехваченный `_handleFormSubmit`. Но `_showActDialog` определяет свой `currentUser` независимо через `window.env` (стр 157) — два разных значения могут разойтись (если `window.env` не инжектится шаблоном, fallback на пустую строку → `X-JupyterHub-User: ""` → 401/403). 

```javascript
// acts-manager-page.js:461
const username = AuthManager.getCurrentUser(); // ← источник 1
...
await dialogClass._handleFormSubmit(form, true, actId, username, form);

// dialog-create-act.js:157
const currentUser = window.env?.JUPYTERHUB_USER || AppConfig?.auth?.jupyterhubUser || "";  // ← источник 2
this._setupEventHandlers(dialog, isEdit, actData, currentUser);  // привязывает form.onsubmit с currentUser

// → form.onsubmit вызовет _handleFormSubmit(e.target, isEdit, actData?.id, currentUser, dialog) — стр 439
// → разные значения username в обычном submit-flow vs. перехваченном safeClose-flow
```

### A.2 Autosave / submit-flow — НОВАЯ КРИТИЧЕСКАЯ НАХОДКА (N1)

**[CRITICAL]** Перехват `_closeDialog` в `acts-manager-page.js:496-535` (H9) приводит к **двойной отправке PATCH-запроса** при обычном «Сохранить изменения».

Flow:
1. Пользователь жмёт «Сохранить» → `form.onsubmit` → `_handleFormSubmit(form, true, actId, currentUser_env, dialog)` (currentUser из `window.env`, см. A.1).
2. `_handleFormSubmit` → `_submitActData` → PATCH №1 успешен → `_handleSubmitSuccess` (стр 1026).
3. `_handleSubmitSuccess` вызывает `this._closeDialog()` (стр 1255).
4. `_closeDialog` ПЕРЕХВАЧЕН на `safeClose` (стр 501-535):
   ```javascript
   CreateActDialog._closeDialog = async function safeClose() {
       if (!dialogClass._isSaving && lockAcquired) {  // ← _isSaving=undefined в этом flow!
           dialogClass._isSaving = true;
           const form = dialogClass._currentDialog?.querySelector('#actForm');
           if (form) {
               await dialogClass._handleFormSubmit(form, true, actId, username, form);  // ← PATCH №2
           }
       }
       // unlock + восстановление
   };
   ```
   Флаг `_isSaving` устанавливается ТОЛЬКО внутри самого `safeClose`. При основном submit-flow (через `form.onsubmit`) `_isSaving` остаётся `undefined`, условие `!_isSaving && lockAcquired === true` срабатывает → **PATCH отправляется второй раз**.
5. Дополнительно: `_handleFormSubmit(form, true, actId, username, form)` — пятый аргумент по сигнатуре = `dialog`, передан `form`. Валидаторы используют `form.querySelectorAll(...)` — работает «случайно» (form ⊂ dialog DOM), но `_collectFormData(form, dialog=form,...)` ищет `.team-member-row` и `.directive-row` тоже от form — работает только потому, что эти элементы внутри form. Если завтра вынесут какой-то fieldset за `<form>` — silent breakage.

**Confidence:** [HIGH]. Защита `_isSaving` корректно работает ТОЛЬКО когда `_closeDialog()` вызван не из submit-flow (Escape / клик мимо / крестик): тогда safeClose сам сохраняет, ставит флаг, и рекурсии нет.

**Дополнительный нюанс (M14 связан):** перехват ссылается на `actId` и `username` из замыкания `editAct` (стр 453). Это **намеренное замыкание**, не утечка. Но `dialogClass._currentDialog` обращается к статике CreateActDialog — если в момент `safeClose` другой код успел открыть другой диалог (теоретически), сохранит чужие данные. Защиты `if (CreateActDialog._currentDialog !== overlay)` нет.

### A.3 Inline handlers / закрытие

`closeBtn.onclick`, `cancelBtn.onclick`, `deleteBtn.onclick`, `addTeamBtn.onclick`, `addDirectiveBtn.onclick`, `form.onsubmit` — все через `.onclick =` (свойство, не `addEventListener`). При повторном `show()` `_currentDialog` пересоздаётся целиком, утечки нет. Но это исключает множественную подписку → если кто-то снаружи попытается доп. слушатель добавить через свойство — затрёт.

`_setupEscapeHandler`/`_setupOverlayClickHandler` приходят из `DialogBase`. `_closeDialog` (стр 637-644) корректно вызывает `_removeEscapeHandler`.

### A.4 Silent fail автозаполнения (M15)

**[CONFIRMED]** `dialog-create-act.js:672-682`:
```javascript
static async _autoFillUser({ search }, username) {
    try {
        const users = await APIClient.searchTeamUsers(username);
        const exact = users.find(u => u.username === username);
        if (exact) { search.fillFromUser(exact); }
        // ← если exact не нашёлся: тишина, поле останется пустым
    } catch (err) {
        console.error('Автозаполнение пользователя:', err);  // ← без Notifications
    }
}
```
Пользователь видит пустую строку «Руководитель» при наличии username в env, и не понимает, что справочник недоступен.

### A.5 Двойной AppConfig.api.getUrl — НОВАЯ КРИТИЧЕСКАЯ НАХОДКА (N2)

**[CRITICAL]** В `_handleKmExistsError` (стр 1310) передаётся УЖЕ обёрнутый URL:
```javascript
await this._createWithNewPart(AppConfig.api.getUrl('/api/v1/acts/create'), body, currentUser);
```
Внутри `_createWithNewPart` (стр 1376-1378):
```javascript
const resp = await fetch(AppConfig.api.getUrl(`${endpoint}?force_new_part=true`), {...});
```
`AppConfig.api.getUrl` (см. `static/js/shared/app-config.js:86-91`) добавляет `baseUrl` + `/` + endpoint. Под JupyterHub-proxy `baseUrl = https://hub/user/USER/proxy/8000`. Результат:
```
https://hub/user/USER/proxy/8000/https://hub/user/USER/proxy/8000/api/v1/acts/create?force_new_part=true
```
→ 404 (или browser-level CORS-блок). **Создание новой части при коллизии КМ не работает под JupyterHub.** В dev-режиме (без proxy) `baseUrl = origin`, URL получится `http://localhost:8000/http://localhost:8000/api/v1/acts/create?force_new_part=true` → 404 тоже.

**Confidence:** [HIGH]. Регресс не покрыт тестами (frontend нет в pytest).

---

## §B. Acts list lifecycle (acts-manager-page.js, 731 строка)

### B.1 Действия в карточке + role-checks

| Action | Кнопка | Проверка роли | Lock-check | Backend-роут |
|---|---|---|---|---|
| open | Открыть | нет (Участник может) | `act.is_locked` → warning | `/constructor?act_id=...` |
| edit (метаданные) | ✏️ | `act.user_role !== 'Участник'` | `act.is_locked` → warning | `LockManager.init` + `CreateActDialog.showEdit` |
| history | 📜 | `['Куратор','Руководитель'].includes(act.user_role)` | LockManager.init внутри | `AuditLogDialog.show` |
| duplicate | 📋 | **нет** (Участник может, by design) | `act.is_locked` → warning | POST `/api/v1/acts/{id}/duplicate` |
| delete | 🗑️ | `!== 'Участник'` | `act.is_locked` → warning | DELETE `/api/v1/acts/{id}` |

Role-check **на бэкенде** в `ActAccessGuard.require_edit_permission` (вызывается из `delete_act`, `lock_act` и др.). Frontend-проверка role — UX-уровень. **Однако** edit/delete для роли Участник — disabled на UI, но если пользователь руками снимет `disabled` через DevTools и нажмёт — `editAct` сразу делает `LockManager.init` → `lock_act` (стр 479) **без предварительной проверки роли на сервере** (lock проверяет edit_permission, так что вернёт 403). Это **некритично**, fail-safe.

### B.2 Кеш списка актов

`loadActs()` (стр 204-240) — **всегда fetch**, кеша нет (комментарий в JSDoc: «всегда свежие данные из БД»). После create/edit/duplicate/delete вызывается `loadActs()` — локально страница свежая.

**Проблема (НОВАЯ, N3):** инвалидация **меню актов** (`ActsMenuManager._clearCache`) сделана ТОЛЬКО в `CreateActDialog._invalidateCache` (стр 1329-1333), и вызывается только из `_handleSubmitSuccess` (= create/edit). После **delete** и **duplicate** в `acts-manager-page.js` `_clearCache` НЕ вызывается. На странице acts-manager `ActsMenuManager` отсутствует, поэтому on-page нет проблемы. Но если у пользователя **в другой вкладке открыт конструктор**, его меню актов остаётся stale (показывает удалённый акт или не показывает дубликат). При клике → 404.

**[MEDIUM]** Cross-tab инвалидации (BroadcastChannel / storage event) нет ни в одной операции. Если коллега в соседней вкладке/сессии создал/удалил акт — текущая вкладка узнает только по ручному refresh.

### B.3 `_createActCard` — sanitization

`_fillFields` (стр 91-98) → `field.textContent = data[fieldName]` — XSS-безопасно для основной meta.
**Однако:** `cardElement.setAttribute('data-tooltip', status.tooltip)` (стр 322) — tooltip содержит **`act.locked_by`** (логин блокировщика). При render через CSS `content: attr(data-tooltip)` — безопасно. Если завтра кто-то поменяет на `innerHTML` чтения tooltip — XSS. Сейчас OK, но fragile.

### B.4 _editingActInProgress

Защита от двойного клика на ✏️ (стр 454-457). Корректно. **Но:** flag сбрасывается в `finally` (стр 542), который выполнится сразу после `CreateActDialog.showEdit(actData, status)` — это синхронный return. Защита нужна только на время `fetch + LockManager.init`. После того как диалог открыт, повторный клик на ✏️ создаст НОВЫЙ перехват `_closeDialog` (но `originalClose` уже сохранён первым — каждый новый перехват сохраняет ссылку на _предыдущий_ перехват_, формируя цепочку). **Реальная проблема:** при двойном открытии диалогов цепочка перехватов отрабатывает многократно → multiple PATCH + multiple unlock.

**[MEDIUM, N4]** Защита `_editingActInProgress` снимается слишком рано (после `showEdit`, не после закрытия диалога). На практике редко воспроизводимо (защита `_currentDialog` в DialogBase обычно не даст открыть второй), но архитектурно — потенциальный race.

---

## §C. AuditLog + VersionPreview

### C.1 Ручная фильтрация без FilterEngine (M13)

**[CONFIRMED]** `FilterEngine` в проекте **отсутствует как класс** (`grep` по `static/js/`). `dialog-audit-log.js:221-266` — ручная цепочка `Array.filter` по chip-actions, username, fromDate, toDate. Алгоритмически корректна, но дублирует логику фильтрации, которая в проекте могла бы быть общей утилитой (chat фильтрует по-другому). Не блокер.

### C.2 Нет debounce на фильтрах (M16)

**[CONFIRMED]** `dialog-audit-log.js:122-124`:
```javascript
filters.querySelectorAll('input[type="date"], input[type="text"]').forEach(input => {
    input.addEventListener('input', () => this._onFilterChange());
});
```
На каждый keystroke в поле «Пользователь» — полный re-filter 2000 записей + re-render. При среднем словарном фильтре `~5 chars`, `5 × filter(2000) × render(20) = 5×40k ops`. На современных машинах <50ms, но при большом фильтре с >2000 записей и debounce **должен быть** для UX-консистентности. На больших датасетах (если backend начнёт отдавать больше) — input лагает.

### C.3 2000 записей в памяти

`_maxLoadLimit = 2000` (стр 17). Backend пагинирует, но дёргается ОДИН запрос с `limit=2000`. Уведомление выводится только если `data.total > 2000` (стр 208-212): «Загружено 2000 из N». **Кнопки «загрузить ещё»/«следующая страница на сервере» нет** — пользователь увидит только первые 2000 (LIFO порядок? нужна проверка backend). Для долгоживущих актов (>2000 операций) — частая ситуация.

### C.4 Restore version — права + lock-конкуренция

**Backend** (`audit_log_service.py:20-66`): `require_management_role` + `require_lock_owner`. Если пользователь потерял роль между открытием диалога и кликом «Восстановить» — backend вернёт 403, frontend покажет «Ошибка: ...».

**Frontend (lock-конкуренция, НОВАЯ КРИТИЧЕСКАЯ НАХОДКА, N5):**

В `AuditLogDialog.show` (стр 36-46) при открытии берётся `LockManager.init` (полноценный лок с heartbeat/inactivity). Хорошо.

Но в `VersionPreviewOverlay._restore` (стр 288-323):
```javascript
await APIClient.lockAct(this._actId);  // ← повторный lock тем же юзером
try {
    const result = await APIClient.restoreVersion(this._actId, versionId);
} finally {
    await APIClient.unlockAct(this._actId).catch(() => {});  // ← СНИМАЕТ lock, который держит AuditLogDialog
}
```
`atomic_lock_act` идемпотентен для того же юзера (`act_lock_service.py:42-65`), повторный lock пройдёт. Но `unlockAct` в `finally` снимает блокировку **глобально** для акта — а `LockManager` в AuditLogDialog продолжает heartbeat и при следующем `extend_lock` получит «Вы не владеете блокировкой» (`act_lock_service.py:70-72`).

**Сценарий:** Куратор открыл AuditLogDialog → LockManager взял lock → открыл preview версии → нажал «Восстановить» → restore прошёл → unlock в finally снял lock → LockManager пытается продлить через 1-2 мин → 4xx → LockManager сбрасывается в never-recovery state, юзер видит «Сессия завершена», хотя сам активен.

**[CRITICAL]** Двойной путь restore (через AuditLogDialog._restoreVersion ровно тем же versionId vs через VersionPreviewOverlay._restore) расходятся по lock-семантике:
- `AuditLogDialog._restoreVersion` (стр 360-391) НЕ берёт повторный lock и НЕ снимает — правильно.
- `VersionPreviewOverlay._restore` (стр 288-323) берёт+снимает — ломает LockManager-state родительского диалога.

### C.5 DiffEngine / DiffRenderer — L10

**[CONFIRMED]** `window.DiffEngine = DiffEngine;` (`diff-engine.js:300`), `window.DiffRenderer = DiffRenderer;` (`diff-renderer.js:287`). Это **корректный** паттерн (singleton-публикация для `<script>`-загрузки без бандлера, см. CLAUDE.md «Singleton-публикация в `window`»). Класс — pure utility, всё в `static` методах. `DiffEngine.compute` — pure-функция (без side effects), DOM не трогает.

### C.6 DiffEngine на больших tree_data

`_wordDiff` имеет защиту `m * n > 250000` (стр 244-249) — для текстблоков >500 слов × 500 слов скатывается в простой delete+insert. Хорошо.

`_diffTree` использует `JSON.parse(JSON.stringify(newTree))` (стр 38) — deep-clone. На 1000+ нод это O(N) и работает быстро (<10ms), но **держит две полные копии в памяти** во время вычисления + аннотированную копию.

`_diffTables` — внешний цикл `for r in maxRows × for c in maxCols`. Для таблицы 100×30 = 3000 итераций × число таблиц. На «портфолио» 200 таблиц — 600k операций. Допустимо.

**[LOW]** Прогноз: на акте 1000 нод + 100 таблиц по 50×20 + 50 текстблоков по 1000 слов diff будет идти 500ms-1s (синхронно, блокирует UI). Не CRITICAL для нынешних объёмов, но если акты будут расти — нужно вынести в Worker.

### C.7 Restore-validation (L11) — УТОЧНЕНИЕ

`VersionPreviewOverlay._restore` (стр 288-323): **никакой client-side валидации структуры `versionData` нет**, прокидывается `versionId` в backend. Backend (`audit_log_service.py:20-66`) собирает `ActDataSchema(...)` из `version["tree_data"]` и др. — pydantic-валидация на сервере есть.

**Опровергаю как баг.** Фронт ничего валидировать не должен — БД и backend держат инварианты. Заметка о L11 в исходной ревизии скорее о том, что **между показом preview и restore данные в БД могли измениться** (другой юзер тоже что-то поменял). Это решается атомарностью `restore_version` (сохраняет текущее как новую версию ДО восстановления — стр 47-55 audit_log_service.py: создаёт версию из version_id_data ПОСЛЕ save_content; но pre-save snapshot текущего — нет, восстанавливаемая версия становится «текущей», бывшая «текущая» не сохраняется как версия). Это **отдельная backend-проблема** (lost write для активного редактора). [MEDIUM, N6]

### C.8 acts-card открытие при locked

Карточка с `act.is_locked` показывает tooltip, при клике open/edit/duplicate/delete — Notifications.warning. Но `act.is_locked` берётся из ответа `/api/v1/acts/list` **в момент загрузки страницы**. Если коллега заблокировал акт после загрузки — пользователь увидит «открыто» в карточке и сделает open → конструктор сделает свой lock → получит 409 от backend. UX-расхождение, но не data-loss.

---

## §D. Подтверждённые находки (по флагам)

| Флаг | Статус | Зона | Комментарий |
|---|---|---|---|
| **H8** | ✅ CONFIRMED | `acts-manager-page.js:476-487` | Условие `typeof window.currentActId === 'undefined'` корректно различает контексты (конструктор vs acts-manager). Двойного locking-баг нет — это и есть защита. Сам комментарий в коде это объясняет. **Однако** проверка через `typeof === 'undefined'` хрупкая: если в портале случайно объявят `window.currentActId = null` (не undefined) — условие провалится. Лучше `!window.currentActId`. **MINOR.** |
| **H9** | ✅ CONFIRMED + усугублено N1 | `acts-manager-page.js:496-535` | Перехват `_closeDialog` для autosave — **источник критического бага двойного PATCH**. См. §A.2/N1. |
| **H10** | ✅ CONFIRMED | `dialog-create-act.js:61,157` | 2× `window.env`, тогда как остальная зона — `AuthManager`. См. §A.1. |
| **M13** | ✅ CONFIRMED | `dialog-audit-log.js:221-266` | `FilterEngine` в проекте отсутствует. Cм. §C.1. |
| **M14** | ✅ CONFIRMED | `dialog-create-act.js:1351-1361` | Неявная зависимость `window.currentActId` — `_refreshAfterEdit` обращается напрямую. На странице acts-manager `currentActId === undefined` (не в конструкторе), блок не выполняется — это работает «по совпадению». |
| **M15** | ✅ CONFIRMED | `dialog-create-act.js:672-682` | Silent fail автозаполнения. Cм. §A.4. |
| **M16** | ✅ CONFIRMED | `dialog-audit-log.js:122-124` | Нет debounce. См. §C.2. |
| **L10** | ✅ CONFIRMED (и это **правильно**) | `diff-engine.js:300`, `diff-renderer.js:287` | `window.X = X` — корректный singleton-паттерн без бандлера. **Не баг**, документация может пересмотреть. |
| **L11** | ⚠️ УТОЧНЕНО | `version-preview.js:300-306` | На фронте валидации нет — это by design (backend валидирует). См. §C.7. **Реальный баг** в этом блоке — конфликт lock (N5), а не отсутствие валидации. |

---

## §E. Опровергнутые

- **L11** в формулировке «нет валидации структуры при restore» — frontend в принципе не должен валидировать DB-снэпшоты, backend pydantic делает это. Снимаю как «не баг». Однако замечу, что в blast-радиусе L11 есть отдельная backend-проблема — pre-save текущего содержимого при restore не сохраняется как версия (§C.7 → N6).
- **L10** в формулировке «window-экспорт DiffEngine/DiffRenderer» — это правильный паттерн проекта (`CLAUDE.md`: Singleton-публикация в `window`). Не баг.

---

## §F. Новые находки (не было в ревизии)

### N1. [CRITICAL] Двойной PATCH при сохранении метаданных через editAct

**Файл:** `acts-manager-page.js:496-535` + `dialog-create-act.js:1000-1032,1254-1269`.
**Условие:** пользователь редактирует метаданные через ✏️ на странице acts-manager и жмёт «Сохранить изменения».
**Эффект:** `_handleFormSubmit` → PATCH №1 → `_handleSubmitSuccess` → `_closeDialog` (перехваченный) → `safeClose` не видит `_isSaving` (он `undefined` в обычном flow), запускает второй `_handleFormSubmit` → PATCH №2.
**Дополнительный риск:** во втором вызове передан `form` как `dialog`-аргумент (`_handleFormSubmit(form, ..., form)`), валидаторы могут вести себя по-другому если разметка изменится.
**Воспроизводимость:** при каждом «Сохранить» через page acts-manager (НЕ через конструктор-окно метаданных).
**Фикс:** выставить `_isSaving = true` в начале `_handleFormSubmit` (или в `_handleSubmitSuccess` до `_closeDialog()`) — тогда safeClose увидит флаг и пропустит автосохранение.

### N2. [CRITICAL] Двойной AppConfig.api.getUrl в _createWithNewPart

**Файл:** `dialog-create-act.js:1310 + 1378`.
**Условие:** при создании акта с уже существующим КМ юзер подтверждает «Создать новую часть».
**Эффект:** URL формируется как `<baseUrl>/<baseUrl>/api/v1/acts/create?force_new_part=true` → 404.
**Воспроизводимость:** всегда, под любым деплоем (и dev, и JupyterHub).
**Фикс:** один из двух — либо в `_handleKmExistsError:1310` передавать сырой path `'/api/v1/acts/create'`, либо в `_createWithNewPart:1378` НЕ оборачивать снова. Семантически чище — передавать сырой path всегда, оборачивать только в одном месте.

### N3. [HIGH] Нет cross-tab/cross-window инвалидации списка актов

**Файлы:** весь `acts-manager-page.js`, плюс `dialog-create-act.js:1329`.
**Условие:** в другой вкладке/окне коллега создал/удалил/дублировал акт.
**Эффект:** в текущей вкладке (на странице acts-manager или в конструкторе с меню) список stale, при попытке открыть удалённый акт — 404.
**Дополнение:** `_invalidateCache` (`dialog-create-act.js:1329`) чистит ТОЛЬКО `ActsMenuManager._clearCache()` — внутри create/edit flow. После `deleteAct`/`duplicateAct` в `acts-manager-page.js` (стр 551-660) — НЕТ вызова `_clearCache`. Если юзер дублирует акт на странице acts-manager и затем переходит в конструктор открытого ранее акта — меню в шапке покажет старый список без дубликата (TTL 60s, см. CLAUDE.md).
**Фикс:** BroadcastChannel('acts-list') + слушатель в `loadActs`/ActsMenuManager. Также добавить `_invalidateCache()` после delete/duplicate.

### N4. [MEDIUM] Цепочка перехватов _closeDialog при двойном editAct

**Файл:** `acts-manager-page.js:454-545`.
**Условие:** теоретически — двойной клик на ✏️ до того, как успел открыться диалог. `_editingActInProgress` защищает только до `showEdit` (sync return), флаг сбрасывается в `finally` сразу.
**Эффект:** каждый новый `editAct` пишет в `CreateActDialog._closeDialog = safeClose`, ссылка на старый `originalClose` теряется. Если двойной перехват сработал, при close выполнится PATCH×2 + unlock×2.
**Воспроизводимость:** редко (DialogBase обычно не даст открыть второй overlay; нужен race в момент async-pause).
**Фикс:** держать `_editingActInProgress = true` до закрытия диалога, либо переделать перехват на проверку `if (_currentDialog === expected) ...`.

### N5. [CRITICAL] VersionPreviewOverlay._restore ломает lock родительского AuditLogDialog

**Файл:** `version-preview.js:288-323`, фон — `dialog-audit-log.js:36-46`.
**Условие:** Куратор открыл AuditLogDialog → preview версии → restore.
**Эффект:** VersionPreviewOverlay делает свой `lockAct` + `unlockAct.catch(()=>{})` в finally — снимает lock, который держит LockManager в AuditLogDialog. Дальше LockManager heartbeat падает, всплывает фейковое «Сессия завершена», хотя юзер активен.
**Сравнение:** `AuditLogDialog._restoreVersion:360-391` — НЕ берёт повторный lock, использует уже взятый. Корректно.
**Фикс:** убрать lock/unlock-обёртку в `VersionPreviewOverlay._restore` — он всегда открывается из AuditLogDialog, где lock уже есть. Защита от прямого вызова (если в будущем понадобится открывать preview без диалога) — через optional флаг `requireLock`.

### N6. [MEDIUM] Backend: restore_version не сохраняет ТЕКУЩЕЕ содержимое перед восстановлением

**Файл:** `app/domains/acts/services/audit_log_service.py:20-66`.
**Сценарий:** Юзер работает с актом в окне 1 → коллега-куратор в окне 2 открывает AuditLogDialog → restore версию 3 (давнюю). Текущее содержимое окна 1 теряется бесследно — версии создаётся только из `version_id_data` ПОСЛЕ `save_content` (стр 40, 47-55), но pre-save snapshot текущего НЕ создаётся.
**Эффект:** lost write для активного редактора (если active редактор не успел сохраниться раньше restore).
**Уточнение:** в норме это блокируется `require_lock_owner` (стр 23) — restore возможен только если этот же юзер держит lock. То есть актуально только если **тот же юзер** в окне 1 (с lock) и окне 2 (без lock, отдаст редактору lock через manualUnlock конструктора) — он же и restore'нул. Маловероятно, но возможно.
**Фикс:** перед `content_repo.save_content` в `restore_version` создать версию из ТЕКУЩЕГО содержимого (по аналогии auto-save).

### N7. [MEDIUM] /api/v1/acts/users/search — нет auth-зависимости

**Файл:** `app/domains/acts/api/users.py:14-22`.
**Эффект:** endpoint не требует `Depends(get_username)` / `require_domain_access`. Любой запрос с/без `X-JupyterHub-User` получит поиск по справочнику пользователей (даже если auth Middleware есть глобально — проверь).
**Сценарий:** если кто-то снаружи (или скрипт) узнает URL — может массово выкачать ФИО+должности.
**Фикс:** добавить `username: str = Depends(get_username)` + `require_domain_access("acts")` или хотя бы `Depends(get_username)`.

---

## §G. Прочие наблюдения

### G.1 audit-log entry — username не экранирован

`dialog-audit-log.js:415`:
```javascript
<span class="audit-log-entry-meta">${entry.username} &mdash; ${date}</span>
```
И на стр 503 (`_renderVersion`):
```javascript
<span class="audit-log-entry-meta">${saveType} &mdash; ${v.username} &mdash; ${date}</span>
```
Username приходит из БД (зачитывается из `JUPYTERHUB_USER`, фильтруется `extract_username_digits()` — только цифры). Из конкретно этого источника XSS невозможен. Но если в будущем username станут читаемыми именами — открытая уязвимость. Желательно `_escapeHtml(entry.username)` для defensive coding.

### G.2 duplicate_act не копирует invoices

`app/domains/acts/services/act_crud_service.py:832-893` — копирует tree/tables/textblocks/violations, **НЕ копирует `act_invoices`**. Если оригинал имел сохранённые фактуры — новая копия будет «требует фактур». Это, вероятно, by design (фактура per-act), но в UX не объяснено пользователю.

### G.3 deleteAct — hard delete

`app/domains/acts/services/act_crud_service.py:242-277` — `DELETE FROM acts WHERE id = $1`. Никакого `is_deleted` или archive. Если другой пользователь открыт в конструкторе с тем же act_id — следующий save вернёт 404, потенциальный data-loss (StorageManager попытается восстановить из localStorage, но без act_id связи).

### G.4 LockManager.init блокирует «Историю» из карточки

`acts-manager-page.js:405-410` — клик на 📜 вызывает `AuditLogDialog.show`, который сам делает `LockManager.init`. Если акт уже заблокирован коллегой — `LockManager.init` бросает `ACT_LOCKED`, AuditLogDialog показ молча отменится (`return` в `catch`, стр 41-43). Юзер кликнул на «История» — ничего не открылось, ничего не сказано. UX-баг. **[MEDIUM]**.

### G.5 _checkSessionExit

`acts-manager-page.js:702-727` — корректно очищает sessionStorage флаги после показа диалога. OK.

---

## §H. Резюме приоритетов

| Приоритет | ID | Заголовок | Фикс-усилия |
|---|---|---|---|
| 🚨 CRITICAL | N1 | Двойной PATCH при editAct | 1 строка |
| 🚨 CRITICAL | N2 | Двойной getUrl в _createWithNewPart | 1 строка |
| 🚨 CRITICAL | N5 | VersionPreview ломает lock AuditLogDialog | удалить 4 строки |
| ⚠️ HIGH | H10 | window.env vs AuthManager | стандартизировать |
| ⚠️ HIGH | N3 | Нет cross-tab инвалидации | BroadcastChannel + _clearCache в delete/duplicate |
| ▪ MEDIUM | M13/M16 | Фильтрация без FilterEngine + без debounce | extract + debounce 300ms |
| ▪ MEDIUM | M15 | Silent fail автозаполнения | Notifications.warning |
| ▪ MEDIUM | M14 | Неявная зависимость currentActId | передавать явно |
| ▪ MEDIUM | N4 | Цепочка перехватов _closeDialog | держать flag до close |
| ▪ MEDIUM | N6 | Backend: pre-save при restore | +1 create_version |
| ▪ MEDIUM | N7 | users/search без auth | add Depends(get_username) |
| ▪ MEDIUM | G.4 | Silent fail AuditLogDialog.show при locked | toast «акт занят» |
| ▫ LOW | H8 | typeof === 'undefined' хрупкий | заменить на !window.currentActId |
| ▫ LOW | C.6 | DiffEngine sync — может лагать на крупных | Worker (на будущее) |
| ▫ LOW | G.1 | username не экранирован | _escapeHtml (defensive) |
| ▫ LOW | G.2 | duplicate без invoices | задокументировать в UI |
| ▪ NOTE | L10 | Window-export — корректный паттерн | не баг |
| ▪ NOTE | L11 | Frontend restore validation — не нужна | not-a-bug |

---

## §I. Snippets и трассы по флагам (для verify)

### I.1 H8 — двойная блокировка typeof === 'undefined'

```javascript
// acts-manager-page.js:471-488
let lockAcquired = false;

// В конструкторе акт уже заблокирован, поэтому
// здесь блокируем ТОЛЬКО если открываем метаданные из списка актов (acts-manager page),
// где window.currentActId, как правило, не задан.
if (typeof window.currentActId === 'undefined' && typeof LockManager !== 'undefined') {
    console.log(`[ActsManagerPage] Блокируем акт ${actId} для редактирования метаданных`);
    try {
        await LockManager.init(actId);
        lockAcquired = true;
        ...
```

Корректно: `window.currentActId` объявляется ТОЛЬКО в `constructor/*` (через `<script>` в `constructor.html`). На странице acts-manager его нет → typeof === 'undefined' → берём lock. Проверка через typeof защищает от ReferenceError, но если в будущем кто-то добавит `window.currentActId = null` (для логического сброса), условие сработает наоборот.

### I.2 H9 — перехват _closeDialog (полная цепочка)

```javascript
// acts-manager-page.js:496-535
const originalClose = CreateActDialog._closeDialog.bind(CreateActDialog);
const dialogClass = CreateActDialog;

CreateActDialog._closeDialog = async function safeClose() {
    try {
        if (!dialogClass._isSaving && lockAcquired) {
            dialogClass._isSaving = true;
            const form = dialogClass._currentDialog?.querySelector('#actForm');
            if (form) {
                try {
                    await dialogClass._handleFormSubmit(form, true, actId, username, form);
                } catch (e) { console.error('Ошибка автосохранения перед закрытием:', e); }
            }
        }
        if (lockAcquired && typeof LockManager !== 'undefined') {
            try { await LockManager.manualUnlock(); }
            catch (unlockErr) { console.error('Ошибка ручной разблокировки:', unlockErr); }
        }
    } finally {
        CreateActDialog._closeDialog = originalClose;
        dialogClass._isSaving = false;
        originalClose();
    }
};
```

Трасса при «Сохранить»:
1. `form.onsubmit` (привязано в `_setupEventHandlers:437-441`) → `_handleFormSubmit(e.target, isEdit=true, actData?.id, currentUser=window.env-источник, dialog)`.
2. Внутри `_handleFormSubmit`: успех → `_handleSubmitSuccess` (стр 1026).
3. `_handleSubmitSuccess` строка 1255: `this._closeDialog();` — это `safeClose`.
4. `safeClose`: `_isSaving === undefined` → `!undefined === true` → войдёт в save-блок → второй `_handleFormSubmit(form, true, actId, username, form)`.
5. После второго `_handleSubmitSuccess` → `_closeDialog()` снова, но к этому моменту `_currentDialog` уже null (его обнулил первый сброс?). Проверим: `_closeDialog` в `dialog-create-act.js:637-644`:
   ```javascript
   static _closeDialog() {
       if (this._currentDialog) {
           ...
           this._currentDialog = null;
       }
   }
   ```
   После первого вызова `_currentDialog = null`. Второй `_handleSubmitSuccess` → `_closeDialog()` → проверка `if (_currentDialog) ...` не пройдёт. То есть второй цикл `safeClose` НЕ запустится — но первый второй PATCH **уже отправлен**.

### I.3 H10 — window.env vs AuthManager grep

Полный grep по зоне:
```
dialog-create-act.js:61:   const currentUser = window.env?.JUPYTERHUB_USER || AppConfig?.auth?.jupyterhubUser || "";
dialog-create-act.js:157:  const currentUser = window.env?.JUPYTERHUB_USER || AppConfig?.auth?.jupyterhubUser || "";
acts-manager-page.js:212:  const username = AuthManager.getCurrentUser();
acts-manager-page.js:461:  const username = AuthManager.getCurrentUser();
acts-manager-page.js:563:  const username = AuthManager.getCurrentUser();
acts-manager-page.js:632:  const username = AuthManager.getCurrentUser();
shared/api.js:1030:        const username = AuthManager.getCurrentUser();  (searchTeamUsers)
```

Если `window.env` инжектится в каждый портал-шаблон (нужно проверить `base_portal.html`), различие косметическое — оба возвращают одну строку. Если нет — fallback на `AppConfig?.auth?.jupyterhubUser || ""` → пустая строка в `X-JupyterHub-User`.

### I.4 M13 — ручная фильтрация (snippet целиком)

```javascript
// dialog-audit-log.js:221-266 — без extracted FilterEngine
static _applyFiltersAndRender() {
    if (!this._cachedLog || !this._overlay) return;
    ...
    const chips = this._overlay.querySelectorAll('.audit-log-chip');
    const activeActions = new Set();
    chips.forEach(c => {
        if (c.classList.contains('active')) {
            c.dataset.value.split(',').forEach(v => activeActions.add(v));
        }
    });
    if (activeActions.size === 0) { ... return; }
    let filtered = this._cachedLog.filter(e => activeActions.has(e.action));
    const username = this._overlay.querySelector('[data-filter="username"]')?.value?.trim();
    if (username) {
        const lower = username.toLowerCase();
        filtered = filtered.filter(e => e.username?.toLowerCase().includes(lower));
    }
    const fromDate = ...;
    if (fromDate) { filtered = filtered.filter(e => new Date(e.created_at) >= from); }
    if (toDate) { filtered = filtered.filter(e => new Date(e.created_at) <= to); }
    this._filteredLog = filtered;
    this._renderFilteredPage(0);
}
```

Каждый фильтр — `O(N)` проход по 2000 записям. Цепочка трёх `filter` создаёт два intermediate-массива. Для 2000 элементов суммарно ~6000 проходов на каждый keystroke в полях username/date.

### I.5 M14 — `window.currentActId` в _refreshAfterEdit

```javascript
// dialog-create-act.js:1351-1361
if (window.currentActId === actId && window.APIClient) {
    await window.APIClient.loadActContent(actId);
    if (window.StorageManager && typeof window.StorageManager.markAsSyncedWithDB === 'function') {
        window.StorageManager.markAsSyncedWithDB();
    }
    if (typeof Notifications !== 'undefined') {
        Notifications.info('Данные акта обновлены');
    }
}
```

`actId` — INTEGER из ответа сервера. `window.currentActId` в конструкторе тоже INTEGER. На странице acts-manager `window.currentActId === undefined !== actId` → блок не выполняется. На странице конструктора (если бы CreateActDialog там вызывался для редактирования метаданных — он там и вызывается через ActsHeaderMenu, см. `static/js/constructor/header/acts-header-menu.js`) — блок СРАБОТАЕТ и перезагрузит контент. Это правильно по сценарию, но связь через глобал `window.currentActId` хрупкая.

### I.6 M16 — нет debounce (snippet)

```javascript
// dialog-audit-log.js:122-124
filters.querySelectorAll('input[type="date"], input[type="text"]').forEach(input => {
    input.addEventListener('input', () => this._onFilterChange());  // ← никакого debounce
});
```

`_onFilterChange` → `_applyFiltersAndRender` (см. I.4) на КАЖДЫЙ keystroke.

### I.7 L10 — window-экспорт

```javascript
// diff-engine.js:300
window.DiffEngine = DiffEngine;

// diff-renderer.js:287
window.DiffRenderer = DiffRenderer;

// version-preview.js:338
window.VersionPreviewOverlay = VersionPreviewOverlay;
```

Все три — статические классы без instance-state, идиоматично для проекта (по `CLAUDE.md`: «Singleton-публикация в window»).

### I.8 L11 — restore validation отсутствует

```javascript
// version-preview.js:288-323
static async _restore(versionId, versionNumber) {
    const confirmed = await DialogManager.show({...});
    if (!confirmed) return;
    try {
        await APIClient.lockAct(this._actId);     // ← N5 (см. §C.4)
        try {
            const result = await APIClient.restoreVersion(this._actId, versionId);
            Notifications.success(...);
        } finally {
            await APIClient.unlockAct(this._actId).catch(() => {});
        }
        this._close();
        if (typeof AuditLogDialog !== 'undefined' && AuditLogDialog._overlay) {
            AuditLogDialog._loadAllData();
            AuditLogDialog._loadAllVersions();
        }
    } catch (err) {
        console.error('Ошибка восстановления:', err);
        if (err.status === 409) {...}
    }
}
```

Никаких `if (!versionData.tree_data)` или checks перед лок-ом. Backend (`audit_log_service.py:25-28`) проверит `if not version: ActNotFoundError`. Pydantic-схема `ActDataSchema(...)` тоже валидирует. Фронту валидировать нечего и нечем (фронт получил ровно те данные, которые ему отдал бекенд через `getVersion`).

---

## §J. Backend-зависимости, обнаруженные при анализе

Эти 3 backend-проблемы найдены вне моей зоны, но влияют на UX фронта зоны acts-manager:

1. **N6** — `restore_version` не сохраняет current-snapshot перед `save_content` (`audit_log_service.py:40` сразу перезаписывает). При live-конкуренции — lost write. [MEDIUM]
2. **N7** — `/api/v1/acts/users/search` (`api/users.py:14`) без auth-зависимости. [MEDIUM]
3. **deleteAct hard-delete** (`act_crud_service.py:269`) — `DELETE FROM acts WHERE id=$1`. Если есть открытые активные клиенты — следующая операция получит 404. Soft-delete / `is_deleted` отсутствует. [LOW для текущей нагрузки]

---

## §K. Контрольные команды для верификации

Все находки воспроизводимы локально:

```bash
# N1: двойной PATCH
# Открыть DevTools → Network → ✏️ → внести изменение → Сохранить.
# Ожидать: 2× PATCH /api/v1/acts/{id} с одинаковым телом.

# N2: двойной getUrl
# Создать акт с КМ, который уже есть → подтвердить «новая часть».
# Ожидать в Network: запрос на URL вида .../proxy/8000/<scheme>://.../api/v1/acts/create → 404.

# N5: ломанный lock
# Открыть «История» (📜) акта → перейти в «Версии» → «Просмотр» → «Восстановить».
# Ожидать через 1-2 мин: LockManager пытается extend → 4xx → «Сессия завершена».

# N3: cross-tab
# Вкладка A: создать акт. Вкладка B (конструктор уже открыт, до создания A): меню актов в шапке не покажет новый акт > 60s (TTL).

# N7: auth bypass
curl -s "http://localhost:8000/api/v1/acts/users/search?q=иван"
# Ожидать: 200 + JSON со списком (без X-JupyterHub-User).
```

---

## Confidence summary

- §A.1, A.2 (N1), A.4 (M15), A.5 (N2): **[HIGH]** — прочитан весь flow, цепочка вызовов трассируется по строкам и подтверждена snippets в §I.
- §B.1, B.2 (N3): **[HIGH]** — поведение проверено в исходниках, grep на _clearCache подтверждает отсутствие в delete/duplicate.
- §C.4 (N5): **[HIGH]** — два пути restore явно различаются, lock-семантика разобрана через `act_lock_service.py`.
- §C.6: **[MEDIUM]** — оценка производительности без benchmark, формула O(N) корректна, но конкретные тайминги — экстраполяция.
- §C.7 (N6): **[MEDIUM]** — проверена логика `audit_log_service.py`, но без E2E-теста на data-loss.
- §G.4: **[MEDIUM]** — error-flow прослежен, UX-импакт логически следует.
- H8 hardness note, G.1 (escape username): **[LOW]** — defensive, не воспроизводимы при текущих данных.
- N7: **[HIGH]** — endpoint прочитан целиком, отсутствие `Depends(get_username)` подтверждено.
