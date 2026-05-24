# NEW-2: Performance — статический аудит

> **Метод.** Статический анализ кода без реального профайлинга. Все «миллисекунды» и «события/сек» — это **расчётные оценки** на основе:
>
> - подсчёта DOM-операций по исходникам (`createElement`, `appendChild`, `addEventListener`);
> - типовых стоимостей операций в современных Chromium-движках (createElement ≈ 1–3 мкс, addEventListener ≈ 0.5–1 мкс, JSON.stringify зависит от размера);
> - заявленных параметров деплоя (HTTP/1.1 под JupyterHub-proxy, ~6 параллельных коннектов на origin).
>
> **Все числа нужно валидировать DevTools Performance/Network профилем перед фиксом.** Документ — это «куда смотреть», а не «вот точная цифра».
>
> **Дата:** 2026-05-24. Working tree HEAD: `7ded1f0` (`master`).

---

## Сводка

### Главные боли (5)

1. **`ItemsRenderer.renderAll()` — монолитная перерисовка всего шага 2 на каждое микро-изменение.** Стирает `innerHTML`, теряет выделение, обходит дерево, переподключает слушатели на каждой ячейке. Вызывается из **18 точек** (`grep` выше). Для типичного акта это **~3 000–5 000 DOM-операций** на одну правку строки таблицы. Корень H1/H6/H7 из `frontend-constructor-as-is.md`.
2. **~72 `<script>`-тега в `base_constructor.html` + жёсткий порядок.** Под HTTP/1.1 (cap = 6 параллельно) — **~12 round-trips**. При RTT 50–100 мс это **600–1 200 мс «второго белого экрана»** до того, как страница станет интерактивной. Это §8.2 из as-is.
3. **`app:state-changed` слушается, но никем не emit'ится — listener мёртв.** `PreviewMenuManager` (`preview-menu.js:345-349`) подписан на `app:state-changed`, но в коде **нет ни одного `dispatchEvent('app:state-changed')`**. Реальный rerender преview идёт через **прямые** вызовы `PreviewManager.update()` из ~30 мест. H6 из as-is про «preview без throttle» — частично симптом, частично преувеличение: throttle через `requestAnimationFrame` есть, но без debounce — на потоке клавиш будет N кадров подряд.
4. **`storage-manager.js`: `JSON.stringify(AppState)` целиком при каждом debounce (1 сек).** Для типичного акта (~150 нод, ~5 таблиц, ~10 textblocks) это **~50–200 КБ JSON**. При активном вводе — раз в секунду блокирующая операция 5–20 мс на main thread. Квота LS 5 МБ позволит держать ~25–100 актов.
5. **196 `addEventListener` против 31 `removeEventListener` в `static/js/constructor/`.** Дисбаланс **6:1**. Большая часть оправдана (singleton-компоненты, живущие всё время страницы), но `tableManager.attachEventListeners()` после каждого `renderAll()` цепляет **2–3 listener'а на каждую ячейку** без чистки — старые DOM-узлы выкидываются в GC вместе с handler'ами, новые получают свежие. На таблице 5×4 это +20 cell listeners + ~12 resize listeners = **~32 новых listener'а на каждый renderAll**.

### Замеры (расчётные)

| Метрика | Значение | Источник |
|---|---|---|
| JS-файлов всего | **92** | `find static/js -name "*.js" | wc -l` |
| JS-файлов суммарно | **1230 КБ** (uncompressed) | `find static/js -printf "%s"` |
| `<script src=` в `base_constructor.html` | **72** | `grep -c "script src=" templates/constructor/base_constructor.html` |
| CSS-файлов всего | **78** | `find static/css -name "*.css" | wc -l` |
| CSS-файлов суммарно | **387 КБ** (uncompressed) | `find static/css -printf "%s"` |
| `@import` в `constructor.css` | **41** (76 строк, ~41 импорт) | `wc -l static/css/entry/constructor.css` |
| `addEventListener` в constructor/ | **196** | `grep -r addEventListener` |
| `removeEventListener` в constructor/ | **31** | `grep -r removeEventListener` |
| `passive: true` listeners | **2** | preview-menu и lock-manager только |
| `setTimeout/setInterval` в constructor/ | **~40** | grep |
| `clearTimeout/clearInterval` в constructor/ | **~25** | grep |
| Прямые `style.X = ` (в constructor/) | **~180** | `grep -rcE "\.style\.[a-zA-Z]+\s*="` |
| `getBoundingClientRect/offsetWidth/Height` | **~45 точек** | grep |
| `localStorage.setItem/getItem` в constructor/ | **~15** | grep |
| Точек вызова `ItemsRenderer.renderAll()` | **18** | grep |
| Точек вызова `PreviewManager.update()` | **~30** | grep |

---

## §A. `renderAll()` — детальная оценка стоимости

### A.1 Алгоритмическая сложность

`ItemsRenderer.renderAll()` (`static/js/constructor/items/items-renderer.js:13-28`):

```js
static renderAll() {
    const container = document.getElementById('itemsContainer');
    if (!container) return;

    container.innerHTML = '';                     // [1] стирает всё (включая listener-связи)
    tableManager.clearSelection();                // [2] теряет выделение

    if (AppState.treeData?.children) {
        AppState.treeData.children.forEach(item => {
            container.appendChild(this.renderItem(item, 1));   // [3] обход всего дерева
        });
    }

    tableManager.attachEventListeners();          // [4] переподключение слушателей на ВСЕ ячейки
    this._restoreTableSizes();                    // [5] async через setTimeout(0)
}
```

**Сложность: O(N + C)**, где
- **N** — общее число нод в дереве (item, table, textblock, violation);
- **C** — общее число ячеек во всех таблицах шага 2 (главный множитель из-за `attachEventListeners`).

### A.2 Расчёт для типичного акта

**Параметры типичного акта** (по §3 as-is + дефолтная инициализация):

