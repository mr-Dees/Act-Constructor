/**
 * Управление нарушениями в документе
 * Создает и обрабатывает интерактивные формы для ввода нарушений
 */
class ViolationManager {
    constructor() {
        this.selectedViolation = null;
    }

    /**
     * Создает элемент нарушения для отображения в интерфейсе
     * @param {Object} violation - Объект нарушения с полями (violated, established, и т.д.)
     * @param {Object} node - Узел дерева, к которому привязано нарушение
     * @returns {HTMLElement} Контейнер с формой нарушения
     */
    createViolationElement(violation, node) {
        const section = document.createElement('div');
        section.className = 'violation-section';
        section.dataset.violationId = violation.id;

        const columnsContainer = document.createElement('div');
        columnsContainer.className = 'violation-columns';

        // Колонка "Нарушено"
        const violatedColumn = document.createElement('div');
        violatedColumn.className = 'violation-column';

        const violatedLabel = document.createElement('div');
        violatedLabel.className = 'violation-label';
        violatedLabel.textContent = 'Нарушено:';
        violatedColumn.appendChild(violatedLabel);

        const violatedTextarea = document.createElement('textarea');
        violatedTextarea.className = 'violation-textarea';
        violatedTextarea.placeholder = 'Опишите нарушение...';
        violatedTextarea.value = violation.violated || '';
        violatedTextarea.rows = 4;

        // Настраиваем обработку клавиш для сохранения изменений
        this.setupTextareaHandlers(violatedTextarea, (value) => {
            violation.violated = value;
            PreviewManager.update();
        });

        violatedColumn.appendChild(violatedTextarea);

        // Колонка "Установлено"
        const establishedColumn = document.createElement('div');
        establishedColumn.className = 'violation-column';

        const establishedLabel = document.createElement('div');
        establishedLabel.className = 'violation-label';
        establishedLabel.textContent = 'Установлено:';
        establishedColumn.appendChild(establishedLabel);

        const establishedTextarea = document.createElement('textarea');
        establishedTextarea.className = 'violation-textarea';
        establishedTextarea.placeholder = 'Опишите установленное...';
        establishedTextarea.value = violation.established || '';
        establishedTextarea.rows = 4;

        // Настраиваем обработку клавиш для сохранения изменений
        this.setupTextareaHandlers(establishedTextarea, (value) => {
            violation.established = value;
            PreviewManager.update();
        });

        establishedColumn.appendChild(establishedTextarea);

        columnsContainer.appendChild(violatedColumn);
        columnsContainer.appendChild(establishedColumn);
        section.appendChild(columnsContainer);

        // Контейнер для дополнительных опциональных полей
        const optionalFieldsContainer = document.createElement('div');
        optionalFieldsContainer.className = 'violation-optional-fields';

        optionalFieldsContainer.appendChild(
            this.createOptionalField(violation, 'descriptionList', 'Описание перечнем', 'list')
        );
        optionalFieldsContainer.appendChild(
            this.createOptionalField(violation, 'additionalText', 'Дополнительный текст', 'text')
        );
        optionalFieldsContainer.appendChild(
            this.createOptionalField(violation, 'reasons', 'Причины', 'text')
        );
        optionalFieldsContainer.appendChild(
            this.createOptionalField(violation, 'consequences', 'Последствия', 'text')
        );
        optionalFieldsContainer.appendChild(
            this.createOptionalField(violation, 'responsible', 'Ответственные', 'text')
        );

        section.appendChild(optionalFieldsContainer);
        return section;
    }

    /**
     * Настраивает обработчики событий для textarea с поддержкой отмены
     * @param {HTMLTextAreaElement} textarea - Элемент textarea
     * @param {Function} onUpdate - Callback для обновления данных
     */
    setupTextareaHandlers(textarea, onUpdate) {
        let originalValue = textarea.value;

        // Обновляем данные при каждом изменении
        const handleInput = () => {
            onUpdate(textarea.value);
        };

        // Обработка горячих клавиш
        const handleKeyDown = (e) => {
            if (e.key === 'Enter' && e.shiftKey) {
                // Shift+Enter — добавить новую строку (стандартное поведение)
                e.stopPropagation();
            } else if (e.key === 'Enter' && !e.shiftKey) {
                // Enter — сохранить изменения и снять фокус
                e.preventDefault();
                textarea.blur();
            } else if (e.key === 'Escape') {
                // Escape — отменить изменения и восстановить исходное значение
                e.preventDefault();
                e.stopPropagation();
                textarea.value = originalValue;
                onUpdate(originalValue);
                textarea.blur();
            }
        };

        // Запоминаем исходное значение при получении фокуса
        const handleFocus = () => {
            originalValue = textarea.value;
        };

        textarea.addEventListener('input', handleInput);
        textarea.addEventListener('keydown', handleKeyDown);
        textarea.addEventListener('focus', handleFocus);
    }

