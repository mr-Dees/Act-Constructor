# NEW-3: CSS-архитектура + Accessibility

Аудит CSS-зоны (`static/css/**`) и accessibility-зоны (`templates/**`, `static/js/**`) Act Constructor.

---

## ЧАСТЬ 1: CSS

## Сводка CSS

- Файлов: **78** `.css` — общий объём **~387 KB** (`find static/css -name "*.css" -exec cat {} + | wc -c` = 395 792 байта; учтены три entry-агрегатора `entry/{shared,portal,constructor}.css`).
- Entry points: **3** (`static/css/entry/shared.css`, `entry/portal.css`, `entry/constructor.css`). `portal.css` и `constructor.css` оба импортируют `shared.css`.
- Дополнительная точка входа: `static/css/shared/errors/errors.css` подключается напрямую из `templates/shared/errors/base_error.html:7` (минует entry-агрегаторы и не использует общий `app-config`, поэтому подгружает только `variables` + `reset`).
- Файл `static/css/base/variables.css` — **29 574 байта**, **572 CSS-переменные** в одном `:root{}` (грубо `wc -l` подтверждает по `^\s*--…:`). Это **главный риск читаемости** в зоне CSS.
- `.<class>{` определений: **710** в 65 файлах.
- `!important` вхождений: **57** в 6 файлах (главные нарушители — `utilities/helpers.css` и `utilities/read-only.css`).
- `transition: all …`: **38** вхождений.
- `@media`: всего **5** запросов в 4 файлах — приложение почти не адаптивно.
- ID-селекторов в правилах: **4** (`acts-modal.css`, `textblock-toolbar.css`).
- Дубли значений (визуальный осмотр variables): **2 цвета**, появляющиеся захардкоженно при наличии семантического `--var` (см. §B).
- Сломанные кастом-проперти (без определения в `:root`): `--duration-fast`, `--duration-normal` используются в **29 местах** (см. §B, severity HIGH).
- Orphan CSS-файлов: **0** (все 78 файлов либо импортируются из entry, либо напрямую из шаблона). `errors.css` ранее считалась orphan — это ошибка предыдущего обзора, файл подключён `base_error.html`.

### §A. Структура импортов

```
entry/shared.css
├── base/variables.css   (29.6 KB, 572 vars — мега-файл)
├── base/auth.css
├── base/reset.css
├── base/animations.css  (10 KB)
├── shared/buttons/{buttons-base, buttons-action}.css
├── shared/notifications/{base, types, content}.css
├── shared/dialog/{dialog, dialog-overlay, dialog-buttons}.css
└── shared/chat/{chat, chat-blocks, chat-history}.css

entry/portal.css
├── @import shared.css
├── portal/layout/sidebar.css
├── shared/layout/settings-menu.css
├── portal/landing/landing.css
├── portal/acts-manager/{base, cards, team-member-search, audit-log-dialog, version-preview}.css
├── shared/dialog/acts-modal.css
├── constructor/preview/{base, table, typography, violation}.css   ← cross-area импорт
└── portal/admin/{page, search, roles, add-user}.css
└── portal/ck/{page, table, form, process-picker}.css

entry/constructor.css
├── @import shared.css
├── constructor/layout/{container, header, header-actions, acts-menu, two-columns, panels}.css
├── shared/layout/settings-menu.css
├── constructor/tree/{base, drag-drop, states, nodes, children}.css
├── constructor/table/{base, states, resize, editor}.css
├── constructor/violation/{base, fields, list, additional-content}.css
├── constructor/preview/{base, typography, table, violation, menu}.css
├── constructor/help/{button, modal, content}.css
├── constructor/buttons/buttons-save-group.css
├── constructor/items/{base, levels, header, content}.css
├── constructor/textblock/{toolbar, content, links-footnotes}.css
├── constructor/context-menu/{base, states}.css
├── constructor/dialog/dialog-invoice.css
├── shared/dialog/acts-modal.css
├── portal/acts-manager/team-member-search.css         ← cross-area
├── constructor/chat/chat-popup.css
└── constructor/utilities/{helpers, save-indicator, read-only}.css

shared/errors/errors.css                ← напрямую из base_error.html, минует entry
├── @import base/variables.css
└── @import base/reset.css
```