- 5 защищённых секций уровня 1 (1–5)
- + по ~5–10 пунктов 2-го уровня на каждую = ~30–50 item-нод
- + в р.5 ~10 leaf-нод с invoices = ещё ~10 item-нод
- + риск-таблицы (1 в р.5, обычно 2 — операционная и обычная), метрик-таблицы 5×N
- + по таблице/textblock'у/violation у некоторых leaf'ов

**Принимаем модель:** ~80 item-нод + 5 таблиц (по 5×4 = 20 ячеек) + 10 textblocks + 5 violations = **N ≈ 100 нод дерева, C ≈ 100 ячеек таблиц**.

#### DOM-операции на одну `renderAll()`

| Действие | Операций на штуку | Шт. | Итого |
|---|---|---|---|
| `_createItemContainer` (`<div class="item-block">`) | 1 createElement + 1 dataset = 2 | 100 | **200** |
| `_createItemHeader` (`<div>` + `<h{N}>` + `<span>×2`) | 4 createElement + 3 appendChild = 7 | 80 | **560** |
| `_createTbSelector` под р.5 (~30 нод) — badge или badges-container | ~3–5 | 30 | **120** |
| `_setupTitleEditing` — 1 `addEventListener('click')` | 1 | 80 | **80** |
| `renderTable` → `_createTableElement` → `_createTableRow`/`_createTableCell`: каждая ячейка — 1 `createElement` + 1 `Object.assign(dataset, ...)` + 2 resize handles | ~5 операций | 100 | **500** |
| `textBlockManager.createTextBlockElement` (грубо: контейнер + editor + toolbar) | ~10 | 10 | **100** |
| `violationManager.createViolationElement` (форма из ~10 input/textarea/buttons) | ~15 | 5 | **75** |
| **DOM-операций в renderItem-фазе** | | | **~1 635** |

Затем **`tableManager.attachEventListeners()`** (`table-core.js:70-149`):
- `querySelectorAll('td, th')` — обход всех ячеек, **2 addEventListener на ячейку** (click + dblclick + contextmenu = **3**)
- `querySelectorAll('.resize-handle')` — **1 mousedown** на каждую column-handle (~80 шт.: 4 колонки × 4 строк × 5 таблиц, минус последние колонки)
- `querySelectorAll('.row-resize-handle')` — **1 mousedown** на каждую row-handle (~100 шт.)

| Действие | Операций | Шт. | Итого addEventListener |
|---|---|---|---|
| Cell click + dblclick + contextmenu | 3 | 100 ячеек | **300** |
| Column-resize mousedown | 1 | ~80 | **80** |
| Row-resize mousedown | 1 | ~100 | **100** |
| **addEventListener вызовов в attachEventListeners** | | | **~480** |

**Итого на одну `renderAll()` типичного акта:**
- **~1 635 DOM mutations** (createElement + appendChild + dataset.x = ...)
- **~480 addEventListener'ов** (свежих, на новых DOM-узлах)
- **~80 setupTitleEditing** click listener'ов
- **1 querySelectorAll('.table-section')** + N applyPersistedSizes (через async setTimeout 0)

**Грубая стоимость по эмпирическим бюджетам Chromium:**
- createElement ≈ 1 мкс → 1 635 × 1 = **~1.6 мс на mutation phase**
- addEventListener ≈ 0.5 мкс → 480 × 0.5 = **~0.25 мс на listener phase**
- innerHTML = '' = layout invalidation + GC старого поддерева — обычно **~3–10 мс** на странице такого размера
- layout/paint после массовых insert'ов — **~10–30 мс** при сложном CSS (а у нас 41 импорт в constructor.css)

**Расчётный total: 15–40 мс** на одну `renderAll()` при типичном акте. Под HTTP/1.1 + slow CPU (например, удалённый desktop в JupyterHub) — **смело умножить на 2–3**.

**Для большого акта** (N ≈ 300 нод, C ≈ 500 ячеек): расчётный total **80–200 мс** — это **видимый jank**.

### A.3 Сравнение: `renderAll` vs per-node update

| Сценарий | renderAll() | Гипотетический `updateNode(nodeId)` |
|---|---|---|
| Изменить текст одной ячейки | ~15–40 мс (вся перерисовка) | ~0.05 мс (один `cell.textContent =`) |
| Merge/unmerge 2 ячеек | ~15–40 мс | ~5–10 мс (перерисовать одну таблицу) |
| Insert row | ~15–40 мс | ~3–5 мс (insertRow + N createElement) |
| Drag-drop ноды | ~15–40 мс (renderAll + tree.render + preview.update) | ~3–10 мс (одна структурная перестановка) |
| Изменение заголовка узла | ~15–40 мс (`items-title-editing.js:109,160,288`) | ~0.05 мс (`textSpan.textContent =`) |

**Худший случай** (раздел 4.4 as-is, `context-menu-cells.js:791-803`): после операции — **`setTimeout(50)` + `restoreTableSizes()` + потом `renderAll()`**. Магия 50 мс намекает, что в проде уже наблюдалось «не успевает». Это эмпирический комментарий разработчика, что 15–40 мс — это **оптимистичная нижняя граница**.

### A.4 Call-sites `ItemsRenderer.renderAll()` (точно, 18 вхождений)

| # | Файл:строка | Триггер | Можно ли заменить на per-node? |
|---|---|---|---|
| 1 | `app.js:224` | После загрузки акта | Нет (первоначальный рендер) |
| 2 | `context-menu-cells.js:785` | После merge/unmerge cells | **Да**: только эта таблица |
| 3 | `context-menu-cells.js:805` (`tableManager.renderAll`) | После cell-операции | **Да** |
| 4 | `context-menu-tree.js:409` | После добавления/удаления узла | **Да**: пересобрать поддерево родителя |
| 5 | `items-renderer.js:614` | Fallback в `renderSingleTable` если секция не найдена | Уже fallback, не критично |
| 6 | `storage-manager.js:215` | После restore из LS | Нет (полное восстановление) |
| 7 | `table-cells-operations.js:166` | insertRow / deleteRow | **Да**: только эта таблица + соседние таблицы не трогать |
| 8 | `table-cells-operations.js:242` | insertCol / deleteCol | **Да** |
| 9 | `table-cells-operations.js:359` | merge | **Да** |
| 10 | `table-cells-operations.js:446` | unmerge | **Да** |
| 11 | `table-cells-operations.js:508` | paste | **Да** |
| 12 | `table-cells-operations.js:572` | edit cell | **Да** (на самом деле — необязательно, текст уже в DOM) |
| 13 | `table-cells-operations.js:805` | header-toggle | **Да** |
| 14 | `table-cells-operations.js:870` | bulk operation | **Да** |
| 15 | `tree-drag-drop.js:323` | После drop | **Да**: только два поддерева (old parent + new parent) |
| 16 | `items-title-editing.js` (×3, неявные via PreviewManager.update) | Edit title | **Нет, уже не вызывают `renderAll`** (только update) |

