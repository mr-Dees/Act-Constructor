# Справочник по модели данных акта (`tree_data` и связанные сущности)

Документ описывает структуру содержимого акта аудита, которым оперирует фронт-редактор и которое сохраняется в БД. Это руководство для разработчика, впервые подходящего к доменy `acts`: какие поля хранятся в `tree_data`, как они связаны с денормализованными таблицами и какие правила инвариантности должна соблюдать клиентская сторона.

Все артефакты исходят из реальных файлов проекта — где это важно, в тексте указаны ссылки `путь:строка`.

---

## 1. Введение

**Что такое `tree_data`.** Это JSONB-документ с иерархической структурой акта. Хранится в таблице `act_tree` (одна запись на акт, см. `app/domains/acts/migrations/postgresql/schema.sql:136-147`). Корневой узел `{id: "root", label: "Акт", children: [...]}` — пять защищённых разделов (1–5), а в `children` — пункты, подпункты, таблицы, текстовые блоки и нарушения. Если запись отсутствует, репозиторий возвращает пустой каркас `{"id": "root", "label": "Акт", "children": []}` (`app/domains/acts/repositories/act_content.py:107-115`).

**Где живёт всё остальное содержимое.** Дерево хранит только структуру и ссылки. Тяжёлые данные вынесены в отдельные таблицы:

| Таблица           | Что хранит                                                                  | Ссылка из дерева             |
|-------------------|-----------------------------------------------------------------------------|------------------------------|
| `act_tree`        | сам JSONB `tree_data`                                                       | сам корень                    |
| `act_tables`      | сетки таблиц (`grid_data`), ширины колонок, флаги спец-таблиц                | `node.tableId`               |
| `act_textblocks`  | HTML-контент текстовых блоков и базовое форматирование                       | `node.textBlockId`           |
| `act_violations`  | поля нарушения (нарушено, установлено, причины, последствия, рекомендации…) | `node.violationId`           |
| `act_invoices`    | фактуры, прикреплённые к листьям раздела 5                                   | `node.invoice` + `node.id`   |
| `act_directives`  | поручения по пунктам акта                                                    | `node_id`                    |
| `acts`            | метаданные акта (КМ, СЗ, даты, блокировка, audit_act_id и т.д.)             | владелец всех остальных      |

**API между фронтом и бэком.**

- На загрузку: `ActContentRepository.get_content(act_id)` возвращает `{tree, tables, textBlocks, violations}` (`app/domains/acts/repositories/act_content.py:41-61`). Фактуры подмешиваются в `node.invoice` фронт-кодом `APIClient._attachInvoicesToTree` (`static/js/shared/api.js:602-626`).
- На сохранение: фронт отдаёт `ActDataSchema` (`app/domains/acts/schemas/act_content.py`) — те же четыре раздела + `invoiceNodeIds`, `changelog`, `saveType`. Единую плоскую транзакцию (контент + diff аудита + снимок версии) держит сервис `ActContentService.save_content`; репозиторий собственную транзакцию не открывает (контракт в его докстринге). `_save_tree` UPDATE-ит JSONB, остальные секции делают `DELETE … WHERE act_id` + `executemany INSERT`.

Денормализация (дублирование `node_number`, `audit_point_id`, `audit_act_id` в `act_tables`/`act_textblocks`/`act_violations`/`act_invoices`) нужна для BI/выгрузок и поиска. Источник истины — `tree_data`; при сохранении бэк рассчитывает `node_map` и `audit_point_map` единым обходом дерева (`act_content.py:197-238`) и проставляет денормализованные поля.

---

## 2. Корневая структура

Тело `ActDataSchema` — четыре основных раздела + служебные поля:

```jsonc
{
  "tree":          { /* корневой узел: {id:"root", label:"Акт", children:[…]} */ },
  "tables":        { "<tableId>":     TableSchema,     … },
  "textBlocks":    { "<textBlockId>": TextBlockSchema, … },
  "violations":    { "<violationId>": ViolationSchema, … },
  "invoiceNodeIds": ["<nodeId>", …],
  "changelog":     [ /* гранулярный лог локальных изменений */ ],
  "saveType":      "manual" | "periodic" | "auto"
}
```

Pydantic-описание: `ActDataSchema` (`app/domains/acts/schemas/act_content.py:319-358`). Поле `saveType` валидируется по regex `^(manual|periodic|auto)$`.

**Ссылочная целостность (на app-уровне).** Жёсткой FK между узлами и `act_tables`/`act_textblocks`/`act_violations` нет (всё перезаписывается одной транзакцией). Связь идёт по `id` контейнера и `nodeId` узла:

