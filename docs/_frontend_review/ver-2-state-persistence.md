# VER-2: State и Persistence

> Аудит зоны: state-core/content/tree, storage-manager, lock-manager, changelog-tracker, navigation-manager, app.js (init pipeline), shared/api.js (методы acts).
> Подход: ручная верификация флагов из `docs/frontend-constructor-as-is.md` + точечный поиск новых проблем.

## Сводка

- Подтверждено: 8
- Опровергнуто: 2 (полностью), 1 (частично)
- Новые находки: 9
- КРИТИЧЕСКИЕ:
  - **N1 (NEW, CRITICAL)** — `Object.defineProperty`-Proxy в `state-core.js:518-538` ловит ТОЛЬКО присвоение верхнего уровня (`AppState.tables = x`). Все `AppState.tables[id].grid[r][c] = ...` (сотни мутаций в `table-cells-operations.js`, `items-renderer.js` и др.) **НЕ помечают состояние как изменённое**. Дебаунс автосохранения и индикатор не срабатывают на правки ячеек/нарушений.
  - **N2 (NEW, CRITICAL)** — `StorageManager.restoreSavedState()` (`storage-manager.js:100-167`, 68 строк кода + docstring «вызывается из ActsMenuManager») **не вызывается ни из одной точки кода**. Восстановление состояния из localStorage фактически не работает.
  - **H4 (CONFIRMED, HIGH)** — `lock-manager.js:261-267`, activity-listeners на `document` без `removeEventListener`. При `LockManager.destroy()` остаются висеть.
  - **N3 (NEW, HIGH)** — `_extendLockSafely` при ЛЮБОЙ сетевой ошибке (одна неудачная попытка fetch) запускает `_initiateExit('extensionFailed')`. Кратковременная потеря сети в JupyterHub-окружении выкинет пользователя из редактора без права повтора.
  - **N4 (NEW, HIGH)** — несимметричный `_setupNavigationInterception` (`storage-manager.js:277-336`): диалог показывается ТОЛЬКО для кликов по `<a href>` (link.target !== '_blank', same-origin). Программные `window.location.href = ...` (lock-manager:181/201/517, acts-menu:533), `history.pushState`/`replaceState`, кнопки form submit, MouseEvent middle-click и `target=_blank` обходят защиту.
  - **N5 (NEW, HIGH)** — двойная ответственность за сохранение при exit. `header-exit.js:77` ВРУЧНУЮ дёргает `APIClient.saveActContent` (`saveType: 'manual'`), который шлёт `data.changelog = ChangelogTracker.flush()` ДО того, как `LockManager._initiateExit` запустит свой `fetch ... PUT /content` (lock-manager:463) с уже пустым changelog. Результат — двойной PUT, второй без changelog, не атомарен относительно unlock.

## Подтверждённые

### [H3] Гонка LS между вкладками
**Severity:** MEDIUM (понижена с HIGH — частично смягчена тем, что для одного acta есть lock; гонка реальна между вкладками без открытого акта и для общих кешей)
**Файлы:** `static/js/constructor/storage-manager.js:174-185, 614-628`, `static/js/constructor/header/acts-menu.js:51-87`, `static/js/constructor/app.js:253-289`
**Код:**
```js
// storage-manager.js — нет storage event listener
const stateJson = localStorage.getItem(AppConfig.localStorage.stateKey);
// при сохранении ничего не уведомляет другие вкладки
localStorage.setItem(AppConfig.localStorage.stateKey, stateJson);
```
**Bad-outcome:** Пользователь открывает два окна `/acts` (без открытия конструктора) → две вкладки кешируют `acts_menu_cache`. Создание/удаление акта в одной вкладке не инвалидирует кеш во второй до его TTL (60 сек). `constructor_scroll_positions` пишется из обеих вкладок (вкладка 2 страница 1, вкладка 1 страница 2 — последняя побеждает, после refresh скролл "пляшет"). Ключ `constructor_current_step` глобальный, не привязан к актID — переключение шага в одной вкладке после refresh затянет тот же шаг во второй (даже для другого акта).
**Effort:** M, ~6 ч
**Fix direction:** `window.addEventListener('storage', ...)` для inflight-инвалидации кешей; префиксовать `_scrollStorageKey`/`_stepStorageKey` через `${key}:${actId}`; для критичных операций — `BroadcastChannel('act-constructor')`.
**Cross-links:** N6 (ключи LS без префикса actId)

---

### [H4] activity-listeners в lock-manager без removeEventListener
**Severity:** HIGH (подтверждено)
**Файлы:** `static/js/constructor/lock-manager.js:261-267`
**Код:**
```js
static _setupActivityTracking() {
    const events = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    const updateActivity = () => (this._lastActivity = Date.now());
    events.forEach(event =>
        document.addEventListener(event, updateActivity, {passive: true})
    );
}
```
**Bad-outcome:** Каждый `LockManager.destroy()` (вызывается из `manualUnlock`, `_initiateExit`, переключения акта в `acts-menu.js:332`) НЕ снимает эти 4 listener'а. При переключении между актами слушатели накапливаются (4 × N переключений). Замыкание на `LockManager._lastActivity` (static field, общее) — функционально не ломается, но утечка референсов реальна. После переключения на read-only акт активность всё ещё трекается (бесполезно).
**Effort:** S, ~1 ч
**Fix direction:** Сохранить `this._activityHandler` как именованное замыкание, в `destroy()` дополнительно делать `events.forEach(e => document.removeEventListener(e, this._activityHandler))`.
**Cross-links:** M3

