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
2. [Модель данных: content vs formatting](#2-модель-данных-content-vs-formatting)
3. [Капсулы (ссылки и сноски)](#3-капсулы-ссылки-и-сноски)
4. [Caret-guard: каретка рядом с contenteditable=false](#4-caret-guard-каретка-рядом-с-contenteditablefalse)
5. [Целостность капсул: prevent-then-heal в 3 слоя](#5-целостность-капсул-prevent-then-heal-в-3-слоя)
6. [Toolbar и размер шрифта](#6-toolbar-и-размер-шрифта)
7. [Paste: стратегия «только ссылки»](#7-paste-стратегия-только-ссылки)
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

## 2. Модель данных: content vs formatting

`AppState.textBlocks[id]` содержит два независимых поля:

| Поле | Что это | Статус |
|---|---|---|
| `content` | HTML-строка (innerHTML редактора минус guard'ы) — **единственный источник истины** для текста, инлайн-форматирования (`<b>`/`<i>`/`<u>`/`<s>`, `span[style]`), капсул ссылок/сносок | Живое, читается/пишется при каждом фокусе/blur/save |
| `formatting` | `{fontSize?, alignment?}` | Применяется **только** в `createEditor` (`applyFormatting`, `textblock-formatting.js:12-28`) как стартовый inline-стиль контейнера-редактора (`editor.style.fontSize`/`editor.style.textAlign`). Дальнейшие изменения размера/выравнивания идут через toolbar `execCommand`/`applyFontSize`, которые пишут в `content` (span-обёртки), **не** обновляют `formatting` |

Практическое следствие: `formatting.fontSize` — это унаследованный
базовый размер контейнера при **первом** рендере блока (или после
`reload`), а не текущее состояние. Любое изменение размера через тулбар
материализуется как `<span style="font-size:...">` внутри `content`
(см. §6) — оно переживает reload/preview/export именно поэтому. Не
пытайтесь синхронизировать `formatting` с реальным форматированием текста
— оно принципиально не гранулярно (один размер/alignment на весь блок).

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
капсулы «на месте». Observer целостности (§5) **не** откатывает
`contenteditable` капсулы в этом режиме (проверяет класс `editing-mode`) —
иначе фикс целостности вступал бы в конфликт с намеренной правкой.

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

## 7. Paste: стратегия «только ссылки»

`handleEditorPaste` (`textblock-editor.js:422-469`) — вставка **не**
воспроизводит форматирование стороннего источника (Word/сайт) один в
один: единственный элемент разметки, который переживает paste — `<a href>`
(на любой глубине вложенности, DFS-обход `_collectPasteNodes`) →
превращается в `span.text-link` (`createLinkMarker`). Всё остальное
форматирование схлопывается в plain-текст; структура абзацев/списков —
только через явные `<br>`/границы блочных тегов (`<p>`/`<div>`/`<li>` →
перенос-разделитель после блока, без задвоения и без хвостового переноса
после последнего абзаца).

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
порядку обхода дерева (`AppState.treeData`). Пересчитывается при фокусе
редактора и на любое создание/удаление/правку маркера
(`renumberEditorFootnotes`).

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
font-style/text-decoration/text-decoration-line`), data-атрибуты
(`data-footnote-id/-text`, `data-link-id/-url`). `contenteditable`
**намеренно не** в allowlist'е — рантайм-only атрибут (§3).

`ALLOWED_PROTOCOLS = ["http", "https", "mailto"]` — заметно **уже**, чем
фронтовый `validateLinkUrl`/DOCX `_SAFE_LINK_PREFIXES` (нет `tel`/`ftp`/
`file`). Это осознанный зазор глубокоэшелонированной защиты, не баг:
bleach режет протокол атрибута `href`, которого у капсул **нет** (URL в
`data-link-url`, не в `href` — см. §3) — атрибут `data-link-url` проходит
как обычное строковое значение data-атрибута, протокол-фильтру не
подвергается.

---

## 10. DOCX-экспорт (inline.py)

`app/domains/acts/formatters/docx/builders/inline.py::apply_inline_html` —
`HTMLParser`-наследник (`_InlineParser`), стримингом читает `content` и
эмитит `docx`-runs в параграф. Поддержаны `<b>/<strong>`, `<i>/<em>`,
`<u>`, `<s>/<strike>/<del>`, `<span style="font-size/text-decoration">`,
`<br>`, `<a href>`, капсулы `.text-link`/`.text-footnote`, блочные теги
(`div/p/li/h1-6`) как перенос строки.

### 10.1 Блочные границы vs `<br>` — без задвоения переноса

Enter в редакторе → `<br>` (мягкий перенос внутри одного `<w:p>`); блочные
теги (`<div>`/`<p>`/...) появляются из paste. `<div><br></div>` (пустая
строка-блок из paste) раньше давал **двойной** перенос — один от границы
блока, один от вложенного `<br>`. Флаг `_boundary_break_pending`:
граница блока (`handle_starttag` для `_BLOCK_TAGS`) ставит перенос и
взводит флаг; следующий `<br>` идёт через `_handle_br()`, который **гасит**
placeholder-`<br>`, если флаг взведён (без дублирования переноса), но
**не** трогает реальный видимый контент — любой текст/новый `<br>` сбрасывает
флаг сначала. Несколько пустых блоков подряд по-прежнему дают несколько
пустых строк (у каждого своя граница-перенос) — намеренно, пользователь
может захотеть 1+ пустых строк подряд, схлопывать их вслепую нельзя.

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
- **`saveContent`** — единая точка записи: `_stripGuards` →
  `validateAndRepairCapsules` → `PreviewManager.updateBlock`. Все
  browser-side пути записи `content` (input-debounce, blur, paste,
  toolbar-команды, создание/удаление капсулы) идут через неё либо
  повторяют тот же порядок вручную.
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
- **`formatting`-объект — намеренно грубый** (§2): один `fontSize`/
  `alignment` на блок, применяется только при первом рендере. Гранулярное
  форматирование живёт исключительно в `content`. Не «доделывать»
  `formatting` до параллельного источника истины — усложнит модель без
  выигрыша (текущая архитектура полностью покрывает нужды UI).
- **Paste теряет структуру источника кроме ссылок** (§7) — сознательный
  выбор простоты («стратегия только-ссылки»), не баг и не временное
  решение.

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