**Из 18 вхождений ~14 можно вынести в per-node API.** Это «вариант B» из as-is §9.2.

---

## §B. Network waterfall (~72 скрипта)

### B.1 Реальное число

| Источник | Скриптов | Из чего |
|---|---|---|
| `templates/constructor/base_constructor.html` (прямые `<script src=`) | **72** | `grep -c "script src="` |
| `templates/constructor/constructor.html` | **0** | пуст |
| `templates/constructor/header/header.html` | **0** | только HTML, без скриптов |
| **Итого на странице конструктора** | **72** | |

Из 72 скриптов:
- **17** из `js/shared/*` (включая 11 чат-модулей + DOMPurify + AppConfig + auth + api + notifications + dialog-base + dialog-confirm)
- **57** из `js/constructor/*` (включая все state/tree/table/textblock/violation/validation/preview/header/dialog/items/context-menu/services + lock-manager + storage-manager + changelog-tracker + app + navigation-manager)
- **2** из `js/portal/acts-manager/*` (`team-member-search.js`, `dialog-create-act.js` — H2 из as-is, портальная связность)
- **1** из `vendor/dompurify/purify.min.js`

### B.2 Размеры (top-30 файлов)

| Файл | Bytes | КБ |
|---|---|---|
| `portal/acts-manager/dialog-create-act.js` | 57 642 | 56 |
| `constructor/dialog/dialog-invoice.js` | 47 717 | 47 |
| `shared/api.js` | 44 555 | 44 |
| `shared/chat/chat-renderer.js` | 43 366 | 42 |
| `constructor/state/state-tree.js` | 37 055 | 36 |
| `constructor/context-menu/context-menu-cells.js` | 34 636 | 34 |
| `constructor/table/table-cells-operations.js` | 34 477 | 34 |
| `constructor/items/items-renderer.js` | 33 476 | 33 |
| `shared/chat/chat-messages.js` | 33 264 | 32 |
| `portal/acts-manager/acts-manager-page.js` | 31 816 | 31 |
| `constructor/storage-manager.js` | 30 621 | 30 |
| `portal/acts-manager/dialog-audit-log.js` | 29 181 | 28 |
| `constructor/state/state-content.js` | 27 981 | 27 |
| `shared/app-config.js` | 26 055 | 25 |
| `constructor/table/table-sizes.js` | 25 468 | 25 |
| `constructor/header/acts-menu.js` | 24 654 | 24 |
| `constructor/tree/tree-renderer.js` | 22 383 | 22 |
| `constructor/lock-manager.js` | 22 149 | 22 |
| `constructor/state/state-core.js` | 21 426 | 21 |
| `shared/chat/chat-stream.js` | 20 402 | 20 |
| `shared/ck/ck-form.js` | 19 049 | 19 |
| `constructor/context-menu/context-menu-tree.js` | 18 575 | 18 |
| `constructor/textblock/textblock-links-footnotes.js` | 18 469 | 18 |
| `constructor/textblock/textblock-toolbar.js` | 15 871 | 16 |
| `constructor/table/table-core.js` | 15 175 | 15 |
| `constructor/violation/violation-core.js` | 15 109 | 15 |
| `shared/chat/chat-history.js` | 14 917 | 15 |
| `portal/acts-manager/version-preview.js` | 14 287 | 14 |
| `constructor/tree/tree-drag-drop.js` | 14 275 | 14 |
| `constructor/app.js` | 14 022 | 14 |
| **Всего в `static/js/`** | **1 259 335** | **1 230 КБ** |

На страницу конструктора попадают не все — `ck-*`, `portal-sidebar`, `portal-settings`, `admin/*`, `landing/*` не грузятся. Реально для конструктора: **~70 файлов ≈ 1 МБ исходников**.

При gzip (типовой ratio для JS ≈ 3–4×) — **~250–350 КБ по сети**. По объёму это **не катастрофа**, главная боль — **количество round-trips**, а не суммарный вес.

### B.3 HTTP/1.1 анализ

Прод деплой: nginx → Tornado (JupyterHub) → Tornado (Datalab) → uvicorn. Это **HTTP/1.1 повсюду** (HTTP/2 в этой цепочке не упомянут). Браузеры держат **6 параллельных коннектов на origin** при HTTP/1.1.

- Скриптов: **72**
- Параллельных коннектов: **6**
- Total round-trips: **⌈72/6⌉ = 12**
- Без `defer`/`async` (а у нас НЕТ ни одного `defer`/`async` в `base_constructor.html`) — скрипты блокируют HTML-парсинг последовательно

**Расчёт «второго белого экрана»** (от первого байта HTML до DOMContentLoaded):

| RTT | Время на 12 серий | + парсинг + execute |
|---|---|---|
| 20 мс (локальная сеть) | 240 мс | ~400–500 мс |
| 50 мс (JupyterHub в DC) | 600 мс | **~1 000–1 200 мс** |
| 100 мс (slow WAN) | 1 200 мс | **~2 000+ мс** |

Это **точно ощутимо**, и пользователи это ощущают как «открыл акт — секундная пауза, потом всё появилось». Под HTTP/2 (мультиплексирование) — 72 скрипта в одном TCP-коннекте — это **один RTT**, разница огромная.