    /**
     * Создает опциональное поле с чекбоксом для включения/выключения
     * @param {Object} violation - Объект нарушения
     * @param {string} fieldName - Имя поля в объекте violation
     * @param {string} label - Текст метки поля
     * @param {string} type - Тип поля ('list' или 'text')
     * @returns {HTMLElement} Контейнер с опциональным полем
     */
    createOptionalField(violation, fieldName, label, type) {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'violation-optional-field';

        // Чекбокс для включения/выключения поля
        const checkboxContainer = document.createElement('div');
        checkboxContainer.className = 'violation-field-toggle';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `${violation.id}-${fieldName}`;
        checkbox.checked = violation[fieldName].enabled;

        checkbox.addEventListener('change', () => {
            violation[fieldName].enabled = checkbox.checked;
            contentContainer.style.display = checkbox.checked ? 'block' : 'none';
            PreviewManager.update();
        });

        const checkboxLabel = document.createElement('label');
        checkboxLabel.htmlFor = checkbox.id;
        checkboxLabel.textContent = label;
        checkboxLabel.className = 'violation-field-label';

        checkboxContainer.appendChild(checkbox);
        checkboxContainer.appendChild(checkboxLabel);
        fieldContainer.appendChild(checkboxContainer);

        // Контейнер для содержимого поля
        const contentContainer = document.createElement('div');
        contentContainer.className = 'violation-field-content';
        contentContainer.style.display = violation[fieldName].enabled ? 'block' : 'none';

        // Создаем либо список, либо текстовое поле
        if (type === 'list') {
            const listContainer = document.createElement('div');
            listContainer.className = 'violation-list-container';

            const addButton = document.createElement('button');
            addButton.className = 'violation-list-add-btn';
            addButton.textContent = '+ Добавить пункт';

            addButton.addEventListener('click', () => {
                violation[fieldName].items.push('');
                this.renderList(listContainer, violation, fieldName);
                PreviewManager.update();
            });

            contentContainer.appendChild(addButton);
            contentContainer.appendChild(listContainer);
            this.renderList(listContainer, violation, fieldName);

        } else if (type === 'text') {
            const textarea = document.createElement('textarea');
            textarea.className = 'violation-textarea';
            textarea.placeholder = label ? `Введите ${label.toLowerCase()}...` : '...';
            textarea.value = violation[fieldName].content || '';
            textarea.rows = 3;

            // Настраиваем обработку клавиш
            this.setupTextareaHandlers(textarea, (value) => {
                violation[fieldName].content = value;
                PreviewManager.update();
            });

            contentContainer.appendChild(textarea);
        }

        fieldContainer.appendChild(contentContainer);
        return fieldContainer;
    }

    /**
     * Отрисовывает маркированный список элементов
     * @param {HTMLElement} container - Контейнер для списка
     * @param {Object} violation - Объект нарушения
     * @param {string} fieldName - Имя поля со списком
     */
    renderList(container, violation, fieldName) {
        container.innerHTML = '';

        violation[fieldName].items.forEach((item, index) => {
            const itemContainer = document.createElement('div');
            itemContainer.className = 'violation-list-item';

            const input = document.createElement('input');
            input.type = 'text';
            input.className = 'violation-list-input';
            input.value = item;
            input.placeholder = `Пункт ${index + 1}`;

            let originalValue = item;

            // Обновляем массив при вводе
            input.addEventListener('input', () => {
                violation[fieldName].items[index] = input.value;
                PreviewManager.update();
            });

            // Обработка горячих клавиш для элементов списка
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    // Enter — сохранить и снять фокус
                    e.preventDefault();
                    input.blur();
                } else if (e.key === 'Escape') {
                    // Escape — отменить изменения
                    e.preventDefault();
                    input.value = originalValue;
                    violation[fieldName].items[index] = originalValue;
                    input.blur();
                    PreviewManager.update();
                }
            });

            // Запоминаем исходное значение
            input.addEventListener('focus', () => {
                originalValue = input.value;
            });

            // Кнопка удаления элемента списка
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'violation-list-delete-btn';
            deleteBtn.textContent = '×';

            deleteBtn.addEventListener('click', () => {
                violation[fieldName].items.splice(index, 1);
                this.renderList(container, violation, fieldName);
                PreviewManager.update();
            });

            itemContainer.appendChild(input);
            itemContainer.appendChild(deleteBtn);
            container.appendChild(itemContainer);
        });
    }
}

// Глобальный экземпляр менеджера нарушений
const violationManager = new ViolationManager();
