# VER-3: Tree + Isolation — верификация и расширение (КЛЮЧЕВАЯ ЗОНА)

Confidence: **HIGH** для H1, M5, M6, M7, M8, M9, асимметрии `isPinnedTable`; **MEDIUM** для оценок масштаба DOM (без runtime-замеров) и для нескольких edge-case-сценариев drag-drop.

## Сводка

- Подтверждено / Опровергнуто / Новые: **6 / 0 / 8**
- АРХИТЕКТУРНЫЙ ВЕРДИКТ ПО ИЗОЛЯЦИИ: **MEDIUM** (с тенденцией к ухудшению).
  - Данные **изолированы хорошо**: `TextBlockManager` пишет только в `AppState.textBlocks[id]`, `ViolationManager` — только в свой `violation`-объект (по замыканию), `TableManager` — только в `AppState.tables[id]` и `tableUISizes[id]`. Реальных пересечений по записи между «соседями» (текстблок↔таблица↔нарушение) **нет**.
  - **Рендер не изолирован**: любая правка таблицы/перемещение узла/добавление контента — `ItemsRenderer.renderAll()`, который полностью стирает `#itemsContainer` и пересоздаёт все блоки всех сущностей. Это и есть «правка одной сущности задевает соседей» — не данные, а DOM и focus/selection/IME-состояние.
  - **Структура — узкие места**: дублирующая нумерация (state vs tree-renderer), две лестницы магических строк (`'table'/'textblock'/'violation'`), несимметричная защита (UI блокирует delete, а `AppState.deleteNode` — нет), асимметричный `isPinnedTable`.
- Главная боль: H1 renderAll — **подтверждено**, **критично**.

---

## §A. renderAll() — глубокий аудит

### A.1 Все call-sites `ItemsRenderer.renderAll()` — точно 14

| # | Файл:строка | Триггер | Что реально изменилось | Возможна ли per-node-замена | Эстимат сложности замены |
|---|---|---|---|---|---|
| 1 | `static/js/constructor/app.js:224` | переключение на Шаг 2 | первый рендер step2 | НЕТ — это первичный рендер | — |
| 2 | `static/js/constructor/storage-manager.js:215` | restore стейта из localStorage | пересоздаётся весь treeData | НЕТ — стейт пришёл целиком | — |
| 3 | `static/js/shared/api.js:415` | load акта с сервера | загружен весь акт | НЕТ — стейт пришёл целиком | — |
| 4 | `static/js/constructor/tree/tree-drag-drop.js:323` | `handleDrop` после `moveNode` | один узел переехал; 1-2 родителя поменяли children | **ДА** — `updateNode(oldParentId)` + `updateNode(newParentId)`; при cross-section в §5 ещё пересчёт metrics на 5.X | M |
| 5 | `static/js/constructor/context-menu/context-menu-tree.js:409` | `updateTreeViews()` после add/delete node/table/textblock/violation | один новый/удалённый узел | **ДА** — `insertNode(parentId, idx, data)` или `removeNode(nodeId)` | M (учесть risk-table cascade) |
| 6 | `static/js/constructor/context-menu/context-menu-cells.js:785` | `restoreTableSizes()` после операции с ячейками | контент одной таблицы | **ДА** — `renderSingleTable(tableId)` уже существует, но `restoreTableSizes` без причины зовёт `renderAll` | S |
| 7 | `static/js/constructor/table/table-cells-operations.js:166` | `insertRowAbove` | grid одной таблицы | **ДА** — `renderSingleTable(tableId)` | S |
| 8 | `static/js/constructor/table/table-cells-operations.js:242` | `insertRowBelow` | grid одной таблицы | **ДА** | S |
| 9 | `static/js/constructor/table/table-cells-operations.js:359` | `insertColumnLeft` | grid одной таблицы | **ДА** | S |
| 10 | `static/js/constructor/table/table-cells-operations.js:446` | `insertColumnRight` | grid одной таблицы | **ДА** | S |
| 11 | `static/js/constructor/table/table-cells-operations.js:508` | `deleteRow` | grid одной таблицы | **ДА** | S |
| 12 | `static/js/constructor/table/table-cells-operations.js:572` | `deleteColumn` | grid одной таблицы | **ДА** | S |
| 13 | `static/js/constructor/table/table-cells-operations.js:805` | `mergeCells` | grid одной таблицы | **ДА** | S |
| 14 | `static/js/constructor/table/table-cells-operations.js:870` | `unmergeCells` | grid одной таблицы | **ДА** | S |