**Наблюдения:**
1. `portal.css` импортирует `constructor/preview/*` — preview-рендер шарится для version-preview/diff (см. `portal/acts-manager/version-preview.css`). Это намеренное cross-zone заимствование; стоит выделить «preview-renderer» как отдельную shared-папку, чтобы не было `portal → constructor`.
2. `constructor.css` импортирует `portal/acts-manager/team-member-search.css` — дублирование cross-zone. Тот же файл импортирован из `portal.css`. При присутствии обеих страниц в SPA это безвредно (один файл загрузится дважды как `@import`, но браузер кеширует), но семантически — место `team-member-search` должно быть в `shared/`.
3. `shared/errors/errors.css` подключается напрямую (не через entry). Это нормально, так как errors-страницы рендерятся вне portal/constructor контекста, но создаёт **четвертую точку входа**, которую легко пропустить при инвентаризации.

### §B. CSS-переменные

`static/css/base/variables.css` содержит **572 переменные** в одном `:root{}`-блоке. Это уже не «design tokens», а свалка локальных констант компонента (`--preview-resize-grip-active-color`, `--invoice-warning-padding`, `--save-saved-white-shadow` и т.п.). 

**Категории по объёму (грубо по комментариям секций):**
- цвета (палитра, статусы, gray-шкала, фоны, границы, текст, кнопки) — ~150
- save-indicator (один компонент!) — **35** переменных (`--save-saved-*`, `--save-unsaved-*`, `--save-local-only-*`, `--save-error-*` и т.д.)
- preview-меню/preview-grip — 22
- toolbar — 14
- tree — 13
- typography — 18
- spacing-шкала — 17 (`--spacing-xs` … `--spacing-12xl` + `--spacing-preview-menu`, `--spacing-save-menu`)
- z-index (10 layer'ов) — см. §G
- остальное — частные компоненты

#### B.1 Сломанные переменные — HIGH severity

| Переменная | Определена | Используется (вхождений) | Эффект |
| --- | --- | --- | --- |
| `--duration-fast` | **нет** в `variables.css` | 29 — `shared/chat/*.css`, `portal/layout/sidebar.css:75,95,107,145,162,204,221,255,317`, `portal/landing/landing.css:62` | `transition: all var(--duration-fast)` → значение undefined → переход мгновенный/CSS-ошибка |
| `--duration-normal` | **нет** | `portal/landing/landing.css:92` | то же |

В части мест указан fallback `var(--duration-fast, 150ms)` (например `chat-history.css:33`, `chat-blocks.css:64`), но в `chat.css:54,189`, `sidebar.css:95,162,255,317` и `landing.css:62,92` fallback не указан — там transition нерабочий. **Действие:** добавить `--duration-fast: 150ms` / `--duration-normal: 300ms` в `variables.css` (либо заменить вызовы на существующие `--transition-fast`/`--transition-base`).

#### B.2 «50 оттенков серого» / hardcoded цвета

Гайдлайн `variables.css` декларирует шкалу `--gray-50…--gray-900` (10 значений) — это разумно. Но в коде встречаются прямые hex-цвета помимо шкалы:

| hex | Файл | Должно быть |
| --- | --- | --- |
| `#f8f9fa` | `utilities/read-only.css:35,40` | `var(--bg-secondary)` |
| `#aab9dc` | `variables.css:223` `--tree-parent-selected-border` | semantically — оттенок `--primary-subtle`, hardcoded |
| `#fff8e8` | `variables.css:224` `--tree-protected-bg` | пере-захардкожено |
| `#f9f9f9` | `variables.css:189` `--table-protected-header-bg` | не из gray-шкалы (можно `--gray-50` `#f8fafb`) |
| `#3d4d73` | `variables.css:89` `--button-bg-active` | вне шкалы primary-* |
| `#3d8a5a` | `variables.css:107` `--button-success-active` | вне success-* |
| `#bd2130` | `variables.css:108` `--button-danger-active` | вне danger-* |
| `#5b21b6` | `variables.css:166` `--drag-miniature-gradient` | вне палитры |
| `#2ecc71`, `#e74c3c`, `#fbbf24`, `#10b981`, `#dc3545`, `#f59e0b` | разрозненно в variables.css | три параллельные палитры (Bootstrap-ish, Tailwind-ish, custom) сосуществуют |

В `variables.css` декларированы **три семейства красного**: `--error: #c75555`, `--danger: #dc3545`, `--save-error-glow: rgba(239, 68, 68, …)`. Аналогично **два warning**: `--warning: #d89849` и параллельный `#fbbf24` (Tailwind amber-400). Это побочный эффект бесшовного слияния разных compoenent-стилей за время роста проекта. Severity MEDIUM — визуально работает, но при ребрендинге придётся искать руками.

#### B.3 Дубли значений с одинаковой семантикой

| Дубли | Где |
| --- | --- |
| `--accent: #4a9ab6` и `--info: #4a9ab6` | `variables.css:15,41` — побайтно идентичны, и hover/light — тоже |
| `--accent-light: #6bb5d0` ≡ `--info-light: #6bb5d0` | то же |
| `--gradient-header` ≡ `--table-header-gradient` (`linear-gradient(135deg, #748fca 0%, #9d7cb8 100%)`) | `:153,162` |

Можно сократить через `var(--accent)` присвоения, не теряя семантики.

### §C. Orphan CSS

**Нет.** Перепроверено: 78 файлов, 75 импортируются через 3 entry, 1 (`errors.css`) подключается напрямую из `base_error.html:7`. Все 78 живые.

### §D. !important war

57 вхождений, 6 файлов. Распределение:

| Файл | Кол-во | Оценка |
| --- | --- | --- |
| `constructor/utilities/helpers.css` | **42** | Atomic-utility слой (`.text-center`, `.flex-1`, `.sr-only`, …). `!important` здесь обоснован — utility должен перебивать компонентные стили |
| `constructor/utilities/read-only.css` | **6** | read-only режим (`display: none !important` для редакторских контролов). Обосновано: режим должен перебивать любые состояния |
| `constructor/tree/tree-states.css` | **6** | Protected-узлы и edit-mode (`background ... !important`). Из-за конкуренции с `.tree-item.selected` |
| `shared/dialog/acts-modal.css` | **1** | `border-color: var(--warning) !important` — точечная подсветка ошибки |
| `portal/acts-manager/acts-manager-cards.css` | **1** | `background ... !important` для `--act-attention-bg` |
| `portal/acts-manager/version-preview.css` | **1** | `background: rgba(245, 158, 11, 0.12) !important` (захардкожено, без переменной) |

**Вердикт:** настоящего «war» нет. helpers.css = osознанный utility, остальные 15 — точечные. **Действие:** заменить хардкод `rgba(245, 158, 11, 0.12)` в `version-preview.css:235` на `var(--act-attention-bg)` (значение совпадает по смыслу).

### §E. Specificity

- **ID-селекторов в CSS-правилах**: 4 (`#directivesContainer`, `#kmNumberField` в `acts-modal.css:473,490`; `#fontSizeSelect`, `#headingSelect` в `textblock-toolbar.css:173,177`). Антипаттерн, но малое количество. Лучше заменить на `data-id` или class — это удаляет жёсткий приоритет.
- Селекторы глубиной >3: точно не подсчитывал, но spot-check показывает максимум 3-4 уровня (`.violation-list .violation-list-item .violation-list-delete-btn:focus-visible` — 4). Хроническая глубокая вложенность не наблюдается.
- Псевдо-классы `:focus-visible` — **17** компонентов (`buttons-base.css:44`, `dialog-close-btn`, `acts-modal-close`, `help-modal-close`, `header-action-btn`, `settings-menu-close`, `tree-item`, `context-menu-item`, `step`, `notification-close`, `violation-list-add-btn`, `save-indicator-button`, `preview-menu-close`, `acts-menu-close`, `help-button`, `header-action-btn--exit`, `violation-list-delete-btn`). См. §M для оценки покрытия.

### §F. Конфликты portal/constructor

Поскольку обе зоны импортируют **`shared.css` целиком**, фактически конфликтов нет: все «общие» классы (`.btn`, `.dialog-*`, `.notification-*`, `.chat-*`) определены один раз. Прямого пересечения по одинаковым селекторам нет — namespacing через префиксы (`.acts-manager-*`, `.admin-*`, `.tree-*`, `.violation-*`, `.preview-*`) даёт чистое разделение.

Cross-зональные импорты, требующие внимания:
- `entry/constructor.css:68` → `../portal/acts-manager/team-member-search.css` (team-member используется в диалоге создания акта внутри constructor).
- `entry/portal.css:21-24` → `../constructor/preview/*` (preview-рендер шарится для diff/version-preview).

**Рекомендация:** вынести `team-member-search` в `shared/forms/` и `preview/*` в `shared/preview-renderer/`, чтобы cross-импорты исчезли.

### §G. Z-index map

В `variables.css` определена layer-шкала:
```
--z-base: 1
--z-dropdown: 1000
--z-sticky: 1100
--z-sticky-elevated: 1120
--z-sticky-high: 1121
--z-fixed: 1200
--z-modal-backdrop: 1300
--z-modal: 1400
--z-popover: 1500
--z-tooltip: 1600
--z-notification: 1700
```

Шкала **разумная**, layers логически отделены. Все основные слои реально используются.

**Утечки магических чисел (вне шкалы):**

| Magic | Файл:строка | Где должно быть |
| --- | --- | --- |
| `z-index: 1` | `chat-popup.css:61`, `ck-table.css:20` | `var(--z-base)` |
| `z-index: 10` | `chat.css:335`, `dialog-invoice.css:206,474,526` | вероятно `var(--z-base)` или новый `--z-stack` |
| `z-index: 100` | `team-member-search.css:17`, `utilities/read-only.css:20` | `var(--z-dropdown)` |
| `z-index: 1000` | `tree-nodes.css:157` | `var(--z-dropdown)` |
| `z-index: -1` | `items-base.css:80` | `var(--z-below, -1)` (новая токен) |
| `z-index: calc(var(--z-popover) + 1)` | `context-menu-base.css:157` | OK (использует токен) |
| `z-index: calc(var(--z-modal-backdrop) + 100)` | `dialog-overlay.css:59` | пересекается с `--z-modal: 1400` → 1400, что РАВНО modal. Возможен баг порядка наслоения |
| `z-index: calc(var(--z-modal) + 100)` | `dialog-overlay.css:64` | = 1500 = `--z-popover`. Опасное смешение |
| `z-index: calc(var(--z-modal-backdrop, 1000) + 10)` | `chat-blocks.css:421` | fallback `1000` не совпадает с реальным `1300` → подсветка может отличаться от ожидаемой |

Severity MEDIUM: `calc()`-выражения переходят границы соседних layer'ов и эффективно поднимают элемент в чужой слой.

### §H. Анимации

- `transition: all` — **38 вхождений** (антипаттерн: пересчёт всех свойств, скрытые reflow). Большинство — кнопки и hover-эффекты. Severity MEDIUM, не блокер.
- Длительности через переменные: `--transition-fast: 150ms`, `--transition-base: 200ms`, `--transition-slow: 300ms` — компактная шкала, OK.
- Хардкод `transition: all 0.15s`/`all 0.2s` — `audit-log-dialog.css:30,175`, `version-preview.css:66,170`, `admin-roles.css:75,156`. Стоит заменить на `--transition-fast` (одинаковое значение).
- `animations.css` (10 KB) содержит keyframes для shake/spin/pulse/slide. **`prefers-reduced-motion: 0 вхождений** во всём проекте — это блокер a11y (см. §R).

### §I. Responsive

**Только 5 `@media` запросов на 78 файлов**:
- `shared/errors/errors.css:135` — `max-width: 480px` (error-page)
- `portal/landing/landing.css:334` — `max-width: 1400px`
- `portal/landing/landing.css:340` — `max-width: 900px`
- `portal/landing/landing.css:350` — `max-width: 768px`
- `portal/layout/sidebar.css:377` — `max-width: 768px`

**Вердикт:** приложение **не адаптивно**. Constructor (главная рабочая зона) не имеет ни одного media query — расчитан на десктоп ≥1280px. Учитывая что юзер-аудитория — внутренние аудиторы на корпоративных ноутбуках, это сознательный выбор. Но landing/login на 1024×768 или планшете развалятся.

Если задача поддержать только десктоп — это OK, но стоит **зафиксировать в документации** (минимальные требования) и удалить полу-готовые media-queries в `landing.css` (создают ложное впечатление адаптивности).

---

## ЧАСТЬ 2: a11y

## Сводка a11y

- ARIA-атрибутов в templates: **~30 use-cases** (`aria-label`, `aria-expanded`, `role`, `aria-labelledby`, `aria-selected`). В JS — только 2 динамических (`notifications.js:227 aria-label`, `storage-manager.js:197 aria-selected`).
- Покрытие ARIA по компонентам: **частичное** (~15-25%) — диалоги имеют `aria-label`, context-menu имеют `role="menu"`/`role="menuitem"`, но **tree, table, items-editor, validation-error, save-indicator живой regions** — ничего не имеют.
- `role="dialog"`: **1** (help_modal.html). `aria-modal`: **0**. `aria-labelledby`: 1 (help_modal). `aria-live`: 0. `aria-controls`/`aria-owns`: 0. `aria-describedby`: 0. `aria-hidden`: 0 (для декоративных SVG).
- Keyboard navigation: **отсутствует** для дерева, таблиц, items-редактора. Есть только Escape для диалогов/context-menu и снятия выделения. Стрелочная навигация tree — нет. Tab внутри сложных компонентов — стандартная браузерная.
- Focus management: **нет focus-trap**, **нет focus-restoration** в `DialogBase`. Открытие диалога не двигает фокус внутрь, после закрытия фокус не возвращается на triggering-кнопку.
- WCAG-уровень оценка: **fail** (даже на A). Основные блокеры — недостающие ARIA для кастомных компонентов и `prefers-reduced-motion`.
- Положительные стороны: `lang="ru"` на всех `<html>`, `:focus-visible` определён для 17 ключевых компонентов, кнопки везде `<button>`, не `<div onclick>`, форма создания акта имеет `<label>` для всех `<input>`.

### §J. ARIA-атрибуты

| Компонент | Сейчас | Должно быть | Severity |
| --- | --- | --- | --- |
| Tree (`templates/constructor/components/tree_panel.html:4` — `<ul id="tree" class="tree">`) | **ничего** | `role="tree"` на `<ul>`; для каждого `<li class="tree-item">` — `role="treeitem"`, `aria-expanded="true|false"`, `aria-selected="true|false"`, `aria-level`, `aria-setsize`, `aria-posinset`. См. APG https://www.w3.org/WAI/ARIA/apg/patterns/treeview/ | **HIGH** |
| Table (constructor — `static/js/constructor/table/table-core.js`) | Стандартный `<table>` | Нативная семантика OK, но кастомное «cells-operations» (merge, insert, delete) недоступно с клавы — нужен `role="grid"` + `aria-rowindex`/`aria-colindex` + keyboard model APG https://www.w3.org/WAI/ARIA/apg/patterns/grid/ | **HIGH** |
| Context-menu (`templates/constructor/components/context_menu.html`) | `role="menu"`, `role="menuitem"`, `role="separator"` — **есть** | Нужно: `tabindex="-1"` на items + JS-управление focus / roving tabindex / Esc + ArrowUp/Down (APG menu). Сейчас открывается только по правому клику мыши | MEDIUM |
| Dialog (`templates/constructor/header/help_modal.html:2`) | `role="dialog" aria-labelledby="helpModalTitle"` | Не хватает `aria-modal="true"` и focus-trap | MEDIUM |
| Остальные диалоги (`acts-modal-close`, `dialog-close-btn`, `acts-modal`) | `aria-label="Закрыть"` на крестике, но самого `role="dialog"`/`aria-modal` НЕТ | Добавить `role="dialog" aria-modal="true" aria-labelledby="..."` на корневой div, focus-trap в JS | **HIGH** |
| Notifications (`static/js/shared/notifications.js`) | `aria-label` только на close-button | Нужен `aria-live="polite"` для info/success, `aria-live="assertive"` для error на контейнере уведомлений | **HIGH** |
| Save-indicator (`templates/constructor/header/header_save_indicator.html:7`) | `aria-label="Индикатор сохранности"` | Нужен `aria-live="polite"` + динамическое обновление текста; сейчас скринридер видит только статическую метку | **HIGH** |
| Steps (`templates/constructor/header/header_steps.html`) | `role="tablist"` + `role="tab"` + `aria-selected` — **есть** (отлично) | Не хватает `aria-controls` указывающий на step1/step2 div | LOW |
| Format-dropdown (`templates/constructor/constructor.html:42`) | `role="menu"` + `aria-expanded` на trigger — **есть** | Не хватает `aria-haspopup="true"` и динамического `aria-expanded` обновления | LOW |
| SVG icons (37 inline `<svg>` в шаблонах) | Без `aria-hidden`/`<title>` | Для декоративных — `aria-hidden="true"` на `<svg>`; для значимых (нет текстового лейбла рядом) — `<title>текст</title>` внутрь svg | MEDIUM |
| Workflow-filter-btn (`landing.html:20`) | Без `aria-label` | Кнопка имеет визуальный текст «Фильтры» — OK, но без обработчика (заглушка) | LOW |

### §K. Semantic HTML

**Хорошее:**
- Все интерактивные элементы — `<button>` или `<a>` (нет `<div onclick>` — `grep "<div[^>]*onclick"` = 0).
- Только 1 inline `onclick` (`acts_error_state.html:10` — `onclick="ActsManagerPage.loadActs()"`). Лучше навешивать через `addEventListener`, но в одном месте — терпимо.
- `<label>` оборачивает `<input>` в форме создания акта (24 `<label>` в `create_act_dialog.html`).
- Заголовки иерархичны: `<h1>` на странице (`acts-manager-title`, `admin-title`), `<h2>` для секций (`📝 Структура акта`, `📄 Предварительный просмотр`), `<h3>` для подзаголовков. Иерархия не нарушена.
- `<main>` есть в `portal/base_portal.html:20`. В `constructor/base_constructor.html` — **нет** `<main>` (только `<body>` → `<div class="container">`). MEDIUM.
- `<nav>` в sidebar, `<aside>` в landing — есть.

**Что улучшить:**
- `templates/constructor/base_constructor.html:21` — обернуть `{% block content %}` в `<main>` (constructor — главная рабочая зона).
- Emoji в заголовках (`📝 Структура акта`, `📄 Предварительный просмотр`) скринридер прочитает как «note pad emoji структура акта». Лучше `aria-hidden="true"` на emoji или вынести в `::before` через CSS.
- Context-menu emoji-иконки (➕📊⚠️) — то же самое, проигнорирует или прочитает имя символа. Решение: обернуть emoji в `<span aria-hidden="true">…</span>` и оставить текст.

### §L. Keyboard navigation

**Что РАБОТАЕТ:**
- Tab перемещается по кнопкам, инпутам, ссылкам — стандартное поведение.
- Escape закрывает диалоги (`DialogBase._setupEscapeHandler`, `dialog-base.js:102-116`), закрывает context-menu (поиск `key === 'Escape'` нашёл 19 файлов).
- Escape снимает selection в дереве (`tree-core.js:46-50`).

**Что НЕ РАБОТАЕТ:**
- **Tree:** нет стрелочной навигации (`grep "ArrowUp|ArrowDown|ArrowLeft|ArrowRight" static/js/constructor/tree` → пусто). Дерево полностью мышиное. Невозможно выделить узел без клика, развернуть/свернуть Right/Left, перейти к sibling Up/Down.
- **Table:** клавиатурного управления ячейками нет (вход в режим редактирования только по double-click, согласно `table-core.js`). Merge/insert/delete только через context-menu правой кнопкой.
- **Context-menu:** открывается только по `contextmenu` событию (правая кнопка). Открыть с клавиатуры (Shift+F10 или контекстная клавиша) на узле дерева — никак (потому что узел не tabIndex'ируем).
- **Items-editor (шаг 2):** drag-and-drop violation-content без клавиатурной альтернативы (видно по `violation-drag-drop.js`).
- **`tabindex` в JS:** найдено всего 1 место (`violation-additional-content.js:57` — `setAttribute('tabindex', '0')`). Tree, table, items, format-dropdown options — все ни одного `tabindex`.

**Действия (приоритет):**
1. Реализовать `roving tabindex` для tree (`tabindex="0"` на текущем активном узле, `-1` на остальных) + handlers Up/Down/Left/Right/Home/End/Enter/F2.
2. На `<input>` в form'ах подтверждение Enter уже работает (стандартное form-submit), но проверить — submit-кнопки `type="button"` (через clase, не через submit) могут терять Enter.

### §M. Focus management

**`DialogBase`** (`static/js/shared/dialog/dialog-base.js`):
- `_showDialog` — `body.appendChild(overlay)` + reflow + `classList.add('visible')`. **Focus в диалог НЕ переводится.** Скринридер остаётся в старой позиции, юзер с клавы должен Tab'нуть до диалога.
- `_hideDialog` — удаляет overlay. **Focus НЕ возвращается** на triggering-кнопку. После закрытия диалога focus уходит на `<body>` (или теряется), Tab начинает заново.
- **Focus-trap НЕ реализован.** Можно Tab'нуть из диалога в фоновый контент (хотя скрыт `dialog-open` классом на body — но фокусируемые элементы доступны).

**Visible focus indicator:**
- 17 компонентов имеют `:focus-visible` (см. §A). 
- Большинство — `outline: var(--focus-outline)` (`2px solid var(--accent)` + 2px offset). 
- `:focus` без `:focus-visible` встречается 71 раз — старый формат, для мыши убирался outline вручную через `outline: none`. Спот-чек: `buttons-base.css` корректно использует только `:focus-visible`.

**Действия:**
- В `DialogBase._showDialog`: сохранить `document.activeElement` в `overlay._previousFocus`, после reflow найти первый focusable элемент в диалоге и `.focus()`.
- В `DialogBase._hideDialog`: после `setTimeout` восстановить `overlay._previousFocus.focus()` если элемент ещё в DOM.
- Реализовать focus-trap: на overlay вешать `keydown` Tab handler, который если `activeElement === lastFocusable && !shift` → `firstFocusable.focus()` (и наоборот для Shift+Tab).

### §N. Screen readers

- `aria-live`: **0 регионов**. Notifications появляются в DOM, но не озвучиваются автоматически. **Блокер UX** — пользователь не узнает об успешном сохранении/ошибке валидации.
- `aria-label` для иконочных кнопок: **есть** для close-buttons диалогов, header-actions (`Открыть настройки`, `Меню актов`, `AI ассистент`), save-indicator. Покрытие хорошее в header'е.
- `aria-describedby` для validation-errors: **0**. Pattern-mismatch на КМ-номере (`pattern="КМ-\d{2}-\d{5}"`) даёт только browser tooltip — для скринридера не связан с инпутом.
- `role` для tree, grid, listbox: **0** (см. §J).
- Inline SVG без `<title>`: 37 — большинство декоративные (рядом есть текст), стоит добавить `aria-hidden="true"` чтобы AT их игнорировал.

### §O. Color contrast (выборочно)

Проверка нескольких пар foreground/background по `variables.css`:

| FG | BG | Contrast ratio | WCAG AA (norm 4.5, large 3) |
| --- | --- | --- | --- |
| `--text-primary: #1a202c` | `--bg-primary: #ffffff` | ~16.4:1 | PASS |
| `--text-secondary: #4a5568` | `--bg-primary` | ~8.6:1 | PASS |
| `--text-tertiary: #9ba3b3` | `--bg-primary` | ~3.0:1 | **FAIL** для normal, OK для large |
| `--text-disabled: #cfd4dc` | `--bg-primary` | ~1.7:1 | FAIL (но это disabled — допустимо WCAG) |
| `--primary: #5b6fa8` (текст ссылки) | `--bg-primary` | ~5.0:1 | PASS |
| `--warning: #d89849` | `--bg-primary` | ~2.5:1 | FAIL для текста — но используется для иконок/границ |
| `--success: #52a876` | `--bg-primary` | ~3.0:1 | FAIL для normal text |
| `#ffffff` | `--primary: #5b6fa8` (кнопка) | ~5.0:1 | PASS |

**Проблема `--text-tertiary` (`#9ba3b3`)** — используется как `--input-placeholder`, `--icon-color`, `--text-disabled` хост. Для placeholder в инпутах текущий контраст ниже AA. Усилить до `#7a8290` или подобного → ~4.6:1.

**Проблема `--warning`/`--success` как текстового цвета** — `notifications-types.css` использует их. Spot-check рекомендуется в браузере с реальным контентом.

### §P. Forms

`create_act_dialog.html` — образец:
- ✅ Каждый `<input>` обёрнут `<label>` (24 пары).
- ✅ `required` присутствует.
- ✅ `pattern` + `title` для КМ-номера.
- ❌ Звёздочка `*` визуально, но `aria-required="true"` не дублирует — некоторые скринридеры зачитают «звёздочка», что неконтекстно. Лучше `<span aria-hidden="true">*</span>` + `aria-required="true"` на input.
- ❌ Ошибки валидации (когда submit падает) — `pattern`-fail показывает browser-tooltip, но кастомные ошибки (например, дубль КМ+part от сервера) выводятся через notifications, не связаны с input через `aria-describedby`. Скринридер не поймёт какое поле сломалось.
- ❌ `fieldset` + `legend` используется в `<legend>Состав аудиторской группы *</legend>`, `<legend>Служебная записка (опционально)</legend>` — **молодец**. Это правильно.
- ❌ `autocomplete="off"` на `<form id="actForm">` — корректно для бизнес-форм. На admin-search input: `autocomplete="off"` — тоже OK.

### §Q. i18n

- `lang="ru"` присутствует во всех трёх base-шаблонах (`portal/base_portal.html:2`, `shared/errors/base_error.html:2`, `constructor/base_constructor.html:2`). ✅
- Direction RTL — не нужен (только русский, который LTR).
- `<meta charset="UTF-8">` есть.
- Жёсткая привязка к одному языку — внутренний продукт, переводить не планируется.

### §R. Reduced motion

**`prefers-reduced-motion` — 0 вхождений во всём проекте.** Это **блокер a11y**.

`animations.css` (10 KB) определяет shake, spin, pulse, slide-in, pulse-urgent (через `--duration-pulse-urgent: 2s`). Для пользователей с вестибулярными нарушениями (или просто отключившими анимации в OS) приложение продолжит дёргаться.

**Действие** (низкий effort, высокий impact):
```css
/* В конец static/css/base/animations.css */
@media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
        animation-duration: 0.01ms !important;
        animation-iteration-count: 1 !important;
        transition-duration: 0.01ms !important;
        scroll-behavior: auto !important;
    }
}
```

---

## ИТОГ: Топ-10 находок (CSS + a11y)

| # | Находка | Файл/место | Severity | Effort |
| --- | --- | --- | --- | --- |
| 1 | **Сломанные CSS-переменные** `--duration-fast`/`--duration-normal` — undefined в `variables.css`, используются 29 раз без fallback в `chat.css`, `sidebar.css`, `landing.css` → transitions не работают | `variables.css` (определить); `chat.css:54,189`, `sidebar.css:75,95,107,145,162,204,221,255,317`, `landing.css:62,92` | **HIGH** (CSS) | XS (1 строка в variables) |
| 2 | **`prefers-reduced-motion` нигде не учитывается** — анимаций много (shake, spin, pulse, slide), пользователи с вестибулярными нарушениями страдают | `animations.css` + глобально | **HIGH** (a11y) | XS (один media query) |
| 3 | **Tree — нет ARIA и клавы.** `<ul id="tree">` без role/treeitem, ноль ArrowUp/Down handler'ов. Главный рабочий компонент недоступен с клавиатуры | `templates/constructor/components/tree_panel.html:4`, `static/js/constructor/tree/tree-core.js` | **HIGH** (a11y) | L (APG treeview pattern + roving tabindex + handlers) |
| 4 | **Диалоги без focus-management.** `DialogBase` не переводит focus внутрь при открытии, не возвращает при закрытии, нет focus-trap, нет `aria-modal` | `static/js/shared/dialog/dialog-base.js:34-71` + все диалоги без `role="dialog"` на корне | **HIGH** (a11y) | M (3 метода в DialogBase) |
| 5 | **Notifications без `aria-live`.** Success/error появляются в DOM, но screen-reader о них не узнаёт. Save-indicator — то же (только статическая `aria-label`) | `static/js/shared/notifications.js`, `templates/constructor/header/header_save_indicator.html:7` | **HIGH** (a11y) | XS (атрибут на контейнере) |
| 6 | **`variables.css` — 572 переменные в одном файле (29 KB).** Свалка компонентных констант (35 переменных только для save-indicator). Сложно поддерживать, ребрендинг = боль. Дубли: `--accent` ≡ `--info`, три семейства красного, два warning | `static/css/base/variables.css` | MEDIUM (CSS) | L (декомпозиция на `variables/colors`, `variables/spacing`, `variables/components/*`) |
| 7 | **Z-index `calc()`-выражения пересекают соседние layer'ы.** `dialog-overlay.css:59,64` дают 1400 и 1500, что равно `--z-modal` и `--z-popover` соответственно → ломает порядок слоёв | `dialog-overlay.css:59,64`, `chat-blocks.css:421` | MEDIUM (CSS) | S (переписать на `--z-modal + 1` или новый токен `--z-modal-elevated`) |
| 8 | **Constructor не адаптивен**, имеет 0 media queries; landing/sidebar — только 768/900/1400. Поломается на любом разрешении <1280 кроме указанных | весь `constructor/*.css`, `landing.css` | MEDIUM | XL (если задача — десктоп-only, добавить в доку явное минимальное разрешение; иначе плановая работа) |
| 9 | **Emoji в context-menu и заголовках без `aria-hidden`.** Скринридер прочитает «note pad emoji структура акта» — низкая UX | `templates/constructor/components/{tree_panel,preview_panel}.html`, `context_menu.html` (10 пунктов) | LOW (a11y) | XS (обернуть `<span aria-hidden="true">…</span>`) |
| 10 | **`transition: all` 38 вхождений.** Анти-паттерн (reflow всех свойств). Также 6 хардкод-длительностей вне шкалы переменных (`0.15s`, `0.2s` в `audit-log-dialog.css`, `version-preview.css`, `admin-roles.css`) | см. §H | LOW (CSS) | S (find-replace) |

Файл: `D:\PROJECT\Pyton\Act Constructor\docs\_frontend_review\new-3-css-a11y.md`