**Дополнительно:** в `base_constructor.html` НИ ОДИН скрипт **не имеет `defer` или `async`**. Это означает, что каждый блокирует парсинг HTML. Можно безопасно поставить `defer` на 90% — но порядок выполнения сохранится (`defer` гарантирует execute order), а блокировку парсинга снимет.

### B.4 Что можно вынести в `defer`/`async` или удалить со страницы

| Файл | Use case на конструкторе | Можно `defer`? | Можно убрать? |
|---|---|---|---|
| `vendor/dompurify/purify.min.js` | Нужен только для чата | **Да, defer** | Нет (всё ещё нужен, но не на старте) |
| `shared/chat/*` (11 файлов, ~160 КБ суммарно) | Чат-popup лениво открывается | **Да, defer + lazy-init по клику** | Да: грузить **только** при первом open popup |
| `portal/acts-manager/team-member-search.js` | Меню «создать акт» из header | **Да, defer** | Можно: вынести в lazy chunk |
| `portal/acts-manager/dialog-create-act.js` | Тот же диалог | **Да, defer** | Можно: lazy |
| `constructor/dialog/dialog-invoice.js` (47 КБ) | Только при клике «приложить фактуру» в р.5 | **Да, defer** | Можно: lazy |
| `constructor/header/acts-menu.js` (24 КБ) | При открытии меню актов | **Да, defer** | Частично lazy |
| `portal/acts-manager/dialog-audit-log.js` | НЕ на конструкторе, только на acts-manager | — | **Можно убрать со страницы конструктора, если не используется** (проверить) |
| `constructor/preview/preview-*.js` (4 файла) | Только когда открыли side-preview | **Да, defer** | Можно: lazy при первом open |
| `constructor/validation/*` (5 файлов) | Только при save-and-export (клик кнопки) | **Да, defer** | Можно: lazy |
| `constructor/textblock/textblock-toolbar.js` | Только когда фокус в текстблоке | **Да, defer** | Можно: lazy при первом фокусе |
| Все остальные `constructor/*` | Нужны на старте | Можно `defer`, но не lazy | — |

**Грубая ROI оценка bundling**:
- Bundle 11 чат-модулей в один → **-10 round-trips** (с 12 до 10–11 — экономия не такая большая, чат сам по себе 11 файлов из 72)
- + lazy-load чата → **-11 файлов из стартовой загрузки** → **12 → 10 round-trips** + чат-init не блокирует DCL.
- + lazy-load invoice/dialog-create-act/preview/validation/audit-log → **-15 файлов** → **10 → 8 round-trips**.
- + defer на оставшиеся 50 → **парсинг HTML не блокируется**, DOMContentLoaded раньше.

**Реалистично можно срезать с ~12 RTT до ~6–7** + сделать парсинг неблокирующим. На RTT 50 мс это **500–700 мс экономии** на холодном старте.

---

## §C. CSS-загрузка

### C.1 Импорты в `constructor.css`

```
@import './shared.css';     -- который сам импортирует 14 файлов
+ 40 импортов constructor-специфичных
= ~55 фактически загружаемых CSS-файлов
```

Точный счёт:
- `static/css/entry/constructor.css` — **41 `@import`** (76 строк, минус комментарии и пустые)
- `static/css/entry/shared.css` — **14 `@import`** (29 строк)
- `static/css/entry/portal.css` — **15 `@import`** (36 строк)

**Браузер обрабатывает `@import` каскадно**: пока не загружен импорт-файл, парсер не знает, что внутри. Это означает **доп. round-trip per import-chain**. В худшем случае:
1. GET `constructor.css` → парсер видит `@import './shared.css'` → ещё GET → парсер видит 14 импортов → 14 GET → ...

В современных браузерах с HTTP/1.1 это вылазит в **+2–4 round-trips для CSS-цепочки**, что добавляет к §B.3 ещё **+100–200 мс**.

### C.2 Размер итогового CSS bundle

`find static/css -printf "%s"` = **395 792 байт ≈ 387 КБ**. После gzip типично **~70–90 КБ**.

Это **много для CSS** (для сравнения, Bootstrap CSS — ~25 КБ gzip). Скорее всего, в CSS есть много рассыпанной стилизации специфичных компонентов, которые не используются на конструкторе (но импортируются через `@import` каскад).

### C.3 Critical CSS — нет разделения

Поиск `inline <style>` в `base_constructor.html` — **0**. Весь CSS — внешний, blocking (без `media="print"` хака для async).

**Рекомендация:** для топ-секции (header, save-indicator, основные layout-blocks) можно собрать ~5 КБ inline critical CSS и поместить в `<head>`. Остальное оставить external. Это уберёт FOUC на медленных каналах.

---

## §D. localStorage I/O

### D.1 Объём типичного JSON состояния

`StorageManager._prepareStateForSaving()` (`storage-manager.js:450-464`) сохраняет:
- `AppState.treeData` — дерево из ~100–150 нод × ~200 байт/нода (с label, number, id, type, флаги) = **~20–30 КБ**
- `AppState.tables` — ~5 таблиц × (5×4 ячеек × ~100 байт content) = **~10 КБ**
- `AppState.textBlocks` — ~10 textblocks × ~2 КБ HTML/text = **~20 КБ**
- `AppState.violations` — ~5 violations × ~3 КБ полей = **~15 КБ**
- `AppState.tableUISizes` — мелочь, ~1 КБ
- мета — ~0.5 КБ

**Итого ~70 КБ JSON для типичного акта.** Для большого акта (200 нод, длинные textblocks) — **до 300 КБ**.

### D.2 Частота `setItem`

`StorageManager` (`storage-manager.js:392-395`):

```js
this._saveTimeout = setTimeout(() => {
    this.saveState(true);
}, AppConfig.localStorage.autoSaveDebounce);   // 1000 мс
```

При активном вводе пользователя `markAsUnsaved` дёргается на каждую запись Proxy-полей (`state-core.js:564`, autosaved-trigger). Debounce 1 сек собирает поток в **1 `setItem` в секунду** при непрерывном вводе. За минуту = **60 setItem'ов × 70 КБ = 4.2 МБ записи** в localStorage за минуту (главная цена — `JSON.stringify`).

