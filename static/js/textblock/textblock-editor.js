/**
 * Расширение для работы с редактором
 */
Object.assign(TextBlockManager.prototype, {
    /**
     * Создаёт DOM-элемент текстового блока с редактором
     */
    createTextBlockElement(textBlock, node) {
        const section = document.createElement('div');
        section.className = 'textblock-section';
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
        editor.className = 'textblock-editor';
        editor.dataset.textBlockId = textBlock.id;
        editor.dataset.placeholder = 'Введите текст...';
        editor.innerHTML = textBlock.content || '';

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
            element._mouseenterHandler = () => {
                this.tooltipTimeout = setTimeout(() => {
                    this.showTooltip(element);
                }, 700);
            };

            element._mouseleaveHandler = () => {
                this.hideTooltip();
            };

            element.addEventListener('mouseenter', element._mouseenterHandler);
            element.addEventListener('mouseleave', element._mouseleaveHandler);
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

            // Применяем форматирование к новым ссылкам и сноскам
            this.applyFormattingToNewNodes(editor);

            PreviewManager.update();
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
