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
        editor.contentEditable = 'true';
        editor.dataset.textBlockId = textBlock.id;
        editor.dataset.placeholder = 'Введите текст...';
        editor.innerHTML = textBlock.content || '';

        this.applyFormatting(editor, textBlock.formatting);
        this.attachEditorEvents(editor, textBlock);

        return editor;
    },

    /**
     * Применяет форматирование к редактору
     */
    applyFormatting(editor, formatting) {
        if (formatting.fontSize) {
            editor.style.fontSize = `${formatting.fontSize}px`;
        }
        if (formatting.alignment) {
            const alignmentMap = {
                'left': 'left',
                'center': 'center',
                'right': 'right',
                'justify': 'justify'
            };
            editor.style.textAlign = alignmentMap[formatting.alignment] || 'left';
        }
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
        // Обработка горячих клавиш
        if (e.ctrlKey || e.metaKey) {
            switch (e.key.toLowerCase()) {
                case 'b':
                    e.preventDefault();
                    this.execCommand('bold');
                    this.updateToolbarState();
                    break;
                case 'i':
                    e.preventDefault();
                    this.execCommand('italic');
                    this.updateToolbarState();
                    break;
                case 'u':
                    e.preventDefault();
                    this.execCommand('underline');
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