**Цена одного цикла на main thread:**
- `JSON.stringify(70 КБ объекта)` ≈ **5–10 мс**
- `localStorage.setItem` ≈ **1–5 мс** (синхронный disk I/O в браузере)
- **Итого ~10–15 мс на цикл**, 1 раз в секунду — это **1.5% main thread**, незаметно отдельно, но в комбинации с `renderAll()` после удалённой операции вилки могут совпасть.

При большом акте (300 КБ JSON) — **30–60 мс на цикл**, 1 раз в секунду — это **5% main thread**, заметно при наборе.

### D.3 Квота и риски

- LS квота в браузерах: **5–10 МБ на origin** (Chrome 10 МБ, Firefox 10 МБ, Safari 5 МБ).
- Один акт ~70 КБ. **~70–140 актов поместится одновременно.**
- Но: `act_changelog_{actId}` (`changelog-tracker.js`, max 500 entries × ~100 байт = ~50 КБ/акт). С учётом — **~50–100 актов**.
- Также есть `auth_*`, `preview-menu-width`, `chat-*`, ChangelogTracker — суммарно еще десятки КБ.

`QuotaExceededError` уже обрабатывается (`storage-manager.js:435-439`), показывает Notification. Но **L6 из as-is**: `ChangelogTracker._saveChangelogToLocalStorage` молча проглатывает quota error — этот канал не уведомит пользователя.

### D.4 Что можно оптимизировать

1. **Дельта-сохранение** вместо целого state. Сохранять только изменённые ключи (`tables[X]`, конкретная нода) — снизить байты сериализации в 10–100 раз.
2. **`requestIdleCallback`** вместо `setTimeout` для serialize — даёт браузеру время на render-frame.
3. **`structuredClone` + WebWorker** для тяжёлых актов — `JSON.stringify` уйдёт с main thread.
4. **IndexedDB** вместо localStorage — асинхронный API, нет limit на ~10 МБ, объекты без сериализации. Но это бо́льшая работа.

---

## §E. Preview перерисовка

### E.1 Откуда триггерится rerender

**`app:state-changed` — мёртвый канал.** В `preview-menu.js:345-349`:

```js
document.addEventListener('app:state-changed', () => {
    if (window.previewMenuManager?.isOpen) {
        window.previewMenuManager.forceUpdate();
    }
});
```

`grep -rn "state-changed" static/js` — **0 emit'ов**. Этот listener не срабатывает никогда. **Это противоречит H6 из as-is** — там сказано «без throttle». На деле — без триггера вообще; preview-menu обновляется только через прямые вызовы `PreviewManager.update(...)`.

### E.2 Прямые `PreviewManager.update()` — ~30 вызовов

Полный список:
```
app.js:77, 232
context-menu-cells.js:806
context-menu-tree.js:407
items-title-editing.js:110, 161, 289
table-cells-operations.js:64, 167, 243, 360, 447, 509, 573, 806, 871
textblock-core.js:61
textblock-editor.js:129
tree-drag-drop.js:320
violation-additional-content.js:39, 240
violation-core.js:70, 102, 211, 240, 257, 291, 306, 323
violation-drag-drop.js:172
```

**Это ~30 точек.** При активном редактировании textblock'а `update` вызывается **на каждую правку** (`textblock-editor.js:129`), при редактировании violation — **на каждое нажатие в textarea** (`violation-core.js:70, 102, 211`).

### E.3 Throttle через `requestAnimationFrame`

`PreviewManager.update` (`preview.js:14-26`):

```js
static update(options = {}) {
    ...
    requestAnimationFrame(() => {
        this._performUpdate(previewTrim);
    });
}
```

**Что даёт RAF:** батчит несколько вызовов до следующего кадра (16.67 мс при 60Hz). Если за 16 мс пришло 5 вызовов — выполнится один (или столько, сколько в очереди RAF, без коалесцирования). Это **не дедуплицирует** — каждый `update` ставит свой callback в очередь.

**Проверка:**

```js
requestAnimationFrame(cb);
requestAnimationFrame(cb);
// → cb выполнится 2 раза в следующем frame, не 1
```

Это значит, что **при потоке 100 правок в секунду — будет 100 callback'ов в RAF-очередь**, выполнятся все в течение нескольких кадров. Throttle есть **только по «не быстрее чем экран»**, не по «не больше N раз».

### E.4 Стоимость `_performUpdate`

`preview.js:40-50`:

```js
static _performUpdate(previewTrim) {
    const preview = document.getElementById('preview');
    preview.innerHTML = '';                       // [1] стирает всё
    this._renderTitle(preview);
    this._renderTree(preview, previewTrim);       // [2] рекурсивный обход всего дерева
    this._attachPreviewTooltips(preview);         // [3] +2 listener'а на каждый link/footnote
}
```

Стоимость ≈ как `renderAll()`, но **легче**: нет таблиц-cell-listener'ов, нет contentEditable, только текст + структура. Расчётно **~5–15 мс** для типичного акта.

**При потоке ввода в textblock:** 30 нажатий за секунду → 30 RAF callback'ов → **30 × 10 = 300 мс работы за 1 секунду = 30% main thread на preview только.** Это и есть H6.

### E.5 Что можно оптимизировать

1. **Дедупликация RAF**: один флаг `_pendingUpdate`, при `update()` проверять флаг, если есть — return.
2. **Debounce 150–300 мс** для preview во время ввода (`isTyping` детект).
3. **Per-node update** (как для `renderAll`) — `PreviewManager.updateNode(nodeId)` обновляет только секцию.
4. **`PreviewMenuManager` mention-only opt-in**: side-panel preview обновляется только когда открыт.

---

## §F. Event listeners — счётчик и leaks

### F.1 Полный счёт по `static/js/constructor/`