---

### [M2] dirty/clean дублирующаяся семантика
**Severity:** MEDIUM (подтверждено)
**Файлы:** `static/js/constructor/storage-manager.js:36-43, 345-381, 659-696`
**Код:** Два независимых булевых флага `_hasUnsavedChanges` (LS) и `_isSyncedWithDB` (БД) формируют 4 комбинации, но реально используются только 3 (нет валидного state "сохранено в БД, но изменено локально и НЕ сохранено в LS" — он сразу превращается в `unsaved`). Логика `_updateSaveIndicator` (line 669-687) делает то, что могло бы быть единственным enum `'unsaved' | 'local-only' | 'saved'`.
**Bad-outcome:** Любая правка `_markAsSaved` / `markAsSyncedWithDB` / `clearStorage` мутирует ОБА флага вручную (lines 369-370, 378-380, 620-622). Легко забыть синхронизацию — например, `restoreSavedState:149-150` ставит `_hasUnsavedChanges=false; _isSyncedWithDB=false` (правильно), но любой будущий новый сценарий потребует ручного маппинга на 2 поля.
**Effort:** M, ~4 ч
**Fix direction:** ввести `_state: 'saved' | 'local-only' | 'unsaved'` + сеттер-helper. Или конечный автомат.
**Cross-links:** L5, N7

---

### [M3] Несимметричные beforeunload
**Severity:** MEDIUM (подтверждено, расширено)
**Файлы:** `static/js/constructor/app.js:243`, `static/js/constructor/storage-manager.js:227-244`, `static/js/constructor/lock-manager.js:328`
**Код:**
- `app.js:243` — `window.addEventListener('beforeunload', () => this._saveScrollPositions())` — НЕТ remove.
- `storage-manager.js:227-244` — арроу-функция как handler, НЕТ remove.
- `lock-manager.js:328` — сохранённый референс `this._beforeUnloadHandler`, ЕСТЬ remove через `disableBeforeUnload()`.
**Bad-outcome:** Только LockManager.beforeunload можно "отключить". При программном выходе scroll-positions и storage-manager-handler всё равно выполняются, а внутри storage-handler есть условный `e.preventDefault()` (line 240) с warning-диалогом браузера. Хотя `_programmaticExit=true` (line 234) гарантирует ранний return — это спасает, но защита однонаправленная и хрупкая (любая забытая ветка возродит баг). 3 разных подхода к одному API.
**Effort:** S, ~2 ч
**Fix direction:** Единый Lifecycle-helper, либо все три handler'а через именованный референс + общий `destroy()`.

---

### [M4] ChangelogTracker._debounceTimers leak
**Severity:** LOW (понижена с MEDIUM)
**Файлы:** `static/js/constructor/changelog-tracker.js:9, 61-75, 81-100`
**Код:**
```js
static _debounceTimers = {};
...
static _recordDebounced(op, id, name, extra = {}, debounceMs = 5000) {
    const key = `${op}_${id}`;
    if (this._debounceTimers[key]) {
        clearTimeout(this._debounceTimers[key].timer);
    }
    this._debounceTimers[key] = { timer: setTimeout(...), op, id, name, extra };
}
```
**Bad-outcome:** При активной работе с N разными ID за короткое время (например, печать в 50 разных ячейках) — до 50 параллельных pending-таймеров. Все срабатывают через 5 сек, выполняют `record()` и удаляют ключ — то есть утечка временная, до 5 сек. Реально не страшно, **но**: метод `_recordDebounced` — приватный, в репозитории НЕТ ни одного вызова (см. grep ниже). То есть код мёртв.
```bash
grep -rn "_recordDebounced" static/js → только определение в changelog-tracker.js:61
```
**Effort:** S, ~30 мин
**Fix direction:** Удалить `_recordDebounced` и `_debounceTimers` если функционал не нужен; либо в `flush()` уже подтверждает срабатывание pending (lines 83-88) — но если flush НЕ вызывается долго (никто не сохранил), таймеры всё равно сбрасываются по своему setTimeout. Можно оставить.

---

### [M11] read-only disabled vs save-indicator
**Severity:** MEDIUM (подтверждено)
**Файлы:** `static/js/constructor/app.js:296-322`, `static/js/constructor/storage-manager.js:659-696`
**Код:**
```js
// app.js:303-307 — устанавливает disabled при readonly
saveIndicatorBtn.disabled = true;
saveIndicatorBtn.title = AppConfig.readOnlyMode.messages.cannotSave;
saveIndicatorBtn.classList.add('disabled');

// storage-manager.js:672, 678 — _updateSaveIndicator снова дёргает disabled
button.disabled = false;  // в ветке 'unsaved' и 'local-only'
```
**Bad-outcome:** Если в read-only режиме каким-то путём сработает `markAsUnsaved` (например, новый код, забывший проверять readonly, или Proxy от внутренних мутаций при `loadActContent`), `_updateSaveIndicator` сбросит `disabled = false`. Кнопка станет кликабельной → `forceSave()` (line 510 storage-manager) проверяет readonly и возвращает false с warning — спасает, но индикатор показывает кликабельность.
**Effort:** S, ~1 ч
**Fix direction:** `_updateSaveIndicator` в начале — `if (AppConfig.readOnlyMode?.isReadOnly) { button.disabled = true; return; }`.

---

