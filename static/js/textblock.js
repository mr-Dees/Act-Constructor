/**
 * Менеджер для управления текстовыми блоками
 * Отвечает за создание, редактирование и форматирование текстовых блоков в документе
 */
class TextBlockManager {
    /**
     * Создаёт экземпляр TextBlockManager
     */
    constructor() {
        // Текущий выбранный текстовый блок
        this.selectedTextBlock = null;
        // Ссылка на глобальную панель инструментов форматирования
        this.globalToolbar = null;
        // Активный редактор, в котором идёт редактирование
        this.activeEditor = null;
    }

    /**
     * Инициализирует глобальную панель инструментов для форматирования текста
     * Создаёт элемент тулбара с кнопками форматирования и добавляет его в DOM
     */
    initGlobalToolbar() {
        // Проверяем, не создан ли уже тулбар
        if (document.getElementById('globalTextBlockToolbar')) return;

        // Создаём контейнер тулбара
        const toolbar = document.createElement('div');
        toolbar.id = 'globalTextBlockToolbar';
        toolbar.className = 'textblock-toolbar-global hidden';

        // Заполняем тулбар элементами управления форматированием
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

        // Добавляем тулбар на страницу
        document.body.appendChild(toolbar);

        // Сохраняем ссылку на созданный тулбар
        this.globalToolbar = toolbar;

        // Подключаем обработчики событий к элементам тулбара
        this.attachToolbarEvents();
    }

    /**
     * Привязывает обработчики событий к элементам панели инструментов
     * Настраивает кнопки форматирования и выбор размера шрифта
     */
    attachToolbarEvents() {
        // Проверяем наличие тулбара
        if (!this.globalToolbar) return;

        // Обработчики для кнопок форматирования (жирный, курсив, выравнивание)
        this.globalToolbar.querySelectorAll('.toolbar-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();

                // Получаем действие форматирования из атрибута кнопки
                const action = btn.dataset.action;

                // Применяем форматирование к активному редактору
                if (this.activeEditor) {
                    // Возвращаем фокус в редактор
                    this.activeEditor.focus();

                    // Выполняем команду форматирования
                    document.execCommand(action);

                    // Сохраняем изменённый контент в состояние приложения
                    const textBlockId = this.activeEditor.dataset.textBlockId;
                    const textBlock = AppState.textBlocks[textBlockId];
                    if (textBlock) {
                        textBlock.content = this.activeEditor.innerHTML;
                    }

                    // Обновляем предпросмотр документа
                    PreviewManager.update();
                }
            });
        });

        // Обработчик для выбора размера шрифта
        const fontSizeSelect = this.globalToolbar.querySelector('#fontSizeSelect');
        if (fontSizeSelect) {
            fontSizeSelect.addEventListener('change', (e) => {
                if (this.activeEditor) {
                    // Получаем выбранный размер шрифта
                    const newSize = parseInt(e.target.value);

                    // Применяем размер к редактору
                    this.activeEditor.style.fontSize = `${newSize}px`;

                    // Сохраняем изменения в состояние
                    const textBlockId = this.activeEditor.dataset.textBlockId;
                    const textBlock = AppState.textBlocks[textBlockId];
                    if (textBlock) {
                        textBlock.formatting.fontSize = newSize;
                        textBlock.content = this.activeEditor.innerHTML;
                    }

                    // Обновляем предпросмотр
                    PreviewManager.update();
                }
            });
        }
    }

    /**
     * Показывает панель инструментов форматирования
     */
    showToolbar() {
        if (this.globalToolbar) {
            this.globalToolbar.classList.remove('hidden');
        }
    }

    /**
     * Скрывает панель инструментов форматирования
     */
    hideToolbar() {
        if (this.globalToolbar) {
            this.globalToolbar.classList.add('hidden');
        }
    }

    /**
     * Создаёт DOM-элемент текстового блока с редактором
     *
     * @param {Object} textBlock - Объект текстового блока из состояния приложения
     * @param {Object} node - Узел дерева документа, к которому привязан блок
     * @returns {HTMLElement} Готовый DOM-элемент секции с редактором
     */
    createTextBlockElement(textBlock, node) {
        // Создаём контейнер для текстового блока
        const section = document.createElement('div');
        section.className = 'textblock-section';
        section.dataset.textBlockId = textBlock.id;

        // Создаём редактор с поддержкой contentEditable
        const editor = document.createElement('div');
        editor.className = 'textblock-editor';
        editor.contentEditable = 'true';
        editor.dataset.textBlockId = textBlock.id;
        editor.innerHTML = textBlock.content || '';

        // Применяем сохранённое форматирование к редактору
        this.applyFormatting(editor, textBlock.formatting);

        // Обработчик фокуса - показываем тулбар и синхронизируем настройки
        editor.addEventListener('focus', () => {
            // Запоминаем активный редактор
            this.activeEditor = editor;

            // Показываем тулбар
            this.showToolbar();

            // Синхронизируем выбранный размер шрифта с тулбаром
            const fontSizeSelect = document.getElementById('fontSizeSelect');
            if (fontSizeSelect) {
                fontSizeSelect.value = textBlock.formatting?.fontSize || 14;
            }
        });

        // Обработчик потери фокуса - сохраняем изменения и скрываем тулбар
        editor.addEventListener('blur', () => {
            // Сохраняем контент
            textBlock.content = editor.innerHTML;

            // Скрываем тулбар с небольшой задержкой
            // Задержка нужна, чтобы успеть обработать клик по кнопкам тулбара
            setTimeout(() => {
                if (document.activeElement !== editor &&
                    !this.globalToolbar?.contains(document.activeElement)) {
                    this.hideToolbar();
                    this.activeEditor = null;
                }
            }, 200);
        });

        // Обработчик ввода - автоматическое сохранение с задержкой (debounce)
        let saveTimeout;
        editor.addEventListener('input', () => {
            // Отменяем предыдущий таймер сохранения
            clearTimeout(saveTimeout);

            // Запускаем новый таймер - сохранение через 500мс после последнего ввода
            saveTimeout = setTimeout(() => {
                textBlock.content = editor.innerHTML;
                PreviewManager.update();
            }, 500);
        });

        // Обработчик нажатий клавиш для специальных действий
        editor.addEventListener('keydown', (e) => {
            // Shift+Enter - добавить двойной перенос строки
            if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                document.execCommand('insertHTML', false, '<br><br>');
                textBlock.content = editor.innerHTML;
                PreviewManager.update();
            }
            // Enter - сохранить и завершить редактирование
            else if (e.key === 'Enter') {
                e.preventDefault();
                textBlock.content = editor.innerHTML;
                PreviewManager.update();
                editor.blur();
            }
            // Escape - выйти из редактора без дополнительных действий
            else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                editor.blur();
            }
        });

        // Добавляем редактор в контейнер секции
        section.appendChild(editor);

        return section;
    }

    /**
     * Применяет сохранённое форматирование к элементу редактора
     *
     * @param {HTMLElement} editor - DOM-элемент редактора
     * @param {Object} formatting - Объект с настройками форматирования
     */
    applyFormatting(editor, formatting) {
        // Применяем размер шрифта, если задан
        if (formatting.fontSize) {
            editor.style.fontSize = `${formatting.fontSize}px`;
        }

        // Применяем выравнивание текста, если задано
        if (formatting.alignment) {
            editor.style.textAlign = formatting.alignment;
        }
    }
}

// Создаём глобальный экземпляр менеджера текстовых блоков
const textBlockManager = new TextBlockManager();