| Файл (top-10 по числу `addEventListener`) | addEvent |
|---|---|
| `dialog/dialog-invoice.js` | 23 |
| `header/acts-menu.js` | 13 |
| `header/settings-menu.js` | 11 |
| `header/preview-menu.js` | 11 |
| `violation/violation-rendering.js` | 9 |
| `violation/violation-core.js` | 9 |
| `textblock/textblock-editor.js` | 9 |
| `header/chat-popup.js` | 9 |
| `context-menu/context-menu-links-footnotes.js` | 9 |
| `tree/tree-renderer.js` | 8 |
| **Всего по constructor/** | **196** |

`removeEventListener` по constructor/: **31** — дисбаланс **6:1**.

### F.2 Passive листенеры

`grep -rn "passive" static/js/constructor` — **2 точки**:
1. `preview-menu.js:132` — `mousemove` для resize handle: `{passive: true}` ✓
2. `lock-manager.js:265` — `mousedown,keydown,scroll,touchstart` для activity tracking: `{passive: true}` ✓

**Везде остальное — без `passive`.** Особенно важно для:
- `scroll`-обработчиков (не нашёл явных, но в `acts-menu.js` могут быть прокручиваемые dropdown)
- `touchstart`/`touchmove` (важно на тач-девайсах, но в коде их единицы)

**Не критично сейчас** (большинство listener'ов на click/dblclick/contextmenu, которые непассивны по природе). Но при добавлении `wheel`/`scroll`/`touchmove` без `passive: true` — будет блокировать скролл-композитор.

### F.3 «Leakable» listener'ы

#### F.3.1 `tableManager.attachEventListeners` — переподключение без cleanup

`table-core.js:70-149`:
- На каждый renderAll вызывается **заново**.
- Старые ячейки удаляются из DOM (через `innerHTML = ''`) — handler'ы GC'ятся вместе с узлами.
- Новые ячейки получают свежие click/dblclick/contextmenu/mousedown.
- **Нет утечки, есть дороговизна:** 480 свежих addEventListener при каждом renderAll (см. §A).

#### F.3.2 `LockManager._setupActivityTracking` (`lock-manager.js:261`)

H4 из as-is. На странице один LockManager, листенеры на document. На этой версии (без SPA re-init) утечки нет.

#### F.3.3 `_setupTitleEditing` (items-renderer.js:166)

```js
static _setupTitleEditing(textSpan, node) {
    let clickCount = 0;
    let clickTimer = null;
    textSpan.addEventListener('click', () => {...});
}
```

Closure захватывает `clickCount`/`clickTimer`/`node`. **Утечки нет** (textSpan удаляется при innerHTML='' → handler GC). Но: **80 свежих closure'ов на каждый renderAll**, каждый ~200 байт памяти = **+16 КБ GC pressure**.

#### F.3.4 Preview tooltip listener'ы (`preview.js:236-244`)

```js
elements.forEach(element => {
    element.addEventListener('mouseenter', () => {...});
    element.addEventListener('mouseleave', () => {...});
});
```

Переподключаются на каждый `_performUpdate`. По N ссылок/сносок в акте. **~10–30 listener'ов на каждое обновление preview**, не критично.

#### F.3.5 `ChangelogTracker._debounceTimers` (M4 из as-is)

`changelog-tracker.js`. Map ключей без cleanup при срабатывании. При длинной сессии — десятки осиротевших ключей с null-значениями. Память микроскопическая, но симптом неаккуратности.

### F.4 Сводно по leaks

| Канал | Реальный leak? | Стоимость на renderAll |
|---|---|---|
| `tableManager.attachEventListeners` | Нет (GC) | **+480 addEventListener** |
| `_setupTitleEditing` | Нет (GC) | **+80 closures, +80 listeners** |
| Preview tooltip | Нет (GC) | **+10–30 listeners** на каждый PreviewManager.update |
| LockManager activity | Нет на этой версии | — |
| ChangelogTracker timers | Микро-утечка | — |

**Главная боль не leak, а постоянное пересоздание handler'ов.** Per-node update снимет это автоматически.

---

## §G. Memory leaks (static analysis)

### G.1 Map/Set без cleanup

`grep -rnE "new (Map|Set)\(" static/js/constructor`:
- `violation/violation-core.js:11` — `this.activeViolations = new Map();` (per-violation state) — **возможный leak** если violation удаляется, а ключ остаётся в Map. Надо проверить.
- `table/table-sizes.js:200` — `affectedCells = new Map()` — локальная переменная функции, GC'ится. ОК.
- `textblock/textblock-toolbar.js:148` — `new Set()` локальный. ОК.
- Остальные — локальные в функциях.

**Главный кандидат:** `ViolationManager.activeViolations` — если при удалении violation узла из дерева в Map остаётся запись, при долгих сессиях — рост памяти. Проверить через `delete this.activeViolations[violationId]` в `ViolationManager.removeViolation`.

### G.2 Closures с большими захватами

В `static/js/constructor/storage-manager.js`:

```js
this._saveTimeout = setTimeout(() => {
    this.saveState(true);
}, ...);
```

Closure захватывает `this` (StorageManager class) → весь модуль. Это не leak, это паттерн. Но: если `clearTimeout` не вызывается, и timeout повторяется — handler в очереди удерживает ссылку.

В `lock-manager.js`: setInterval'ы для inactivity-check и auto-extend живут всё время страницы — это by design.

### G.3 Timer без `clear` (соотношение setTimeout:clearTimeout)

По данным грепа:
- `storage-manager.js`: 6 setTimeout / 5 clearTimeout — баланс почти есть
- `lock-manager.js`: 5 setTimeout/setInterval / 8 clearTimeout/clearInterval — есть cleanup
- `items-renderer.js`: 5 setTimeout / 2 clearTimeout — **дисбаланс**: `_restoreTableSizes`/`_restoreSingleTableSizes`/`_setupTitleEditing` создают timer'ы, которые не очищаются явно
- `dialog-invoice.js`: 5 setTimeout / 0 clearTimeout — все на анимации, не критично
- `textblock-links-footnotes.js`: 4 / 1 — потенциальные осиротевшие timer'ы tooltip'ов

**Не leak в строгом смысле** (timer выполнится один раз и забудется), но при быстрых сменах состояния — могут срабатывать «уже неактуальные» callback'и (см. H7 в as-is: магический `setTimeout(50)` в context-menu-cells).

### G.4 DOM-ссылки в JS

`static/js/constructor/header/preview-menu.js`:
```js
window.previewMenuManager = new PreviewMenuManager();
```

Менеджеры держат ссылки на DOM-элементы (`this._panel`, `this._handle`, etc.). При удалении DOM (например при route change в SPA) ссылки сохраняются. Сейчас не SPA, не проблема.

`ItemsRenderer` — статический, без ссылок на удаляемые DOM. ОК.

### G.5 Сводно по leaks

- **Реальных runtime leak'ов в обычном single-act flow — НЕТ.**
- **Скрытая память:** ~16 КБ GC pressure на каждый renderAll из-за closures + 480 listener-объектов.
- **Уязвимости** появятся, если кто-то добавит SPA-навигацию между актами без перезагрузки страницы — тогда listener'ы LockManager, Map в ViolationManager, DOM-ссылки в менеджерах превратятся в реальные leak.

---

## §H. Re-paint / re-flow триггеры

### H.1 Прямые `style.X = ...`

Top-3 по числу прямых style assigns:
- `table/table-sizes.js`: **60** — здесь оправдано, это resize handles с `dragstart`/`dragmove`. Нужны прямые px-значения.
- `header/chat-popup.js`: **10** — popup positioning, оправдано (динамика по drag).
- `table/table-cells-operations.js`: **9** — позиционирование editor над ячейкой.
- `items-renderer.js`: **8** — в `_createTableTitle` (`Object.assign(tableTitle.style, {...})` — батч). **Не критично**.
- `header/preview-menu.js`: **8** — drag-resize side panel.

**Всё остальное — точечные позиционирования меню/dropdown/tooltip**, в основном при mouse-событиях. Не критично.

**Лучшая практика:** использовать CSS-классы для статических состояний, прямые style только для динамики (drag, animations). В целом код этому следует.

### H.2 Forced sync layout

`grep -rcE "offsetWidth|offsetHeight|getBoundingClientRect"`:
- `table/table-sizes.js`: **11** — измерения для resize ячеек, неизбежно
- `tree/tree-core.js`: **4**
- `tree/tree-drag-drop.js`: **3** — для drop zone calc
- `header/preview-menu.js`: **2** — измерения для drag
- `items-renderer.js`: **2** — в `_showTbDropdownInItems` (positioning of dropdown)
- `header/chat-popup.js`: **2** — popup positioning

**Главная опасность forced layout** — паттерн «измерил → записал → снова измерил» в цикле. По grep'у не видно явных циклов. Большинство — одно `getBoundingClientRect` → `style.left = ...` → следующий элемент. Это нормально.

**Точка для verify:** `table/table-sizes.js:200+` — `affectedCells` Map с layout-чтениями в цикле resize'а. Под `mousemove` это срабатывает 60×/сек, важно чтобы измерения и записи не чередовались.

### H.3 `innerHTML = ''` — главный re-paint trigger

- `items-renderer.js:17` — в `renderAll()`
- `preview.js:45` — в `_performUpdate()`
- `tree-renderer.js` — в `render()` (по as-is §3)

Это **массовый layout invalidate + paint**. Каждый вызов = 5–30 мс на сложной странице.

---

## §I. LCP — анализ

### I.1 Что блокирует первый paint конструктора

На странице конструктора в шаге 1:
- `treeContainer` (tree panel слева)
- `preview` (preview div справа, основной для step1)

**Самые тяжёлые блоки рендера:**
1. **`TreeRenderer.render()`** — рендерит всё дерево узлов сразу (~100–150 нод × ~5–10 createElement каждая ≈ **600–1 500 DOM операций**). Это LCP-блокер для шага 1.
2. **`PreviewManager.update()`** — рендерит preview. Стоимость ~5–15 мс. Менее весомо.

В шаге 2:
1. **`ItemsRenderer.renderAll()`** — описано в §A. ~15–40 мс.

### I.2 Lazy-load кандидаты для уменьшения LCP

| Что | Когда нужно | Текущая загрузка |
|---|---|---|
| Чат-popup | Только при первом клике в чат | Eager (все 11 файлов + DOMPurify на старте) |
| Invoice dialog | Только в р.5 при «приложить фактуру» | Eager (47 КБ) |
| Audit-log dialog | Только на acts-manager, **не на конструкторе** | **Лишний на конструкторе** (если действительно не используется — H/M-флаг) |
| Validation модули (5 файлов) | Только при save-and-export | Eager |
| Help dialog | Только при клике help-btn | Eager |
| Settings menu | Только при клике в шестерёнку | Eager |
| Preview side-panel (4 preview-renderer файла) | Только при открытии preview-menu | Eager |
| Textblock toolbar (~16 КБ) | Только при фокусе в textblock | Eager |
| Violation file-upload | Только при drop файла в violation | Eager |

**Если вынести всё перечисленное в lazy** — стартовый bundle уменьшится примерно на **30 файлов из 72** → **с 12 RTT до ~7 RTT** → **300–500 мс быстрее DOMContentLoaded**.

### I.3 LCP-оптимизация — короткая формула

1. **Critical CSS inline (~5 КБ)** для header + основных layout-блоков.
2. **`defer` на все 72 скрипта** (по умолчанию все блокирующие).
3. **Lazy чат-popup**: грузить 11 модулей по первому клику.
4. **Lazy invoice/help/settings/validation/preview-side**: dynamic import по первому open.
5. **Bundle оставшиеся ~30 core-модулей в 3–5 файла** (логически: state, tree, table, items, app+navigation).

Реально это **переход на vite/esbuild с минимальной перестройкой исходников** — пишет on top существующего vanilla JS.

---

## §J. Chat SSE стоимость

### J.1 SSE-стрим — частота событий

`shared/chat/chat-stream.js:208-209`:

```js
const reader = response.body.getReader();
const decoder = new TextDecoder('utf-8');
```

Это **manual SSE parsing** через fetch + Reader (а не `EventSource`). Поток `block_delta` для reasoning/text/code:

- Типичный LLM (Qwen, GigaChat) выдаёт **~20–60 tokens/sec** в streaming-режиме.
- Каждый token ≈ 1 SSE-event = **20–60 событий/сек**.
- На каждое событие — `ChatRenderer.appendBlock` (см. §J.2).

### J.2 `ChatRenderer.appendBlock` — стоимость

`shared/chat/chat-renderer.js` (1006 строк) — main renderer. Точечные операции:
- Поиск элемента по `data-block-id` (querySelector)
- Либо createElement + insertBefore (новый блок), либо update `textContent` (delta)
- DOMPurify санитизация для markdown blocks

Для `text/reasoning/code` delta'ов это **~0.2–0.5 мс на событие** (одно textContent +=).
Для нового `block_start`/`block_complete` — **~1–2 мс** (createElement + parse markdown).

**При 30 событий/сек стриминга** — **6–15 мс/сек main thread на чат**. Это **1–2% CPU**, незаметно — пока не происходит одновременно с renderAll/storage-save.

### J.3 SSE bottleneck

Под HTTP/1.1 SSE/POST занимают **1 коннект из 6**. При активных concurrent fetch'ах (POST `/messages` + Resume GET `/forward-stream/{rid}`) — **2 коннекта одновременно для чата**. Из 6 для страницы остаётся 4. При первой загрузке (72 скрипта в очередь) — чат-init может задержать другие resources.

### J.4 Что можно оптимизировать в чате

1. **Bundle 11 chat-файлов** в один — это уже даёт `-10 RTT` (см. §B.4).
2. **Lazy init** — модули не нужны до первого open popup.
3. **Throttle SSE rendering**: вместо «событие → render», batch'ить за `requestAnimationFrame` (1 render/frame максимум). Сейчас, видимо, нет.
4. **Web Worker для DOMPurify** на больших markdown'ах (для агента-ответов с длинным текстом).

---

## §K. Рекомендации в порядке ROI

### K.1 Quick wins (1–3 дня, низкий риск)

1. **`defer` на все 72 `<script>`** в `base_constructor.html`. Парсинг HTML не блокируется, порядок выполнения сохраняется. **Экономия: ~200–400 мс на DCL**, риск минимальный (порядок выполнения не меняется).
2. **`{passive: true}` на mouse/scroll/touch listener'ы** где не нужен `preventDefault`. **Экономия: jank при скроллинге, особенно на тач-девайсах.** Audit ~20 точек в `table/`, `tree/`, `header/`.
3. **Дедупликация RAF в `PreviewManager.update`**: `_pendingUpdate` флаг. **Экономия: 30→1 callback при потоке ввода в textblock = ~290 мс сэкономлено за каждую секунду активного набора.**
4. **Удалить мёртвый `app:state-changed` listener** в `preview-menu.js:345-349`. Никто не emit'ит. **Это микро-cleanup, но снимает confusion.**
5. **`AppConfig.preview.debounce` 150 мс** для preview-вызовов при typing-flow (textblock-editor / violation-core). **Экономия: ~80% преview-вызовов** при наборе.

### K.2 Medium wins (1 неделя, средний риск)

6. **Lazy-load chat-popup**: 11 файлов + DOMPurify грузятся только при первом клике в чат. **Экономия: ~150 КБ из стартового bundle + 1 RTT в HTTP/1.1 chain.** Риск: нужно правильно ждать init перед первым sendMessage.
7. **Lazy-load invoice dialog / help / audit-log**: dynamic `<script>` insert по первому open. **Экономия: ~80 КБ + 2–3 RTT.** Риск низкий.
8. **Дельта-сериализация для localStorage**: сохранять только дифф-ключи. **Экономия: 70 КБ → 5–10 КБ JSON.stringify = 10× быстрее.** Риск: нужно правильно восстанавливать на refresh.
9. **`requestIdleCallback` для `saveState`** вместо `setTimeout`. **Не блокирует frame.**

### K.3 Big wins (2+ недель, высокий риск, большой return)

10. **`ItemsRenderer.updateNode(nodeId)` per-node API** (вариант B из as-is §9.2). **Экономия: 15–40 мс → 0.1–5 мс на типовое изменение** (10–300×). Это **главный архитектурный долг**. Требует:
    - id-based addressing (`data-node-id` + Map nodeId→DOM)
    - 14 call-site миграций
    - Playwright smoke-тесты (сейчас 0 JS-тестов, см. §8.1 as-is)
11. **Bundle всех `static/js/` через esbuild/vite**: 72 файла → 3–5 chunks (core, vendor, chat, dialogs, validation). **Экономия: 12 RTT → 2–3 RTT под HTTP/1.1 = 500–900 мс на холодном старте.**
12. **HTTP/2 на JupyterHub-proxy** (если возможно — другая зона). **Один RTT для всех 72 файлов.** Из-под Tornado-Tornado сложно, но nginx → может.

### K.4 Дополнительные note'ы

- **Cache-busting** (8.3 as-is) — Ctrl+F5 после деплоя бесит пользователей. **5-минутная правка**, `?v={app_version}`.
- **WebWorker для JSON.stringify** больших актов — если дельта-сериализация (K.2#8) не зашла.
- **IndexedDB** вместо localStorage — async, нет квота-боли. **Большая работа**, оправдана только при росте сложности.

---

## Аппендикс: что **не покрыто** этим аудитом

- **Реальный профайл** под Chrome DevTools Performance / Lighthouse. Все цифры — расчётные.
- **Сетевой профайл** под фактическим RTT и bandwidth JupyterHub. Деплой может оказаться или быстрее, или медленнее моих оценок.
- **Memory snapshot** в течение длинной сессии (1+ час). Подтвердит/опровергнет G.1 (`ViolationManager.activeViolations` leak).
- **Реальная частота `markAsUnsaved`** при активном вводе — нужен trace для подтверждения D.2.
- **Стоимость chat-renderer на длинных markdown'ах** — нужен профайл с реальным LLM-response.
- **Server-side render cost** — не наш аудит, бэкенд.

Всё перечисленное — **обязательная верификация** перед фиксом любого пункта §K. «Зацени, как код выглядит» — это **не профайл**.
