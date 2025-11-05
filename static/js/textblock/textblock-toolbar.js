/**
 * Расширение для работы с панелью инструментов
 */
Object.assign(TextBlockManager.prototype, {
    /**
     * Инициализирует глобальную панель инструментов
     */
    initGlobalToolbar() {
        if (document.getElementById('globalTextBlockToolbar')) return;

        const toolbar = document.createElement('div');
        toolbar.id = 'globalTextBlockToolbar';
        toolbar.className = 'textblock-toolbar-global hidden';

        toolbar.innerHTML = `
            <div class="toolbar-group">
                <button class="toolbar-btn" data-command="bold" title="Жирный (Ctrl+B)">
                    <strong>Ж</strong>
                </button>
                <button class="toolbar-btn" data-command="italic" title="Курсив (Ctrl+I)">
                    <em>К</em>
                </button>
                <button class="toolbar-btn" data-command="underline" title="Подчёркнутый (Ctrl+U)">
                    <u>П</u>
                </button>
                <button class="toolbar-btn" data-command="strikeThrough" title="Зачёркнутый">
                    <s>З</s>
                </button>
            </div>
            
            <div class="toolbar-separator"></div>
            
            <div class="toolbar-group">
                <select class="toolbar-select" id="fontSizeSelect" title="Размер шрифта">
                    ${this.fontSizes.map(size =>
            `<option value="${size}" ${size === 14 ? 'selected' : ''}>${size}px</option>`
        ).join('')}
                </select>
            </div>
            
            <div class="toolbar-separator"></div>
            
            <div class="toolbar-group">
                <button class="toolbar-btn" data-command="justifyLeft" title="По левому краю">
                    ◧
                </button>
                <button class="toolbar-btn" data-command="justifyCenter" title="По центру">
                    ▥
                </button>
                <button class="toolbar-btn" data-command="justifyRight" title="По правому краю">
                    ◨
                </button>
                <button class="toolbar-btn" data-command="justifyFull" title="По ширине">
                    ▦
                </button>
            </div>
            
            <div class="toolbar-separator"></div>
            
            <div class="toolbar-group">
                <button class="toolbar-btn" data-command="createLink" title="Добавить гиперссылку (Ctrl+K)">
                    🔗
                </button>
                <button class="toolbar-btn" data-command="createFootnote" title="Добавить сноску">
                    📑
                </button>
            </div>
            
            <div class="toolbar-separator"></div>
            
            <div class="toolbar-group">
                <button class="toolbar-btn" data-command="removeFormat" title="Очистить форматирование">
                    ✕
                </button>
            </div>
        `;

        document.body.appendChild(toolbar);
        this.globalToolbar = toolbar;
        this.attachToolbarEvents();
    },

    /**
     * Привязывает обработчики событий к тулбару
     */
    attachToolbarEvents() {
        if (!this.globalToolbar) return;

        // Обработчики для кнопок форматирования
        this.globalToolbar.querySelectorAll('.toolbar-btn[data-command]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const command = btn.dataset.command;

                // Специальная обработка для ссылок и сносок
                if (command === 'createLink') {
                    this.createOrEditLink();
                } else if (command === 'createFootnote') {
                    this.createOrEditFootnote();
                } else {
                    this.execCommand(command);
                }

                this.updateToolbarState();
            });
        });

        // Обработчик размера шрифта
        const fontSizeSelect = this.globalToolbar.querySelector('#fontSizeSelect');
        if (fontSizeSelect) {
            fontSizeSelect.addEventListener('change', (e) => {
                this.applyFontSize(parseInt(e.target.value));
            });
        }
    },

    /**
     * Применяет размер шрифта к выделенному тексту или всему блоку
     */
    applyFontSize(fontSize) {
        if (!this.activeEditor) return;

        this.activeEditor.focus();

        const selection = window.getSelection();

        if (selection && !selection.isCollapsed && selection.rangeCount > 0) {
            // Применяем к выделенному тексту
            this.execCommand('fontSize', '7'); // Используем временное значение

            // Заменяем font tags на span с точным размером
            const fontTags = this.activeEditor.querySelectorAll('font[size="7"]');
            fontTags.forEach(font => {
                const span = document.createElement('span');
                span.style.fontSize = `${fontSize}px`;
                span.innerHTML = font.innerHTML;
                font.parentNode.replaceChild(span, font);
            });
        } else {
            // Применяем ко всему блоку
            this.activeEditor.style.fontSize = `${fontSize}px`;
        }

        const textBlockId = this.activeEditor.dataset.textBlockId;
        this.saveContent(textBlockId, this.activeEditor.innerHTML);
    },

    /**
     * Обновляет состояние кнопок тулбара
     */
    updateToolbarState() {
        if (!this.globalToolbar || !this.activeEditor) return;

        // Обновляем состояние кнопок форматирования
        this.globalToolbar.querySelectorAll('.toolbar-btn[data-command]').forEach(btn => {
            const command = btn.dataset.command;
            const isActive = this.queryCommandState(command);
            btn.classList.toggle('active', isActive);
        });

        // Обновляем размер шрифта
        this.updateFontSizeSelect();
    },

    /**
     * Обновляет выбранный размер шрифта в select
     */
    updateFontSizeSelect() {
        const fontSizeSelect = this.globalToolbar.querySelector('#fontSizeSelect');
        if (!fontSizeSelect) return;

        const selection = window.getSelection();
        let fontSize = 14;

        if (selection && selection.rangeCount > 0) {
            const range = selection.getRangeAt(0);
            const container = range.commonAncestorContainer;
            const element = container.nodeType === 3 ? container.parentElement : container;

            if (element && this.activeEditor.contains(element)) {
                const computedSize = window.getComputedStyle(element).fontSize;
                fontSize = parseInt(computedSize);
            }
        } else if (this.activeEditor) {
            const computedSize = window.getComputedStyle(this.activeEditor).fontSize;
            fontSize = parseInt(computedSize);
        }

        // Находим ближайшее значение из списка
        const closestSize = this.fontSizes.reduce((prev, curr) =>
            Math.abs(curr - fontSize) < Math.abs(prev - fontSize) ? curr : prev
        );

        fontSizeSelect.value = closestSize;
    }
});
