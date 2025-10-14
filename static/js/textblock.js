// Управление текстовыми блоками

class TextBlockManager {
    constructor() {
        this.selectedTextBlock = null;
        this.globalToolbar = null;
        this.activeEditor = null;
    }

    // Инициализация глобальной панели инструментов
    initGlobalToolbar() {
        // Проверяем, есть ли уже панель
        if (document.getElementById('globalTextBlockToolbar')) {
            return;
        }

        const toolbar = document.createElement('div');
        toolbar.id = 'globalTextBlockToolbar';
        toolbar.className = 'textblock-toolbar-global hidden';
        toolbar.innerHTML = `
            <div class="toolbar-label">Форматирование текста:</div>
            <button class="toolbar-btn" data-action="bold" title="Жирный"><b>B</b></button>
            <button class="toolbar-btn" data-action="italic" title="Курсив"><i>I</i></button>
            <button class="toolbar-btn" data-action="underline" title="Подчеркнутый"><u>U</u></button>
            <span class="toolbar-separator">|</span>
            <button class="toolbar-btn" data-action="justifyLeft" title="По левому краю">⬅</button>
            <button class="toolbar-btn" data-action="justifyCenter" title="По центру">↔</button>
            <button class="toolbar-btn" data-action="justifyRight" title="По правому краю">➡</button>
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

        // Вставить панель в начало контейнера шага 2
        const step2Container = document.getElementById('step2');
        if (step2Container) {
            const itemsContainer = document.getElementById('itemsContainer');
            if (itemsContainer) {
                step2Container.insertBefore(toolbar, itemsContainer);
            }
        }

        this.globalToolbar = toolbar;
        this.attachToolbarEvents();
    }

    // Привязка событий к кнопкам панели
    attachToolbarEvents() {
        if (!this.globalToolbar) return;

        // Обработка кнопок форматирования
        this.globalToolbar.querySelectorAll('.toolbar-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                const action = btn.dataset.action;
                if (this.activeEditor) {
                    this.activeEditor.focus();
                    document.execCommand(action);

                    // Сохранить изменения в состоянии
                    const textBlockId = this.activeEditor.dataset.textBlockId;
                    const textBlock = AppState.textBlocks[textBlockId];
                    if (textBlock) {
                        textBlock.content = this.activeEditor.innerHTML;
                    }
                }
            });
        });

        // Обработка выбора размера шрифта
        const fontSizeSelect = this.globalToolbar.querySelector('#fontSizeSelect');
        if (fontSizeSelect) {
            fontSizeSelect.addEventListener('change', (e) => {
                if (this.activeEditor) {
                    this.activeEditor.focus();
                    this.activeEditor.style.fontSize = e.target.value + 'px';

                    const textBlockId = this.activeEditor.dataset.textBlockId;
                    const textBlock = AppState.textBlocks[textBlockId];
                    if (textBlock) {
                        textBlock.formatting.fontSize = parseInt(e.target.value);
                        textBlock.content = this.activeEditor.innerHTML;
                    }
                }
            });
        }
    }

    // Показать панель инструментов
    showToolbar() {
        if (this.globalToolbar) {
            this.globalToolbar.classList.remove('hidden');
        }
    }

    // Скрыть панель инструментов
    hideToolbar() {
        if (this.globalToolbar) {
            this.globalToolbar.classList.add('hidden');
        }
    }

    // Создание элемента текстового блока для рендеринга на шаге 2 (БЕЗ заголовка)
    createTextBlockElement(textBlock, node) {
        const section = document.createElement('div');
        section.className = 'textblock-section';
        section.dataset.textBlockId = textBlock.id;

        // Редактор текста (БЕЗ заголовка на шаге 2)
        const editor = document.createElement('div');
        editor.className = 'textblock-editor';
        editor.contentEditable = true;
        editor.dataset.textBlockId = textBlock.id;
        editor.innerHTML = textBlock.content || '';

        // Применить форматирование
        this.applyFormatting(editor, textBlock.formatting);

        // События фокуса
        editor.addEventListener('focus', () => {
            this.activeEditor = editor;
            this.showToolbar();

            // Установить текущий размер шрифта в селект
            const fontSizeSelect = document.getElementById('fontSizeSelect');
            if (fontSizeSelect) {
                fontSizeSelect.value = textBlock.formatting.fontSize || 14;
            }
        });

        editor.addEventListener('blur', () => {
            // Сохранить при потере фокуса
            textBlock.content = editor.innerHTML;

            // Скрыть панель через небольшую задержку (чтобы клик по кнопке успел сработать)
            setTimeout(() => {
                if (document.activeElement !== editor &&
                    !this.globalToolbar?.contains(document.activeElement)) {
                    this.hideToolbar();
                    this.activeEditor = null;
                }
            }, 200);
        });

        // Сохранение изменений при вводе (debounced)
        let saveTimeout;
        editor.addEventListener('input', () => {
            clearTimeout(saveTimeout);
            saveTimeout = setTimeout(() => {
                textBlock.content = editor.innerHTML;
            }, 500);
        });

        section.appendChild(editor);

        return section;
    }

    // Применение форматирования к редактору
    applyFormatting(editor, formatting) {
        if (formatting.fontSize) {
            editor.style.fontSize = formatting.fontSize + 'px';
        }
        if (formatting.alignment) {
            editor.style.textAlign = formatting.alignment;
        }
    }
}

const textBlockManager = new TextBlockManager();
