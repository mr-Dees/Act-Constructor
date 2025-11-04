/**
 * Расширение TextBlockManager для работы с панелью инструментов
 */
Object.assign(TextBlockManager.prototype, {
    /**
     * Инициализирует глобальную панель инструментов для форматирования текста
     * Создаёт элемент тулбара с кнопками форматирования и добавляет его в DOM
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
    },

    /**
     * Привязывает обработчики событий к элементам панели инструментов
     * Настраивает кнопки форматирования и выбор размера шрифта
     */
    attachToolbarEvents() {
        if (!this.globalToolbar) return;

        this.globalToolbar.querySelectorAll('.toolbar-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                this.handleToolbarAction(btn.dataset.action);
            });
        });

        const fontSizeSelect = this.globalToolbar.querySelector('#fontSizeSelect');
        if (fontSizeSelect) {
            fontSizeSelect.addEventListener('change', (e) => {
                this.handleFontSizeChange(parseInt(e.target.value));
            });
        }
    },

    /**
     * Обрабатывает действие форматирования из тулбара
     * @param {string} action - Команда форматирования
     */
    handleToolbarAction(action) {
        if (!this.activeEditor) return;

        this.activeEditor.focus();
        document.execCommand(action);

        const textBlockId = this.activeEditor.dataset.textBlockId;
        this.saveContent(textBlockId, this.activeEditor.innerHTML);
    },

    /**
     * Обрабатывает изменение размера шрифта
     * @param {number} newSize - Новый размер шрифта в пикселях
     */
    handleFontSizeChange(newSize) {
        if (!this.activeEditor) return;

        this.activeEditor.style.fontSize = `${newSize}px`;

        const textBlockId = this.activeEditor.dataset.textBlockId;
        const textBlock = this.getTextBlock(textBlockId);
        if (textBlock) {
            textBlock.formatting.fontSize = newSize;
            textBlock.content = this.activeEditor.innerHTML;
            PreviewManager.update();
        }
    },

    /**
     * Синхронизирует тулбар с текущим редактором
     * @param {Object} textBlock - Объект текстового блока
     */
    syncToolbar(textBlock) {
        const fontSizeSelect = document.getElementById('fontSizeSelect');
        if (fontSizeSelect) {
            fontSizeSelect.value = textBlock.formatting?.fontSize || 14;
        }
    }
});