### [L3] Магические задержки 100/500/300/1500 мс
**Severity:** LOW (подтверждено)
**Файлы:**
- `static/js/shared/api.js:117, 425, 533` — `setTimeout(() => StorageManager.enableTracking(), 100|500|100)`
- `static/js/constructor/storage-manager.js:132, 210, 553` — `setTimeout(..., 100)` для UI и `forceSaveAsync` delay
- `static/js/constructor/lock-manager.js:517` — `setTimeout(() => window.location.href = '/acts', 300)` после unlock
- `static/js/constructor/header/acts-menu.js:533` — `setTimeout(..., 1500)` для redirect
- `static/js/constructor/header/acts-menu.js:608` — `setTimeout(() => this.show(), 500)` если нет act_id в URL
**Bad-outcome:** На медленной машине / при заторе event-loop эти задержки могут оказаться недостаточными. Конкретно `api.js:425` — `setTimeout(enableTracking, 500)` после `loadActContent`. Если рендеринг дерева занимает >500 мс, между `enableTracking()` и реальным завершением рендера Proxy успеет поймать мутации `treeManager.render()`, помечая чистый акт как unsaved. На крупных актах это вероятно.
**Effort:** M, ~3 ч
**Fix direction:** Заменить на `requestAnimationFrame` chain или `await Promise.resolve()` после фактических render-операций; magic-числа вынести в `AppConfig.timings.*`.

---

### [L4] Мёртвые методы APIClient
**Severity:** LOW (подтверждено частично)
**Файлы:** `static/js/shared/api.js:819-825, 833-840`
**Код / verification:**
```bash
grep -rn "checkReadOnlyMode\|loadActContentRaw" static/js
# checkReadOnlyMode — только определение, НИКТО не вызывает
# loadActContentRaw — определение + ВЫЗОВ в static/js/portal/acts-manager/version-preview.js:127
```
**Опровергнуто частично:** `loadActContentRaw` **используется** в `version-preview.js:127` для diff-сравнения версий. Метод не мёртв.
**Подтверждено:** `checkReadOnlyMode()` (line 819) не вызывается нигде — реально мёртв. Логика дублируется через прямой `AppConfig.readOnlyMode?.isReadOnly`.
**Effort:** XS, ~10 мин
**Fix direction:** Удалить только `checkReadOnlyMode`. `loadActContentRaw` оставить.

---

### [L6] ChangelogTracker QuotaExceededError silent
**Severity:** LOW (подтверждено)
**Файлы:** `static/js/constructor/changelog-tracker.js:106-117`
**Код:**
```js
static _persist() {
    if (this._persistTimer) clearTimeout(this._persistTimer);
    this._persistTimer = setTimeout(() => {
        if (!this._storageKey) return;
        try {
            localStorage.setItem(this._storageKey, JSON.stringify(this._entries));
        } catch { /* quota exceeded — ignore */ }
    }, 1000);
}
```
**Bad-outcome:** При QuotaExceededError changelog НЕ сохраняется, но пользователь не уведомлён. После закрытия вкладки до flush — все записи аудита потеряны без следа. Сравни с `storage-manager.js:435-439`, где `QuotaExceededError` показывает `Notifications.error`. Дополнительно: `_persistTimer` НЕ объявлен как static field (line 6-10), просто появляется в runtime → можно проглядеть.
**Effort:** S, ~30 мин
**Fix direction:** В catch — `console.warn` + `Notifications.warning` (один раз через флаг). Объявить `_persistTimer = null` в полях класса.

---

## Опровергнутые

### [L5] Жёлтый индикатор после refresh
**Severity:** OPPOSED
**Файлы:** `static/js/shared/api.js:351-447`, `static/js/constructor/storage-manager.js:36-43, 366-371, 376-381`
**Анализ:** При первой инициализации `StorageManager.init()` НЕ трогает флаги (line 67-78). По умолчанию `_hasUnsavedChanges=false`, `_isSyncedWithDB=true` (lines 36, 43). При вызове `APIClient.loadActContent`:
1. `disableTracking()` (api.js:351)
2. Мутации `AppState.treeData = ...` — Proxy НЕ срабатывает (tracking disabled)
3. `StorageManager.saveState(true)` (api.js:422) → `_markAsSaved()` → `_hasUnsavedChanges=false`, `_isSyncedWithDB` НЕ трогается (остаётся `true` initial)
4. `setTimeout(enableTracking, 500)` (api.js:425)

Итог: после refresh с `?act_id=N` индикатор должен быть **белый** ("saved"), не жёлтый. L5 опровергнут.

**ВНИМАНИЕ — есть тонкость:** если бы `restoreSavedState` РАБОТАЛ (а он не вызывается, см. N2), он ставит `_isSyncedWithDB=false` (line 150) → жёлтый. Сейчас этого пути нет.

---

### Частично опровергнуто — withoutTracking симметрия
**Файлы:** `static/js/constructor/storage-manager.js:594-601`
**Анализ:** `withoutTracking(fn)` использует `try/finally` — гарантированно восстанавливает флаг. Это правильно.
**НО:** прямые пары `disableTracking()` / `enableTracking()` (api.js:70/118, 351/425, 495/533) — несимметричны: используется `setTimeout(enableTracking, 100|500)` вне try/finally. При исключении ВНУТРИ `try` блок `finally` выполнится и поставит enableTracking через `setTimeout`. Но если исключение БРОШЕНО до `try` или внутри асинхронной операции, которая прерывается через `throw err` (api.js:445, после `StorageManager.enableTracking()`) — там делается прямой enable вне setTimeout. Один путь обнаружен:
```js
// api.js:442-446 — catch блок loadActContent
} catch (err) {
    console.error('Ошибка загрузки акта:', err);
    StorageManager.enableTracking();  // прямой, ОК
    throw err;
}
```
Это норма. Реально симметрия соблюдена везде через try/finally или try/catch. Опровергнуто.