**Итого 14 вызовов, из них:** 3 first-render (1-3) — необходимые; 11 (4-14) — потенциально per-node/per-table. **8 из 11 — операции над одной таблицей**, для которых УЖЕ существует `renderSingleTable(tableId)` (items-renderer.js:610). Не используется — даже `restoreTableSizes` (call-site #6) сама дёргает `renderAll()` вместо `renderSingleTable`.

### A.2 Масштаб операции (порядок цифр)

Возьмём «типичный» акт по дефолтной структуре (state-core создаёт секции 1-5, плюс пользователь обычно добивает 5-6 узлов второго уровня в §5):

- Секций (level 1, защищённых): **5** (1, 2, 3, 4, 5)
- В §5 — типично 3-6 узлов 5.X с 0-3 подпунктами 5.X.Y, каждый с violation или таблицей: ~**15 пунктов**
- Внутри §5: 1 главная metrics-table + 0-3 metrics на 5.X = ~**3-4 metrics-таблицы** (по 7 колонок × 4 строки = ~28 ячеек × 2 хендла + colspan-spanned) ≈ **80-100 td/th**
- Risk-таблиц (если в акте): 0-2 штуки × ~6 колонок × ~4 строки ≈ 24 td каждая
- Обычные пользовательские таблицы: 2-5 шт × ~3×3 = ~9 td каждая
- Textblock'ов: 3-8 шт (contentEditable div'ы)
- Violation'ов: 2-6 шт, каждый — 2 textarea + 4 optional checkbox + 4 optional textarea/list = ~10 input/textarea

**Грубый эстимат за один `renderAll()`:**