- Узел `type=table` имеет `tableId`, соответствующая запись в `tables[tableId]` обязательна (кросс-валидатор `ActDataSchema` отклоняет висячую ссылку 422), `tables[tableId].nodeId === node.id`.
- Аналогично для `type=textblock` (`textBlockId` ↔ `textBlocks[id]`) и `type=violation` (`violationId` ↔ `violations[id]`).
- Записи в `tables`/`textBlocks`/`violations` без соответствующего узла-носителя в БД не попадают: orphan-фильтр репозитория отбрасывает их при сохранении (с warning-логом) для всех трёх словарей. Фронт дополнительно чистит сирот при удалении узлов (`_deleteNodeData` в `state-tree.js`).
- `invoiceNodeIds` — плоский список ID узлов, у которых на фронте проставлено `node.invoice`. По нему бэк синхронизирует `act_invoices`: всё, чего нет в списке, удаляется (`act_content.py:396-433`).

---

## 3. Node-типы

Pydantic-описание узла дерева — `ActItemSchema` (`app/domains/acts/schemas/act_content.py:278-316`). Поле `type` ограничено `Literal["item", "textblock", "violation", "table"]`. С точки зрения семантики узлы делятся на две группы:

- **Item-узлы** (`type="item"`, либо отсутствие `type` — фронт трактует это как `item`, см. `state-core.js:365`) — структурные пункты. Могут иметь `children`.
- **Content-узлы** (`type="table" | "textblock" | "violation"`) — «информационные» узлы по фронт-терминологии (`tree-utils.js:225-228`). У них не должно быть `children` (drag-and-drop запрещает делать их родителями: `canAcceptAsChild`, `tree-drag-drop.js:142-146`).

Сводная таблица обязательности полей. «—» означает «не используется/не имеет смысла».

| Поле                  | item                 | table                | textblock            | violation            | Описание                                                                                       |
|-----------------------|----------------------|----------------------|----------------------|----------------------|------------------------------------------------------------------------------------------------|
| `id`                  | обяз.                | обяз.                | обяз.                | обяз.                | уникальный ID узла в пределах дерева                                                            |
| `label`               | обяз.                | обяз.                | обяз.                | обяз.                | отображаемый текст                                                                              |
| `type`                | опц. (`"item"` или отсутствует) | `"table"`     | `"textblock"`        | `"violation"`        | дискриминатор; для `item` фронт допускает отсутствие                                            |
| `children`            | список               | пусто/отсутствует    | пусто/отсутствует    | пусто/отсутствует    | дочерние узлы (рекурсивная схема)                                                               |
| `content`             | строка               | —                    | —                    | —                    | текстовое содержимое пункта (для item; для content-узлов фронт пишет туда `""`)                |
| `tableId`             | —                    | обяз.                | —                    | —                    | FK на `tables[tableId]`                                                                         |
| `textBlockId`         | —                    | —                    | обяз.                | —                    | FK на `textBlocks[id]`                                                                          |
| `violationId`         | —                    | —                    | —                    | обяз.                | FK на `violations[id]`                                                                          |
| `number`              | опц.                 | опц.                 | опц.                 | опц.                 | автогенерируется фронтом: для item — иерархия (`5.1.2`), для content — `"Таблица N"` и т.п. (`state-tree.js:36-67`) |
| `customLabel`         | опц.                 | опц.                 | опц.                 | опц.                 | пользовательское название (приоритет над автоматическим)                                        |
| `protected`           | опц., default false  | опц., default false  | опц., default false  | опц., default false  | защита от перемещения и удаления (для разделов 1–5: `true`)                                     |
| `deletable`           | опц., default true   | опц., default true   | опц., default true   | опц., default true   | разрешено ли удаление; работает независимо от `protected`                                       |
| `isMetricsTable`      | —                    | опц., default false  | —                    | —                    | таблица метрик для пункта `5.X` (см. §6)                                                       |
| `isMainMetricsTable`  | —                    | опц., default false  | —                    | —                    | главная сводная таблица метрик раздела 5                                                        |
| `tb`                  | опц., только под 5.* | —                    | —                    | —                    | массив аббревиатур территориальных банков (см. `AppConfig.territorialBanks`, `app-config.js:16-28`) |
| `invoice`             | опц., только под 5.* | —                    | —                    | —                    | прикреплённая фактура (см. §7); НЕ сериализуется бэкендом, существует только во фронт-объекте  |
| `auditPointId`        | опц.                 | опц.                 | опц.                 | опц.                 | UUID точки аудита, выданный внешним сервисом (`AuditIdService`, `services/id-generator.js`)    |
| `parentId`            | runtime-only         | runtime-only         | runtime-only         | runtime-only         | техническое поле фронта; в сериализованный `tree_data` не попадает напрямую                     |

Замечания:

- Поля `isMetricsTable`/`isMainMetricsTable` дублируются в `node` (для быстрого определения «закреплённости» без обращения к `tables`) и в `tables[tableId].isMetricsTable`/`isMainMetricsTable` (для денормализованной выгрузки в `act_tables`). Согласованность поддерживает фронт.
- `isRegularRiskTable` / `isOperationalRiskTable` НЕ хранятся в `node` — только в `tables[tableId]`. Проверка «является ли узел risk-таблицей» делается через lookup в `AppState.tables` (`tree-utils.js:309-317`).
- В сохранённом дереве `_serializeTree` (`state-core.js:361-391`) форсирует `protected` и `deletable` к булевым значениям и взаимоисключает `content` ↔ `tableId/textBlockId/violationId` (content пишется только для item-узлов).