---

## Новые находки

### [N1] CRITICAL: Proxy в state-core НЕ ловит nested mutations
**Severity:** CRITICAL
**Файлы:** `static/js/constructor/state/state-core.js:505-542`, использования в `static/js/constructor/table/table-cells-operations.js` (24+ места), `static/js/constructor/items/items-renderer.js`, `static/js/constructor/dialog/dialog-invoice.js`
**Код:**
```js
// state-core.js:518-538
trackedProperties.forEach(prop => {
    let internalValue = AppState[prop];
    Object.defineProperty(AppState, prop, {
        get() { return internalValue; },
        set(newValue) {  // СРАБАТЫВАЕТ ТОЛЬКО ЗДЕСЬ
            internalValue = newValue;
            StorageManager.markAsUnsaved();
        },
        enumerable: true, configurable: true
    });
});
```
**Bad-outcome:** Все мутации внутрь коллекций обходят defineProperty:
- `AppState.tables[tableId].grid[r][c].content = 'edit'` — НЕ помечает state
- `AppState.tables[tableId] = newTable` — ПОМЕЧАЕТ (присвоение в `tables` объект... нет, это присвоение в КЛЮЧ объекта, defineProperty на `tables` не срабатывает. Срабатывает только `AppState.tables = {}`)

Реально единственные срабатывания Proxy в боевом коде:
- `AppState.treeData = ...` в `restoreSavedState` (мёртв) и `loadActContent` (api.js:362, 388 — но tracking disabled)
- `AppState.currentStep = stepNum` в `app.js:172`, `goToStep`
- `AppState.selectedNode = ...` (множество мест)
- `AppState.selectedCells = ...` (множество мест)

Реальные правки контента (печать в ячейке, redactor нарушения, изменение `colWidths`, `tb` и т.д.) — Proxy НЕ ловит. Срабатывание `markAsUnsaved` происходит "случайно" через:
- `items-renderer.js:288` — единственный ручной `StorageManager.markAsUnsaved()` после edit cell
- `id-generator.js:88-89` — после assign id
- `tree-renderer.js:545` — после tree операций
- `_addAsSibling` / `_addAsChild` / `_performMove` — мутируют `parent.children`, НЕ помечают; но `generateNumbering()` потом мутирует `child.number`, тоже НЕ помечает. Только Proxy на `treeData` сработает, если будет переприсвоение — но нет.

Это значит: **тысячи edit-операций в течение часа НЕ запустят автосохранение**, пока пользователь не нажмёт Ctrl+S, не переключит акт, или не закроет вкладку.

```bash
grep -rn "markAsUnsaved" static/js/constructor/ static/js/shared/
# Всего 4 ручных вызова. Все остальные пути полагаются на Proxy верхнего уровня.
```
**Effort:** L, 16-24 ч
**Fix direction:**
1. Краткосрочно — добавить ручные `StorageManager.markAsUnsaved()` после ВСЕХ операций мутации в `state-content.js` (~30 мест), `state-tree.js` (~20 мест), `table-cells-operations.js`, `dialog-violation.js`, и т.д. Покрыть тестами/grep'ом.
2. Долгосрочно — заменить `Object.defineProperty` на полноценный recursive `Proxy` с handler `{ set(target, prop, value) { ... markAsUnsaved(); ... } }`. Recursive создание Proxy при чтении nested объектов. Это тяжелее, но единая семантика.

---

### [N2] CRITICAL: StorageManager.restoreSavedState() — мёртвый метод
**Severity:** CRITICAL
**Файлы:** `static/js/constructor/storage-manager.js:96-167`
**Код:** Метод объявлен с публичным интерфейсом и документирован как "вызывается явно из ActsMenuManager".
**Verification:**
```bash
grep -rn "restoreSavedState\|StorageManager\.restore" static/ app/ templates/
# Единственный hit — само определение в storage-manager.js:100
```
**Bad-outcome:** Восстановление состояния из localStorage никогда не выполняется. Сохранение работает (saveState вызывается из `_debouncedSave`, `_periodicSaveInterval`, `forceSave`). Получается:
- localStorage заполняется данными (до 4 МБ) — данные накапливаются "вечно"
- При refresh страницы конструктор делает `_autoLoadAct` → `APIClient.loadActContent` — берёт из БД, локальное состояние игнорируется
- При offline или ошибке загрузки из БД — НЕТ fallback на локальное хранилище

68 строк мёртвого кода (lines 96-167) + связанный `_restoreSelectedFormats` (489-502), `_updateStepUI` (192-219, вызывается ТОЛЬКО из restoreSavedState).
**Effort:** S, ~2 ч
**Fix direction:** Либо удалить метод и связанный код (если БД — единственный источник истины), либо вызывать `StorageManager.restoreSavedState()` как fallback при ошибке `APIClient.loadActContent` (catch-блок api.js:442-446) или offline.

---

