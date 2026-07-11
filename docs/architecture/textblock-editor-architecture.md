# Редактор текстблоков — архитектура

> Deep-dive по подсистеме текстблоков конструктора: contenteditable-редактор,
> капсулы (ссылки/сноски), caret-guard'ы, целостность капсул, DOCX-экспорт.
> Общий фронт (AppState/StorageManager/зоны) — см.
> [`docs/architecture/frontend-architecture.md`](frontend-architecture.md).
> Источник истины — код в `static/js/constructor/textblock/`,
> `app/domains/acts/formatters/docx/builders/inline.py`,
> `app/domains/acts/utils/html_sanitizer.py`. При расхождении документа и
> кода — источник истины код.

## Оглавление

1. [Обзор и файлы](#1-обзор-и-файлы)
2. [Модель данных: content как единственный источник](#2-модель-данных-content-как-единственный-источник)
3. [Капсулы (ссылки и сноски)](#3-капсулы-ссылки-и-сноски)
4. [Caret-guard: каретка рядом с contenteditable=false](#4-caret-guard-каретка-рядом-с-contenteditablefalse)
5. [Целостность капсул: prevent-then-heal в 3 слоя](#5-целостность-капсул-prevent-then-heal-в-3-слоя)
6. [Toolbar и размер шрифта](#6-toolbar-и-размер-шрифта)
7. [Copy/paste: свой буфер vs внешний HTML](#7-copypaste-свой-буфер-vs-внешний-html)
8. [Валидация ссылок и нумерация сносок](#8-валидация-ссылок-и-нумерация-сносок)
9. [Санитизация: фронт и бэк](#9-санитизация-фронт-и-бэк)
10. [DOCX-экспорт (inline.py)](#10-docx-экспорт-inlinepy)
11. [Save/persistence: частности текстблоков](#11-savepersistence-частности-текстблоков)
12. [Известные компромиссы и non-goals](#12-известные-компромиссы-и-non-goals)
13. [Тесты](#13-тесты)

---

## 1. Обзор и файлы

Редактор текстблока — `contenteditable="true"` `<div>` с ручной обработкой
форматирования (`document.execCommand`), inline-виджетами-«капсулами» для
ссылок/сносок и рантайм-нормализацией DOM для навигации кареткой. Без
bundler'а, без стороннего rich-text движка (обоснование решения «не
мигрировать» — `docs/reports/2026-06-28-textblock-editor-architecture-caret.md`,
gitignored working-artifact; здесь фиксируется только то, что реально
реализовано и закоммичено).

**Файлы** (`static/js/constructor/textblock/`):

| Файл | LOC | Назначение |
|---|---|---|
| `textblock-core.js` | 161 | `TextBlockManager`/`textBlockManager`, `saveContent`, `execCommand`, `flushActiveEditor` |
| `textblock-formatting.js` | 133 | Наследование inline-стилей на капсулы от соседей/предков (`inheritFormattingToElement`, `applyFormattingToNewNodes`) |
| `textblock-editor.js` | 773 | DOM-создание редактора, caret-guard-система, обработчики fokus/blur/input/keydown/paste |
| `textblock-toolbar.js` | 556 | Глобальный floating-тулбар, кастомный дропдаун размера шрифта, `applyFontSize`, `normalizeFontSizes` |
| `textblock-links-footnotes.js` | 686 | Создание/редактирование капсул, tooltip, контекстное меню, нумерация сносок, `validateLinkUrl` |
| `textblock-capsule-integrity.js` | 396 | `validateAndRepairCapsules`, 3-слойный prevent-then-heal (см. §5) |

Все файлы — `Object.assign(TextBlockManager.prototype, {...})`-расширения
одного класса (кроме `textblock-core.js`, где класс объявлен). Порядок
импорта в entry (`static/js/entries/constructor.js`) не критичен для
методов прототипа, но `textblock-links-footnotes.js` явно импортирует
`./textblock-editor.js` (см. комментарий в файле) — гарантия, что базовый
`handleEditorFocus` уже навешен до его обёртки.

DOM: `div.textblock-section[data-text-block-id]` → `div.textblock-editor[data-text-block-id][contenteditable]`
(`RENDER_CLASSES.TEXTBLOCK_SECTION`/`TEXTBLOCK_EDITOR`, `render-classes.js:13-15`).
CSS — `static/css/constructor/textblock/{textblock-content,textblock-links-footnotes,textblock-toolbar}.css`.

---

## 2. Модель данных: content как единственный источник

`AppState.textBlocks[id]` хранит форматирование **только** в поле
`content` — HTML-строке (innerHTML редактора минус guard'ы). Это
единственный источник истины для текста, инлайн-форматирования
(`<b>`/`<i>`/`<u>`/`<s>`, `span[style="font-size"]`), выравнивания
(`text-align` в style блочных элементов — §9/§10) и капсул ссылок/сносок.
Читается/пишется при каждом фокусе/blur/save.

**Прежний объект `formatting {fontSize, alignment}` вырезан целиком**
(директива владельца, коммиты `9fedcfe`/`b8a6d3f`). Он писался
единственный раз при создании блока и правками не обновлялся, а превью и
DOCX читали его как «базу», в которую никто не писал, — отсюда рос класс
находок TB-1/EXP-2 (выравнивание и размер терялись на сохранении). Схема
`TextBlockSchema` (`act_content.py`) больше не содержит поля `formatting`,
а `model_validator` `_drop_legacy_formatting` молча отбрасывает его из
данных старых актов на загрузке (обратная совместимость не требуется).
На **уже развёрнутых** БД колонку `formatting` нужно снять вручную
(`create_tables_if_not_exist` не делает ALTER) — сценарий в
[`docs/migrations/2026-07-05-drop-textblock-formatting.md`](../migrations/2026-07-05-drop-textblock-formatting.md).

**Базовый размер шрифта** — единый дефолт настроек (экранные **16px**),
он не хранится per-block. Конвертация в DOCX — везде единая **×0.75**
(16px → 12pt, кегль тела акта; §6, §10); прежний спец-кейс «14px → 12pt»
удалён. Любое изменение размера через тулбар материализуется как
`<span style="font-size:...">` внутри `content` (§6) — переживает
reload/preview/export именно поэтому. **Выравнивание** гранулярно
per-line: `execCommand('justify*')` пишет `text-align` в style блочных
элементов `content`, легализованный во всех трёх слоях
(фронт-санитайзер, bleach, DOCX — §9/§10). Отдельного поля-«базы» для
размера или выравнивания больше нет — не пытайтесь его завести.

---

## 3. Капсулы (ссылки и сноски)

Капсула — `<span class="text-link"|"text-footnote" contenteditable="false" data-*>`,
inline-атом, который редактор не даёт «раздвинуть» кареткой изнутри.

| | Ссылка (`text-link`) | Сноска (`text-footnote`) |
|---|---|---|
| Атрибут-значение | `data-link-url` (URL) | `data-footnote-text` (текст сноски) |
| Атрибут-id | `data-link-id` (`link_<ts>_<rand>`) | `data-footnote-id` (`footnote_<ts>_<rand>`) |
| Рантайм-атрибут | — | `data-footnote-number` (сквозная нумерация, см. §8) |

**Зачем `data-*`, а не `<a href>`**: URL/текст сноски хранятся в
`data-link-url`/`data-footnote-text`, не в `href`/тексте — так переживают
и bleach-санитайзер (§9), и произвольные схемы (`tel:`/`ftp:`/`file:`,
которые обычный `<a>`-рендеринг браузера не всегда трактует кликабельно).
DOCX-экспорт (§10) читает эти атрибуты напрямую, не полагаясь на семантику
`<a>`.

**`contenteditable="false"` — рантайм-only**: бэкенд-санитайзер
(`html_sanitizer.py`) не включает `contenteditable` в allowlist атрибутов
`span` — он не хранится в БД. Поэтому `normalizeMarkers` (§4) ре-применяет
его на **каждом** рендере редактора (`createEditor` → `normalizeMarkers`),
иначе капсула из перезагруженного акта редактируема напрямую (каретка
заходит внутрь, Enter у границы клонирует маркер).

**Атомарность при форматных командах**: `execCommand('bold'|...)`,
`applyFontSize`, paste и удаление через Range API все проходят через
`_expandRangeOutOfMarkers`/`_expandStaticRangeOutOfMarkers` — расширяют
границы Range **за целые капсулы**, если граница легла внутрь тела
маркера. Без этого `extractContents()`/`deleteContents()` клонирует
частично захваченную капсулу (визуальный дубль ссылки).

**Создание/редактирование** — `createOrEditLink`/`createOrEditFootnote` →
`_createOrEditInlineMarker` (`textblock-links-footnotes.js:97-211`): `prompt()`
для значения, поиск существующего маркера от начала выделения (не от
`anchorNode` — при обратном выделении якорь лежит в конце), наследование
форматирования на новый span, пробел-разделитель после капсулы.

**Двойной клик** (`enableInlineEditing`) временно снимает
`contenteditable="false"` и добавляет класс `editing-mode` — правка текста
капсулы «на месте». `editing-mode` — **первоклассный режим редактора**:
его проверяют **все** слои целостности (§5), а не только observer.
`beforeinput`-слой (§5, слой 1), `_expandRangeOutOfMarkers` и paste-путь
трактуют капсулу в `editing-mode` как обычный контент — иначе (баг
CARET-1) печать уходила бы **наружу** капсулы, а Backspace удалял бы её
целиком без undo. Выход из inline-правки идёт через `finalizeEdit` (§5) —
единый сток, а не прямой `saveContent`. **Ограничение** (семантика
Chromium): полное удаление всего текста капсулы в `editing-mode`
разворачивает её в plain-text (тело сноски/URL теряется) — приемлемо,
правка начисто очищенной капсулы бессмысленна.

**Удаление** — `removeLinkOrFootnote` заменяет капсулу на `<span>` с
сохранённым `font-size`, аккуратно расставляя пробелы по соседям
(`needsSpaceBefore`/`needsSpaceAfter`), и вызывает `_deleteCapsuleWhole`
(при удалении через beforeinput-перехват, §5) — заодно убирает соседние
caret-guard'ы, а не оставляет их «висящими».

---

## 4. Caret-guard: каретка рядом с contenteditable=false

Браузер не даёт штатно поставить каретку **вплотную** к
`contenteditable="false"`-атому, если рядом нет обычного текста (край
блока, `<br>`, другая капсула). Решение — невидимые текстовые узлы-guard'ы
из **одного символа `U+FEFF`** (`TextBlockManager.CAP_GUARD_CHAR`,
`textblock-editor.js:114`), вставляемые туда, где иначе каретке негде
«приземлиться».

**Почему не `U+200B`**: этот символ уже занят под другую задачу — якорь
материализации размера шрифта на схлопнутой каретке (`applyFontSize`, §6).
Использование одного символа под обе роли создало бы неоднозначность при
их совместном стрипе/анализе.

### 4.1 Расстановка (`normalizeMarkers` → `_placeCapGuards`)

Вызывается на каждом рендере/структурной правке (`createEditor`, после
создания/удаления капсулы, после paste, после `applyFontSize`). Идемпотентно:
сначала `_cleanCapGuards` (снять все старые), потом `_placeCapGuards`
(расставить заново).

Правило (`_placeCapGuards`, `textblock-editor.js:255-274`): guard ставится
**только** там, где слева/справа от капсулы нет обычного видимого текста —
край блока (`null`), `<br>` (перенос строки) или другая капсула. Если
рядом обычный текст — guard не нужен (каретка встаёт штатно).

`_caretHomeSibling` (:158-162) при поиске соседа **пропускает
zero-width-узлы** — не только сам guard, но и span-«якорь размера»
(`U+200B` из `applyFontSize`), состоящий только из zero-width-символов.
Иначе такой span, прилёгший к капсуле, маскировал бы границу строки и
блокировал расстановку guard'а — баг, из-за которого вертикальная
навигация ломалась после смены размера шрифта рядом с капсулой и не
чинилась даже перезагрузкой (`_isZeroWidthNode`, :139-149).

Ведущий guard важен не только у края блока, но и **у капсулы в начале
визуальной строки** (первый значимый ребёнок ИЛИ сразу после `<br>`): без
него нативная `Up`/`Down`-навигация Chromium проскакивает строку-капсулу
целиком.

### 4.2 Клавиатура (`_handleCapsuleCaretKey`)

`Home`/`←`/`→` без модификаторов у границы капсулы переставляют каретку
в guard явно (`_placeCaretBesideMarker`) — та же точка приземления, что
даёт клик мышью. `Home` использует `_currentLineFirstNode` (:193-211),
которая уважает **текущую визуальную строку** (между `<br>`), а не первый
ребёнок всего блока — иначе `Home` на 3-й строке телепортировал бы к
капсуле 1-й строки.

### 4.3 Enter у границы капсулы

Нативный `SplitBlock` при `Enter` рядом с `contenteditable=false`-узлом
расщепляет/клонирует его — фантомная пустая капсула, задвоенная нумерация
сноски. `handleEditorKeydown` перехватывает `Enter` без `Shift`, если
`_caretAdjacentMarkers` находит капсулу по одну из сторон каретки: вставляет
`<br>` вручную, капсулу переносит на новую строку и **сразу** ставит перед
ней ведущий caret-guard (`_placeCaretBesideMarker`) — без этого перед
капсулой-в-начале-строки нельзя было бы встать с клавиатуры сразу после
Enter (эфемерная DOM-позиция не закреплена в узле).

### 4.4 Стрип перед сохранением

`_stripGuards(html)` — `html.split(CAP_GUARD_CHAR).join('')`. Вызывается
в каждой точке записи в `content`/БД: `saveContent`, `handleEditorBlur`,
`handleEditorInput` (после debounce), `validateAndRepairCapsules`. Guard'ы
**никогда** не попадают в `AppState.textBlocks[id].content`, превью или
DOCX по построению — они существуют только в живом DOM редактора. Двойная
страховка на экспорте: `inline.py::_add_run` тоже срезает `U+FEFF`
(`inline.py:217-220`) на случай рассинхрона.

---

## 5. Целостность капсул: prevent-then-heal в 3 слоя

Три независимых слоя защиты от «порчи» капсул (частичное удаление, ввод
внутрь тела, потеря `contenteditable`, guard, испорченный чужим кодом).
Слой 2 избыточен по отношению к слою 1 в Chromium (см. ниже) — оставлен
намеренно как defense-in-depth для не-Chromium/программных мутаций.

**Класс `editing-mode` — сквозной контракт всех слоёв.** Капсула,
открытая на inline-правку (двойной клик, §3), несёт класс `editing-mode`;
**каждый** слой (beforeinput, `_expandRangeOutOfMarkers`, paste, observer)
обязан трактовать её как обычный редактируемый контент, а не как атом.
Раньше это знал только observer — отсюда баг CARET-1, из-за которого
правка капсулы была фактически мертва. Завершение правки любого рода
идёт через единый сток `finalizeEdit` (§11), не прямой `saveContent`.

### Слой 1 — prevent: `beforeinput`

`handleEditorBeforeInput` (`textblock-capsule-integrity.js:117-183`)
перехватывает нативные правки **до** мутации DOM через
`e.getTargetRanges()`:

- **Схлопнутое удаление, примыкающее к капсуле** (Backspace/Delete у
  границы) → `preventDefault` + `_deleteCapsuleWhole` (капсула и её
  guard'ы удаляются целиком, а не остаётся частичный текст).
- **Непустое удаление, клипающее тело капсулы** → `preventDefault`,
  Range расширяется за капсулу целиком (`_expandStaticRangeOutOfMarkers`),
  затем `deleteContents()`.
- **`insertText`/`insertReplacementText` внутрь тела капсулы** →
  `preventDefault`, каретка переносится наружу (`_placeCaretBesideMarker`),
  ввод применяется там.

`insertCompositionText` (IME), `historyUndo`/`Redo`, `insertFromDrop` —
не перехватываются намеренно, их страхует слой 3.

### Слой 2 — Range-расширение при программных операциях

`execCommand`-форматные команды (bold/italic/underline/strikeThrough),
`applyFontSize`, paste — расширяют Range за целые капсулы перед
`extractContents()`/`deleteContents()`/`insertNode()` (см. §3). Формально
избыточно относительно слоя 1 в Chromium: реальный `Backspace`/`Delete`
там всегда даёт нерасщеплённый `getTargetRanges()`, покрывающий капсулу
целиком, — но код это на 100% не гарантирует для всех путей (программные
`execCommand`, будущие браузеры), поэтому расширение оставлено везде, где
Range строится вручную.

### Слой 3 — heal: `MutationObserver`

`installCapsuleObserver` (:250-262) — навешивается **только** на
editable-редактор (не read-only), идемпотентно (переустановка отключает
старый observer — важно при `replaceChild` в `ItemsRenderer.updateTextBlock`,
иначе detached-редактор с висящим observer'ом — утечка памяти;
`createTextBlockElement` явно отключает observer старого DOM-узла с тем
же id перед пересозданием).

`_onCapsuleMutations` (:276-339) — **узкий триггер**: реагирует только на
реальные нарушения инвариантов, а не на каждую структурную мутацию
(широкий `normalizeMarkers` на каждый `childList` пересоздавал бы
guard-узлы и ломал каретку при обычном вводе):

| Наблюдение | Триггер | Починка |
|---|---|---|
| `characterData`, `oldValue` — чистый guard, стал длиннее | Текст напечатан прямо в guard-узел | `_restoreGuard`: вынести напечатанный текст наружу, guard вернуть к `U+FEFF`, каретку — за вынесенный текст |
| `childList`, среди `removedNodes` — узел с `data === U+FEFF` | Guard удалён (программно/чужим кодом) | `normalizeMarkers` (полная пере-расстановка) |
| `attributes`, капсула потеряла `contenteditable="false"` | Что-то сбросило атрибут | Хирургически возвращает `contenteditable="false"` на конкретную капсулу — **кроме** капсулы в `editing-mode` (двойной клик, §3) |

Отдельный edge-case: реальный Backspace по zero-width guard-узлу иногда
даёт `characterData` (`U+FEFF → ''`) и **следом** `childList`-remove уже
пустого узла в одном батче mutation-записей — `removedNode.data === ''`,
не `U+FEFF`, поэтому `childList`-ветка его не распознаёт. Обработчик ловит
этот случай через `guardNodeToRestore`, у которого нет `parentNode`
(узел уже отвязан), и в этой ветке тоже форсирует полную пере-расстановку
guard'ов — без этого вертикальная навигация ломалась и не чинилась даже
перезагрузкой страницы (симптом было видно только руками — юнит-тест на
синтетический DOM этот конкретный порядок mutation-записей не
воспроизводил).

**Re-entrancy**: флаг `editor.__healing` (ранний `return` в начале
`_onCapsuleMutations`) + `observer.takeRecords()` в `finally` — паттерн
из CKEditor: собственные правки observer'а не должны сами себя
триггерить повторно.

### `validateAndRepairCapsules` — четвёртый, не realtime слой

Отдельная от трёх realtime-слоёв функция (`textblock-capsule-integrity.js:20-29`)
чинит **уже сохранённый** HTML (строка → строка, чистая, идемпотентная,
парсит в detached `<template>`, живой DOM не трогает): дубль `data-*-id` у
независимых капсул (новый id клону), расщеплённый клон того же id
(склейка текстов), пустой `data-link-url`/`data-footnote-text` (разворот
капсулы в plain-текст). Вызывается на **каждой** точке записи в
`content`/БД (`saveContent`, blur, input-debounce) и при **загрузке**
акта (`createEditor`) — чинит уже испорченные капсулы старых актов.

---

## 6. Toolbar и размер шрифта

Floating-тулбар (`initGlobalToolbar`) — не привязан к конкретному
редактору, следует за фокусом (`setActiveEditor`). Кнопки форматирования
(`bold`/`italic`/`underline`/`strikeThrough`/`justify*`) идут через
`document.execCommand` (deprecated Web API, но по-прежнему поддержан
всеми целевыми браузерами — см. §12 про non-goals).

**Размер шрифта — кастомный дропдаун, не `<select>`**: нативный `<select>`
крадёт фокус у `contenteditable` и схлопывает выделение при открытии, из-за
чего `applyFontSize` не мог работать по живому Range. Триггер и пункты
меню гасят `mousedown`/`pointerdown` (`preventDefault`) — редактор не
теряет фокус/выделение при клике по тулбару.

**`applyFontSize(fontSize)`** (`textblock-toolbar.js:214-300`):

1. Клампится по границам из `ACTS__TEXTBLOCKS__FONT_SIZE_MIN/MAX`
   (`getStructureLimits()`, читает `/api/v1/acts/limits`).
2. **Есть выделение** — оборачивает `range.extractContents()` в
   `<span style="font-size:...">`, снимает конфликтующий `font-size` у
   вложенных span (кроме капсул — у них должен остаться собственный
   inline-размер, иначе внешний span на капсулу не действует, она
   `contenteditable=false` и не наследует стиль контейнера визуально
   так же, как обычный текст).
3. **Схлопнутая каретка (флагманский фикс data-loss)** — материализует
   размер **в `content`**, не в `editor.style`: вставляет
   `<span style="font-size:..."><!--ZWSP--></span>` (`U+200B`-«якорь») и
   ставит каретку внутрь него. До этого фикса размер на каретке без
   выделения писался в стиль DOM-контейнера редактора, который **не**
   входит в `innerHTML` — терялся при reload/preview/export.

**`U+200B`-якорь размера — сознательно живёт в `content`** (в отличие от
caret-guard `U+FEFF`, который стрипается всегда): он несёт реальную
информацию (унаследуемый размер будущего ввода). `_stripGuards` его не
трогает. На DOCX-экспорте он всё равно невидим и не должен попасть в
`<w:t>` — стрипается отдельно в `inline.py::_add_run` (§10).

**`normalizeFontSizes(textBlocks, palette)`** (:519-554) — одноразовый
идемпотентный проход при загрузке акта: снапает нестандартные px-размеры
(legacy-акты) к ближайшему значению палитры (`textBlockManager.fontSizes`
— 16 значений от 8 до 72). Парсит через **инертный `<template>`**, не
живой `div.innerHTML` (см. §9 про stored-XSS). Возвращает
`{changed, count}` — вызывающий (`api.js` на загрузке) помечает акт
несохранённым, если что-то поменялось.

---

## 7. Copy/paste: свой буфер vs внешний HTML

Вставка выбирает режим по **метке происхождения `data-aw-clip`**
(`handleEditorPaste`, `textblock-editor.js`): свой буфер редактора против
чужого HTML.

**Свой буфер (round-trip капсул).** Copy/cut редактора (`handleEditorCopy`,
слушатели `copy`/`cut`) кладёт в `clipboardData` выделение как есть
(капсулы — span с `data-*`-атрибутами) под меткой-обёрткой
`data-aw-clip="1"`, предварительно стрипнув caret-guard'ы `U+FEFF` (иначе
невидимка утекает во внешние приложения — CORE-4). При вставке своего
буфера капсулы **реконструируются** фабриками (`createLinkMarker`/сноска)
со свежими id (`validateAndRepairCapsules` дедуплицирует) и сохранением
inline-формата — Ctrl+X→Ctrl+V текста со сноской/ссылкой не теряет тело
сноски и URL (CARET-2). Метка проверяется **точным атрибутом** (инертный
`<template>`-парсинг), не подстрокой — слово «data-aw-clip» в чужом тексте
щедрый режим не включит.

**Внешний HTML (стратегия «только ссылки»).** Для чужого источника
(Word/сайт) вставка **не** воспроизводит форматирование один в один:
единственный элемент разметки, который переживает paste — `<a href>` (на
любой глубине вложенности, DFS-обход `_collectPasteNodes`) → превращается
в `span.text-link` (`createLinkMarker`). Всё остальное форматирование
схлопывается в plain-текст; структура абзацев/списков — только через явные
`<br>`/границы блочных тегов (`<p>`/`<div>`/`<li>` → перенос-разделитель
после блока, без задвоения и без хвостового переноса после последнего
абзаца).

**Пустой paste-фрагмент** (например, «Копировать изображение» кладёт
`text/html='<img …>'` при пустом plain, а DOMPurify вырезает всё)
гейтится **до** `deleteContents()` — иначе выделение стёрлось бы без
вставки и без undo (CARET-6).

**Санитизация вставляемого HTML** — `SafeHTML.sanitize` с явным
allowlist'ом (`['a', 'br', 'p', 'div', 'li']` тегов, `['href']` атрибутов,
расширенный `ALLOWED_URI_REGEXP`, включающий `file:` — DOMPurify-дефолт
его вырезает, а локальные файловые ссылки — легитимный сценарий этого
приложения). Финальный гейт схемы — тот же `validateLinkUrl`, что и при
ручном вводе (§8); `javascript:`/`data:`/`vbscript:` отбиваются на обоих
уровнях (DOMPurify regex + `validateLinkUrl`).

Порядок операций в конце вставки: `normalizeMarkers` (guard'ы под новые
капсулы) → `applyFormattingToNewNodes` (наследование размера/стиля на
вставленные капсулы) → `saveContent`. Наследование форматирования
**обязано** идти до `saveContent` — иначе унаследованный размер вставленной
ссылки менялся бы только в живом DOM и не попадал в сериализованный
`content` до следующего blur (paste не ставит `saveTimeout`, поэтому
`flushActiveEditor` для него no-op).

---

## 8. Валидация ссылок и нумерация сносок

**`validateLinkUrl(raw)`** (`textblock-links-footnotes.js:642-680`) — UX-
валидация URL при ручном вводе и paste, зеркало допустимых схем DOCX-
экспорта (`inline.py::_SAFE_LINK_PREFIXES`). Разрешены: `http`, `https`,
`mailto`, `tel`, `ftp`, `file` + внутри-документные якоря `#...`. Опасные
схемы (`javascript`, `data`, `vbscript`) блокируются всегда.

Распознавание схемы — **не** substring-поиском (обходился бы через
`'javascript:alert("http://")'`), а строгим `^scheme:` матчем, и **не**
любое совпадение `scheme:` трактуется как схема: `example.com:8443`/
`localhost:8080` — это `host:port`, а не URL. Правило: считается схемой,
только если сразу после `:` идёт `//` (authority) **либо** это заведомо
известная схема (allowed или dangerous — опасные тоже нужно опознать,
чтобы заблокировать). Иначе — schemeless ввод, подставляется `https://`.

**Нумерация сносок** — сквозная, как в Word, рантайм-атрибутом
`data-footnote-number` (не хранится в `content` — санитайзер его вырезает,
раз в БД он не персистентен). `numberFootnotes(root, startNumber)`
проставляет номера DFS-обходом; `footnoteOffsetForBlock(textBlockId)`
считает офсет — сколько непустых сносок в блоках **до** текущего по
порядку обхода дерева (`AppState.treeData`).

Два прохода нумерации:
- `renumberEditorFootnotes(editor)` — **один** редактор (активный по
  умолчанию); зовётся при фокусе и из `finalizeEdit` на любое
  создание/удаление/правку маркера.
- `renumberAllFootnotes(container)` — **глобальный** проход по всем
  редакторам после рендера items-вида (`renderAll`/`updateTextBlock`),
  **в том числе в read-only** (TREE-1/CORE-3). Без него номера не
  появлялись до клика в блок, правка в раннем блоке устаревала номера в
  поздних, а в read-only номеров в редакторах не было никогда. Превью и
  DOCX нумеруют независимо своим DFS-проходом по листу — они верны всегда,
  рассинхрон касался только живого редактора.

Подсчёт офсета парсит `content` соседних блоков через **инертный
`<template>`**, не живой `div.innerHTML` (см. §9) — иначе сохранённый в
чужом текстблоке `<img onerror>` (обошедший бэк-санитайзер старой версией
или через прямое обращение к API) исполнился бы прямо при подсчёте
офсета, до какого-либо явного действия пользователя над этим блоком.

---

## 9. Санитизация: фронт и бэк

### 9.1 Инертный `<template>` вместо живого `div.innerHTML`

Правило, применённое во всех местах, где код должен **распарсить** HTML
`content` без цели что-то показать пользователю (подсчёт офсета сносок,
нормализация размеров шрифта, — везде, где паттерн раньше был
`document.createElement('div').innerHTML = untrusted`):

```js
const tmp = document.createElement('template');
tmp.innerHTML = untrustedContent;
tmp.content.querySelectorAll(...);   // .content, не сам tmp
```

`<template>` — inert-контент: браузер парсит разметку, но не грузит
ресурсы и не исполняет обработчики событий внутри (`<img onerror>` не
триггерится). Живой `<div>.innerHTML` при том же вводе исполнил бы
`onerror` немедленно — stored-XSS в обход `DOMPurify`, если вредоносный
HTML оказался в БД (сохранён до появления фильтра, либо прямой доступ к
API в обход UI). Показ пользователю (сам редактор, превью) по-прежнему
идёт через `SafeHTML.set` (DOMPurify) — этот паттерн только для мест,
где HTML нужно **распарсить**, а не отрендерить.

### 9.2 `SafeHTML` 'acts'-профиль (фронт)

`shared/sanitize.js` — allowlist-профиль `'acts'`, зеркало бэкового
`html_sanitizer.py`: те же теги/data-атрибуты + доп. allowlist CSS-свойств
для inline `style` (`ACTS_CSS_PROPERTIES`). Используется при рендере
`content` в редактор/превью — обходит любой vector stored-XSS на клиенте
(контент из БД мог быть сохранён до появления бэк-санитайзера). Детали —
`frontend-architecture.md` §11.1.

### 9.3 bleach-санитайзер (бэкенд)

`app/domains/acts/utils/html_sanitizer.py::sanitize_html` — defense in
depth: HTML-поля акта (включая `textBlocks[*].content`) чистятся через
`bleach.clean` **на каждую запись** (`ActContentService`/`sanitize_act_data`),
даже если фронтовый `SafeHTML` обойдут напрямую через API. Allowlist —
не статические константы, а `ACTS__SANITIZER__*` из `settings_registry`
(рантайм, единый источник с фронтом): теги
(`p/br/b/strong/i/em/u/s/strike/del/span/a/ul/ol/li/h1-h6/div`), CSS-
свойства для `style` (`font-size/color/background-color/font-weight/
font-style/text-decoration/text-decoration-line/text-align`), data-
атрибуты (`data-footnote-id/-text`, `data-link-id/-url`).
`contenteditable` **намеренно не** в allowlist'е — рантайм-only атрибут
(§3).

**Per-tag политика для `text-align`** (TB-1): блочные теги `div`/`p`
несут в `style` **только** `text-align` со строгим enum-значением
(`left|center|right|justify`) — их дочищает пост-фильтр
`_BlockStyleFilter` (bleach-`CSSSanitizer` per-tag не умеет), у span'а —
полный CSS-allowlist выше без `text-align`. Зеркало: `_BLOCK_STYLE_TAGS`
на бэке ↔ `BLOCK_STYLE_TAGS` во фронте (`sanitize.js`). Причина
асимметрии: `font-size` эмитится на span (Range-хирургия), `text-align` —
на блоках (execCommand justify*); div-level `font-size` отрисовался бы
превью, но DOCX его игнорирует (`_extract_size_pt` читается только у span)
— был бы новый шов превью↔экспорт.

`ALLOWED_PROTOCOLS = ["http", "https", "mailto"]` — заметно **уже**, чем
фронтовый `validateLinkUrl`/DOCX `_SAFE_LINK_PREFIXES` (нет `tel`/`ftp`/
`file`). Это осознанный зазор глубокоэшелонированной защиты, не баг:
bleach режет протокол атрибута `href`, которого у капсул **нет** (URL в
`data-link-url`, не в `href` — см. §3) — атрибут `data-link-url` проходит
как обычное строковое значение data-атрибута, протокол-фильтру не
подвергается.

---

## 10. DOCX-экспорт (inline.py)

DOCX-модель текстблока — **два уровня**. Верхний:
`split_block_segments` режет `content` на сегменты-абзацы
(`BlockSegment{alignment, html}`) — каждый верхнеуровневый `<div>`/`<p>`
→ **отдельный `w:p`** со своим выравниванием
(`formatter.py::_render_textblock`, `_TB_ALIGNMENT_MAP`, дефолт
`JUSTIFY`). Нижний:
`app/domains/acts/formatters/docx/builders/inline.py::apply_inline_html`
(`HTMLParser`-наследник `_InlineParser`) стримит **внутренности** одного
сегмента в runs этого `w:p`. Поддержаны `<b>/<strong>`, `<i>/<em>`,
`<u>`, `<s>/<strike>/<del>`, `<span style="font-size/text-decoration">`,
`<br>`, `<a href>`, капсулы `.text-link`/`.text-footnote`, **вложенные**
блочные теги (`div/p/li/h1-6`) как мягкий перенос `w:br`. Базовый размер —
единый экранный дефолт настроек ×0.75 (EXP-2: 16px → 12pt); span'ы с
собственным `font-size` конвертируются тем же ×0.75. Начертание — только
inline-тегами `<b>/<i>/<u>` (§2).

### 10.1 Модель абзацев: блочный элемент = `w:p`

Верхнеуровневый `<div>`/`<p>` → **свой** `w:p` с `w:jc` из его
`text-align` (TB-1: источник истины — HTML, дефолт justify). Прежняя
модель «один `w:p` + `w:br` на все блоки» не выражала per-line
выравнивание. Инвариант геометрии сохранён: границы сегментов — бывшие
`w:br`, поэтому **промежуточным** `w:p` обнуляется `space_after`
(межабзацного зазора между строками одного текстблока быть не должно);
Normal-спейсинг (3pt after) остаётся только у последнего `w:p` —
расстояние до следующего контента не меняется. Пустой/пробельный текстблок
не печатает ни одного `w:p` (EXP-4, паритет с превью); контент без
верхнеуровневых сегментов (голый текст/span-легаси) → один абзац с
дефолтным justify.

Внутри сегмента `<br>` — мягкий перенос `w:br`. Пустая строка-блок
`<div><br></div>` дала бы **двойной** перенос (один от абзаца-сегмента,
один от вложенного `<br>`): `_normalize_segment_html` схлопывает сегмент
из одного placeholder-`<br>` в пустой html (сам абзац уже даёт строку), а
внутри `apply_inline_html` флаг `_boundary_break_pending` гасит
placeholder-`<br>` сразу после переноса-границы **вложенного** блока
(первый же реальный контент/перенос сбрасывает флаг). Несколько пустых
блоков подряд по-прежнему дают несколько пустых строк — схлопывать их
вслепую нельзя.

### 10.2 Footnote + justify: неразрывный пробел (NBSP)

Под выравниванием «по ширине» (`w:jc="both"`) Word растягивает **только**
обычный пробел `U+0020` — `U+00A0` (NBSP) не тянется. Без спецобработки
разделитель «слово ↔ якорь сноски» и хвостовой пробел внутри самого якоря
растягивались бы под justify, визуально отрывая номер сноски от слова,
которому он принадлежит:

- `_nbsp_trailing_space_before_footnote()` — перед открытием
  `text-footnote`-span заменяет **последний** хвостовой `U+0020` у
  **непосредственно примыкающего** `<w:r>` (не `<w:hyperlink>` — если
  сноска идёт сразу за ссылкой, это no-op: правка чужого run'а
  (принадлежащего ссылке) неразрывила бы не то слово) на `U+00A0`.
  Примыкающий run ищется обходом `reversed(paragraph._p)`, пропуская
  `pPr`/пустые/нетекстовые узлы.
- `_strip_trailing_anchor_space()` — срезает хвостовые обычные пробелы
  **внутри** текста самого якоря сноски (например, вставленного из Word)
  перед вызовом `add_footnote` — иначе они дали бы растяжимую щель между
  якорем и номером.
- `_after_footnote_ref` — следующий текстовый run **после** сноски,
  начинающийся с обычного пробела, тоже получает NBSP вместо первого
  символа: номер сноски «прилипает» к следующему слову.

### 10.3 Guard/anchor-символы не попадают в `<w:t>`

`_add_run` срезает и `U+FEFF` (caret-guard, рантайм-only во фронте — на
случай рассинхрона стрипа), и `U+200B` (size-anchor, **намеренно** живущий
в `content` — см. §6, но невидимый символ не должен утечь в Word). Если
после стрипа строка пуста — run не эмитится вовсе.

### 10.4 `doNotExpandShiftReturn` — короткие строки с ручным переносом не раздуваются под justify

`app/domains/acts/formatters/docx/formatter.py::_disable_shift_return_expansion`
ставит `<w:doNotExpandShiftReturn/>` в `<w:compat>` секции `settings.xml`.
Без неё Word под justify силой растягивает **короткую** строку с явным
`<w:br>`-переносом (Enter в редакторе) на всю ширину абзаца — единственная
щель на такой строке (например, стык «слово-якорь сноски ↔ номер») тогда
раздувается, даже если разделитель уже неразрывный (§10.2 борется с
NBSP-пробелом, а не с самим фактом растяжения строки Word'ом). Естественно
переносимый (`word-wrap`) текст под настройкой остаётся выровненным по
ширине как обычно — затронуты только строки с ручным разрывом.

`CT_Compat` — **фиксированная `xsd:sequence`**: элемент обязан идти после
узкого набора более ранних булевых опций (`_COMPAT_BEFORE_SHIFT_RETURN` —
10 штук, ни одна не эмитится дефолтным шаблоном `python-docx`, набор
существует на случай, если библиотека когда-нибудь начнёт их писать) и
**перед** всем прочим (`useFELayout`, `compatSetting`, ...). Вставка ищет
первого ребёнка `<w:compat>`, чей тег **не** входит в
`_COMPAT_BEFORE_SHIFT_RETURN`, и вставляет элемент перед ним
(`addprevious`) — при отсутствии такого ребёнка добавляет в конец. Неверный
порядок делает `settings.xml` схемо-невалидным — строгие потребители
(LibreOffice, XML-валидаторы) вправе отбросить весь `<w:settings>`-part.

---

## 11. Save/persistence: частности текстблоков

Общая state machine `StorageManager`/`APIClient` — см.
`frontend-architecture.md` §5/§11. Специфика именно текстблоков:

- **Debounce 500мс на ввод** (`handleEditorInput`) — пишет в
  `AppState.textBlocks[id].content` (через `validateAndRepairCapsules`),
  плюс отдельный typing-debounce превью (150мс, `PreviewManager.
  scheduleTypingBlock`).
- **Blur коммитит немедленно** (`handleEditorBlur`) — не ждёт 500мс
  debounce, гасит висящий `saveTimeout` (та же работа не повторяется) и
  сразу патчит превью точечно (`PreviewManager.updateBlock`).
- **`flushActiveEditor()`** (`textblock-core.js:70-83`) — persistence-
  воронки (`StorageManager` перед `exportData()`) вызывают его, чтобы
  прочитать `innerHTML` активного редактора с непогашенным `saveTimeout`
  до сериализации всего акта (иначе автосейв/экспорт/switch акта могли бы
  прочитать состояние без последних введённых символов).
- **`finalizeEdit(editor, {renumber?})`** (`textblock-core.js`) — **единый
  сток завершения правки**: в фиксированном порядке пересчитывает
  производные состояния, чтобы ни один путь правки (Enter у капсулы, paste,
  нативное удаление, смена размера, observer-heal, выход из editing-mode)
  не забыл шаг (класс багов «забытый вызов» — TB-5, CARET-5/7). Порядок:
  (а) `normalizeMarkers` (guard'ы — только если есть капсулы ИЛИ живой
  `U+FEFF`, самоочистка после удаления последней капсулы); (б)
  `renumberAllFootnotes` глобально, если число сносок изменилось с прошлого
  стока (кэш `editor.__lastFootnoteCount` ловит нативное удаление/paste
  поверх сноски) или `opts.renumber`; (в) класс пустоты; (в.1) снятие
  осиротевших `U+200B`-якорей размера; затем `saveContent`. Нормализация
  двигает caret-guard'ы — вызывающие, которые сами ставят каретку, обязаны
  звать `finalizeEdit` **до** установки каретки.
- **`saveContent`** — единая точка записи: `_stripGuards` →
  `validateAndRepairCapsules` → `PreviewManager.updateBlock` +
  changelog-запись (единый аудит-след правок, TB-5). Все browser-side пути
  записи `content` (input-debounce, blur, paste, toolbar-команды,
  создание/удаление капсулы) идут через неё либо через `finalizeEdit`.
- **`forceSaveToDb`** (аварийная эскалация при переполнении
  `localStorage`) сериализуется с обычным периодическим `PUT /content`
  через `APIClient._saveInFlight`/`_saveInFlightPromise` — без этого два
  параллельных `PUT` могли бы разъехаться (сервер — last-writer-wins без
  версии). Успешная эскалация показывает toast **один раз на серию**
  переполнений (`StorageManager._quotaEscalationNotified`), не на каждую
  правку — флаг сбрасывается, когда обычная запись снимка в
  `localStorage` снова проходит.
- **Восстановление черновика** (`draft-restore.js::shouldOfferRestore`) —
  несогласованный, но **свежий** (по `updated_at`) локальный снимок **не**
  выбрасывается молча: восстанавливается, а `sanitizeActContent` на пути
  загрузки чинит структурные несогласованности (сироты словарей, висячие
  ссылки узлов) неразрушающе. Раньше несогласованный снимок отбрасывался
  целиком — потеря несохранённых правок пользователя.
- **`normalizeFontSizes`** на загрузке акта (§6) может пометить акт
  несохранённым сразу после открытия (legacy нестандартные размеры
  снэпнуты к палитре) — но **не** в read-only сессии (`AppConfig.
  readOnlyMode.isReadOnly`): у роли «Участник» нет прав на `PUT`, и
  фоновая попытка автосейва без этого гейта заканчивалась бы 403.

### Телеметрия здоровья редактора

`EditorTelemetry` (`static/js/constructor/services/editor-telemetry.js`) —
клиентские счётчики событий редактора, батчами (50 событий ИЛИ 30с) на
`POST /api/v1/acts/editor-telemetry`. Мотив: все self-heal'ы редактора
молчат — о поломках раньше узнавали только от пользователей. Пять типов
событий (синхронны с CHECK `check_editor_telemetry_event_type_values` в
обеих `schema.sql` и Literal бэка): `observer_heal`, `capsule_repair`,
`dup_id_fix`, `save_failure`, `empty_paste`. Точки вызова — опциональные
однострочники `window.EditorTelemetry?.track?.('...')`: отсутствие модуля
(portal, тесты) ничего не ломает, ошибки сети проглатываются (телеметрия
не должна ронять редактор).

**Приватность**: в payload уходят ТОЛЬКО тип события, id акта и счётчик —
никакого пользовательского контента; username бэк берёт из auth. Таблица —
`{PREFIX}act_editor_telemetry`.

**Kill-switch**: `ACTS__EDITOR_TELEMETRY_ENABLED` (дефолт `true`). При
выключении эндпоинт отвечает `204` без записи, а фронт (получив флаг через
`GET /acts/limits`) перестаёт слать батчи.

**Счётчики НЕ дизъюнктны** — важно при SQL-агрегации: `capsule_repair`
включает `dup_id_fix` (починка дубль-id — частный случай ремонта капсулы,
инкрементит оба счётчика), `observer_heal` считается отдельно. Не
складывать типы как непересекающиеся множества.

---

## 12. Известные компромиссы и non-goals

- **`document.execCommand`** — формально deprecated Web API, но
  поддержан всеми целевыми браузерами проекта (десктоп Chromium/Edge,
  см. §12 `frontend-architecture.md` про a11y/desktop-only). Миграция на
  собственный командный слой не запланирована — риск оценён выше выгоды
  при текущем охвате браузеров (future-risk, не текущий баг).
- **A11y — не цель для редактора текстблоков**, как и для остального
  конструктора (десктоп-only B2B-инструмент, решение Б-3.1 — см.
  `frontend-architecture.md` §12.7). Точечные шорткаты (Ctrl+Shift+*)
  есть, полной ARIA-адаптации contenteditable-редактора нет и не
  планируется.
- **Форматирование живёт только в `content`** (§2) — прежний контейнерный
  объект `formatting` вырезан. Не заводить параллельный источник истины
  (поле-«базу») для размера/выравнивания: усложнит модель без выигрыша,
  текущая архитектура полностью покрывает нужды UI.
- **Внешний paste теряет структуру источника кроме ссылок** (§7) —
  сознательный выбор простоты. Свой буфер (`data-aw-clip`) — исключение:
  капсулы round-trip'ятся полностью.
- **Полное удаление текста editing-капсулы разворачивает её в plain-text**
  (§3) — семантика Chromium, не фиксится: правка начисто очищенной капсулы
  бессмысленна, тело сноски/URL при этом теряется намеренно.
- **Keepalive-эскалация квоты из `beforeunload` — best-effort до ~64KB**
  (PERSIST-6): `fetch(..., {keepalive:true})` браузер ограничивает ~64KB
  тела запроса; больший акт при закрытии вкладки может не доехать (в лог —
  `console.warn`). Узкий кейс: только переполнение localStorage в момент
  закрытия вкладки.
- **IME-композиция покрыта юнит-имитацией** (CARET-8): живой IME в
  автотестах недоступен, `compositionstart/end` проверяются синтетическими
  событиями. Для русскоязычного контура кейс редкий.
- **Легаси пробельные тела сносок остаются в данных, но не экспортируются**
  (EXP-3): старые записи с телом сноски из одних пробелов трим на
  сохранении не переписывает (он покрывает только новые правки), но при
  экспорте такая сноска больше не создаётся — единый критерий пустоты
  `payload.strip()` (`inline.py`) зеркалит фронт-нумерацию (`text.trim()`).
- **Превью текстблока — print-precise, супersedes B-22** (Task C, 2026-07):
  на печатном листе (`.preview-sheet .preview-textblock-content`,
  `preview-typography.css`) line-height теперь одинарный Word-интервал DOCX
  (`styles.py::Spacing.line_single`, ~1.15), плюс 3pt после блока / 0pt между
  его сегментами (зеркало `_render_textblock`) — превью мирит DOCX-вывод, а
  не редактор. Редактор (`.textblock-editor`) остался на 1.75 —
  `--textblock-line-height` теперь редактор-only токен.

---

## 13. Тесты

**Frontend (`node:test`, `tests/js/`)**:

`textblock-font-size.test.mjs`, `textblock-footnote-numbering.test.mjs`,
`textblock-handlers-cleanup.test.mjs`, `textblock-home-caret-line.test.mjs`,
`textblock-inherit-neighbors.test.mjs`, `textblock-links-footnotes.test.mjs`,
`textblock-validate-link-url.test.mjs`, `textblock-capsule-observer-editing.test.mjs`,
`textblock-blur-preview.test.mjs`, `draft-restore.test.mjs`,
`preview-textblock-formatting.test.mjs`. Стаб DOM — `_browser-stub.mjs`;
zero-width символы — `chr(0xFEFF)`/`chr(0x200B)`, не raw escape в исходнике
теста (см. правило проекта про invisible-символы только escape'ами в коде,
но литеральные значения в рантайм-строках тестов допустимы).

**Backend (`pytest`, `tests/domains/acts/formatters/docx/`)**:

`test_inline.py` (блочные границы, guard/anchor-стрип, footnote+justify
NBSP), `test_inline_footnotes.py`, `test_inline_hyperlinks.py`,
`test_inline_link_spans.py`, `test_formatter_facade.py` (порядок
`CT_Compat`, включая позицию `doNotExpandShiftReturn` относительно
`useFELayout`).

**Live/manual** — рецепт ручного E2E через Playwright MCP и локальный
seed — `docs/reports/` (working-artifact, не коммитится); краткий рецепт
записан в памяти агента (`local-browser-test-harness`), не дублируется
здесь как не-код-артефакт.