### 3.1. Подсхемы вложенных сущностей

`TableCellSchema` (`act_content.py:13-34`) — ячейка матричной таблицы:

| Поле          | Тип / default       | Назначение                                                                                       |
|---------------|---------------------|--------------------------------------------------------------------------------------------------|
| `content`     | str, default `""`   | текстовое содержимое ячейки                                                                       |
| `isHeader`    | bool, default false | признак заголовка                                                                                 |
| `colSpan`     | int ≥ 1, default 1  | горизонтальный span                                                                               |
| `rowSpan`     | int ≥ 1, default 1  | вертикальный span                                                                                 |
| `isSpanned`   | bool, default false | признак ячейки, скрытой под объединением                                                          |
| `spanOrigin`  | `{row,col}` или null| координаты «главной» ячейки объединения                                                           |
| `originRow`   | int ≥ 0 / null      | строка, где была создана ячейка                                                                   |
| `originCol`   | int ≥ 0 / null      | колонка, где была создана ячейка                                                                  |

`TableSchema` (`act_content.py:37-139`):

| Поле                      | Тип / default                | Назначение                                                                                              |
|---------------------------|------------------------------|---------------------------------------------------------------------------------------------------------|
| `id`                      | str (обяз.)                  | ID таблицы (ключ в `tables`)                                                                            |
| `nodeId`                  | str (обяз.)                  | ID узла-носителя                                                                                        |
| `grid`                    | `list[list[TableCellSchema]]`, max 64 строк, ≤ 16 колонок в каждой | матрица ячеек; ограничение защищает от исчерпания памяти |
| `colWidths`               | `list[int]`, max 16, все > 0 | относительные веса ширины колонок (DOCX-билдер нормирует по сумме; редактор рендерит colgroup в %)        |
| `protected`               | bool, default false          | защита от изменения структуры (добавление/удаление строк/колонок)                                       |
| `deletable`               | bool, default true           | можно ли удалить таблицу                                                                                |
| `isMetricsTable`          | bool, default false          | таблица метрик пункта `5.X`                                                                             |
| `isMainMetricsTable`      | bool, default false          | главная сводная таблица раздела 5                                                                       |
| `isRegularRiskTable`      | bool, default false          | таблица регулярных рисков                                                                               |
| `isOperationalRiskTable`  | bool, default false          | таблица операционных рисков                                                                             |

`TextBlockFormattingSchema` (`act_content.py:142-165`):

| Поле        | Тип / default                          | Назначение                                  |
|-------------|-----------------------------------------|---------------------------------------------|
| `fontSize`  | int 8–72, default 14                    | базовый размер шрифта                       |
| `alignment` | `"left" | "center" | "right" | "justify"`, default `"left"` | выравнивание                                |
| `bold`      | bool, default false                     | жирный                                      |
| `italic`    | bool, default false                     | курсив                                      |
| `underline` | bool, default false                     | подчёркивание                                |

`TextBlockSchema` (`act_content.py:168-184`):

| Поле          | Тип / default                              | Назначение                                                            |
|---------------|---------------------------------------------|-----------------------------------------------------------------------|
| `id`          | str                                         | ID блока                                                              |
| `nodeId`      | str                                         | ID узла-носителя                                                       |
| `content`     | str, default `""`                           | HTML с inline-форматированием                                          |
| `formatting`  | `TextBlockFormattingSchema`                 | базовые параметры                                                      |

`ViolationSchema` (`act_content.py:232-275`) — нарушение, прикреплённое к узлу:

| Поле                  | Тип                                       | Назначение                                                  |
|-----------------------|-------------------------------------------|-------------------------------------------------------------|
| `id`                  | str                                       | ID нарушения                                                 |
| `nodeId`              | str                                       | ID узла-носителя                                             |
| `violated`            | str, default `""`                         | секция «Нарушено»                                            |
| `established`         | str, default `""`                         | секция «Установлено»                                         |
| `descriptionList`     | `ViolationDescriptionListSchema`          | `{enabled: bool, items: list[str]}`                          |
| `additionalContent`   | `ViolationAdditionalContentSchema`        | `{enabled: bool, items: list[ViolationContentItemSchema]}`   |
| `reasons`             | `ViolationOptionalFieldSchema`            | `{enabled: bool, content: str}`                              |
| `consequences`        | `ViolationOptionalFieldSchema`            | `{enabled: bool, content: str}`                              |
| `responsible`         | `ViolationOptionalFieldSchema`            | `{enabled: bool, content: str}`                              |
| `recommendations`     | `ViolationOptionalFieldSchema`            | `{enabled: bool, content: str}`                              |

