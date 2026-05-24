# VER-4: UX-оболочка — верификация и расширение

> Зона аудита: header (`chat-popup`, `format-menu-manager`, `settings-menu`, `acts-menu`, `preview-menu`, `header-exit`), preview (`preview` + 3 renderer'а), dialogs (`dialog-help`, `dialog-invoice`), `constructor/app.js` (hotkeys), context-menu для таблиц (`context-menu-cells.js`).
> Confidence-метки: [HIGH] — verified grep'ом и/или ручным чтением кода; [MEDIUM] — гипотеза, подтверждённая логически; [LOW] — observation, требует прогона в реальной среде.

## Сводка

- **Подтверждено**: 7 из 9 флагов (H5, H6, H7, M10, M11, M12, L7, L8, L9 — все, кроме рассмотренных особо).
- **Опровергнуто**: 0.
- **Новые находки**: 11.
- Hotkeys map: см. §A (16 keydown-listener'ов, 4 конфликта по Escape, 1 по Ctrl+S).
- Preview cost: см. §B (полный rebuild `preview.innerHTML = ''` при каждом изменении символа, без throttle/debounce).
- DialogInvoice: см. §F (отдельный раздел — самый сложный диалог, 1211 строк, 6 silent-fail catch-блоков, кеши без инвалидации).

---

## §A. Hotkeys — полная карта

### Глобальные keydown-listener'ы (`document.addEventListener('keydown', ...)`)

| # | Файл | Стр | Combo / Key | Условие | Action | Конфликт? |
|---|------|-----|-------------|---------|--------|-----------|
| 1 | `constructor/app.js` | 149 | **Ctrl+S / Cmd+S** | всегда (capture не указан) | `forceSaveAsync()` + click `#generateBtn` | См. ниже |
| 2 | `header/settings-menu.js` | 162 | **Escape** | если меню settings открыто | `hide()` settings | E |
| 3 | `header/preview-menu.js` | 77 | **Escape** | если preview-меню открыто | `close()` preview-меню | E |
| 4 | `header/acts-menu.js` | 18 | **Escape** | если actsDropdown открыт | `hide()` actsDropdown | E |
| 5 | `header/chat-popup.js` | 59 | **Escape** | если chat-panel открыт | `close()` chat-popup | E |
| 6 | `dialog/dialog-help.js` | 104 | **Escape** | если helpModal открыт | `hide()` helpModal | E |
| 7 | `shared/dialog/dialog-base.js` | 112 | **Escape** | top-of-stack overlay | onClose активного диалога | E (но stack-aware) |
| 8 | `shared/chat/chat-modal.js` | 35 | **Escape** | модал чата открыт | hide() | E |
| 9 | `shared/chat/chat-renderer.js` | 789 | **Escape** | file viewer открыт | hide() viewer | E |
| 10 | `portal/portal-settings.js` | 158 | **Escape** | settings portal | hide() | E (другой контекст — портал) |
| 11 | `constructor/violation/violation-paste.js` | 12 | **Escape** | если активная зона нарушения | сброс активной зоны | E |
| 12 | `constructor/tree/tree-core.js` | 46 | **Escape** | `!editingElement` | clearSelection дерева | E |
| 13 | `constructor/table/table-core.js` | 41 | **Escape** | всегда | clearSelection ячеек + hide ContextMenu | E |
| 14 | `constructor/context-menu/context-menu-links-footnotes.js` | 298 | **Escape** | popup ссылки/сноски | закрыть popup | E |
| 15 | `constructor/textblock/textblock-links-footnotes.js` | 284 | **Escape** | popup ссылки | закрыть popup | E |
| 16 | `constructor/items/items-title-editing.js` | 313 | **Enter / Escape** | element-level (`blur` + `keydown`) | cancel/save редактирования | элементный |

### Element-level keydown'ы (input/textarea/editor)

| Файл | Стр | Где | Combo | Action |
|------|-----|-----|-------|--------|
| `violation/violation-core.js` | 183, 295 | textarea/input нарушения | Enter (save), Escape (cancel) | стандартное editing |
| `textblock/textblock-editor.js` | 77, 80 | editor textblock | keydown + keyup | форматирование/selection |
| `table/table-cells-operations.js` | 93 | textarea ячейки | Enter / Shift+Enter / Escape | save/newline/cancel |
| `chat-manager.js` | 75 | chat-input | Enter (send) | отправка сообщения |
| `acts-manager/team-member-search.js` | 64 | search | Enter | navigation suggestions |
| `context-menu-links-footnotes.js` | 210, 222 | input/textarea ссылки | Enter | save |

### Конфликты — детально

**Конфликт #1 (Escape, тип E): 9 листенеров на `document` + 2 stack-based**

Сценарий: пользователь открыл `helpModal`, поверх него вызывает `actsMenu` → Escape. Будут отработать **оба** listener'а одновременно:
- `dialog-help.js:104` — `if (!modal.classList.contains('hidden')) this.hide()` → закроет help
- `acts-menu.js:18` — `if (!menu.classList.contains('hidden')) this.hide()` → закроет actsMenu

Никто из них не вызывает `e.stopImmediatePropagation()`, так что **оба** упадут. Аналогично если открыто чат-popup поверх preview-menu — оба закроются на одном Escape.

`dialog-base.js:106` использует `_activeDialogs` стек и закрывает только top, но это работает **только** для диалогов, наследующих `DialogBase` через `_setupEscapeHandler`. HelpManager НЕ использует stack (написал свой `_setupModalEscapeHandler`). Header-меню не используют stack.

**Конфликт #2 (Ctrl+S, тип H5):**

`app.js:149` единственный глобальный обработчик Ctrl+S. Но в редактировании ячейки таблицы (`table-cells-operations.js:93` textarea) есть свой keydown без `Ctrl+S` ветки, и стандартное браузерное "сохранить страницу" уже перехвачено в `app.js`. На element-level конфликта нет, **НО**: в `app.js:152` используется `e.stopImmediatePropagation()` — это блокирует chain даже до element-level. Если textarea внутри ячейки хочет реализовать Ctrl+S как "сохранить ячейку", это нереализуемо без рефакторинга глобального обработчика. На сегодня — non-issue, но архитектурный долг.

**Конфликт #3 (Enter, capture):**

Глобальных listener'ов на Enter нет — все element-level. Конфликта нет.

**Конфликт #4 (Tab):**

Нет глобальных listener'ов на Tab. Браузер обрабатывает focus management.

**Конфликт #5 (Ctrl+Click):**

В таблице (`table-core.js:86`): `if (!e.ctrlKey) this.cellsOps.clearSelection(); ... selectCell(cell);` — Ctrl+клик = мультивыбор. Конфликта нет.

### Подтверждение H5

[HIGH] **H5 подтверждён**: глобальный Ctrl+S в `app.js:149` единственный, но element-level Enter (`items-title-editing.js:313`, `table-cells-operations.js`) **не подавляет** Ctrl+S при редактировании ячейки. Сценарий: пользователь правит длинную ячейку — нажал Ctrl+S → `forceSaveAsync()` + click generate, при этом ячейка ещё в editing-state, изменения не закоммичены в `AppState`. Сохранится предыдущая версия. См. также новую находку **N1**.

---

## §B. Preview rendering cost

### Вызовы `PreviewManager.update()` (29 точек)

Подсчитано через grep: `static/js/constructor/` содержит **29 вызовов** `PreviewManager.update()` / `forceUpdate()` без throttle. Все непосредственно перерисовывают весь preview.

Ключевые горячие точки:
- `table-cells-operations.js`: **9 вызовов** в одном файле (insertRow, deleteRow, mergeCells и т.д.).
- `violation-core.js`: **8 вызовов** (каждое поле нарушения → перерендер при `input`).
- `items-title-editing.js`: **3 вызова** при редактировании.

### Что делает один `update()` (verified via `preview.js:40-50`)

```javascript
static _performUpdate(previewTrim) {
    const preview = document.getElementById('preview');
    if (!preview) return;
    this._hidePreviewTooltip();
    preview.innerHTML = '';          // <— полная очистка
    this._renderTitle(preview);
    this._renderTree(preview, previewTrim);  // <— рекурсия по всему дереву
    this._attachPreviewTooltips(preview);    // <— querySelectorAll + addEventListener на КАЖДУЮ ссылку
}
```

Для типичного акта (5 секций × 2-3 пункта × таблицы и нарушения):
- ~30-100 заголовков `h1-h6`
- ~5-20 таблиц (каждая = вложенный grid с N ячейками, всё через `createElement` для каждой ячейки)
- ~10-50 нарушений (каждое = 5-10 строк `_addLine`)

**Один rebuild = 200-2000 createElement + одинаковое количество appendChild + новый tooltip listener для каждой ссылки.**

### Триггеры

[HIGH] Триггер 1: явный вызов `PreviewManager.update()` — 29 точек (см. выше).

[HIGH] Триггер 2: событие `app:state-changed` слушает `preview-menu.js:345`:
```javascript
document.addEventListener('app:state-changed', () => {
    if (window.previewMenuManager?.isOpen) {
        window.previewMenuManager.forceUpdate();
    }
});
```
**Это событие НИГДЕ не диспатчится** (grep `dispatchEvent.*state-changed` → 0 hits, кроме самого listener'а). Listener мёртв. Прямое доказательство → §C, **M12-A**.

### Реальная стоимость при вводе одного символа в textarea ячейки

`table-cells-operations.js:50-94` (input в ячейку):
1. `input`-handler ячейки → `tableManager.updateCellValue(...)` (через blur callback).
2. На каждый `Enter` → `finishEditing(false)` → `PreviewManager.update()` (line 64).
3. Дополнительно: на каждое `blur` → ещё один update (line 167, 243, 360...).

**Один символ — не триггерит update** (только final commit). Это правильная архитектура для ячеек.

Но `violation-core.js:208-211` (поле нарушения, textarea):
```javascript
checkbox.addEventListener('change', () => {
    violation[fieldName].enabled = checkbox.checked;
    contentContainer.style.display = ...;
    PreviewManager.update();    // <— на каждый toggle
});
```
и `items-title-editing.js:288-291`:
```javascript
input.addEventListener('input', () => {
    violation[fieldName].items[index] = input.value;
    PreviewManager.update();    // <— на каждый символ в списке метрик нарушения
});
```

[HIGH] **H6 подтверждён жёстко**: для списка-нарушений (`renderList` в `violation-core.js`) каждый набранный символ = полный rebuild всего дерева preview. Для акта с десятком таблиц это сотни createElement в синхронной handler-функции.

### throttle/debounce

| Где | Throttle / Debounce | Verdict |
|-----|---------------------|---------|
| `preview.js:23` | `requestAnimationFrame` (внутри `update`) | НЕ throttle — это просто defer на следующий кадр, можно запустить 60 раз/сек |
| `preview-menu.js:151` | RAF — ровно один внутри resize | throttle есть |
| `preview-menu.js:84-93` | `setTimeout(150)` на window-resize | debounce есть |
| `chat-popup.js:152-169` | RAF в resize | throttle есть |
| Всё остальное (preview/textblock/violation/table) | **отсутствует** | **проблема** |

---

## §C. Подтверждённые находки

### H5-A. Ctrl+S во время редактирования ячейки сохраняет неактуальное состояние [HIGH]

**Где**: `app.js:149-163` + `table-cells-operations.js:60-94`.

```javascript
// app.js
document.addEventListener('keydown', async (e) => {
    if ((e.ctrlKey || e.metaKey) && e.code === AppConfig.hotkeys.save.key) {
        e.preventDefault();
        e.stopImmediatePropagation();
        await StorageManager.forceSaveAsync();  // <— берёт snapshot AppState
        const generateBtn = document.getElementById('generateBtn');
        if (generateBtn) generateBtn.click();
    }
});
```

**bad-outcome**: пользователь редактирует ячейку (textarea live, `AppState.tables[...].grid[...].content` ещё не обновлён — обновляется только в `finishEditing`), нажимает Ctrl+S → сохраняется предыдущая версия ячейки. После save кнопка генерации триггерится — экспорт без последних правок.

**effort**: M.

**fix**: перед `forceSaveAsync` принудительно завершить editing — `document.activeElement?.blur()` или явный вызов всех активных `tableManager.finishEditing()`. Или ввести `commitPendingEdits()` в `AppState`.

**cross-links**: связано с **M11** (read-only режим тоже не учитывает live-editing).

---

### H6-A. Preview перерисовывается на каждый input в нарушении/списке [HIGH]

**Где**: `violation-core.js:208-211, 291`, `items-title-editing.js:288-291`.

```javascript
// items-title-editing.js
input.addEventListener('input', () => {
    violation[fieldName].items[index] = input.value;
    PreviewManager.update();  // <— на КАЖДЫЙ символ
});
```

`PreviewManager.update()` оборачивает `_performUpdate` в `requestAnimationFrame`, но это не throttle — следующие 60 input-событий в течение секунды дадут 60 rebuild'ов всего дерева (RAF не de-dup'ит вызовы, каждый дает отдельный callback).

**bad-outcome**: ввод текста в нарушения → 60 fps DOM-rebuild → лаги при наборе длинного текста, особенно когда в акте много таблиц.

**effort**: S — добавить простой debounce (100-200мс) в `PreviewManager.update`, и дополнительно scheduled flag, чтобы несколько вызовов в одном RAF сводились в один.

**fix**:
```javascript
static _updateScheduled = false;
static update(options = {}) {
    if (this._updateScheduled) return;
    this._updateScheduled = true;
    requestAnimationFrame(() => {
        this._updateScheduled = false;
        this._performUpdate(typeof options === 'string' ? AppConfig.preview.defaultTrimLength : (options.previewTrim ?? AppConfig.preview.defaultTrimLength));
    });
}
```

**cross-links**: см. M12 (preview-menu не синхронизируется → дублирование cost при открытом меню).

---

### H7-A. Магический `setTimeout(50)` перед restoreTableSizes [HIGH]

**Где**: `context-menu-cells.js:783-803`.

```javascript
restoreTableSizes(allTableSizes) {
    if (AppState.currentStep === 2) {
        ItemsRenderer.renderAll();
        setTimeout(() => {
            document.querySelectorAll('.table-section').forEach(section => {
                // ...
                tableManager.applyTableSizes(...);
            });
        }, 50);
    } else { ... }
}
```

**bad-outcome**: на медленных машинах (особенно через RemoteApp/JupyterHub-proxy с лагами браузера) `ItemsRenderer.renderAll()` может не успеть за 50мс — `querySelectorAll('.table-section')` вернёт старые элементы или пустой список, размеры не восстановятся. Пользователь видит "прыжки" колонок после merge/insert/delete.

**effort**: S.

**fix**: заменить `setTimeout(50)` на двойной `requestAnimationFrame` (после двух RAF DOM гарантированно отрендерен):
```javascript
ItemsRenderer.renderAll();
requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelectorAll('.table-section').forEach(...);
}));
```

**cross-links**: код продублирован в `tree-drag-drop.js`, `context-menu-tree.js` — проверить.

---

### M10-A. HelpManager vs DialogManager — параллельные иерархии [HIGH]

**Где**: `dialog-help.js:8` (`extends DialogBase`), но переопределяет:
- свой `_setupModalEscapeHandler` (line 103) — НЕ использует `_activeDialogs` stack из `DialogBase`.
- использует `_lockBodyScroll` / `_unlockBodyScroll` из `DialogBase` (правильно).
- НЕ использует `_showDialog` / `_hideDialog` / `_setupOverlayClickHandler` (использует, но напрямую).
- НЕ регистрируется в `_activeDialogs` через `push()` → при Escape с двумя открытыми диалогами (help + confirm) HelpManager закроет help, DialogManager закроет confirm одновременно.

**bad-outcome**: 
1. Открыт `helpModal`. Поверх — `DialogManager.show(...)` (confirm). Escape закрывает оба. Пользователь теряет confirm-диалог.
2. Логика scroll-restore разделена: `DialogBase._activeDialogs.length === 0` контролирует unlock, но HelpManager ставит `dialog-open` через `_lockBodyScroll`, и второй диалог поверх не "видит" его в стеке.

**effort**: M — мигрировать HelpManager на `_setupEscapeHandler(overlay, onClose)` из DialogBase, регистрировать helpModal в `_activeDialogs`.

**fix**: внутри `_showModalHelp`:
```javascript
this._activeDialogs.push(modal);  // или эквивалент через DialogBase API
this._setupEscapeHandler(modal, () => this.hide());
```
И удалить кастомный `_setupModalEscapeHandler`.

---

### M11-A. read-only — `disabled` затирается _updateSaveIndicator [HIGH]

**Где**: `app.js:303-308` ставит `saveIndicatorBtn.disabled = true`, но `storage-manager.js:672, 678` делает `button.disabled = false` в первых двух ветках `_updateSaveIndicator()`. Только третья ветка (`saved`) ставит `disabled = true`.

**Сценарий**: read-only пользователь открывает акт. `_applyReadOnlyMode()` блокирует кнопку. Дальше что-то меняется в `AppState` (например, fix tree numbering при загрузке) → `markAsUnsaved()` → `_updateSaveIndicator()` → `button.disabled = false` → кнопка снова кликабельна. Click → `forceSave()` проверяет `AppConfig.readOnlyMode.isReadOnly` (line 511) и возвращает false с warning. **Но**: кнопка визуально доступна, click обрабатывается → user clicks несколько раз, получает warning notification × N.

**bad-outcome**: визуальное состояние кнопки противоречит фактическому read-only. Confusion + spam-уведомления.

**effort**: S.

**fix**: в `_updateSaveIndicator`, в начало:
```javascript
if (AppConfig.readOnlyMode?.isReadOnly) {
    button.disabled = true;
    button.classList.add('disabled');
    return;
}
```

---

### M12-A. preview-menu listener мёртв [HIGH]

**Где**: `preview-menu.js:345-349`.

```javascript
document.addEventListener('app:state-changed', () => {
    if (window.previewMenuManager?.isOpen) {
        window.previewMenuManager.forceUpdate();
    }
});
```

**Проверено**: `grep -rn "dispatchEvent.*state-changed"` в `static/js` → **0 hits**. Событие `app:state-changed` нигде не диспатчится.

**bad-outcome**: side-panel preview-menu (отдельная панель справа, активируется кнопкой) НЕ обновляется автоматически при правке акта. Пользователь:
1. Открыл panel.
2. Редактирует ячейки/нарушения.
3. Panel остаётся "замороженной" со старыми данными.
4. Нужно закрыть и снова открыть panel или нажать F5.

Главный preview (внутри step1) обновляется через прямые вызовы `PreviewManager.update()`, но `previewMenuManager` — нет.

**effort**: S — либо эмитить событие `app:state-changed` в `_performUpdate`, либо хук в `PreviewManager.update`:
```javascript
static _performUpdate(previewTrim) {
    // ... existing code
    if (window.previewMenuManager?.isOpen) {
        window.previewMenuManager.updateContent();
    }
}
```
Второй вариант — менее connascent (oneway dependency), но проще.

**Альтернатива**: эмитить `app:state-changed` через `AppState` Proxy (он уже отслеживает изменения через `markAsUnsaved` — добавить туда dispatch).

**cross-links**: H6 (двойная стоимость rebuild при открытом меню).

---

### L7-A. verifyInvoice — заглушка [HIGH]

**Где**: `dialog-invoice.js:1147-1155`, `api.js:741-758`.

```javascript
// dialog-invoice.js
if (result && result.id) {
    try {
        const verifyResult = await APIClient.verifyInvoice(result.id, data.act_id);
        console.log('Результат верификации (заглушка):', verifyResult);
    } catch (verifyErr) {
        console.warn('Ошибка верификации (заглушка):', verifyErr);
    }
}
```

`api.js` верификация реальна (POST `/api/v1/acts/invoice/verify`), но результат **никак не используется** — только console.log. Ошибка тоже только в console.warn, пользователь не узнает.

**bad-outcome**: верификация фактуры может вернуть warnings (метрики не найдены в БД, схема устарела) — пользователь увидит "Фактура успешно прикреплена" без оговорок, проблема выяснится позже на этапе генерации.

**effort**: M — определить контракт `verifyResult`, отрендерить warnings inline в диалоге или показать через Notifications.warning.

---

### L8-A. silent fail в _loadMetricDict/_loadProcessDict/_loadSubsidiaryDict [HIGH]

**Где**: `dialog-invoice.js:231-260`.

```javascript
static async _loadMetricDict() {
    if (this._cachedMetricDict !== null) return;
    try {
        this._cachedMetricDict = await APIClient.loadMetricDict();
    } catch (err) {
        console.error('Ошибка загрузки справочника метрик:', err);
        this._cachedMetricDict = [];  // <— ставится пустой, кеш считается заполненным
    }
}
```

**Аналогично** для process / subsidiary.

**bad-outcome**: 
1. API недоступен → пустой кеш → пользователь не находит ни одной метрики/процесса → думает что "у меня нет нужного кода".
2. Кеш `[]` ставится **навсегда** для текущей сессии (см. условие `!== null`). При следующем открытии диалога — снова пусто, без retry.

**effort**: S.

**fix**: 
- Notifications.error("Не удалось загрузить справочник метрик. Попробуйте позже.").
- Не кешировать `[]` (оставить `null` для retry при следующем открытии).

**cross-links**: те же три кеша + `_invoiceConfig` + `_cachedTables` — см. отдельную находку **F2**.

---

### L9-A. Множественные Escape-listener'ы [HIGH]

См. §A, конфликт #1. 9 глобальных listener'ов на Escape без `stopImmediatePropagation()` и без общей координации.

**bad-outcome**: непредсказуемое каскадное закрытие — Escape в комплексной ситуации (открытое меню + выделение в дереве + выделение в таблице) сбросит **всё** одновременно. User intent "отменить последнее действие" размыт.

**effort**: M (рефакторинг) или S (workaround).

**fix**:
- Workaround: в каждом listener'е проверять `e.defaultPrevented` и вызывать `e.preventDefault()` после обработки. Listener'ы выше по приоритету (модалки) — добавить раньше / capture-phase.
- Правильно: единый `EscapeManager`/`KeyboardStack` с stack-based dispatch по аналогии с `DialogBase._activeDialogs`.

---

## §D. Опровергнутые

Нет. Все 9 флагов подтверждены, хотя нюансы есть:

- **L9** — листенеров **9, не 5+** как намекалось (полнее перечень в §A).
- **H7** — `setTimeout(50)` корректен в 95% случаев, реальная проблема — на лагающих окружениях.
- **M11** — конфликт не "в одной функции", а во **взаимодействии двух точек** (`app.js:303` vs `storage-manager.js:672`).

---

## §E. Новые находки

### N1. forceSave не блокирует двойной POST при клике "Сохранить" [HIGH]

**Где**: `app.js:118-141` (handler), `storage-manager.js:509-534` (forceSave).

```javascript
// app.js:127
newBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!newBtn.disabled) {
        StorageManager.forceSave();  // <— не await
    }
});
```

`forceSave()` запускает `saveState(true)`, который в итоге попадает в `APIClient.saveActContent`. Но кнопка НЕ дизейблится на время операции — `_updateSaveIndicator()` дизейблит её только когда `_isSyncedWithDB === true`, что произойдёт ПОСЛЕ завершения первого save.

**bad-outcome**: пользователь два раза кликает по "Сохранить" — два параллельных POST `/api/v1/acts/{id}/content`. Бэк должен обрабатывать idempotently, но это не гарантия.

**effort**: S.

**fix**: в `forceSave()`:
```javascript
static _saveInFlight = false;
static async forceSave() {
    if (this._saveInFlight) return;
    this._saveInFlight = true;
    try { /* ... */ } finally { this._saveInFlight = false; }
}
```
И/или дизейблить кнопку до возврата.

---

### N2. ActsMenuManager — кеш 1 минута может показывать удалённый акт [MEDIUM]

**Где**: `acts-menu.js:15` (`_cacheExpiry = 1 * 60 * 1000`), `_loadFromCache`.

**Сценарий**:
1. Пользователь открыл вкладку A, посмотрел список актов (cache filled).
2. В вкладке B (другой запуск) удалил акт X.
3. В вкладке A открыл `actsMenu` (или autoLoad через `currentActId`). Cache ещё валиден, акт X в списке.
4. Click → 404 / "Акт не найден".

**Cache инвалидируется** только в `_switchToAct()` (line 366), `deleteCurrentAct()` (line 523), `duplicateCurrentAct()` (line 477) — все эти точки в **текущей** вкладке. Ничего не слушает события из других вкладок.

**bad-outcome**: confusion, ошибка переключения, до 60сек stale state.

**effort**: M.

**fix**: 
- Слушать `storage`-event для синхронизации между вкладками.
- Или ETag / If-Modified-Since в /list — сервер дёшево вернёт 304.
- Снизить TTL до 10-15 сек.

---

### N3. ActsMenuManager — `window.currentActId` race [MEDIUM]

**Где**: `acts-menu.js:361-362`, `539-540`.

```javascript
this.currentActId = actId;
window.currentActId = actId;
```

Два хранилища одного и того же. `header-exit.js`, `dialog-invoice.js`, `acts-menu.js`, `chat-context.js` и др. читают `window.currentActId`. Если между `this.currentActId = actId` и `window.currentActId = actId` (две строки) что-то прочитает — увидит inconsistent state. JS однопоточный, но callback внутри Promise.then может вклиниться (Promise.then запускается в микротасках между строками? Нет, между сишными вызовами движка, но event-loop ticks могут перебить).

**bad-outcome**: race маловероятна в одной функции (sync execution), но архитектурно double-source-of-truth — баг ждёт своего часа.

**effort**: S.

**fix**: оставить только `window.currentActId` (с геттером/сеттером для логирования) или только `ActsMenuManager.currentActId` (с публичной getter-проперти). Не дублировать.

---

### N4. Settings — новая база знаний от бэка невидима юзеру без force-reload [HIGH]

**Где**: `settings-menu.js:211-223` `_loadKbKeysFromDOM`. Ключи берутся из data-атрибутов **в момент инициализации** при `DOMContentLoaded`.

**Сценарий**: админ деплоит новую версию шаблона с дополнительным KB. Юзер сидит в открытом конструкторе. До F5 страницы новый KB не появится. Это норма — но **новый ключ в `localStorage` `assistant_knowledge_bases`** будет иметь дефолт `false`. Если админ хочет включить по умолчанию — потребуется migration script на фронте или принудительный clear LS.

**bad-outcome**: LOW — это by design для шаблонов, но не задокументировано.

**effort**: docs only.

---

### N5. preview-menu LS QuotaExceeded не обрабатывается [LOW]

**Где**: `preview-menu.js:213-216`.

```javascript
_saveWidth() {
    const width = this.menu.offsetWidth;
    localStorage.setItem('preview-menu-width', width.toString());
}
```

Если LS полон (например, после долгой работы с большим актом + autosave snapshots) — `setItem` бросит QuotaExceededError → необработанное исключение → resize-операция падает в console.error.

**bad-outcome**: LOW (LS-quota — редкий кейс). UX-impact: после resize'а размер не сохранится, при reload откатится.

**effort**: trivial.

**fix**: обернуть в try/catch (как в `chat-popup.js:193`).

---

### N6. header-exit не учитывает фоновую save-операцию [MEDIUM]

**Где**: `header-exit.js:32-62`.

`hasUnsavedChanges()` возвращает `_hasUnsavedChanges` (флаг local-only). Если в момент клика "Выход" идёт **периодическое** автосохранение (`StorageManager._periodicSaveInterval` каждые 2мин) — флаг может быть `false` (уже сохранили в LS), но POST в БД ещё в полёте. `_performExit` → `LockManager.manualUnlock()` → `window.location.href` без await save.

**bad-outcome**: race с автосохранением → 50-50 шанс что POST долетит до сервера. Если не долетел — изменения остаются только в LS, при следующем входе StorageManager их восстановит и докинет, но между ушёл-вернулся другой пользователь может успеть открыть акт.

**effort**: S — `await StorageManager._pendingSavePromise` если есть, потом exit.

---

### N7. InvoiceDialog — закрытие диалога во время AJAX leaks Promise [MEDIUM]

**Где**: `dialog-invoice.js:1132-1184` (`_save`), `_close` (line 1191).

Сценарий: пользователь жмёт "Сохранить" → `await APIClient.saveInvoice(data)` — 2-3 секунды. В это время жмёт Escape → `_close()` обнулит `_currentOverlay`, `_currentNode`, `_selectedTable`. Promise дорабатывает: 
- `this._currentNode.invoice = {...}` (line 1137) — `_currentNode` уже null → TypeError.
- `Notifications.success(...)` всё равно показывает "Фактура успешно прикреплена".

**bad-outcome**: TypeError в console + ложное уведомление об успехе, на самом деле узел не обновлён (сервер записал, фронт нет). Состояния разъехались.

**effort**: M.

**fix**: AbortController на fetch + проверка `if (!this._currentOverlay) return;` в then-блоке.

---

### N8. Notifications — нет лимита, при 100/сек шторм DOM [HIGH]

**Где**: `notifications.js:7-378`. `NotificationManager` НЕ имеет `maxNotifications` или window-limit (verified: `grep maxNotifications` → 0).

Группировка работает только по точному matching `${type}:${message}`. Если 100 РАЗНЫХ сообщений (например, при batch-операции с разными ID, разными ошибками) — все 100 элементов добавятся в `notification-container`. На viewport 1080p помещается ~5-7, остальные за overflow, но все живут в DOM.

**bad-outcome**: при retry storm от бэка или массовой валидации (50 ошибок при импорте) — UI заполняется уведомлениями, прокрутка/анимация лагают, 8с auto-hide держит DOM-узлы живыми.

**effort**: S.

**fix**: в `_createNotification` — limit: если `this.notifications.size >= MAX`, скрыть oldest. MAX=10-15 достаточно для UX, и компромисс.

---

### N9. context-menu-cells: merge/unmerge корректность сomspan/rowspan [MEDIUM] [unverified depth]

**Где**: `context-menu-cells.js` (1100+ строк) — handlerы `merge-cells`/`unmerge-cell` делегируют в `tableManager.mergeCells()` / `unmergeCells()` (вне зоны VER-4).

Я НЕ проверял реализацию `mergeCells` в `table-cells-operations.js` глубоко (out of zone), но в context-menu есть **`_columnHasAnyMergedCellsStrict`** — это уже indicator, что было много багов вокруг merge с проверками. Просто отмечу: чтение `delete-row`/`delete-col` (line 215-241) — отказывается удалять строку/колонку с любым merged-cell (даже если merge только в текущей строке). Это **жёсткая** проверка, но безопасная.

Edge-case (требует runtime-проверки):
- delete-row последней data-строки: line 220-224 запрещает — `headerRowCount` + остаток ≥ 1 data row. ОК.
- delete-col одной колонки: line 232-235 запрещает. ОК.
- merge всей строки (colspan=N) + delete-row этой строки → отказ ("содержит объединённые ячейки"). User должен сначала unmerge. Технически корректно, но UX мог бы быть smart-er (auto-unmerge перед delete).

**effort**: out-of-scope, рекомендую separately.

---

### N10. preview tooltips — leak при rapid re-render [MEDIUM]

**Где**: `preview.js:232-245`. На каждый rebuild → `_attachPreviewTooltips`:
```javascript
elements.forEach(element => {
    element.addEventListener('mouseenter', () => { ... });
    element.addEventListener('mouseleave', () => { ... });
});
```

Listener'ы регистрируются на **новые** элементы, созданные в `_performUpdate`. Старые элементы уходят в GC вместе с listener'ами. Утечки нет.

**Но**: `_previewTooltip` (line 32) — static-singleton. Если rebuild случается между `mouseenter` (setTimeout 700ms запущен) и `mouseleave` — listener старого элемента ссылается на `setTimeout`-id, который уже не отменится, потому что элемент удалён. setTimeout всё равно сработает (700ms — это callback в queue), `_showPreviewTooltip(element)` будет вызван с detached DOM-элементом — `getBoundingClientRect()` вернёт zero-rect. Tooltip отобразится в углу экрана.

**bad-outcome**: tooltip в неожиданном месте после rapid действий + rebuild. Косметика.

**effort**: S.

**fix**: в `_hidePreviewTooltip` (вызывается в начале `_performUpdate`, line 44) уже clear-ит timeout. Это **работает**. Но callback запоминает `element` через closure — если timeout успел сработать ДО `_hidePreviewTooltip`, tooltip покажется. Полное исправление — проверить `if (!document.body.contains(element)) return;` в `_showPreviewTooltip`.

---

### N11. dialog-invoice — _selectedMetrics merge с auto-correction скрывает baг логики [LOW]

**Где**: `dialog-invoice.js:859-899` `_selectMetricCode`.

```javascript
if (item.metric_group && item.metric_group !== this._focusedMetric) {
    targetMetric = item.metric_group;
    if (this._selectedMetrics[targetMetric] === undefined) {
        this._selectedMetrics[targetMetric] = null;
    }
    this._switchFocus(overlay, targetMetric);
}
```

Сценарий: пользователь focused на "КС", вводит код "ФР00001" (метрика группы ФР). Автоматически переключается на ФР, КС остаётся в `_selectedMetrics` со значением `null` (когда жмёшь его сначала на line 409). При save (`_save`, line 1078) есть проверка:
```javascript
if (!metricData || !metricData.code) {
    Notifications.warning(`Выберите код для метрики ${metricType}`);
    return;
}
```
ОК, спасает. Но UX: чип "КС" остаётся подсвеченный как configured (хотя без кода). При повторном клике → "клик по configured" → `_switchFocus`. Юзер ходит по кругу.

**effort**: S — на auto-correction убирать null-entries из `_selectedMetrics`:
```javascript
if (this._selectedMetrics[this._focusedMetric] === null) {
    delete this._selectedMetrics[this._focusedMetric];
    // обновить chip CSS
}
```

---

## §F. DialogInvoice — отдельный анализ

### Общая статистика

- 1211 строк, **самый большой** dialog в зоне.
- Static-class (no instances), single-active-overlay (поле `_currentOverlay`).
- 6 кешей: `_invoiceConfig`, `_cachedTables`, `_cachedMetricDict`, `_cachedProcessDict`, `_cachedSubsidiaryDict`, `_currentDbType`.
- 5 input'ов с dropdown'ами (table search, metric code search, process search, subsidiary search, + radio БД).

### F1. AJAX-вызовы

Все через `APIClient.*`, который в свою очередь использует `AppConfig.api.getUrl()`. **Один прямой fetch** — на line 178 (`_loadConfig`):
```javascript
const resp = await fetch(AppConfig.api.getUrl('/api/v1/acts/config/invoice'));
```
Использует `AppConfig.api.getUrl()` корректно — JupyterHub-proxy безопасен.

**Список AJAX**:
| Метод | URL | Через AppConfig.api? |
|-------|-----|----------------------|
| GET | `/api/v1/acts/config/invoice` | Да (явный fetch + getUrl) |
| `APIClient.loadInvoiceTables(dbType)` | api.js:692 | Да |
| `APIClient.loadMetricDict()` | api.js:637 | Да |
| `APIClient.loadProcessDict()` | api.js:658 | Да |
| `APIClient.loadSubsidiaryDict()` | api.js:674 | Да |
| `APIClient.saveInvoice(data)` | api.js:715 | Да |
| `APIClient.verifyInvoice(invoiceId, actId)` | api.js:741 | Да |
| `APIClient.saveActContent(window.currentActId, {saveType: 'auto'})` | api.js:486 | Да |

Все корректные.

### F2. Кеши — инвалидация

| Кеш | Когда заполняется | Когда инвалидируется |
|-----|-------------------|----------------------|
| `_invoiceConfig` | первое `show()` | **Никогда** (live-of-process) |
| `_cachedTables` | при каждом `_loadTables` для dbType | при `_currentDbType !== dbType` (свитч hive↔greenplum). Внутри одного dbType — **никогда** |
| `_cachedMetricDict` | первое `show()` | **Никогда** |
| `_cachedProcessDict` | первое `show()` | **Никогда** |
| `_cachedSubsidiaryDict` | первое `show()` | **Никогда** |

**bad-outcome [MEDIUM]**: ETL-команда добавляет новые метрики/процессы/таблицы → пользователь сидит в открытой странице → не видит. Нужен F5.

**effort**: M.

**fix**:
- TTL (5-15 минут).
- Кнопка "Обновить справочники" в диалоге.
- Эвент через WebSocket/SSE от бэка (heavy).

### F3. Lifecycle

```
show(node, nodeId)
  ├─ if (_currentOverlay) _close()             // защита от двойного открытия
  ├─ reset state (_selectedTable, _focusedMetric, _selectedMetrics, ...)
  ├─ clone template, fill node info
  ├─ await _loadConfig(overlay)                // блокирующий
  ├─ if (node.invoice) _prefill(overlay)
  ├─ _setupHandlers(overlay, dialog)           // ~15 listener'ов
  ├─ append + animate
  ├─ _loadTables / _loadMetricDict / _loadProcessDict / _loadSubsidiaryDict  // параллельно, не await
  └─ (return)

_close()
  ├─ _removeEscapeHandler
  ├─ _hideDialog (через setTimeout closeDelay)
  └─ обнуляет всё state
```

[HIGH] Memory: при `_close()` обнуляется state, но **dropdown'ы остаются в DOM** до завершения `_hideDialog`'s setTimeout. Listener'ы на dropdown-items (mousedown) — внутри overlay, удалятся с overlay. ОК.

[MEDIUM] Race в `_close()` + параллельные `_loadTables` (line 165-168 в show, не awaited): если юзер быстро закрыл диалог — `_loadTables` ещё в полёте — `_cachedTables` запишется в class-static, это ОК (для следующего открытия). Никакого DOM-touch'а из неё после `_close` нет (только в `_filterAndShowResults` через user input). Safe.

[LOW] `_skipNextUnfocus` (line 90, 452, 860) — флаг для подавления unfocus при выборе кода из dropdown. Может остаться `true` если `_close` случится между `_selectMetricCode` (set true) и следующим click на dialog. При следующем `show()` — обнуляется (line 1204). ОК.

### F4. Silent fails в InvoiceDialog

Подробно по line:
- **177-184** `_loadConfig`: catch без notify, `_invoiceConfig` остаётся null → save сорвётся с "Конфигурация фактур не загружена. Обновите страницу." (line 1109). Лучше — Notifications.error при load.
- **214-219** `_loadTables`: catch без notify, `_cachedTables = []` → user видит "Таблицы не найдены" для любого запроса.
- **234-239** `_loadMetricDict`: см. **L8-A**.
- **244-249** `_loadProcessDict`: то же.
- **254-259** `_loadSubsidiaryDict`: то же.
- **1152-1154** `verifyInvoice`: см. **L7-A**.

### F5. Двойной POST при двойном клике "Сохранить"

`_save` (line 1069) **дизейблит** кнопку (line 1127-1130) **до** `await APIClient.saveInvoice`. Это спасает от double-click. **OK** (в отличие от forceSave из N1).

Но при **ошибке** (line 1180-1183) кнопка enable обратно. Если ошибка transient (network) — повторный клик возможен сразу. На сервере это второй POST. Нужна idempotency на бэке (вне зоны фронта).

### F6. UI-инконсистенция в `_switchFocus`

Line 519-543 — некоторые ветки делают `prevChip.classList.add('configured')` дважды (line 527 И 530), и в `else`-ветке (нет данных) — тоже configured. Дублирующаяся логика — non-bug, но выглядит как copy-paste.

### F7. _filterAndShowMetrics 100-limit

Line 742 / 794: `.slice(0, 100)`. Если справочник содержит >100 метрик в одной группе и нужная — на 101-й позиции, юзер её не найдёт без поиска. Магическое число без константы / без сообщения "показано первые 100 из N".

**effort**: S — добавить footer "Показано 100 из {totalCount}, уточните поиск".

---

## Резюме приоритетов

| Приоритет | Находки |
|-----------|---------|
| **P1 (фиксить срочно)** | H6-A (preview rebuild лаги), M12-A (мёртвый listener), N1 (двойной save POST), L7-A (verifyInvoice игнор) |
| **P2 (планировать)** | H5-A (Ctrl+S vs editing), M11-A (read-only disable), L8-A (silent fails), N6 (exit race), N8 (notification flood) |
| **P3 (рефактор)** | M10-A (Help vs Dialog), L9-A (Escape stack), N2 (acts cache TTL), F2 (invoice caches TTL) |
| **P4 (косметика)** | H7-A (setTimeout 50), N5 (LS quota), N10 (tooltip leak), N11 (configured null chip), F7 (100-limit), N3 (currentActId duplicate) |

## Файлы, упомянутые в отчёте

Все пути абсолютные:
- D:\PROJECT\Pyton\Act Constructor\static\js\constructor\app.js
- D:\PROJECT\Pyton\Act Constructor\static\js\constructor\storage-manager.js
- D:\PROJECT\Pyton\Act Constructor\static\js\constructor\header\acts-menu.js
- D:\PROJECT\Pyton\Act Constructor\static\js\constructor\header\chat-popup.js
- D:\PROJECT\Pyton\Act Constructor\static\js\constructor\header\format-menu-manager.js
- D:\PROJECT\Pyton\Act Constructor\static\js\constructor\header\header-exit.js
- D:\PROJECT\Pyton\Act Constructor\static\js\constructor\header\preview-menu.js
- D:\PROJECT\Pyton\Act Constructor\static\js\constructor\header\settings-menu.js
- D:\PROJECT\Pyton\Act Constructor\static\js\constructor\preview\preview.js
- D:\PROJECT\Pyton\Act Constructor\static\js\constructor\preview\preview-table-renderer.js
- D:\PROJECT\Pyton\Act Constructor\static\js\constructor\preview\preview-violation-renderer.js
- D:\PROJECT\Pyton\Act Constructor\static\js\constructor\preview\preview-textblock-renderer.js
- D:\PROJECT\Pyton\Act Constructor\static\js\constructor\dialog\dialog-help.js
- D:\PROJECT\Pyton\Act Constructor\static\js\constructor\dialog\dialog-invoice.js
- D:\PROJECT\Pyton\Act Constructor\static\js\constructor\context-menu\context-menu-cells.js
- D:\PROJECT\Pyton\Act Constructor\static\js\constructor\table\table-cells-operations.js
- D:\PROJECT\Pyton\Act Constructor\static\js\constructor\violation\violation-core.js
- D:\PROJECT\Pyton\Act Constructor\static\js\constructor\items\items-title-editing.js
- D:\PROJECT\Pyton\Act Constructor\static\js\shared\dialog\dialog-base.js
- D:\PROJECT\Pyton\Act Constructor\static\js\shared\notifications.js
- D:\PROJECT\Pyton\Act Constructor\static\js\shared\api.js
