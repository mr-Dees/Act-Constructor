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
            if (document.activeElement !== editor &&
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
     * Обработчик вставки текста - удаляет все стили перед вставкой
     */
    handleEditorPaste(e, editor, textBlock) {
        e.preventDefault();

        // Получаем чистый текст из буфера обмена
        const text = e.clipboardData.getData('text/plain');

        // Вставляем только чистый текст без форматирования
        document.execCommand('insertText', false, text);

        // Сохраняем изменения
        const textBlockId = editor.dataset.textBlockId;
        this.saveContent(textBlockId, editor.innerHTML);
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
    }
});
