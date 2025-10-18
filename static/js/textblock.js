class TextBlockManager {
    constructor() {
        this.selectedTextBlock = null;
        this.globalToolbar = null;
        this.activeEditor = null;
    }

    /**
     * Инициализация глобального тулбара
     */
    initGlobalToolbar() {
        if (document.getElementById('globalTextBlockToolbar')) return;

        const toolbar = document.createElement('div');
        toolbar.id = 'globalTextBlockToolbar';
        toolbar.className = 'textblock-toolbar-global hidden';
        toolbar.innerHTML = `
            <div class="toolbar-label">Форматирование текста:</div>
            <button class="toolbar-btn" data-action="bold" title="Жирный (Ctrl+B)"><strong>Ж</strong></button>
            <button class="toolbar-btn" data-action="italic" title="Курсив (Ctrl+I)"><em>К</em></button>
            <button class="toolbar-btn" data-action="underline" title="Подчёркнутый (Ctrl+U)"><u>П</u></button>
            <span class="toolbar-separator">|</span>
            <button class="toolbar-btn" data-action="justifyLeft" title="По левому краю">◧</button>
            <button class="toolbar-btn" data-action="justifyCenter" title="По центру">▥</button>
            <button class="toolbar-btn" data-action="justifyRight" title="По правому краю">◨</button>
            <span class="toolbar-separator">|</span>
            <select class="toolbar-select" id="fontSizeSelect">
                <option value="10">10px</option>
                <option value="12">12px</option>
                <option value="14" selected>14px</option>
                <option value="16">16px</option>
                <option value="18">18px</option>
                <option value="20">20px</option>
                <option value="24">24px</option>
                <option value="28">28px</option>
                <option value="32">32px</option>
            </select>
        `;

        document.body.appendChild(toolbar);
        this.globalToolbar = toolbar;
        this.attachToolbarEvents();
    }

    /**
     * Привязка событий к тулбару
     */
    attachToolbarEvents() {
        if (!this.globalToolbar) return;

        // Кнопки форматирования
        this.globalToolbar.querySelectorAll('.toolbar-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const action = btn.dataset.action;

                if (this.activeEditor) {
                    this.activeEditor.focus();
                    document.execCommand(action);

                    // Сохраняем контент
                    const textBlockId = this.activeEditor.dataset.textBlockId;
                    const textBlock = AppState.textBlocks[textBlockId];
                    if (textBlock) {
                        textBlock.content = this.activeEditor.innerHTML;
                    }

                    // Обновляем превью
                    PreviewManager.update();
                }
            });
        });

        // Размер шрифта
        const fontSizeSelect = this.globalToolbar.querySelector('#fontSizeSelect');
        if (fontSizeSelect) {
            fontSizeSelect.addEventListener('change', (e) => {
                if (this.activeEditor) {
                    const newSize = parseInt(e.target.value);
                    this.activeEditor.style.fontSize = `${newSize}px`;

                    const textBlockId = this.activeEditor.dataset.textBlockId;
                    const textBlock = AppState.textBlocks[textBlockId];
                    if (textBlock) {
                        textBlock.formatting.fontSize = newSize;
                        textBlock.content = this.activeEditor.innerHTML;
                    }

                    PreviewManager.update();
                }
            });
        }
    }

    /**
     * Показать тулбар
     */
    showToolbar() {
        if (this.globalToolbar) {
            this.globalToolbar.classList.remove('hidden');
        }
    }

    /**
     * Скрыть тулбар
     */
    hideToolbar() {
        if (this.globalToolbar) {
            this.globalToolbar.classList.add('hidden');
        }
    }

    /**
     * Создать элемент текстового блока
     */
    createTextBlockElement(textBlock, node) {
        const section = document.createElement('div');
        section.className = 'textblock-section';
        section.dataset.textBlockId = textBlock.id;

        // Редактор
        const editor = document.createElement('div');
        editor.className = 'textblock-editor';
        editor.contentEditable = 'true';
        editor.dataset.textBlockId = textBlock.id;
        editor.innerHTML = textBlock.content || '';

        // Применяем форматирование
        this.applyFormatting(editor, textBlock.formatting);

        // Focus - показываем тулбар и синхронизируем select
        editor.addEventListener('focus', () => {
            this.activeEditor = editor;
            this.showToolbar();

            const fontSizeSelect = document.getElementById('fontSizeSelect');
            if (fontSizeSelect) {
                fontSizeSelect.value = textBlock.formatting?.fontSize || 14;
            }
        });

        // Blur - скрываем тулбар с задержкой
        editor.addEventListener('blur', () => {
            textBlock.content = editor.innerHTML;

            setTimeout(() => {
                if (document.activeElement !== editor &&
                    !this.globalToolbar?.contains(document.activeElement)) {
                    this.hideToolbar();
                    this.activeEditor = null;
                }
            }, 200);
        });

        // Input - автосохранение с debounce
        let saveTimeout;
        editor.addEventListener('input', () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                textBlock.content = editor.innerHTML;
                PreviewManager.update();
            }, 500);
        });

        // Обработка Enter для создания <br>
        editor.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.shiftKey) {
                // Shift+Enter - перенос строки
                e.preventDefault();
                document.execCommand('insertHTML', false, '<br><br>');
                textBlock.content = editor.innerHTML;
                PreviewManager.update();
            }
            else if (e.key === 'Enter') {
                // Enter - принять и завершить редактирование
                e.preventDefault();
                textBlock.content = editor.innerHTML;
                PreviewManager.update();
                editor.blur();
            }
            // Обработка Escape для выхода
            else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                editor.blur();
            }

            // if (e.key === 'Enter') {
            //     e.preventDefault();
            //     document.execCommand('insertHTML', false, '<br><br>');
            //
            //     textBlock.content = editor.innerHTML;
            //     PreviewManager.update();
            // }
            //
            // // Обработка Escape для выхода
            // if (e.key === 'Escape') {
            //     e.preventDefault();
            //     e.stopPropagation();
            //     editor.blur();
            // }
        });

        section.appendChild(editor);
        return section;
    }

    /**
     * Применить форматирование к редактору
     */
    applyFormatting(editor, formatting) {
        if (formatting.fontSize) {
            editor.style.fontSize = `${formatting.fontSize}px`;
        }

        if (formatting.alignment) {
            editor.style.textAlign = formatting.alignment;
        }
    }
}

const textBlockManager = new TextBlockManager();