### [N3] HIGH: одна неудачная попытка extend → выход
**Severity:** HIGH
**Файлы:** `static/js/constructor/lock-manager.js:222-308`
**Код:**
```js
// _extendLock — НЕ ретраит, при !response.ok бросает
static async _extendLock() {
    ...
    if (!response.ok) throw new Error('Не удалось продлить блокировку');
    ...
}
// _startAutoExtension — при первой же неудаче _initiateExit
const ok = await this._extendLockSafely();
if (!ok) {
    console.error('Автопродление не удалось → выход');
    this._initiateExit('extensionFailed');
}
```
**Bad-outcome:** В JupyterHub-окружении (Kerberos, proxy, нестабильная сеть) короткий network glitch на момент периодической проверки = принудительный logout с потерей текущей сессии. Никакого retry, никакого графика "X неудач подряд". `inactivityCheckIntervalSeconds` (дефолт 30 сек?) определяет окно для glitch'а — узкое, но реальное.
**Effort:** M, ~4 ч
**Fix direction:** Ввести счётчик `_extensionFailures`, инициировать `_initiateExit` только после `MAX_FAILURES` (например 3) подряд. Сбрасывать счётчик при успехе. Логировать каждую неудачу.

---

### [N4] HIGH: Несимметричный navigation interception
**Severity:** HIGH
**Файлы:** `static/js/constructor/storage-manager.js:269-337`
**Код:**
```js
// Перехватываются только клики по <a href>, same-origin, не _blank
document.addEventListener('click', async (e) => {
    if (window._allowNavigation) return;
    const link = e.target.closest('a[href]');
    if (!link || ...) return;
    if (link.target === '_blank' || link.hostname !== window.location.hostname) return;
    if (this.hasUnsyncedChanges()) {
        e.preventDefault();
        ...
    }
});
```
**Bad-outcome:** Обходят защиту:
1. `window.location.href = ...` (lock-manager.js:181, 201, 517; acts-menu.js:533) — не triggers click
2. `history.pushState` / `replaceState` (acts-menu.js:364) — не trigger
3. Middle-click / Ctrl+click (открытие в новой вкладке) — `e.target.closest('a')` сработает, но навигация в новой вкладке всё равно произойдёт (preventDefault не помогает)
4. Form submit
5. browser back/forward (`popstate`, acts-menu.js:601) — НЕ перехватывается, происходит после факта
6. Ссылки с `target="_blank"` (новая вкладка) — не перехватываются, но и не теряют данные текущей; ОК.
7. cross-origin `<a>` — игнорируется (ОК).

Особенно опасно #1 и #5 — реальные пути в коде.
**Effort:** M, ~4 ч
**Fix direction:** Использовать `beforeunload` как safety net (уже есть в storage-manager.js:227); явный `confirmNavigation()` helper, вызываемый вместо прямых `window.location.href` в lock-manager/acts-menu. Для popstate — `window.addEventListener('popstate', e => { if (hasUnsyncedChanges()) history.pushState(...); })`.

---

### [N5] HIGH: Двойной PUT /content при exit
**Severity:** HIGH
**Файлы:** `static/js/constructor/header/header-exit.js:74-82`, `static/js/constructor/lock-manager.js:438-519`
**Анализ:**
- `header-exit.js:77` — `await APIClient.saveActContent(window.currentActId, { saveType: 'manual' })` — выполняется ПЕРВЫМ (на user click), `data.changelog = ChangelogTracker.flush()` уносит ВСЕ записи.
- Затем (если не редирект сразу) идёт `LockManager._initiateExit` → второй `PUT /content` (lock-manager:463) с `AppState.exportData()` — без changelog (флушнут), но с полным state.
**Bad-outcome:** Двойной запрос → дополнительная нагрузка на БД + audit log; второй запрос НЕ атомарен относительно unlock — если упадёт, акт останется в БД в одном состоянии, но без changelog-аудита между двумя PUT'ами. Реально не катастрофа, но архитектурно грязно.
**Effort:** S, ~2 ч
**Fix direction:** Один из путей сохранения. Либо header-exit делегирует LockManager (передаёт флаг "сохранить и выйти"), либо LockManager._initiateExit проверяет `StorageManager.hasUnsyncedChanges()` перед своим PUT'ом и пропускает.

---

### [N6] MEDIUM: LocalStorage-ключи без префикса actId
**Severity:** MEDIUM
**Файлы:**
- `static/js/shared/app-config.js:571` — `audit_workstation_state` (общий!)
- `static/js/shared/app-config.js:574` — `audit_workstation_timestamp` (общий)
- `static/js/constructor/app.js:9` — `constructor_current_step` (общий)
- `static/js/constructor/app.js:10` — `constructor_scroll_positions` (общий)
- `static/js/constructor/header/acts-menu.js:14` — `acts_menu_cache` (общий — это ОК, не зависит от акта)
- `static/js/constructor/changelog-tracker.js:18` — `act_changelog_${actId}` (правильно префиксован!)
- `static/js/constructor/header/format-menu-manager.js:~108` — `_storageKey` (TBD)

**Bad-outcome:** Открытие двух актов в двух вкладках:
- `audit_workstation_state` хранит данные ОДНОГО акта (последнего сохранённого), при switch'е между вкладками — содержимое смешивается / перезаписывается
- `constructor_current_step` — переключение шага в одной вкладке аффектит другую при refresh
- `constructor_scroll_positions` — позиция скролла шаринг
- В пределах одной вкладки ОК, потому что lock не даст открыть второй акт, **но** read-only пользователь МОЖЕТ открыть две вкладки на разные акты в режиме просмотра (lock не требуется, `lock-manager.js:28-32`).

Опасный случай — read-only пользователь, две вкладки с разными актами, скролл/шаг "пляшут".
**Effort:** M, ~4 ч
**Fix direction:** Префикс actId везде, где данные акт-специфичны. Либо `sessionStorage` (per-tab) вместо `localStorage` для scroll-positions/current-step.

---