`ViolationContentItemSchema` (`act_content.py:204-223`) — элемент additionalContent:

| Поле       | Тип                                | Назначение                                |
|------------|------------------------------------|-------------------------------------------|
| `id`       | str                                | ID элемента                               |
| `type`     | `"case" | "image" | "freeText"`    | тип                                       |
| `content`  | str, default `""`                  | текст (для `case`, `freeText`)            |
| `url`      | str, default `""`                  | URL изображения (для `image`)             |
| `caption`  | str, default `""`                  | подпись изображения                       |
| `filename` | str, default `""`                  | имя файла                                 |
| `order`    | int ≥ 0                            | порядок отображения                       |
| `width`    | int 0–100, default `0`             | ширина картинки, % полезной ширины листа (0 = авто: натуральный размер с потолком по ширине) |

---

## 4. Pinned (закреплённые) узлы

**Что это.** Узлы, которые удерживаются в начале массива `children` родителя и не могут быть перетащены/смещены ниже обычных пунктов. Используется для спец-таблиц.

**Какие узлы считаются pinned.** Определение в `TreeUtils.isPinnedTable` (`static/js/constructor/tree/tree-utils.js:309-317`):

```js
isPinnedTable(node) {
    if (node.type !== 'table') return false;
    if (node.isMetricsTable || node.isMainMetricsTable) return true;
    if (node.tableId) {
        const table = AppState.tables[node.tableId];
        if (table && (table.isRegularRiskTable || table.isOperationalRiskTable)) return true;
    }
    return false;
}
```

То есть pinned — это:

1. таблицы метрик пункта `5.X` (`isMetricsTable`),
2. главная сводная таблица метрик раздела 5 (`isMainMetricsTable`),
3. таблицы регулярных рисков (`isRegularRiskTable` — поле в `tables[tableId]`),
4. таблицы операционных рисков (`isOperationalRiskTable` — поле в `tables[tableId]`).

**Правила сортировки.** Метод `AppState._getFirstNonPinnedIndex(parent)` (`state-tree.js:708-714`) ищет первый незакреплённый индекс в `children` родителя — это «нижняя граница» pinned-зоны. Используется в двух местах:

- При drag-and-drop: если `position === 'before'/'after'` указывает в pinned-зону, эффективный индекс прижимается вниз (`_performMove`, `state-tree.js:686-693`). Дополнительно `_calculateDropPosition` (`tree-drag-drop.js:226-240`) запрещает `'before'` на pinned-узле и блокирует `'after'` между двумя соседними pinned-таблицами.
- При создании risk-таблицы: вставляется через `splice(firstNonPinnedIdx, 0, tableNode)` (`state-content.js:594-596`, `state-content.js:629-631`).

Метрик-таблицы (`isMetricsTable`, `isMainMetricsTable`) создаются через `node.children.unshift(tableNode)` (`state-content.js:295`, `state-content.js:442`) — то есть всегда первыми. Если в `children` уже есть pinned-таблицы, новая всё равно встаёт нулевой; порядок между metrics и risk на одном уровне определяется временем создания.

---

## 5. Protected узлы

**Что это.** Узлы с флагом `protected: true`. Дополнительно у них может стоять `deletable: false` — это два независимых ограничения.

**Где задаётся.** Разделы 1–5 создаются защищёнными при инициализации дерева через `_createProtectedSection` (`state-core.js:70-79`):

```js
{
    id, label,
    protected: true,
    deletable: false,
    children: [],
    content: ''
}
```

Список разделов — `AppConfig.tree.defaultSections` (`app-config.js:262-268`): `1` «Информация о процессе, клиентском пути» (для непроцессной проверки — «Характеристика проверяемого направления»), `2` «Оценка качества…», `3` «Примененные технологии», `4` «Основные выводы», `5` «Результаты проверки» (`state-core.js:48-54`).

Помимо разделов, `protected: true` ставится фронт-кодом всем спец-таблицам (metrics, main metrics, regular risk, operational risk) и предустановленным таблицам разделов 2 и 3 (`state-core.js:97-107`, `state-content.js:292-310`, `state-content.js:439-457`, `state-content.js:593-611`, `state-content.js:629-647`).

**Что нельзя делать с protected-узлами:**

| Действие                  | Ограничение                                                                                     |
|---------------------------|--------------------------------------------------------------------------------------------------|
| Удаление                  | Если `deletable === false` — невозможно ни через UI, ни через `deleteNode` (`state-tree.js`). Разделы 1–5 имеют `deletable: false`. |
| Перемещение               | Drag запрещён в `_validateMove` (`state-tree.js:425-427`) и при `dragstart` (`tree-drag-drop.js:85-88`). |
| Изменение структуры таблицы | Для `protected: true` таблиц добавление/удаление строк и колонок блокируется в `table-cells-operations.js` (см. строки 310, 378, 527, 732, 827). |