- DOM-нод стирается/пересоздаётся: **порядка 1500-3000** (контейнеры + ячейки + хендлы resize + textarea/input + checkbox + label/header span'ы для каждого пункта)
- На каждую `td/th` вешается 3 listener'а (click, dblclick, contextmenu) — это делает `tableManager.attachEventListeners()`. Плюс `resize-handle`/`row-resize-handle` — mousedown.
- Если в акте ~150-200 td/th в сумме → **переподключается ~600-800 listener'ов** за один renderAll. Плюс для каждого item-header — двойной-клик-detector на title (closure + setTimeout) — ещё ~15-30 listener'ов. Плюс на каждом violation — десятки textarea/checkbox listener'ов через `setupTextareaHandlers`.

**Опасный сценарий:** keystroke в textblock НЕ триггерит `renderAll()` (textblock пишет через `saveContent` → `textBlock.content = ...` + `PreviewManager.update()`, без `renderAll`). Здесь изоляция работает. **Но** правка ячейки таблицы через `startEditingCell` → если внутри она вызывает `insertRow*/deleteRow/merge*`, то да — каждая такая структурная операция = renderAll. Для непрерывных операций (юзер быстро добавляет 5 строк подряд) — 5 renderAll, ~10K DOM-операций суммарно.

**Side-effects от renderAll:**

1. **Теряется фокус** — если юзер сейчас редактирует violation textarea и в этот момент drag-drop в дереве вызывает `renderAll()` (line tree-drag-drop.js:323), textarea пересоздаётся, фокус и каретка теряются. То же при добавлении нового узла через context-menu.
2. **Теряется выделение ячеек** — `clearSelection()` вызывается явно (items-renderer.js:18). Это сознательно, но юзер может потерять контекст групповой операции.
3. **Сбрасываются IME-состояния** — для русского ввода (composition) пересоздание contenteditable во время composition = неконтролируемое поведение.
4. **persisted column widths не теряются** (восстанавливаются через `_restoreTableSizes`), но **между** renderAll и setTimeout(0) пользователь видит «прыгающую» таблицу.
5. **Selection (`AppState.selectedCells`) сбрасывается** через `clearSelection()` — кросс-зависимость state ↔ DOM.

### A.3 Per-node API — draft предложений

Минимальный, бьётся точно по call-sites 4-14:

```js
// items-renderer.js — расширение
class ItemsRenderer {
    /** Обновить рендеринг одного узла (любой тип) без затрагивания соседей. */
    static updateNode(nodeId) {
        const node = AppState.findNodeById(nodeId);
        if (!node) return;
        const oldEl = document.querySelector(`.item-block[data-node-id="${nodeId}"]`);
        if (!oldEl) return this._fullRenderFallback(); // безопасный fallback
        // Уровень определяется по DOM, чтобы не считать заново
        const level = parseInt([...oldEl.classList]
            .find(c => c.startsWith('level-'))?.replace('level-', '')) || 1;
        const newEl = this.renderItem(node, level);
        oldEl.replaceWith(newEl);
        tableManager.attachEventListenersWithin(newEl); // нужна новая узкая версия
        this._restoreTableSizesWithin(newEl);
    }

    /** Удалить рендеринг узла из DOM. */
    static removeNode(nodeId) {
        const el = document.querySelector(`.item-block[data-node-id="${nodeId}"]`);
        el?.remove();
    }

    /** Вставить новый узел в DOM-позицию, соответствующую его позиции в treeData. */
    static insertNode(parentId, nodeId) {
        // Найти DOM-родителя, найти DOM-соседа по индексу из treeData, insertBefore.
        // Уровень брать у родителя + 1 (с учётом informational shift).
    }

    /** Узкий обработчик для table-cells-operations: только одна таблица. */
    // Уже есть: renderSingleTable(tableId) — на line 610.
}
```

Плюс `TableManager.attachEventListenersWithin(rootEl)` — версия `attachEventListeners()`, ограниченная поддеревом (заменить `container.querySelectorAll` на `rootEl.querySelectorAll`).

**Минимально-инвазивный первый шаг (S, ~1 день):** заменить 8 call-sites в `table-cells-operations.js` на `ItemsRenderer.renderSingleTable(tableId)`. Метод уже существует, тестирован, имеет fallback на полный renderAll. Это сразу убирает ~57% (8/14) полных renderAll.

**Шаг 2 (M, ~2-3 дня):** `updateNode` + `removeNode` + `insertNode`, заменить call-sites в context-menu-tree.js:409 и tree-drag-drop.js:323.

**Шаг 3 (M, дополнительно):** убрать renderAll из `restoreTableSizes` (context-menu-cells.js:785) — там вообще не должен быть полный renderAll, только применение размеров.

---

## §B. Карта изоляции сущностей

Поля `AppState`: `treeData`, `tables`, `textBlocks`, `violations`, `tableUISizes`, `selectedCells`, `currentStep`.

| Компонент | Reads | Writes (через объект-по-ссылке считается write) | Пересечения с соседями |
|---|---|---|---|
| `TextBlockManager` (textblock/*.js) | `AppState.textBlocks[id]` (одно место — `getTextBlock`) | `textBlock.content` (через `saveContent`) | **НЕТ.** Никаких записей в `tables`/`violations`/`treeData`. |
| `ViolationManager` (violation/*.js) | объект `violation` приходит параметром в `createViolationElement(violation, node)` (по ссылке); `AppConfig.readOnlyMode` | `violation.violated`, `violation.established`, `violation.descriptionList.items`, `violation.{reasons,consequences,responsible,recommendations}.{enabled,content}`, `violation.additionalContent.*` | **НЕТ записей наружу.** `grep AppState\. ./violation/` → 0 матчей. Идеальная изоляция данных. |
| `TableManager`/`TableCellsOperations` (table/*.js) | `AppState.tables[id]`, `AppState.tableUISizes[id]` | `table.grid[r][c].content`, `table.grid[r][c].{colSpan,rowSpan,isSpanned,spanOrigin,originRow,originCol,isHeader}`, `AppState.tableUISizes[tableId]`, `AppState.selectedCells` | **НЕТ к соседним сущностям.** Единственное расширение — `selectedCells` (legacy bridge, читается только preview, не критично). |
| `TreeManager`/`TreeRenderer` (tree/*.js) | `treeData` целиком, `AppState.tables[id].isRegularRiskTable/isOperationalRiskTable` (для drag-блокировки) | НЕТ через managers (рендеринг read-only); запись TB-флагов `node.tb` идёт в TreeRenderer._onTbCheckboxChange | `node.tb` — пишется тремя путями (tree-renderer.js:533, items-renderer.js:283, state-tree.js via `_clearTbRecursive`). См. F-1. |
| `state-tree.js` (`AppState.*Node` API) | `treeData`, `tables` | `treeData.children` (mutations), удаляет `tables[id]`, `textBlocks[id]`, `violations[id]`, `tableUISizes[id]` при `deleteNode` | **Это координатор**, пересечения здесь — by design (cascade delete). |
| `state-content.js` | `treeData`, `tables` | создаёт записи в `tables`, `textBlocks`, `violations`; добавляет node'ы в children родителя | by design. |
| `ItemsRenderer` | `treeData`, `tables`, `textBlocks`, `violations` (для рендеринга) | `tables[id].grid[r][c].content` через `_syncTables`; `textBlocks[id].content` через `_syncTextBlocks`; `violations[id].*` через `_syncViolations`; `node.tb` через `_showTbDropdownInItems` | Sync-функции — централизованный DOM→state pull (вызывается из navigation-manager.js:88 и storage-manager.js:309). Здесь нет «правка А ломает Б», но есть скрытая зависимость: если в DOM `data-table-id` мутирован, `_syncTables` потеряет данные. |

**Вывод по изоляции данных:** для четырёх сущностей (table, textblock, violation, item-узел) **записи не пересекаются** — каждый компонент пишет в свою область. Это **сильная сторона** архитектуры. Слабая сторона — не в данных, а в:

1. **Рендере**: пересоздание DOM всех сущностей в `ItemsRenderer.renderAll` (см. §A).
2. **Координации каскадных операций** (delete risk-table → удалить metrics на 5.X → удалить main metrics на 5; move node под §5 → пересчитать сводные). Логика разнесена между `state-tree.js`, `state-content.js`, `context-menu-tree.js` и проверяется по флагам типа `isRegularRiskTable`/`isMetricsTable`. См. §E-3.
3. **TB-данных**: `node.tb` мутируется в 3 разных местах (см. §E-1).

---

## §C. Подтверждённые находки

### C-1 [HIGH] H1: `ItemsRenderer.renderAll()` — монолитная перерисовка step 2
**Файл:** `static/js/constructor/items/items-renderer.js:13-28`, call-sites — см. §A.1.
**Симптом:** любая структурная операция на step 2 (добавить узел / удалить узел / переместить / вставить строку в таблицу / merge ячеек / любая инвалидация tree-views) → `container.innerHTML = ''` + полный рендер всего акта + переподключение всех listener'ов. 11 из 14 call-sites — узколокальные изменения (одна таблица или одна ветка дерева).
**Bad outcome:**
- Потеря фокуса/IME при правке violation textarea и параллельной операции в дереве.
- Заметные «прыжки» при операциях с ячейками в больших таблицах.
- Высокая нагрузка для актов с глубокой §5 структурой (15-20 узлов × таблицы рисков × метрики).
- Сбрасывается выделение ячеек.
**Effort:** Phase 1 — S (заменить 8 call-sites на `renderSingleTable`, уже существует). Phase 2 — M (`updateNode`/`removeNode`/`insertNode` + per-node attach listeners).
**Fix:** см. §A.3.
**Cross-links:** влияет на M5 (если будет per-node-нумерация — нумерация дерева должна стать инкрементальной); влияет на C-2.

### C-2 [MED] M5: дублирование логики нумерации
**Файлы:** `static/js/constructor/state/state-tree.js:14-96` (формат: `Таблица N`, `Текстовый блок N`, `Нарушение N`, hierarchical `1.2.3`); `static/js/constructor/tree/tree-renderer.js:148-184` НЕ дублирует нумерацию, но **формирует label из `node.number`** — однако в `tree-renderer.js` и `items-renderer.js` есть две параллельные ветки построения отображаемой метки:
- `tree-renderer.js:155-184` — рендер дерева: `node.number + '. ' + node.label` для item-узлов; `customLabel || number || label` для content-типов.
- `items-renderer.js:130-143` — рендер step2: `node.number + '. '` + `node.label`.
Также есть третий пункт — `items-renderer.js:452` (`tableTitle.textContent = node.customLabel || node.number || node.label`) — повторяется на line 159, 255 в `items-title-editing.js`.
**Bad outcome:** при изменении формата нумерации (например, переход на «§N» для секций) нужно править ≥3 места. Также формула «`customLabel || number || label`» встречается **9 раз**, любая правка приоритетов фолбэков — рассинхрон между деревом, items, превью.
**Effort:** S.
**Fix:** вынести в `TreeUtils.getNodeDisplayName(nodeId)` (он уже есть на line 324) и в `TreeUtils.getNodeNumberPrefix(node)` — заменить inline-конкатенации.

### C-3 [MED] M6: кросс-зависимость TreeRenderer → ItemsRenderer (TB-sync)
**Файлы:** `static/js/constructor/tree/tree-renderer.js:462-467, 586-598`.
TreeRenderer при изменении TB в чекбоксе **напрямую вызывает private-методы ItemsRenderer**:
- `ItemsRenderer._createTbSelector(node)` (line 592)
- `ItemsRenderer._updateParentTbInItems(node)` (line 597)
Это нарушает изоляцию рендера дерева ↔ рендера items: модуль `tree/` знает о DOM-структуре `items/` (`.item-block[data-node-id]`, `.item-header .tb-selector`).
**Bad outcome:** правка DOM-структуры в `items-renderer.js` (переименовать класс/изменить иерархию) — молча сломает синхронизацию TB. Никаких тестов, никакой типизации. Также `_*` — это конвенция «private», но используется снаружи; PR с рефакторингом «private» методов сломает поведение.
**Effort:** S-M.
**Fix варианты:**
- A) Event-bus: `EventBus.emit('node:tbChanged', {nodeId})`, оба рендера подписаны. Изоляция полная.
- B) DI/callback: `TreeManager.tbChangeListeners = []`, items-renderer регистрируется на init.
- C) Минимум — сделать `_createTbSelector` и `_updateParentTbInItems` публичными (убрать `_`) с явным контрактом-комментарием. Это снимает только косметику, но фиксирует факт публичного API.

### C-4 [LOW] M7: dead-parameter в `_cleanupMetricsTablesAfterRiskTableDeleted(deletedNodeId)`
**Файл:** `static/js/constructor/state/state-content.js:526-576`.
**Воспроизведение мысленно:** удалить risk-table в 5.1.1.
1. `removeTable(tableNodeId)` (state-content.js:61) → удаляет node из children 5.1.1, удаляет `tables[id]`, вызывает `_cleanupMetricsTablesAfterRiskTableDeleted(tableNodeId)`.
2. `_cleanupMetricsTablesAfterRiskTableDeleted` итерирует по `node5.children`, фильтрует item-узлы с `5.\d+` — это все 5.X. Для каждого 5.X считает `deepRiskTables` ТОЛЬКО в его дочерних item-узлах (5.X.Y+). Если у 5.X больше нет risk-таблиц в глубину — удаляет metrics-таблицу с 5.X.
3. Параметр `deletedNodeId` НЕ используется внутри функции (формально — она пересчитывает с нуля).
**Реальный баг или dead-code:** **dead-parameter, не баг.** Поведение корректное: функция работает «реконсилитивно» — пересчитывает по всему §5. Параметр оставлен «на будущее» / для логирования. Имя метода вводит в заблуждение: «Cleanup AFTER {nodeId}» — кажется, что чистит только то, что связано с этим nodeId; на самом деле — сверка по всему §5.
**Bad outcome:** программист, читая `state-tree.js:797` (`this._cleanupMetricsTablesAfterRiskTableDeleted(draggedNode.id)`) при `_reconcileMetricsTablesAfterMove`, может подумать, что нужно передавать «более точный» nodeId для оптимизации — и сделать что-то неверное.
**Effort:** XS.
**Fix:** убрать параметр, переименовать в `_reconcileMetricsTables()` (или `_cleanupOrphanedMetricsTables`). Заодно проверить, что вызовы передают только для логов (state-tree.js:797 — да, передаёт draggedNode.id, но в функции он не нужен).

### C-5 [MED] M8: магические строки nodeTypes (`'table'/'textblock'/'violation'/'item'`)
**Подсчёт:**
- `['"](table|textblock|violation|item)['"]` — **92 occurrences across 17 files** (среди них также сборщик-фильтры, но большинство — литералы для сравнения `node.type === 'table'`).
- Только `'table'`: **51 occurrence, 14 files**.
- Конфигурация `AppConfig.nodeTypes` существует (`static/js/shared/app-config.js:30-34` — `ITEM/TABLE/TEXTBLOCK/VIOLATION`), но используется **только в 5 файлах** (`tree-utils.js`, `validation-tree.js`, `state-content.js`, `state-core.js`, `app-config.js`).

**Топ-5 файлов с магическими строками:**

| Файл | Кол-во |
|---|---|
| `state/state-content.js` | 17 |
| `state/state-tree.js` | 9 |
| `context-menu/context-menu-tree.js` | 13 (включая 6 раз `'table'`) |
| `items/items-renderer.js` | 5 |
| `state/state-core.js` | 6 |

**Bad outcome:** опечатка в литерале (например `'tablle'` или `'TextBlock'`) — silent fail (если сравнение `===`); невозможность переименовать тип без глобального grep'а; смешение с CSS-классами (`'table-node'`) и lowercase-литералом — `grep 'table'` даёт ложноположительные.
**Effort:** S.
**Fix:** жёсткий рефакторинг `node.type === 'table'` → `node.type === AppConfig.nodeTypes.TABLE`. Идеально — `eslint-rule no-restricted-syntax` на литералы, но без бандлера/линтера придётся делать ревью вручную.

### C-6 [MED] M9: `AppState.deleteNode` не проверяет `protected`/`deletable`
**Файл:** `static/js/constructor/state/state-tree.js:217-244`.
В `deleteNode` есть только проверка readOnly-режима. Защита от удаления секций 1-5 живёт **исключительно** в UI: `context-menu-tree.js:336-339` проверяет `node.deletable === false`. Если код позовёт `AppState.deleteNode('5')` напрямую (миграция, dev-tools, новая фича, undo-логика changelog), узел удалится со всем содержимым, **`_deleteChildren` сделает каскад**, и восстановить можно будет только из localStorage.
**Bad outcome:** структурное удаление секции 1-5; нарушение инварианта «у акта всегда 5 секций»; вся валидация ниже по стеку (нумерация, метрики, риски) предполагает существование `findNodeById('5')`.
**Effort:** XS.
**Fix:**

```js
deleteNode(nodeId) {
    if (AppConfig.readOnlyMode?.isReadOnly) {/* ... */}
    const node = this.findNodeById(nodeId);
    if (!node) return false;
    // Защита API-уровня (страховка над UI-проверкой)
    if (node.protected || node.deletable === false) {
        if (typeof Notifications !== 'undefined') {
            Notifications.error('Этот элемент защищён от удаления');
        }
        return false;
    }
    // ... остальная логика
}
```

Для каскадного `_deleteChildren` потребуется обходить — там удаление идёт по child.id, но эти child могут быть protected (например, metrics-таблица). Сейчас при удалении родителя протектед-дочерние тихо удаляются. По бизнес-смыслу — это допустимо (родителя нет — детям незачем). Но решение должно быть явным.

---

## §D. Опровергнутые

Ничего не опровергнуто из заявленных флагов. Все 6 главных пунктов (H1, M5, M6, M7, M8, M9) подтверждены.

---

## §E. Новые находки

### E-1 [MED] `node.tb` мутируется в 3 разных местах без координации
**Файлы:**
- `static/js/constructor/tree/tree-renderer.js:533-546` (`_onTbCheckboxChange` — дерево).
- `static/js/constructor/items/items-renderer.js:279-296` (чекбокс в items dropdown — step 2).
- `static/js/constructor/state/state-tree.js:147-149, 372-380, 826-836` (очистка при addNode/moveNode/clearTbRecursive).

**Bad outcome:** два независимых write-path (tree-renderer и items-renderer оба добавляют/удаляют в `node.tb`), плюс state-tree чистит на структурных операциях. При изменении бизнес-правила (например, «один ТБ на узел») придётся править 3 места. ChangeLog (`ChangelogTracker.record`) не вызывается для TB-изменений (только `StorageManager.markAsUnsaved()`) — теряется аудит-trail.
**Effort:** S.
**Fix:** вынести в `AppState.setNodeTb(nodeId, abbr, checked)` — единая точка записи + changelog.

### E-2 [MED] `TreeUtils.isPinnedTable` асимметричен между metrics и risk
**Файл:** `static/js/constructor/tree/tree-utils.js:309-317`.

```js
isPinnedTable(node) {
    if (node.type !== 'table') return false;
    if (node.isMetricsTable || node.isMainMetricsTable) return true;          // ← НА УЗЛЕ
    if (node.tableId) {
        const table = AppState.tables[node.tableId];
        if (table && (table.isRegularRiskTable || table.isOperationalRiskTable)) return true;  // ← НА ТАБЛИЦЕ
    }
    return false;
}
```

Metrics — флаги на node (`isMetricsTable`, `isMainMetricsTable`, см. state-content.js:293, :440), risk — флаги на table-объекте (см. state-content.js:607, :643). Это исторически — на node нет нужды дублировать, но в коде есть и `_isRiskTable` (state-tree.js:252) который тоже идёт через `tables[tableId]`. Если backend пришлёт `node.isRegularRiskTable: true` без флага в `tables` (миграция/нормализация) — `isPinnedTable` не распознает.
**Bad outcome:** при загрузке акта (api.js) если `tables[id]` ещё не заполнен в момент проверки `isPinnedTable` — pinned-логика молча сломается (drag-drop разрешит вставку перед risk-таблицей).
**Fix:** унифицировать — либо все флаги на node, либо все на table. Лучше на node, т.к. node — структура (дерево), table — данные (контент); пиннинг — структурное свойство.

### E-3 [MED] Каскадная логика metrics ↔ risk размазана по 4 файлам
**Файлы (входы):**
- `state-content.js` — `_updateMetricsTablesAfterRiskTableCreated`, `_cleanupMetricsTablesAfterRiskTableDeleted`, `_createMetricsTable`, `_createMainMetricsTable`, `_findRiskTablesInSubtree`.
- `state-tree.js` — `_reconcileMetricsTablesAfterMove`, `_handleMetricsTableForNode`, `_checkMetricsTableDeletion`, `_checkSection5RiskConstraints`, `updateMetricsTableLabel`.
- `context-menu-tree.js` — `_isRiskTableAllowedForNode`, `_hasDirectRiskTables`, `_hasChildItemRiskTables`, `_hasRiskTablesAtLevel5x`, `_hasRiskTablesBelowLevel5x`, `_hasBothLevelsAvailable` — это **6 предикатов** только в context-menu.
- `tree-drag-drop.js` — `_hasRiskTablesInSubtree` (дубль `_findRiskTablesInSubtree`).

**Bad outcome:** инвариант «метрики на 5.X существуют ⇔ есть risk-таблицы на 5.X.Y+» поддерживается имплицитно в 4-5 точках. При добавлении нового сценария (например, «копировать акт-шаблон») высока вероятность забыть один из путей.
**Effort:** L.
**Fix:** ввести `MetricsRiskCoordinator` — отдельный сервис с явным API `onRiskTableAdded(nodeId)`, `onRiskTableRemoved(nodeId)`, `onSubtreeMoved(nodeId, oldAncestor, newAncestor)`, `validateAddRiskTable(nodeId)`. Все 4 файла дёргают эти точки. Бизнес-правила (5.X vs 5.X.Y) — в одном месте.

### E-4 [LOW] `_findRiskTablesInSubtree` дублирован между `AppState` и `TreeDragDrop`
**Файлы:**
- `static/js/constructor/state/state-content.js:467-483` — `_findRiskTablesInSubtree(node)` возвращает массив.
- `static/js/constructor/tree/tree-drag-drop.js:115-134` — `_hasRiskTablesInSubtree(node)` возвращает boolean (early exit).

Две реализации одного обхода. drag-drop версия микро-оптимизирована (early exit) — это норма, но имя и расположение не дают сигнала «это связано».
**Effort:** XS.
**Fix:** оставить два, но переименовать одно в `_anyRiskTableInSubtree` (boolean) и явно сказать в комментарии «hot-path drag, не использовать `_findRiskTablesInSubtree(...).length > 0`». Либо вынести в `TreeUtils.findRiskTables(node, {firstOnly})`.

### E-5 [MED] `dropPosition` cleared в `cleanup()` — но `handleDrop` async-await может race с `dragend`
**Файл:** `static/js/constructor/tree/tree-drag-drop.js:303-341`.
В `handleDrop`:
```js
async handleDrop(e) {
    if (!this.draggedNode || !this.dropTargetNode || !this.dropPosition) {
        this.cleanup(); return;
    }
    const result = await AppState.moveNode(...);  // ← await c await DialogManager.show внутри _checkMetricsTableDeletion
    if (result.valid) { /* re-render */ }
    this.cleanup();
}
```
`AppState.moveNode` async, в нём может быть `await DialogManager.show(...)` для подтверждения удаления metrics. В это время `dragend` событие уже сработало (синхронно после drop) → вызывается `this.handleDragEnd` → `this.cleanup()` → `this.draggedNode = null`, `this.dropTargetNode = null`. Но `handleDrop` уже взял `this.draggedNode` в локальный неявный this (методы класса). После `await` он не обращается к `this.draggedNode` — он передал ID в `moveNode` ДО await. Хорошо.
**Однако:** после `await`, если юзер успел начать новый drag (например, на другом узле), `this.draggedNode/dropTargetNode/dropPosition` уже изменены. Вызов `this.cleanup()` в конце `handleDrop` **сотрёт состояние ВТОРОГО drag'а** (поставит draggedNode = null, классы dragging уберёт). Реальная вероятность мала (нужен модальный диалог во время moveNode, и параллельно юзер физически тянет ещё), но архитектурно — race возможна.
**Effort:** XS.
**Fix:** капчурить `const draggedEl = this.draggedElement` в начале `handleDrop`, снимать классы у него, не через `this.draggedElement` после await.

### E-6 [LOW] `handleDrop`: «target узел удалили во время drag» — не обрабатывается
**Сценарий:** юзер начал drag узла A над target B. В этот момент происходит auto-save (async load из api.js:415 → `AppState.treeData` пересоздан целиком → `treeManager.render()` стирает старые `.tree-item` DOM-узлы).
- Драг-источник `draggedElement` теперь sirota: висит в `this.draggedElement` (ссылка на DOM-узел, не в дереве). Стиль `opacity: 0.4` остался на нём, но он не в DOM.
- `dropTargetNode` — это `node` из `findNodeById` (ссылка на старое дерево).
- `handleDrop` вызывает `AppState.moveNode(this.draggedNode.id, this.dropTargetNode.id, ...)`. `findNodeById` ищет в новом дереве — может не найти узел с тем же ID (если backend поменял id'ы), вернёт `_getNodesForMove` → failure.
**Bad outcome:** silent fail или ошибка `Notifications.error('Узел не найден')` посреди UX.
**Effort:** M.
**Fix:** во время активного drag блокировать background-reloads (флаг `dragInProgress` в `TreeDragDrop` + проверка в `api.js`). Или: при reload отменять drag (`treeManager.dragDrop.abort()`).

### E-7 [LOW] `enableDraggableItems` использует MutationObserver, который не отключается
**Файл:** `static/js/constructor/tree/tree-drag-drop.js:51-65`.
`MutationObserver` подписан на `manager.container` (subtree). Никогда не вызывается `observer.disconnect()`. В контексте JupyterHub-сессии — каждый раз при создании `TreeManager` (если он пересоздаётся) — наблюдатель копится. По коду — `TreeManager` singleton (создаётся 1 раз), поэтому утечки в продакшене нет, но это хрупко.
**Effort:** XS.
**Fix:** ничего не править — оставить как есть, но прокомментировать «singleton». Либо хранить ссылку и иметь `destroy()`.

### E-8 [MED] `ContextMenu.show` ловит readOnly, но `ContextMenu` дублирует проверки readOnly в каждом handler'е
**Файл:** `static/js/constructor/context-menu/context-menu-core.js:50-55`.
Глобально: `show()` сразу возвращает при readOnly с уведомлением. Но в `state-content.js:19-21`, `state-tree.js:125-128, 218-222, 310-313` — ВСЕ методы повторяют ту же проверку. Это страховка (если кто-то вызовет AppState.addNode из консоли — тоже блок). Но дублирующая проверка означает 5-кратное повторение паттерна `if (AppConfig.readOnlyMode?.isReadOnly) return ValidationCore.failure(AppConfig.readOnlyMode.messages.X)`.
**Effort:** XS-S.
**Fix:** декоратор/гард `_requireWriteMode(messageKey)` или wrap в `ValidationCore.requireWrite()`.

---

## §F. Рекомендации для рефакторинга «изоляция»

Приоритет по риску (риск × неизбежность × дешевизна):

### F-1 [P0, S, 1 день] Заменить 8 call-sites в `table-cells-operations.js` на `renderSingleTable`
- Уже существующий `ItemsRenderer.renderSingleTable(tableId)` — drop-in замена.
- В каждом из 8 мест есть `tableId` через `cell.dataset.tableId`.
- Гарантированный win: 57% renderAll-ов уйдут.
- Риск: низкий — fallback на `renderAll` уже встроен в `renderSingleTable`.

### F-2 [P0, S, 0.5 дня] Защита `AppState.deleteNode` от удаления protected-секций (M9)
См. §C-6. Это страховка с очень дешёвой ценой и предотвращает катастрофу.

### F-3 [P1, S, 1 день] Единая константа nodeTypes (M8)
См. §C-5. Поэтапно: state-content.js → state-tree.js → context-menu/* → items/* → tree/*.

### F-4 [P1, M, 2-3 дня] `ItemsRenderer.updateNode / removeNode / insertNode`
См. §A.3. Замена call-sites #4-5 (tree-drag-drop, context-menu-tree).
- Дополнительно нужен `TableManager.attachEventListenersWithin(rootEl)`.

### F-5 [P1, S, 0.5 дня] Унификация `node.tb` через `AppState.setNodeTb` (E-1)
Единая точка + changelog.

### F-6 [P2, S, 0.5 дня] Очистка `_cleanupMetricsTablesAfterRiskTableDeleted` — убрать dead-parameter, переименовать (M7)

### F-7 [P2, M, 1-2 дня] Изоляция TreeRenderer → ItemsRenderer (M6)
Event-bus минимальный (один топик `node:tbChanged`), без overengineering.

### F-8 [P2, S, 0.5 дня] Унифицировать `isPinnedTable` (E-2) — все pinned-флаги на node.

### F-9 [P3, L, 3-5 дней] Извлечь `MetricsRiskCoordinator` (E-3)
Большая работа, оправдана только если бизнес добавит ещё каскады (например, инвойсы ↔ метрики). Сейчас работает — не трогать без триггера.

### F-10 [P3, S, 0.5 дня] Race-protection drag-drop (E-5, E-6)
Капчурить локальные ссылки до await; флаг `dragInProgress` для блокировки auto-reload.

---

## Финальный вердикт

**Изоляция данных в зоне tree + items: HIGH.** Никаких пересечений по write между Table/TextBlock/Violation managers — каждый пишет в свою AppState-область. Это сильная сторона архитектуры, которую нужно сохранить при любых рефакторингах.

**Изоляция рендера: LOW.** `ItemsRenderer.renderAll()` — bottleneck. 11 из 14 call-sites не нуждаются в полном renderAll; для 8 из них уже есть готовое решение (`renderSingleTable`), нужно только заменить вызовы. F-1 + F-2 + F-3 (3-4 дня суммарно) дадут ~70% выгоды от всего «refactoring isolation» бюджета.

**Самое опасное:** комбинация renderAll + теряемый фокус при правке violation textarea + одновременная операция в дереве. Это UX-баг, который у пользователя проявится как «пишу нарушение, оно молча исчезает, когда товарищ перетянул узел в дереве» — типичный сценарий «правка одной сущности ломает соседа». Решение — F-4 (`updateNode` вместо `renderAll`).