### [N7] MEDIUM: Race-condition между _autoLoadAct и _wrapStateWithProxy
**Severity:** MEDIUM
**Файлы:** `static/js/constructor/state/state-core.js:563-571`, `static/js/constructor/header/acts-menu.js:613`
**Код:**
```js
// state-core.js — оборачивает Proxy в setTimeout(0)
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(_initStateTracking, 0);
    });
} else {
    setTimeout(_initStateTracking, 0);
}

// acts-menu.js:613 — _autoLoadAct тоже на DOMContentLoaded
document.addEventListener('DOMContentLoaded', () => ActsMenuManager.init());
// ActsMenuManager.init() → если есть ?act_id → _autoLoadAct(actId) (async!)
```
**Bad-outcome:** Порядок:
1. DOMContentLoaded fires
2. Оба handler'а в очереди: `_initStateTracking` (setTimeout 0) и `ActsMenuManager.init()` (синхронный)
3. ActsMenuManager.init() → синхронно дёргает `_autoLoadAct(actId)` (async, не ждёт)
4. `_autoLoadAct` асинхронно → `APIClient.loadActContent` → `StorageManager.disableTracking()` (api.js:351)
5. `_initStateTracking` из setTimeout(0) — выполняется ПОСЛЕ синхронной части ActsMenuManager.init(), но порядок относительно асинхронных tickов loadActContent — НЕ определён.

Возможные сценарии:
- Если Proxy инициализируется ДО `StorageManager.disableTracking()` — мутации в `AppState.treeData = content.tree` (api.js:388) пометят state как unsaved ДО того, как tracking отключится.
- Если ПОСЛЕ — нормально.

Текущая реализация надеется на `setTimeout(0)` < `await fetch(...)`, что почти всегда верно, но не гарантировано.

Дополнительный нюанс: `App.init()` тоже на DOMContentLoaded (app.js:356), внутри `_initializeState()` → `AppState.initializeTree(true)` (app.js:44) → создаёт дефолтное дерево ДО `_initStateTracking` (Proxy ещё не активен → присвоения не отслеживаются) → потом `_initStateTracking` оборачивает свойства с уже установленными значениями. **OK для init**, но затем `_autoLoadAct` → `loadActContent` мутирует `treeData` — если в этот момент Proxy уже активен и tracking не disabled, попадёт в markAsUnsaved.

**Effort:** M, ~4 ч
**Fix direction:** Сделать `App.init()` или `ActsMenuManager.init()` ОДНОЙ entry-point с детерминированным порядком: `_wrapStateWithProxy → disableTracking → _autoLoadAct → enableTracking`. Убрать `setTimeout(0)` из state-core.js.

---

### [N8] MEDIUM: ChangelogTracker без destroy / переключение акта
**Severity:** MEDIUM
**Файлы:** `static/js/constructor/changelog-tracker.js:16-25`, `static/js/constructor/header/acts-menu.js:363, 541`
**Код:**
```js
// changelog-tracker.js
static init(actId) {
    this._actId = actId;
    this._storageKey = `act_changelog_${actId}`;
    try {
        const stored = localStorage.getItem(this._storageKey);
        this._entries = stored ? JSON.parse(stored) : [];
    } catch { this._entries = []; }
}

// acts-menu.js:363 (switch) и 541 (autoLoad)
if (typeof ChangelogTracker !== 'undefined') ChangelogTracker.init(actId);
```
**Bad-outcome:** При переключении с акта A на акт B (через `_switchToAct`):
1. Pending debounce-таймеры `_debounceTimers` остаются с записями для акта A
2. `_persistTimer` (line 107) тоже остаётся pending
3. После `init(B)` — таймеры срабатывают → запись попадает в `_entries`, привязанная теперь к акту B (storageKey изменился), но `op/id/name` — от акта A. Поломанный аудит.

Также: между `flush()` (header-exit или saveActContent) и `init(newActId)` нет защелки — если flush ещё не вернул, `_entries = []` (line 91), но новый init его прочитает из storage (старый ключ) и установит = []. ОК.

Реальная проблема — pending `_debounceTimers` на момент switch.
**Effort:** S, ~2 ч
**Fix direction:** Добавить `static destroy()` метод, очищающий все таймеры и `_entries`, вызывать его перед `init(newActId)` в acts-menu.

---

### [N9] LOW: scroll-positions не подчищаются
**Severity:** LOW
**Файлы:** `static/js/constructor/app.js:241-289`
**Код:**
```js
static _setupScrollPersistence() {
    window.addEventListener('beforeunload', () => this._saveScrollPositions());
    requestAnimationFrame(() => this._restoreScrollPositions());
}
```
**Bad-outcome:**
- Listener не имеет remove (см. M3)
- Ключ `constructor_scroll_positions` глобальный (см. N6) — позиции одной страницы накладываются на другую
- При закрытии вкладки `requestAnimationFrame` потенциально может не успеть до save (но beforeunload синхронный — это ОК)
**Effort:** XS, ~30 мин (с N6 — то же место)

---

## Карта таймеров/интервалов