`deletable` работает независимо: можно иметь `protected: true, deletable: true` (защищена от перемещения, но удалить можно) — такая комбинация встречается у спец-таблиц.

---

## 6. Spec-таблицы (metrics и risk)

### 6.1. Metrics-таблицы

**Цель.** Сводка отклонений по узлам раздела 5.

**Подтипы.**

- `isMetricsTable: true` — таблица метрик одного пункта `5.X`. Создаётся, когда в потомках узла `5.X` (т.е. на уровне `5.X.X+`) появляется хотя бы одна risk-таблица (`_updateMetricsTablesAfterRiskTableCreated`, `state-content.js:490-519`). Удаляется автоматически, когда последняя глубокая risk-таблица исчезает (`_cleanupMetricsTablesAfterRiskTableDeleted`, `state-content.js:526-576`).
- `isMainMetricsTable: true` — главная сводная для всего раздела 5. Создаётся при появлении ЛЮБОЙ risk-таблицы в дереве 5, удаляется при их полном отсутствии (та же функция).

**Структура `grid`.** Сетка 4×7 с двумя строками заголовков и двумя строками данных. Заголовки используют объединения (`colSpan`/`rowSpan`/`isSpanned`/`spanOrigin`) для группировки «Количество клиентов / элементов» (ФЛ/ЮЛ под общей шапкой) и «Сумма, руб.» / «Код БП» / «Пункт акта». Полный шаблон — `_createMetricsHeaderGrid` (`state-content.js`).

Схематично (rowSpan=2 — вертикальное объединение через две header-строки; colSpan=2 — горизонтальное в row 0):

```
┌───────────┬──────────────┬──────────────────────────────┬─────────────┬────────┬──────────────────┐
│ Код       │ Наименование │ Количество клиентов /        │ Сумма, руб. │ Код БП │ Пункт / подпункт │  ← row 0
│ метрики   │ метрики      │ элементов, ед.  (colSpan=2)  │             │        │ акта             │
│ (rowSpan  │ (rowSpan=2)  ├──────────────┬───────────────┤ (rowSpan=2) │ (rowS  │ (rowSpan=2)      │
│  =2)      │              │     ФЛ       │      ЮЛ       │             │  =2)   │                  │  ← row 1
├───────────┼──────────────┼──────────────┼───────────────┼─────────────┼────────┼──────────────────┤
│           │              │              │               │             │        │                  │  ← row 2 (данные)
├───────────┼──────────────┼──────────────┼───────────────┼─────────────┼────────┼──────────────────┤
│           │              │              │               │             │        │                  │  ← row 3 (данные)
└───────────┴──────────────┴──────────────┴───────────────┴─────────────┴────────┴──────────────────┘
   col 0        col 1          col 2           col 3           col 4       col 5         col 6
```

В коде ячейки-«дырки» под объединениями явно описаны как `isSpanned: true` с `spanOrigin: {row, col}` — это нужно для корректной отрисовки и редактирования (cм. `headerRow2` в `_createMetricsHeaderGrid`).

**Имя таблицы (`label`).** `"Объем выявленных отклонений (В метриках) по {nodeNumber}"` для `isMetricsTable` и `"Объем выявленных отклонений"` для `isMainMetricsTable`. При перенумерации узла `5.X` фронт обновляет label автоматически — `updateMetricsTableLabel` (`state-tree.js:102-115`).

**Ограничения.**

- Создаются только под разделом 5.
- Всегда `protected: true` (нельзя менять структуру), но `deletable: true` (фронт может убрать вместе с риском).
- Pinned: вставляются `unshift`'ом в начало `children` (см. §4).

### 6.2. Risk-таблицы

**Подтипы.**

- `isRegularRiskTable: true` — регулярные риски. Шаблон в `AppConfig.content.tablePresets.regularRisk` (см. `app-config.js`), создаётся через `_createRegularRiskTable` (`state-content.js:584-612`).
- `isOperationalRiskTable: true` — операционные риски. Шаблон 4×6, заголовки с объединениями, см. `_createOperationalRiskGrid` (`state-content.js:655-745`).

Флаги хранятся ТОЛЬКО в `tables[tableId]`, в `node` их нет. Чтобы понять, что узел — risk-таблица, нужно сделать lookup в `AppState.tables` (`_isRiskTable`, `state-tree.js:252-257`).

**Правила размещения.**

- Только под разделом 5 (любая глубина: `5.X`, `5.X.Y`, …).
- Все risk-таблицы в разделе 5 должны быть на ОДНОМ уровне глубины — либо все на уровне пунктов (`5.X`), либо все на уровне подпунктов (`5.X.Y+`), смешивать запрещено (`_checkSection5RiskConstraints`, `state-tree.js:596-662`).
- Pinned: вставляются через `splice` после всех остальных pinned-таблиц.
- Создание risk-таблицы триггерит ревизию metrics-таблиц (см. §6.1).
- Risk-таблицы **нельзя перетаскивать** — `dragstart` блокирует любую попытку, см. `_hasRiskTablesInSubtree` (`tree-drag-drop.js:91-95`). Это касается и перетаскивания узла-носителя, и перетаскивания пункта, содержащего risk-таблицу в любой ветке поддерева (исключение — перемещение в пределах раздела 5).

