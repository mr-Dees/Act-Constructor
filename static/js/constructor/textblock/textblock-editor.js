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
     * Создаёт DOM-элемент текстового блока с редактором
     */
    createTextBlockElement(textBlock, node) {
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
        }

        this.applyFormatting(editor, textBlock.formatting);

        return editor;
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
        const hasText = editor.textContent.trim().length > 0;
        const hasInlineEl = editor.querySelector('.text-link, .text-footnote, img') !== null;
        editor.classList.toggle('textblock-editor--empty', !hasText && !hasInlineEl);
    },

    /**
     * Привязывает обработчики событий к редактору
     */
    attachEditorEvents(editor, textBlock) {
        editor.addEventListener('focus', () => this.handleEditorFocus(editor, textBlock));
        editor.addEventListener('blur', () => this.handleEditorBlur(editor, textBlock));
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
        textBlock.content = editor.innerHTML;

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
            textBlock.content = editor.innerHTML;

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
            range.deleteContents();
            range.insertNode(fragment);
            range.collapse(false);
            selection.removeAllRanges();
            selection.addRange(range);
        } else {
            // Нет каретки — деградируем до plain-text.
            document.execCommand('insertText', false, plain);
        }

        this.saveContent(editor.dataset.textBlockId, editor.innerHTML);
        // Наследуем форматирование на новые маркеры (как при ручном создании).
        this.applyFormattingToNewNodes(editor);
        this._toggleEmptyClass(editor);
    },

    /**
     * 4г: строит DocumentFragment из вставленного HTML. <a href> с абсолютной
     * схемой (http/https/mailto) → span.text-link (фабрика createLinkMarker, C5);
     * любой другой узел → его textContent. Структура (абзацы/списки) теряется
     * сознательно — режим «только ссылки», без рассинхрона с бэк-санитайзером.
     * @private
     */
    _buildPasteFragment(html) {
        // DOMPurify сводит вход к <a href>…</a> + текст; остальное вырезается
        // (KEEP_CONTENT=true по умолчанию сохраняет текст внутри удалённых тегов).
        const clean = SafeHTML.sanitize(html, {
            USE_PROFILES: false,
            ALLOWED_TAGS: ['a'],
            ALLOWED_ATTR: ['href'],
        });

        const tmp = document.createElement('div');
        tmp.innerHTML = clean; // clean уже прошёл DOMPurify — безопасно для парсинга
        const fragment = document.createDocumentFragment();

        tmp.childNodes.forEach((node) => {
            if (node.nodeType === Node.ELEMENT_NODE && node.tagName === 'A') {
                const url = (node.getAttribute('href') || '').trim();
                const text = node.textContent.trim();
                // Только абсолютные http/https/mailto становятся ссылкой; без
                // схемы/относительные (paste НЕ подставляет https://) → текст.
                if (text && /^(https?:\/\/|mailto:)/i.test(url)) {
                    fragment.appendChild(this.createLinkMarker(text, url));
                } else if (node.textContent) {
                    fragment.appendChild(document.createTextNode(node.textContent));
                }
            } else if (node.textContent) {
                fragment.appendChild(document.createTextNode(node.textContent));
            }
        });
        return fragment;
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
                    const caret = document.createRange();
                    caret.setStartAfter(br);
                    caret.collapse(true);
                    sel.removeAllRanges();
                    sel.addRange(caret);
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
        const skipEmpty = (n, dir) => {
            while (n && n.nodeType === Node.TEXT_NODE && n.data === '') n = n[dir];
            return n;
        };
        beforeNode = skipEmpty(beforeNode, 'previousSibling');
        afterNode = skipEmpty(afterNode, 'nextSibling');
        const isMarker = (n) => n && n.nodeType === Node.ELEMENT_NODE && n.classList &&
            (n.classList.contains('text-link') || n.classList.contains('text-footnote'));
        return { before: isMarker(beforeNode) ? beforeNode : null, after: isMarker(afterNode) ? afterNode : null };
    }
});
