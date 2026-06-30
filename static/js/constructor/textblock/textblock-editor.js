/**
 * Расширение для работы с редактором
 */
import { ChangelogTracker } from '../changelog-tracker.js';
import { PreviewManager } from '../preview/preview.js';
import { TextBlockManager } from './textblock-core.js';
import { RENDER_CLASSES } from '../render-classes.js';
import { AppConfig } from '../../shared/app-config.js';
import { SafeHTML } from '../../shared/sanitize.js';

Object.assign(TextBlockManager.prototype, {
    /**
     * Создаёт DOM-элемент текстового блока с редактором.
     * Перед созданием отключает observer старого редактора (если он ещё в DOM),
     * чтобы при replaceChild (ItemsRenderer.updateTextBlock) не осталось зависших
     * observer'ов на detached-узлах — предотвращает утечки памяти.
     */
    createTextBlockElement(textBlock, node) {
        // Teardown: если в DOM уже есть редактор с тем же id — отключаем его observer.
        const oldEditor = document.querySelector(
            `.textblock-editor[data-text-block-id="${textBlock.id}"]`,
        );
        if (oldEditor && oldEditor.__capsuleObserver) {
            oldEditor.__capsuleObserver.disconnect();
            oldEditor.__capsuleObserver = null;
        }

        const section = document.createElement('div');
        section.className = RENDER_CLASSES.TEXTBLOCK_SECTION;
        section.dataset.textBlockId = textBlock.id;

        const editor = this.createEditor(textBlock);
        section.appendChild(editor);

        return section;
    },

    /**
     * Создаёт элемент редактора
     */
    createEditor(textBlock) {
        const editor = document.createElement('div');
        editor.className = RENDER_CLASSES.TEXTBLOCK_EDITOR;
        editor.dataset.textBlockId = textBlock.id;
        editor.dataset.placeholder = 'Введите текст...';
        // Sanitize: textBlock.content приходит из БД, мог быть сохранён до того,
        // как backend начнёт чистить через bleach. DOMPurify обрабатывает любой
        // вектор stored-XSS на клиенте.
        SafeHTML.set(editor, textBlock.content || '');

        // O1: чиним уже-битые капсулы старых актов при открытии (дубль-id и т.п.).
        if (this.validateAndRepairCapsules) {
            SafeHTML.set(editor, this.validateAndRepairCapsules(editor.innerHTML));
        }

        // BUG-2.2: бэк-санитайзер (bleach, html_sanitizer.py) срезает с маркеров
        // contenteditable — его НЕТ в allowlist'е span-атрибутов (рантайм-only,
        // как data-footnote-number). Возвращаем его при каждом рендере из
        // сохранённого контента, иначе после reload капсула редактируема:
        // каретка заходит внутрь, а Enter у её границы клонирует маркер.
        this.normalizeMarkers(editor);

        // B-26: начальное состояние пустоты — JS-класс, не CSS :empty
        // (:empty ненадёжен в contenteditable: после ввода/удаления остаётся <br>/<div>).
        this._toggleEmptyClass(editor);

        // Привязываем tooltip к ссылкам/сноскам сразу при создании
        this._attachInitialTooltipHandlers(editor);

        // Отключаем редактирование в режиме только чтения
        if (AppConfig.readOnlyMode?.isReadOnly) {
            editor.contentEditable = 'false';
            editor.classList.add('read-only');
        } else {
            editor.contentEditable = 'true';
            this.attachEditorEvents(editor, textBlock);
            // Слой 3: MutationObserver-страховка целостности капсул.
            this.installCapsuleObserver(editor);
        }

        this.applyFormatting(editor, textBlock.formatting);

        return editor;
    },

    /**
     * BUG-2.2 + каретка (гибрид Варианта 2): рантайм-нормализация маркеров при
     * каждом рендере/структурной правке. Делает две вещи:
     *  1. Ре-применяет contenteditable="false" ко всем .text-link/.text-footnote.
     *     Атрибут НЕ хранится в БД (бэк-санитайзер его срезает, он рантайм-only,
     *     как data-footnote-number); без ре-применения после reload капсула
     *     редактируема.
     *  2. Расставляет невидимые caret-guard'ы (U+FEFF) у проблемных границ
     *     капсул (ведущая/хвостовая/смежные), где браузер не даёт поставить
     *     каретку рядом с contenteditable=false-атомом. Идемпотентно: сначала
     *     снимаем все старые guard'ы, потом расставляем заново. Guard'ы живут
     *     ТОЛЬКО в живом DOM — стрипаются при сохранении (_stripGuards) и на
     *     DOCX-экспорте, в БД/превью/Word не попадают. guard=U+FEFF, НЕ U+200B
     *     (последний занят якорем размера в applyFontSize).
     * @param {HTMLElement} editor
     */
    normalizeMarkers(editor) {
        if (!editor || typeof editor.querySelectorAll !== 'function') return;
        editor.querySelectorAll('.text-link, .text-footnote').forEach(marker => {
            if (marker.getAttribute('contenteditable') !== 'false') {
                marker.setAttribute('contenteditable', 'false');
            }
        });
        this._cleanCapGuards(editor);
        this._placeCapGuards(editor);
    },

    /** Символ-«пустышка» caret-guard'а (U+FEFF, BOM/zero-width-no-break-space). */
    CAP_GUARD_CHAR: '\uFEFF',

    /** @private Узел — это inline-капсула (ссылка/сноска)? */
    _isCapsule(node) {
        return !!(node && node.nodeType === Node.ELEMENT_NODE && node.classList &&
            (node.classList.contains('text-link') || node.classList.contains('text-footnote')));
    },

    /** @private Текстовый узел — чистый caret-guard (один U+FEFF)? */
    _isGuardNode(node) {
        return !!(node && node.nodeType === Node.TEXT_NODE && node.data === this.CAP_GUARD_CHAR);
    },

    /** @private Узел — элемент переноса строки <br>? */
    _isBreak(node) {
        return !!(node && node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR');
    },

    /**
     * @private Узел НЕ даёт каретке видимой точки опоры рядом с капсулой:
     * пустой/zero-width текст (включая U+FEFF-guard и U+200B-якорь размера) ЛИБО
     * инлайн-элемент, состоящий ТОЛЬКО из zero-width-символов (например
     * span-якорь размера со вставленным U+200B из applyFontSize). Капсулы, <br>,
     * <img> и пустые элементы — НЕ zero-width (значимые границы/атомы).
     */
    _isZeroWidthNode(n) {
        if (!n) return false;
        if (n.nodeType === Node.TEXT_NODE) {
            return /^[\uFEFF\u200B]*$/.test(n.data);            // '' или только FEFF/ZWSP
        }
        if (n.nodeType === Node.ELEMENT_NODE && !this._isCapsule(n) && n.tagName !== 'BR') {
            const t = n.textContent || '';
            return t.length > 0 && /^[\uFEFF\u200B]+$/.test(t); // span ТОЛЬКО из zero-width (не <img>/пустой)
        }
        return false;
    },

    /**
     * @private Ближайший сосед, дающий каретке видимую точку опоры: пропускает
     * zero-width-узлы (_isZeroWidthNode) — иначе якорь размера (U+200B-span),
     * прилёгший к капсуле, маскировал бы границу строки и блокировал расстановку
     * guard'а (ломая вертикальную навигацию после смены размера). Возвращает
     * null / <br> / капсулу / значимый узел.
     */
    _caretHomeSibling(node, dir) {
        let n = node[dir];
        while (this._isZeroWidthNode(n)) n = n[dir];
        return n;
    },

    /** @private Текстовый узел незначим (пустой ИЛИ caret-guard U+FEFF). */
    _isInsignificantText(n) {
        return n && n.nodeType === Node.TEXT_NODE &&
            (n.data === '' || n.data === this.CAP_GUARD_CHAR);
    },

    /** @private Соседний значимый узел (пропускает пустые тексты и guard'ы). */
    _significantSibling(node, dir) {
        let n = node ? node[dir] : null;
        while (this._isInsignificantText(n)) n = n[dir];
        return n;
    },

    /** @private Первый значимый ребёнок (пропускает пустые/guard'ы). */
    _firstSignificantChild(editor) {
        let n = editor.firstChild;
        while (this._isInsignificantText(n)) n = n.nextSibling;
        return n;
    },

    /**
     * @private Снимает caret-guard'ы: чистые U+FEFF-узлы удаляет, а U+FEFF
     * ВНУТРИ текста с реальными символами (guard, в который успели напечатать)
     * срезает, сохраняя текст. Идемпотентно. U+200B (якорь размера) не трогает.
     */
    _cleanCapGuards(editor) {
        const guardChar = this.CAP_GUARD_CHAR;
        const toRemove = [];
        const walk = (node) => {
            let child = node.firstChild;
            while (child) {
                const next = child.nextSibling;
                if (child.nodeType === 3) {              // TEXT_NODE
                    if (child.data === guardChar) {
                        toRemove.push(child);
                    } else if (child.data && child.data.indexOf(guardChar) !== -1) {
                        child.data = child.data.split(guardChar).join('');
                    }
                } else if (child.nodeType === 1 && child.firstChild) {  // ELEMENT_NODE
                    walk(child);
                }
                child = next;
            }
        };
        if (editor && editor.firstChild) walk(editor);
        toRemove.forEach(t => { if (t.parentNode) t.parentNode.removeChild(t); });
    },

    /**
     * @private Ставит caret-guard'ы у проблемных границ капсул — там, где каретке
     * иначе негде приземлиться вплотную к contenteditable=false-атому: нет
     * обычного текста, а есть КРАЙ блока (начало/конец родителя), ПЕРЕНОС <br>
     * или другая капсула. Где сбоку обычный текст — guard НЕ ставим (каретка
     * встаёт штатно; guard'ы вокруг каждой капсулы ломали бы обычный ввод).
     * Зовётся ПОСЛЕ _cleanCapGuards (в DOM нет старых guard'ов).
     *
     * Ведущий guard важен и для капсулы в начале ВИЗУАЛЬНОЙ строки (первый
     * значимый ребёнок блока ИЛИ сразу после <br>): без него нативная Up/Down-
     * навигация Chromium проскакивает строку-капсулу, а после переноса перед
     * капсулой нельзя встать с клавиатуры (раньше покрывались только капсулы у
     * краёв самого редактора и пары смежных капсул).
     */
    _placeCapGuards(editor) {
        const g = () => document.createTextNode(this.CAP_GUARD_CHAR);
        editor.querySelectorAll('.text-link, .text-footnote').forEach(m => {
            // Ведущий guard: слева нет видимой точки опоры — край блока (null),
            // перенос (<br>) или капсула. _caretHomeSibling пропускает и
            // zero-width-якоря размера (U+200B-span), иначе они блокировали бы
            // guard и ломали вертикальную навигацию после смены размера.
            const prev = this._caretHomeSibling(m, 'previousSibling');
            if (prev === null || this._isBreak(prev) || this._isCapsule(prev)) {
                m.parentNode.insertBefore(g(), m);
            }
            // Хвостовой guard — только у края блока (null) или переноса (<br>):
            // между двумя смежными капсулами guard уже поставлен как ВЕДУЩИЙ у
            // правой, второй там не нужен.
            const next = this._caretHomeSibling(m, 'nextSibling');
            if (next === null || this._isBreak(next)) {
                m.parentNode.insertBefore(g(), m.nextSibling);
            }
        });
    },

    /**
     * @private Убирает caret-guard'ы (U+FEFF) из HTML-строки перед сохранением в
     * content/БД. Guard'ы — рантайм-only, в хранимый контент/превью/DOCX не
     * попадают. U+200B (якорь размера) сознательно НЕ трогаем.
     */
    _stripGuards(html) {
        return typeof html === 'string' ? html.split(this.CAP_GUARD_CHAR).join('') : html;
    },

    /**
     * Привязывает tooltip-обработчики к ссылкам/сноскам при начальном рендере
     * Обработчики будут заменены полным набором при фокусе редактора
     * @private
     */
    _attachInitialTooltipHandlers(editor) {
        const elements = editor.querySelectorAll('.text-link, .text-footnote');

        elements.forEach(element => {
            // Слушатели через per-element AbortController _lfAbort: при фокусе
            // редактора attachLinkFootnoteHandlers вызовет abort() и навесит
            // полный набор — initial tooltip-обработчики не задвоятся.
            if (element._lfAbort) element._lfAbort.abort();
            const controller = new AbortController();
            element._lfAbort = controller;
            const { signal } = controller;

            element.addEventListener('mouseenter', () => {
                this.tooltipTimeout = setTimeout(() => {
                    this.showTooltip(element);
                }, 700);
            }, { signal });

            element.addEventListener('mouseleave', () => {
                this.hideTooltip();
            }, { signal });
        });
    },

    /**
     * B-26: тоггл класса .textblock-editor--empty по реальной пустоте.
     * Пусто = нет видимого текста И нет значимых элементов (картинок/маркеров).
     * @private
     */
    _toggleEmptyClass(editor) {
        // U+FEFF (caret-guard) и U+200B (якорь размера) невидимы, но переживают
        // String.trim() — вычищаем их перед проверкой, иначе блок из одних
        // невидимок считался бы непустым и placeholder не показывался.
        const hasText = editor.textContent.replace(/[\uFEFF\u200B]/g, '').trim().length > 0;
        const hasInlineEl = editor.querySelector('.text-link, .text-footnote, img') !== null;
        editor.classList.toggle('textblock-editor--empty', !hasText && !hasInlineEl);
    },

    /**
     * Привязывает обработчики событий к редактору
     */
    attachEditorEvents(editor, textBlock) {
        editor.addEventListener('focus', () => this.handleEditorFocus(editor, textBlock));
        editor.addEventListener('blur', () => this.handleEditorBlur(editor, textBlock));
        editor.addEventListener('beforeinput', (e) => this.handleEditorBeforeInput(e, editor, textBlock));
        editor.addEventListener('input', () => this.handleEditorInput(editor, textBlock));
        editor.addEventListener('keydown', (e) => this.handleEditorKeydown(e, editor, textBlock));
        editor.addEventListener('paste', (e) => this.handleEditorPaste(e, editor, textBlock));
        editor.addEventListener('mouseup', () => this.handleSelectionChange());
        editor.addEventListener('keyup', () => this.handleSelectionChange());
    },

    /**
     * Обработчик фокуса редактора
     */
    handleEditorFocus(editor, textBlock) {
        this.setActiveEditor(editor);
        this.showToolbar();
        this.updateToolbarState();
        this.attachLinkFootnoteHandlers();

        // Применяем форматирование к ссылкам и сноскам при фокусе
        this.applyFormattingToNewNodes(editor);
    },

    /**
     * Обработчик потери фокуса
     */
    handleEditorBlur(editor, textBlock) {
        const s = this._stripGuards(editor.innerHTML);
        textBlock.content = this.validateAndRepairCapsules ? this.validateAndRepairCapsules(s) : s;

        // Точечный апдейт превью сразу при blur: input-debounce (500мс) мог не
        // успеть сработать, и превью оставалось бы с устаревшим текстом до
        // следующего ввода. Сбрасываем висящий save-таймер — он бы повторил
        // ту же работу. Тот же узкий патч, что у saveContent (updateBlock).
        if (editor.saveTimeout) {
            clearTimeout(editor.saveTimeout);
            editor.saveTimeout = null;
        }
        PreviewManager.updateBlock('textblock', textBlock.id);

        setTimeout(() => {
            // Ownership-guard: если фокус ушёл на ДРУГОЙ текстблок, его
            // handleEditorFocus уже выполнил setActiveEditor(B) → this.activeEditor
            // указывает на B, не на этот editor(A). Стейл-таймер A не должен гасить
            // тулбар, которым теперь владеет B (иначе тулбар мигает и пропадает при
            // каждом переходе между блоками). Прячем только когда ЭТОТ редактор всё
            // ещё активный владелец, а фокус ушёл наружу (не в редактор и не в тулбар).
            if (this.activeEditor === editor &&
                document.activeElement !== editor &&
                !this.globalToolbar?.contains(document.activeElement)) {
                this.hideToolbar();
                this.clearActiveEditor();
            }
        }, 200);
    },

    /**
     * Обработчик ввода с debounce
     */
    handleEditorInput(editor, textBlock) {
        // B-26: пустоту определяем синхронно при каждом вводе — мгновенный
        // показ/скрытие placeholder, без зависимости от save-debounce.
        this._toggleEmptyClass(editor);

        if (editor.saveTimeout) {
            clearTimeout(editor.saveTimeout);
        }

        editor.saveTimeout = setTimeout(() => {
            const s = this._stripGuards(editor.innerHTML);
            textBlock.content = this.validateAndRepairCapsules ? this.validateAndRepairCapsules(s) : s;

            if (typeof ChangelogTracker !== 'undefined') {
                ChangelogTracker._recordDebounced('modify_textblock', textBlock.id, '', {field: 'content'}, 5000);
            }

            // Применяем форматирование к новым ссылкам и сноскам
            this.applyFormattingToNewNodes(editor);

            // typing-flow: дополнительный 150 мс debounce поверх 500 мс save-debounce.
            // Контентная правка одного блока → точечный патч.
            PreviewManager.scheduleTypingBlock('textblock', textBlock.id);
        }, 500);
    },

    /**
     * Обработчик вставки. Стратегия «только ссылки» (4г): <a href> с абсолютной
     * схемой http/https/mailto → внутренний span.text-link, всё остальное
     * форматирование схлопывается в plain-text. Сноски из буфера не адаптируем.
     */
    handleEditorPaste(e, editor, textBlock) {
        e.preventDefault();

        const html = e.clipboardData.getData('text/html');
        const plain = e.clipboardData.getData('text/plain');

        // Нет HTML — прежний путь: только чистый текст.
        if (!html || !html.trim()) {
            document.execCommand('insertText', false, plain);
            this.saveContent(editor.dataset.textBlockId, editor.innerHTML);
            this._toggleEmptyClass(editor);
            return;
        }

        const fragment = this._buildPasteFragment(html);

        const selection = window.getSelection();
        if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            // Атомарность: если выделение клипает капсулу, deleteContents клонирует
            // её. Расширяем границы за целые капсулы перед удалением/вставкой.
            if (typeof this._expandRangeOutOfMarkers === 'function') {
                this._expandRangeOutOfMarkers(range);
            }
            range.deleteContents();
            range.insertNode(fragment);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
        } else {
            // Нет каретки — деградируем до plain-text.
            document.execCommand('insertText', false, plain);
        }

        this.normalizeMarkers(editor);
        this.saveContent(editor.dataset.textBlockId, editor.innerHTML);
        // BUG-4: навешиваем ПОЛНЫЙ набор обработчиков (tooltip/contextmenu/
        // dblclick/клик-каретка) на вставленные маркеры сразу. Иначе ссылка из
        // Word оживала (наведение/редактирование) только при следующем фокусе —
        // перезаход на шаг, перезагрузка или клик в другое поле и обратно.
        this.attachLinkFootnoteHandlers();
        // Наследуем форматирование на новые маркеры (как при ручном создании).
        this.applyFormattingToNewNodes(editor);
        this._toggleEmptyClass(editor);
    },

    /**
     * 4г: строит DocumentFragment из вставленного HTML. <a href> на ЛЮБОЙ глубине
     * → span.text-link (фабрика createLinkMarker, C5); прочий текст → textContent.
     * Структура (абзацы/списки) теряется сознательно — режим «только ссылки».
     * Word оборачивает <a> в mso-разметку, поэтому обходим всё дерево рекурсивно
     * (а не только top-level), иначе вложенная ссылка терялась бы (BUG-4).
     * Схему href валидирует validateLinkUrl (http/https/mailto/tel/ftp/file/#),
     * как и при ручном вводе.
     * @private
     */
    _buildPasteFragment(html) {
        // DOMPurify сводит вход к <a href> + блочной разметке + тексту; прочее
        // вырезается (KEEP_CONTENT=true по умолчанию сохраняет текст внутри
        // удалённых тегов). BUG-4: дефолтный ALLOWED_URI_REGEXP вырезает href со
        // схемой file: (ссылка на локальный файл терялась). Расширяем allowlist
        // схем до http/https/ftp/file/mailto/tel + относительные/якоря;
        // javascript:/data:/vbscript: regex по-прежнему отбивает. Финальный гейт
        // схемы — validateLinkUrl в _collectPasteNodes. BUG-5: разрешаем
        // блочные теги br/p/div/li, чтобы _collectPasteNodes восстановил
        // переносы абзацев (Word размечает их <p class=MsoNormal>); теги инертны
        // и без атрибутов (ALLOWED_ATTR=['href']) — XSS-вектора не несут.
        const clean = SafeHTML.sanitize(html, {
            USE_PROFILES: false,
            ALLOWED_TAGS: ['a', 'br', 'p', 'div', 'li'],
            ALLOWED_ATTR: ['href'],
            ALLOWED_URI_REGEXP: /^(?:(?:https?|ftp|file|mailto|tel):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
        });

        const tmp = document.createElement('div');
        tmp.innerHTML = clean; // clean уже прошёл DOMPurify — безопасно для парсинга
        const fragment = document.createDocumentFragment();
        this._collectPasteNodes(tmp, fragment);
        // BUG-5: хвостовой перенос после последнего абзаца не нужен.
        while (fragment.lastChild
            && fragment.lastChild.nodeType === Node.ELEMENT_NODE
            && fragment.lastChild.tagName === 'BR') {
            fragment.removeChild(fragment.lastChild);
        }
        return fragment;
    },

    /**
     * BUG-4: рекурсивный DFS-обход вставленного фрагмента с сохранением порядка.
     * <a> превращается в маркер ссылки (внутрь не спускаемся — текст уже взят);
     * прочие элементы рекурсируем (ищем вложенные <a>); текстовые узлы — как есть.
     * validateLinkUrl лежит в window (избегаем циклического импорта с
     * links-footnotes.js, который держит порядок инициализации handleEditorFocus).
     * @private
     */
    _collectPasteNodes(root, fragment) {
        const BLOCK = new Set(['P', 'DIV', 'LI']);
        const isBlockEl = (n) => n && n.nodeType === Node.ELEMENT_NODE && BLOCK.has(n.tagName);
        root.childNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'A') {
                const href = (node.getAttribute('href') || '').trim();
                const text = node.textContent.replace(/\s+/g, ' ').trim();
                const verdict = href && window.validateLinkUrl
                    ? window.validateLinkUrl(href) : { ok: false };
                if (text && verdict.ok) {
                    fragment.appendChild(this.createLinkMarker(text, verdict.url));
                } else if (node.textContent) {
                    fragment.appendChild(document.createTextNode(node.textContent));
                }
            } else if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'BR') {
                // BUG-5: явный перенос строки внутри абзаца.
                this._appendPasteBreak(fragment);
            } else if (isBlockEl(node)) {
                // BUG-5: содержимое блока + перенос-разделитель абзаца после него.
                this._collectPasteNodes(node, fragment);
                this._appendPasteBreak(fragment);
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                this._collectPasteNodes(node, fragment);
            } else if (node.nodeType === Node.TEXT_NODE && node.textContent) {
                // BUG-5: пропускаем чисто-пробельный форматирующий whitespace
                // МЕЖДУ блоками (перевод строки между </p> и <p>) — иначе
                // появился бы лишний пробел; внутри-абзацные пробелы сохраняем.
                const blank = !node.textContent.trim();
                if (blank && (isBlockEl(node.previousElementSibling) || isBlockEl(node.nextElementSibling))) {
                    return;
                }
                fragment.appendChild(document.createTextNode(node.textContent));
            }
        });
    },

    /**
     * BUG-5: добавляет перенос строки <br> во фрагмент вставки без ведущих и
     * двойных переносов (не ставит первым узлом и не задваивает подряд).
     * @private
     */
    _appendPasteBreak(fragment) {
        const last = fragment.lastChild;
        if (!last) return;
        if (last.nodeType === Node.ELEMENT_NODE && last.tagName === 'BR') return;
        fragment.appendChild(document.createElement('br'));
    },

    /**
     * Обработчик клавиш
     */
    handleEditorKeydown(e, editor, textBlock) {
        // Все горячие клавиши: Ctrl+Shift+* (e.code — независимо от раскладки)
        if ((e.ctrlKey || e.metaKey) && e.shiftKey) {
            switch (e.code) {
                case 'KeyB':
                    e.preventDefault();
                    this.execCommand('bold');
                    this.updateToolbarState();
                    break;
                case 'KeyI':
                    e.preventDefault();
                    this.execCommand('italic');
                    this.updateToolbarState();
                    break;
                case 'KeyU':
                    e.preventDefault();
                    this.execCommand('underline');
                    this.updateToolbarState();
                    break;
                case 'KeyX':
                    e.preventDefault();
                    this.execCommand('strikeThrough');
                    this.updateToolbarState();
                    break;
                case 'KeyK':
                    e.preventDefault();
                    this.createOrEditLink();
                    break;
                case 'KeyF':
                    e.preventDefault();
                    this.createOrEditFootnote();
                    break;
                case 'KeyA':
                    e.preventDefault();
                    this.cycleAlignment();
                    this.updateToolbarState();
                    break;
                case 'Period':
                    e.preventDefault();
                    this.stepFontSize(1);
                    this.updateToolbarState();
                    break;
                case 'Comma':
                    e.preventDefault();
                    this.stepFontSize(-1);
                    this.updateToolbarState();
                    break;
            }
        }

        // Каретка у границы капсулы с КЛАВИАТУРЫ (Home/←/→) — приземляется в
        // caret-guard у ведущей/хвостовой капсулы (мышь делает то же через
        // click-обработчик). Только «голые» стрелки/Home, без модификаторов.
        if (!e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey &&
            this._handleCapsuleCaretKey(e, editor)) {
            return;
        }

        // BUG-6: Enter у границы inline-маркера (contenteditable=false). Нативный
        // SplitBlock расщепляет/клонирует маркер — фантомные пустые капсулы и
        // задвоение нумерации сносок. Перехватываем и вставляем перенос вручную,
        // не расщепляя маркер: контент до каретки остаётся на строке, маркер
        // уходит на новую (либо появляется пустая строка над ведущим маркером).
        if (e.key === 'Enter' && !e.shiftKey) {
            const sel = window.getSelection();
            if (sel && sel.isCollapsed && sel.rangeCount > 0) {
                const range = sel.getRangeAt(0);
                const { before, after } = this._caretAdjacentMarkers(range);
                if (before || after) {
                    e.preventDefault();
                    const br = document.createElement('br');
                    range.insertNode(br);
                    if (after) {
                        // Капсула уходит в начало новой строки. Ставим стойкий
                        // caret-guard перед ней и каретку в нём — той же ленивой
                        // установкой, что делает клик мышью; иначе перед
                        // капсулой-в-начале-строки клавиатурой не встать
                        // (эфемерная setStartAfter(br)-позиция не закреплена в
                        // узле, а normalizeMarkers тут не зовётся).
                        this._placeCaretBesideMarker(after, false);
                    } else {
                        const caret = document.createRange();
                        caret.setStartAfter(br);
                        caret.collapse(true);
                        sel.removeAllRanges();
                        sel.addRange(caret);
                    }
                    this.saveContent(editor.dataset.textBlockId, editor.innerHTML);
                    this.renumberEditorFootnotes();
                    this._toggleEmptyClass(editor);
                    return;
                }
            }
        }

        // Shift+Enter - двойной перенос
        if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            this.execCommand('insertHTML', '<br><br>');
        }
        // Escape - выход
        else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            editor.blur();
        }
    },

    /**
     * Обработчик изменения выделения
     */
    handleSelectionChange() {
        if (this.activeEditor) {
            this.updateToolbarState();
        }
    },

    /**
     * Каретка у границы капсулы с КЛАВИАТУРЫ (гибрид Варианта 2): Home / ←/→ у
     * ведущей/хвостовой капсулы ставит каретку в её caret-guard через
     * _placeCaretBesideMarker — ту же точку приземления, что и клик мышью.
     * Возвращает true, если перехватил клавишу.
     * @private
     */
    _handleCapsuleCaretKey(e, editor) {
        const sel = window.getSelection();
        if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return false;
        const range = sel.getRangeAt(0);

        if (e.key === 'Home') {
            // Строка начинается капсулой → каретка перед ней (в guard).
            const first = this._firstSignificantChild(editor);
            if (this._isCapsule(first)) {
                e.preventDefault();
                this._placeCaretBesideMarker(first, false);
                return true;
            }
            return false;
        }
        if (e.key === 'ArrowLeft') {
            // Капсула слева, и слева от НЕЁ нет реального контента (ведущая) →
            // встаём ПЕРЕД ней (в guard), а не «проскакиваем» в пустоту.
            const { before } = this._caretAdjacentMarkers(range);
            if (before && !this._significantSibling(before, 'previousSibling')) {
                e.preventDefault();
                this._placeCaretBesideMarker(before, false);
                return true;
            }
            return false;
        }
        if (e.key === 'ArrowRight') {
            const { after } = this._caretAdjacentMarkers(range);
            if (after && !this._significantSibling(after, 'nextSibling')) {
                e.preventDefault();
                this._placeCaretBesideMarker(after, true);
                return true;
            }
            return false;
        }
        return false;
    },

    /**
     * BUG-6: возвращает inline-маркеры (.text-link/.text-footnote), непосредственно
     * примыкающие к схлопнутой каретке слева (before) и справа (after). Пустые
     * текстовые узлы пропускаются. Используется для перехвата Enter у границы
     * маркера, где нативный SplitBlock клонировал бы contenteditable=false узел.
     * @private
     */
    _caretAdjacentMarkers(range) {
        const c = range.startContainer;
        const o = range.startOffset;
        let beforeNode = null;
        let afterNode = null;
        if (c.nodeType === Node.TEXT_NODE) {
            if (o > 0 && o < c.length) return { before: null, after: null }; // внутри текста — границы нет
            if (o === 0) {
                beforeNode = c.previousSibling;
                afterNode = c.length === 0 ? c.nextSibling : null;
            } else { // o === c.length
                beforeNode = c.length === 0 ? c.previousSibling : null;
                afterNode = c.nextSibling;
            }
        } else {
            beforeNode = c.childNodes[o - 1] || null;
            afterNode = c.childNodes[o] || null;
        }
        // Пропускаем пустые текстовые узлы И caret-guard'ы (U+FEFF) — иначе
        // guard между кареткой и капсулой «спрятал» бы маркер от перехвата Enter.
        const skipEmpty = (n, dir) => {
            while (n && n.nodeType === Node.TEXT_NODE &&
                (n.data === '' || n.data === this.CAP_GUARD_CHAR)) n = n[dir];
            return n;
        };
        beforeNode = skipEmpty(beforeNode, 'previousSibling');
        afterNode = skipEmpty(afterNode, 'nextSibling');
        const isMarker = (n) => n && n.nodeType === Node.ELEMENT_NODE && n.classList &&
            (n.classList.contains('text-link') || n.classList.contains('text-footnote'));
        return { before: isMarker(beforeNode) ? beforeNode : null, after: isMarker(afterNode) ? afterNode : null };
    }
});