---

## 7. Invoice attachment (прикреплённые фактуры)

**Куда прикрепляются.** К листовым item-узлам под разделом 5 («TB-leaf»: item под `5.*` без дочерних item-узлов). Проверка: `TreeUtils.isTbLeaf` (`tree-utils.js:282-286`).

**Структура `node.invoice`.** Объект на узле, существующий ТОЛЬКО во фронт-объекте — в сериализованный `tree_data` он не попадает (см. `_serializeTree`, `state-core.js:361-391`). Содержимое (`dialog-invoice.js:1137-1144`, `api.js:611-619`):

```jsonc
{
  "db_type":     "hive" | "greenplum",
  "schema_name": "<имя схемы>",
  "table_name":  "<имя таблицы>",
  "metrics":     [ { "metric_type": "КС|ФР|ОР|РР|МКР", "metric_code": "...", "metric_name": "..." }, … ],  // 1..5 элементов, типы уникальны
  "process":     [ { "process_code": "...", "process_name": "..." }, … ] | null,
  "profile_div": "<подразделение>" | null
}
```

Валидация на бэке — `InvoiceSave` (`app/domains/acts/schemas/act_invoice.py:36-65`): `db_type` строгая литералка, `metrics` ровно 1–5 элементов с уникальными типами из множества `{КС, ФР, ОР, РР, МКР}` (`VALID_METRICS_TYPES`).

**Как привязывается.**

1. На фронте `InvoiceDialog._handleSave` отправляет POST `/api/v1/acts/invoices/save` через `APIClient.saveInvoice` и сразу проставляет `this._currentNode.invoice = {...}` (`dialog-invoice.js:1133-1145`).
2. На бэке создаётся/обновляется строка в `act_invoices` (`{SCHEMA}.{PREFIX}act_invoices`, схема в `migrations/postgresql/schema.sql:279-307`). `UNIQUE(act_id, node_id)` гарантирует одну фактуру на узел.
3. При следующем `save_content` бэк синхронизирует `act_invoices`: всё, что отсутствует в `data.invoiceNodeIds`, удаляется; для оставшихся обновляются `node_number`, `audit_act_id`, `audit_point_id` (`act_content.py:396-433`).
4. На загрузке акта `APIClient._attachInvoicesToTree` обходит дерево и навешивает `node.invoice` на узлы с прикреплёнными фактурами (`api.js:602-626`).

**Сборка `invoiceNodeIds` для отправки.** Фронт-функция `_collectInvoiceNodeIds` обходит дерево и собирает ID всех узлов с `node.invoice` (`state-core.js:345-353`). Это единственный канал, через который бэк узнаёт о привязках; самой структуры `invoice` бэк из дерева не читает.

**Чистка при перемещении.** Если узел уезжает за пределы раздела 5, `_clearInvoiceRecursive` стирает `invoice` у узла и всех потомков (`state-tree.js:382-386, 843-853`). Аналогично при добавлении ребёнка к TB-leaf — родитель перестаёт быть листом, и его `invoice` удаляется (`state-tree.js:147-150`).

**Дополнительные denormalized-поля в `act_invoices`.** `verification_status` (`pending|verified|rejected`, default `pending`), `audit_act_id`, `audit_point_id`, `etl_loading_id`, `create_date`, `created_by` — заполняются бэком, не приходят с фронта.

---

## 8. Drag-and-drop: правила

Реализация — `TreeDragDrop` (`static/js/constructor/tree/tree-drag-drop.js`) + `AppState.moveNode` (`static/js/constructor/state/state-tree.js:309-392`). Валидация на старте и на drop'е.

