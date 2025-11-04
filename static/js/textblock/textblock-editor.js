/**
 * Расширение TextBlockManager для работы с редактором
 */
Object.assign(TextBlockManager.prototype, {
    /**
     * Создаёт DOM-элемент текстового блока с редактором
     * @param {Object} textBlock - Объект текстового блока из состояния приложения
     * @param {Object} node - Узел дерева документа, к которому привязан блок
     * @returns {HTMLElement} Готовый DOM-элемент секции с редактором
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
     * @param {Object} textBlock - Объект текстового блока
     * @returns {HTMLElement} Элемент редактора
     */
    createEditor(textBlock) {
        const editor = document.createElement('div');
        editor.className = 'textblock-editor';
        editor.contentEditable = 'true';
        editor.dataset.textBlockId = textBlock.id;
        editor.innerHTML = textBlock.content || '';

        this.applyFormatting(editor, textBlock.formatting);
        this.attachEditorEvents(editor, textBlock);

        return editor;
    },

    /**
     * Привязывает обработчики событий к редактору
     * @param {HTMLElement} editor - Элемент редактора
     * @param {Object} textBlock - Объект текстового блока
     */
    attachEditorEvents(editor, textBlock) {
        editor.addEventListener('focus', () => this.handleEditorFocus(editor, textBlock));
        editor.addEventListener('blur', () => this.handleEditorBlur(editor, textBlock));
        editor.addEventListener('input', () => this.handleEditorInput(editor, textBlock));
        editor.addEventListener('keydown', (e) => this.handleEditorKeydown(e, editor, textBlock));
    },

    /**
     * Обработчик фокуса редактора
     * @param {HTMLElement} editor - Элемент редактора
     * @param {Object} textBlock - Объект текстового блока
     */
    handleEditorFocus(editor, textBlock) {
        this.setActiveEditor(editor);
        this.showToolbar();
        this.syncToolbar(textBlock);
    },

    /**
     * Обработчик потери фокуса редактора
     * @param {HTMLElement} editor - Элемент редактора
     * @param {Object} textBlock - Объект текстового блока
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
     * Обработчик ввода в редакторе с debounce
     * @param {HTMLElement} editor - Элемент редактора
     * @param {Object} textBlock - Объект текстового блока
     */
    handleEditorInput(editor, textBlock) {
        if (editor.saveTimeout) {
            clearTimeout(editor.saveTimeout);
        }

        editor.saveTimeout = setTimeout(() => {
            textBlock.content = editor.innerHTML;
            PreviewManager.update();
        }, 500);
    },

    /**
     * Обработчик нажатий клавиш в редакторе
     * @param {KeyboardEvent} e - Событие клавиатуры
     * @param {HTMLElement} editor - Элемент редактора
     * @param {Object} textBlock - Объект текстового блока
     */
    handleEditorKeydown(e, editor, textBlock) {
        if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            document.execCommand('insertHTML', false, '<br><br>');
            textBlock.content = editor.innerHTML;
            PreviewManager.update();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            textBlock.content = editor.innerHTML;
            PreviewManager.update();
            editor.blur();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            editor.blur();
        }
    }
});