| Файл:строка | Тип | Значение | Cleanup |
|---|---|---|---|
| storage-manager.js:250 | setInterval | `AppConfig.localStorage.periodicSaveInterval` (120000 мс) | destroy() |
| storage-manager.js:257 | setInterval | то же | destroy() |
| storage-manager.js:392 | setTimeout (debounce) | `autoSaveDebounce` (3000 мс) | при новом вызове + destroy() |
| storage-manager.js:132 | setTimeout | 100 мс — restore formats | НЕТ (мёртвый код) |
| storage-manager.js:210 | setTimeout | 100 мс — _updateStepUI step2 | НЕТ (мёртвый код) |
| storage-manager.js:553 | setTimeout | 100 мс — forceSaveAsync re-enable | НЕТ (одноразовый) |
| lock-manager.js:275 | setInterval | `inactivityCheckIntervalSeconds * 1000` | destroy() |
| lock-manager.js:292 | setInterval | то же | destroy() |
| lock-manager.js:373 | setTimeout | `inactivityDialogTimeoutSeconds * 1000` | destroy() / dialog confirm |
| lock-manager.js:401 | setInterval | 1000 мс — countdown | destroy() / dialog confirm |
| lock-manager.js:517 | setTimeout | 300 мс — redirect | НЕТ (одноразовый) |
| changelog-tracker.js:69 | setTimeout (debounce) | `debounceMs` (5000 мс) | при новом вызове / flush() |
| changelog-tracker.js:111 | setTimeout | 1000 мс — _persistTimer | при новом вызове |
| api.js:117 | setTimeout | 100 мс — enableTracking generateAct | НЕТ |
| api.js:425 | setTimeout | 500 мс — enableTracking loadActContent | НЕТ |
| api.js:533 | setTimeout | 100 мс — enableTracking saveActContent | НЕТ |
| acts-menu.js:286 | setTimeout | `_clickDelay` (300 мс) — double-click detection | при двойном клике |
| acts-menu.js:533 | setTimeout | 1500 мс — redirect | НЕТ |
| acts-menu.js:608 | setTimeout | 500 мс — show menu | НЕТ |
| app.js:246 | rAF | — | НЕТ |
| state-core.js:566/570 | setTimeout | 0 мс — _initStateTracking | НЕТ |

## Карта window-глобалов lifecycle

| Глобал | Где устанавливается | Где читается | Где удаляется |
|---|---|---|---|
| `window.currentActId` | acts-menu.js:362, 540 | storage-manager.js:239,258,312,452,608,675; lock-manager.js (косвенно); api.js (НЕТ); navigation-manager.js:61,126; state-tree.js:159; header-exit.js:76,77; dialog-invoice.js:1168 | НЕТ (никогда не сбрасывается; при switch — перезаписывается) |
| `window.actMetadata` | api.js:331 | (не показано в зоне, но используется header) | НЕТ |
| `window.ActsMenuManager` | acts-menu.js:612 | dialog-create-act.js:1351 | НЕТ |
| `window.LockManager` | lock-manager.js:522 | acts-menu.js, header-exit.js, api.js (косвенно), dialog-* | НЕТ |
| `window._allowNavigation` | storage-manager.js:274, 333 | storage-manager.js:279 | reset в navigation handler |
| `window.history.pushState({actId})` | acts-menu.js:364 | acts-menu.js:602 (popstate) | браузер |
| `window.history.replaceState` | НЕТ (только pushState) | — | — |

**Замечания:**
1. `window.currentActId` НИКОГДА не сбрасывается в null. После `deleteAct` (acts-menu.js:522-525) → `_redirectToActsManager` (line 532) → setTimeout 1500мс → `window.location.href = '/acts'` → перезагрузка страницы, новый `window`. Но между deleteAct и redirect 1500 мс, в это время `window.currentActId` всё ещё содержит ID удалённого акта; периодическое сохранение в БД (storage-manager:258, `hasUnsyncedChanges && window.currentActId`) может попытаться сохранить content на удалённый ID → 404. Не проверял реальный сценарий, но риск есть.
2. `ChangelogTracker._actId` префиксует storageKey, но при switch (см. N8) старые pending-таймеры могут попасть в новый storageKey.
3. `LockManager._actId` сбрасывается в null только в finally `_initiateExit` (line 515) — корректно. При обычном switch'е `LockManager.destroy()` НЕ сбрасывает `_actId` (lock-manager.js:346-363, только таймеры).

---

## Прочие наблюдения (не оформлены как findings)

- **`_wrapStateWithProxy` отслеживает `selectedNode` и `selectedCells`** (state-core.js:512-515) — это ЧАСТЫЕ операции (каждый клик), которые НЕ являются "несохранёнными изменениями" по смыслу, но триггерят `markAsUnsaved`. То есть индикатор может перейти в "несохранено" просто при выборе ячейки → потом `_debouncedSave` сохранит state включая `selectedNode` в localStorage. На пользователя влияет умеренно (false-positive "несохранено"), но N1 настолько серьёзнее, что эти false-positive прикрывают баг (создают иллюзию работы Proxy).
- **`generateNumbering` мутирует `child.number` через `child.number = ...`** (state-tree.js:40,53,66,85) — не помечает state (Proxy не активен на nested). Корректность нумерации полагается на ручной вызов после addNode/deleteNode/moveNode.
- **Tracking через `_initialLoadInProgress` в ActsMenuManager** (line 11, 537-565) — однонаправленный bool, при ошибке внутри try (line 561 catch) ставится в false в finally (565) — корректно. Но не защищает от concurrent `_switchToAct` вызовов (другой code path).
- **`window.history.pushState({actId})` БЕЗ обновления при switch обратно** — `popstate` handler (line 601) делает loadActContent, но при этом `window.currentActId` НЕ обновляется. Расхождение между URL и state.

---

## Карта прямых fetch к `/api/v1/acts/` без AppConfig.api.getUrl