| Правило                                                                                          | Где проверяется                                                  |
|--------------------------------------------------------------------------------------------------|------------------------------------------------------------------|
| Узлы с `protected: true` не draggable                                                            | `handleDragStart` (`tree-drag-drop.js:85-88`), `_validateMove` (`state-tree.js:425-427`) |
| Узлы, содержащие risk-таблицу в поддереве, draggable только внутри раздела 5                     | `handleDragStart` (`tree-drag-drop.js:91-95`), повторно в `moveNode` (`state-tree.js:347-353`) |
| Content-узлы (`table`, `textblock`, `violation`) не могут быть родителями                        | `canAcceptAsChild` (`tree-drag-drop.js:142-146`)                  |
| Запрет drop'а в собственного потомка                                                              | `handleDragOver` через `TreeUtils.isDescendant` (`tree-drag-drop.js:169-172`) |
| Запрет drop'а `'before'` на pinned-узле; `'after'` блокируется, если следом ещё одна pinned       | `_calculateDropPosition` (`tree-drag-drop.js:226-240`)            |
| Превышение `AppConfig.tree.maxDepth` (= 4) запрещено                                              | `_checkDepthConstraints` (`state-tree.js:506-522`)                |
| На первом уровне (`root.children`) разрешён максимум один дополнительный пункт за разделом 5     | `_checkFirstLevelConstraints` (`state-tree.js:551-581`)           |
| В разделе 5: risk-таблицы должны быть на одном уровне глубины                                    | `_checkSection5RiskConstraints` (`state-tree.js:596-662`)         |
| В разделе 5: нельзя создавать подпункты `5.X.X+`, если risk-таблицы стоят на уровне пунктов     | то же                                                              |
| Перемещение metrics-таблицы за пределы раздела 5: требуется подтверждение пользователя (диалог) и она удаляется | `_checkMetricsTableDeletion` (`state-tree.js:455-477`)            |
| В режиме read-only любое перемещение запрещено                                                    | `handleDragStart` (`tree-drag-drop.js:73-77`), `moveNode` (`state-tree.js:310-313`) |
| Эффективный индекс drop'а прижимается ниже pinned-зоны, даже если drop был «выше»                | `_performMove` (`state-tree.js:686-693`)                          |

Дополнительный side-effect перемещения: пересчёт metrics-таблиц через `_reconcileMetricsTablesAfterMove` (`state-tree.js:785-819`) и очистка `tb`/`invoice` у поддерева, ушедшего из раздела 5 (`state-tree.js:382-386`).

---

## 9. Примеры

Примеры иллюстративные и сокращённые — реальные узлы содержат больше служебных полей, генерируемых фронтом (`number`, `customLabel`, и т. д.).

### 9.1. Минимальный валидный акт (пустой каркас)

```jsonc
{
  "tree": {
    "id": "root",
    "label": "Акт",
    "children": [
      { "id": "1", "label": "Информация о процессе, клиентском пути", "type": "item", "protected": true, "deletable": false, "content": "", "children": [] },
      { "id": "2", "label": "Оценка качества …", "type": "item", "protected": true, "deletable": false, "content": "", "children": [] },
      { "id": "3", "label": "Примененные технологии", "type": "item", "protected": true, "deletable": false, "content": "", "children": [] },
      { "id": "4", "label": "Основные выводы", "type": "item", "protected": true, "deletable": false, "content": "", "children": [] },
      { "id": "5", "label": "Результаты проверки", "type": "item", "protected": true, "deletable": false, "content": "", "children": [] }
    ]
  },
  "tables": {},
  "textBlocks": {},
  "violations": {},
  "invoiceNodeIds": [],
  "changelog": [],
  "saveType": "manual"
}
```

### 9.2. Акт с одним пунктом `5.1`, risk-таблицей и автоматически созданной сводной

```jsonc
{
  "tree": {
    "id": "root", "label": "Акт",
    "children": [
      /* … разделы 1..4 … */
      {
        "id": "5", "label": "Результаты проверки", "type": "item",
        "protected": true, "deletable": false, "number": "5",
        "children": [
          /* главная сводная (создана автоматически) */
          {
            "id": "5_table_1717000000000_abc",
            "label": "Объем выявленных отклонений",
            "type": "table",
            "tableId": "table_1717000000000_abc",
            "isMainMetricsTable": true,
            "protected": true, "deletable": true,
            "number": "Таблица 1"
          },
          {
            "id": "node_1717000001000_def", "label": "Подпункт 1",
            "type": "item", "number": "5.1",
            "children": [
              /* сводная метрик для 5.1 (создаётся при появлении risk-таблицы в 5.1.*) */
              {
                "id": "...", "label": "Объем выявленных отклонений (В метриках) по 5.1",
                "type": "table", "tableId": "table_metrics_5_1",
                "isMetricsTable": true, "protected": true, "deletable": true,
                "number": "Таблица 1"
              },
              {
                "id": "node_1717000002000_ghi", "label": "Подпункт 1.1",
                "type": "item", "number": "5.1.1",
                "children": [
                  {
                    "id": "...", "label": "Таблица регулярных рисков",
                    "type": "table", "tableId": "table_risk_reg_1",
                    "protected": true, "deletable": true, "number": "Таблица 1"
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  },
  "tables": {
    "table_1717000000000_abc": {
      "id": "table_1717000000000_abc",
      "nodeId": "5_table_1717000000000_abc",
      "grid": [ /* 4×7 шаблон метрик из _createMetricsHeaderGrid */ ],
      "colWidths": [120, 200, 80, 80, 100, 80, 120],
      "protected": true, "deletable": true,
      "isMainMetricsTable": true
    },
    "table_metrics_5_1": { /* такой же шаблон, isMetricsTable: true */ },
    "table_risk_reg_1":  { /* шаблон regularRisk, isRegularRiskTable: true */ }
  },
  "textBlocks": {},
  "violations": {},
  "invoiceNodeIds": [],
  "changelog": [],
  "saveType": "auto"
}
```

### 9.3. Акт с прикреплённой фактурой на листе `5.2.1`

```jsonc
{
  "tree": {
    "id": "root", "label": "Акт",
    "children": [
      /* … разделы 1..4 … */
      {
        "id": "5", "label": "Результаты проверки", "type": "item", "protected": true, "deletable": false, "number": "5",
        "children": [
          {
            "id": "node_p52", "label": "Пункт 2", "type": "item", "number": "5.2",
            "children": [
              {
                "id": "node_p521", "label": "Подпункт 1", "type": "item", "number": "5.2.1",
                "tb": ["МБ", "СибБ"],
                "invoice": {
                  "db_type": "greenplum",
                  "schema_name": "audit_schema",
                  "table_name": "t_audit_invoices_main",
                  "metrics": [
                    { "metric_type": "ФР", "metric_code": "ФР00001", "metric_name": "Финансовые результаты" }
                  ],
                  "process": [ { "process_code": "P-001", "process_name": "Кредитование" } ],
                  "profile_div": "Дирекция корпоративного бизнеса"
                },
                "children": []
              }
            ]
          }
        ]
      }
    ]
  },
  "tables": {},
  "textBlocks": {},
  "violations": {},
  "invoiceNodeIds": ["node_p521"],
  "changelog": [],
  "saveType": "manual"
}
```

Замечание: при сериализации фронтом через `_serializeTree` поле `invoice` НЕ войдёт в отправляемый `tree`. Бэк узнаёт о фактуре только через `invoiceNodeIds` и существующую строку в `act_invoices`. На загрузке `_attachInvoicesToTree` подмешивает `invoice` обратно в живой объект дерева.

---

## 10. Версионирование схемы

**На текущем этапе явного версионирования схемы `tree_data` нет.**

- Поле `version` или аналог в `tree_data` отсутствует — ни Pydantic-схема (`ActDataSchema`, `ActItemSchema`), ни таблица `act_tree` не содержат такого поля.
- Эволюция структуры идёт через:
  1. SQL-миграции — изменения схемы таблиц (`migrations/postgresql/schema.sql`, `migrations/greenplum/schema.sql`); схема исполняется при старте через `create_tables_if_not_exist` (см. [`developer-guide.md §6.5`](../guides/developer-guide.md#65-миграции)).
  2. Pydantic-валидаторы — `ActItemSchema.model_rebuild()` после декларации и `field_validator`'ы на `TableSchema.grid`/`colWidths`. Политика незнакомых полей задана явно: словарные схемы и `ActDataSchema` — `extra="forbid"` (незадекларированное поле → 422), узлы дерева (`ActItemSchema`) — явный `extra="ignore"` с нормализацией через `model_dump` (дерево хранится нормализованным). При несовместимом изменении схемы валидация старых документов упадёт с `ValidationError` — новые поля добавляются опциональными с `default=` и обязательно декларируются в схеме.
  3. Денормализация — если меняется набор флагов в `act_tables` (например, новый тип спец-таблицы), нужно одновременно обновить SQL-миграции (новая колонка, индекс при необходимости) и `ActContentRepository._load_tables`/`_save_tables`.

**Снапшоты содержимого.** Есть таблица `act_content_versions` (`schema.sql:354-368`) — снэпшоты `tree_data`/`tables_data`/`textblocks_data`/`violations_data` по номерам версий, для просмотра истории и восстановления. Это версионирование данных конкретного акта, а не схемы.

**Рекомендации при изменении модели.**

- Новые поля узлов или контейнеров добавлять с `default=` и явной декларацией в схеме: для словарных схем действует `extra="forbid"` — незадекларированное поле от фронта отклоняется 422.
- Удаление полей делать в два шага: сначала перевод в опциональные, миграция данных, потом удаление.
- При добавлении нового `node.type` — обновлять `Literal[...]` в `ActItemSchema.type`, фронтовый `AppConfig.nodeTypes`, проверки `_isInformationalNode` / `canAcceptAsChild` и сериализатор `_serializeTree`.
- При добавлении нового флага спец-таблицы — добавлять колонку в `act_tables` (миграции PG + GP), маппинг в `_load_tables`/`_save_tables`, поле в `TableSchema` и учёт в `TreeUtils.isPinnedTable`, если таблица должна быть pinned.
- CHECK-констрейнты в SQL: при добавлении нового CHECK обязательно зарегистрировать сообщение в `CHECK_CONSTRAINT_MESSAGES` (`app/core/exceptions.py`) — см. [`developer-guide.md §6.5a`](../guides/developer-guide.md#65a-как-добавить-check-constraint).
- Greenplum: помнить про PG 9.4 (нет `IF NOT EXISTS` для индексов, нет `gen_random_uuid()`, UUID-id — `VARCHAR(36)`); `DISTRIBUTED BY` должен быть подмножеством каждого `UNIQUE`.