Поиск `grep -rn "fetch\\(['\"\`]/api"` по `static/js/` дал **0 совпадений** — все вызовы корректно идут через `AppConfig.api.getUrl(...)`. Это включает:
- `lock-manager.js:90, 114, 148, 181, 201, 225, 325, 463, 491` — все 9 вызовов через getUrl
- `api.js:136, 311, 457, 501, 553, 835, 862, 878, 894` и др. — через getUrl
- `acts-menu.js:101 (косвенно через APIClient)`, `533, 364` — через getUrl

**Регрессионный risk:** при добавлении нового fetch разработчик может забыть про `getUrl`. Рекомендую ESLint-rule или хук pre-commit на pattern `fetch\(['"\`]/api`.

## Углубление N1: количественная оценка покрытия Proxy

Подсчёт `markAsUnsaved` ручных вызовов по файлам:
```
items-renderer.js: 1
services/id-generator.js: 2
state/state-core.js: 3 (внутри Object.defineProperty.set + 2 в комментариях)
storage-manager.js: 1 (определение)
tree/tree-renderer.js: 1
ИТОГО ручных вызовов в продакшен-коде: 5
```

Для сравнения, операций мутации nested-объектов AppState:
```
AppState.tables[...]: 25+ (table-cells-operations.js, context-menu, items, preview)
AppState.textBlocks[...]: 6+
AppState.violations[...]: 4+
AppState.tableUISizes[...]: 2+ (items-renderer.js:266, 290)
nested mutations (table.grid[r][c] = ...): 30+
```

**Покрытие: ~5/65+ ≈ 7-8%.** То есть >90% операций редактирования НЕ запускают autosave и НЕ обновляют save-indicator.

Реальный сценарий: пользователь правит 50 ячеек, ни один из этих edit'ов не пометил state. Затем пользователь:
- кликает по другой ячейке → `AppState.selectedCells = [...]` → Proxy сработал → markAsUnsaved → debounce 3 сек → saveState в LS (все 50 правок попадают). Save-indicator стал красным.
- НЕ кликает (продолжает в той же ячейке) → таймера нет → закрывает вкладку → beforeunload не сработает (line 229: `if (_hasUnsavedChanges)` — false, потому что Proxy не пометил) → данные ТЕРЯЮТСЯ.

Спасает только периодический `_periodicSaveInterval` (line 250-254, 120 сек) — но он тоже проверяет `if (this._hasUnsavedChanges)` (line 251) → не сработает.

И второй periodic — `_periodicDbSaveInterval` (line 257) — проверяет `hasUnsyncedChanges()` (`!_isSyncedWithDB`) → тоже false без Proxy-сигнала.

**Итог: при редактировании только ячеек (без кликов по дереву / выделений), данные сохраняются ТОЛЬКО при ручном Ctrl+S или закрытии вкладки через ссылку (navigation interception → confirm dialog → save).** Что близко к "автосохранение не работает в принципе".

## Прочие косвенные находки

- **`StorageManager.invalidateActsCache`** (storage-manager.js:728-733) — публичный helper, делегирующий `window.ActsManagerPage.invalidateCache()`. Это нарушение слойности (constructor-зона знает о portal-zone). Не критично, но code smell.
- **`StorageManager._programmaticExit`** (storage-manager.js:59) — флаг устанавливается через `allowUnload()`, **никогда не сбрасывается**. Однонаправленный — после первого вызова beforeunload-предупреждение отключено навсегда (но вкладка закрывается → state теряется → ОК). Не баг, но фрагильно — если в будущем потребуется отменить exit, флаг застрянет.
- **`window.history.pushState({actId}, '', ...)` без onpopstate-обновления currentActId** (acts-menu.js:601-604) — на popstate делается `await APIClient.loadActContent(actId)`, но `window.currentActId` НЕ обновляется. Все periodic-save в storage-manager пишут на СТАРЫЙ `currentActId`. Потенциальная коррупция.
- **`AppState.selectedNode = AppState.findNodeById(savedState.selectedNodeId)`** (storage-manager.js:125) — мёртвый код (restoreSavedState не вызывается). Но семантически — `selectedNode` хранит ссылку на узел; после перезагрузки treeData ссылка валидна. ОК.
- **Async-конкуренция: `_saveDefaultStructure` (api.js:453) и пользовательские правки**. После `loadActContent` для нового акта стоит `_pendingDefaultStructureSave=true` (api.js:383). Затем в `_autoLoadAct` (acts-menu.js:552) после `LockManager.init` (медленный fetch) выполняется `await APIClient._saveDefaultStructure(actId, username)`. Между `loadActContent` и `_saveDefaultStructure` пользователь технически может уже начать редактировать (UI отрисован). Если он успеет сохранить state раньше `_saveDefaultStructure` — последний перезапишет правки дефолтной структурой. Узкое окно, но реальное.

## Рекомендации по порядку фиксов

1. **N2 (СНАЧАЛА)** — решить судьбу `restoreSavedState`. Если оставить — вызывать как fallback. Иначе — удалить 200+ строк мёртвого кода.
2. **N1** — самая дорогая, но самая важная. Без неё автосохранение фактически не работает на edit-операциях.
3. **H4** — быстро (1 ч), профилактика утечек.
4. **N3** — быстро (4 ч), напрямую влияет на UX в нестабильной сети JupyterHub.
5. **N4 + N5** — связанные, дать atomic-save-and-unlock как единственную точку выхода.
6. **N6** — префиксы actId, быстро.
7. **M2, M3, M4, M11, L3, L4, L6, N7, N8, N9** — техдолг, можно в одном спринте.
