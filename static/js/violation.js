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
            this.createAdditionalContentField(violation)
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
     * Создает расширяемую секцию дополнительного контента
     * @param {Object} violation - Объект нарушения
     * @returns {HTMLElement} Контейнер с подсущностями
     */
    /**
     * Создает расширяемую секцию дополнительного контента
     */
    createAdditionalContentField(violation) {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'violation-optional-field violation-additional-content';

        // Чекбокс для включения секции
        const checkboxContainer = document.createElement('div');
        checkboxContainer.className = 'violation-field-toggle';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `${violation.id}-additionalContent`;
        checkbox.checked = violation.additionalContent.enabled;
        checkbox.addEventListener('change', () => {
            violation.additionalContent.enabled = checkbox.checked;
            contentContainer.style.display = checkbox.checked ? 'block' : 'none';
            PreviewManager.update();
        });

        const checkboxLabel = document.createElement('label');
        checkboxLabel.htmlFor = checkbox.id;
        checkboxLabel.textContent = 'Дополнительный контент';
        checkboxLabel.className = 'violation-field-label';

        checkboxContainer.appendChild(checkbox);
        checkboxContainer.appendChild(checkboxLabel);
        fieldContainer.appendChild(checkboxContainer);

        // Контейнер содержимого
        const contentContainer = document.createElement('div');
        contentContainer.className = 'violation-field-content additional-content-wrapper';
        contentContainer.style.display = violation.additionalContent.enabled ? 'block' : 'none';

        // Панель кнопок добавления (фиксированная вверху)
        const buttonsPanel = document.createElement('div');
        buttonsPanel.className = 'additional-content-buttons';

        const addCaseBtn = document.createElement('button');
        addCaseBtn.className = 'violation-list-add-btn';
        addCaseBtn.textContent = '+ Кейс';
        addCaseBtn.addEventListener('click', () => {
            this.addContentItem(violation, 'case', contentContainer);
        });

        const addImageBtn = document.createElement('button');
        addImageBtn.className = 'violation-list-add-btn';
        addImageBtn.textContent = '+ Изображение';

        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';
        addImageBtn.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                this.addContentItem(violation, 'image', contentContainer, {
                    url: event.target.result,
                    filename: file.name
                });
            };
            reader.readAsDataURL(file);
            fileInput.value = '';
        });

        const addTextBtn = document.createElement('button');
        addTextBtn.className = 'violation-list-add-btn';
        addTextBtn.textContent = '+ Текст';
        addTextBtn.addEventListener('click', () => {
            this.addContentItem(violation, 'freeText', contentContainer);
        });

        buttonsPanel.appendChild(addCaseBtn);
        buttonsPanel.appendChild(addImageBtn);
        buttonsPanel.appendChild(fileInput);
        buttonsPanel.appendChild(addTextBtn);
        contentContainer.appendChild(buttonsPanel);

        // Контейнер для элементов (в порядке добавления)
        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'additional-content-items';
        itemsContainer.dataset.violationId = violation.id;
        contentContainer.appendChild(itemsContainer);

        // Рендерим существующие элементы
        this.renderContentItems(violation, itemsContainer);

        fieldContainer.appendChild(contentContainer);
        return fieldContainer;
    }

    /**
     * Добавляет элемент контента в массив
     */
    addContentItem(violation, type, container, extraData = {}) {
        const newItem = {
            id: `${type}_${Date.now()}`,
            type: type,
            content: '',
            url: extraData.url || '',
            caption: '',
            filename: extraData.filename || '',
            order: violation.additionalContent.items.length
        };

        violation.additionalContent.items.push(newItem);

        const itemsContainer = container.querySelector('.additional-content-items');
        this.renderContentItems(violation, itemsContainer);
        PreviewManager.update();
    }

    /**
     * Отрисовывает все элементы в порядке добавления
     */
    renderContentItems(violation, container) {
        container.innerHTML = '';

        violation.additionalContent.items.forEach((item, index) => {
            let itemElement;

            if (item.type === 'case') {
                itemElement = this.createCaseElement(violation, item, index);
            } else if (item.type === 'image') {
                itemElement = this.createImageElement(violation, item, index);
            } else if (item.type === 'freeText') {
                itemElement = this.createFreeTextElement(violation, item, index);
            }

            if (itemElement) {
                container.appendChild(itemElement);
            }
        });
    }

    /**
     * Создает элемент кейса
     */
    createCaseElement(violation, item, index) {
        const wrapper = document.createElement('div');
        wrapper.className = 'content-item-wrapper';

        const label = document.createElement('div');
        label.className = 'content-item-label';
        label.textContent = `Кейс ${this.getTypeIndex(violation.additionalContent.items, 'case', index)}`;

        const itemDiv = document.createElement('div');
        itemDiv.className = 'content-item';

        const textarea = document.createElement('textarea');
        textarea.className = 'violation-textarea';
        textarea.placeholder = 'Описание кейса';
        textarea.value = item.content;
        textarea.rows = 3;

        textarea.addEventListener('input', () => {
            item.content = textarea.value;
            PreviewManager.update();
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'violation-list-delete-btn';
        deleteBtn.textContent = '×';
        deleteBtn.title = 'Удалить';
        deleteBtn.addEventListener('click', () => {
            violation.additionalContent.items.splice(index, 1);
            const container = wrapper.parentElement;
            this.renderContentItems(violation, container);
            PreviewManager.update();
        });

        itemDiv.appendChild(textarea);
        itemDiv.appendChild(deleteBtn);
        wrapper.appendChild(label);
        wrapper.appendChild(itemDiv);

        return wrapper;
    }

    /**
     * Создает элемент изображения
     */
    createImageElement(violation, item, index) {
        const wrapper = document.createElement('div');
        wrapper.className = 'content-item-wrapper';

        const label = document.createElement('div');
        label.className = 'content-item-label';
        label.textContent = `Изображение ${this.getTypeIndex(violation.additionalContent.items, 'image', index)}`;

        const itemDiv = document.createElement('div');
        itemDiv.className = 'image-item';

        const img = document.createElement('img');
        img.src = item.url;
        img.alt = item.caption || item.filename;
        img.className = 'image-preview';

        const filenameDiv = document.createElement('div');
        filenameDiv.className = 'image-filename';
        filenameDiv.textContent = item.filename;

        const captionInput = document.createElement('input');
        captionInput.type = 'text';
        captionInput.className = 'violation-list-input';
        captionInput.placeholder = 'Подпись к изображению';
        captionInput.value = item.caption;
        captionInput.addEventListener('input', () => {
            item.caption = captionInput.value;
            PreviewManager.update();
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'violation-list-delete-btn';
        deleteBtn.textContent = '×';
        deleteBtn.title = 'Удалить';
        deleteBtn.addEventListener('click', () => {
            violation.additionalContent.items.splice(index, 1);
            const container = wrapper.parentElement;
            this.renderContentItems(violation, container);
            PreviewManager.update();
        });

        itemDiv.appendChild(img);
        itemDiv.appendChild(filenameDiv);
        itemDiv.appendChild(captionInput);
        itemDiv.appendChild(deleteBtn);
        wrapper.appendChild(label);
        wrapper.appendChild(itemDiv);

        return wrapper;
    }

    /**
     * Создает элемент произвольного текста
     */
    createFreeTextElement(violation, item, index) {
        const wrapper = document.createElement('div');
        wrapper.className = 'content-item-wrapper';

        const label = document.createElement('div');
        label.className = 'content-item-label';
        label.textContent = `Текст ${this.getTypeIndex(violation.additionalContent.items, 'freeText', index)}`;

        const itemDiv = document.createElement('div');
        itemDiv.className = 'content-item';

        const textarea = document.createElement('textarea');
        textarea.className = 'violation-textarea';
        textarea.placeholder = 'Произвольный текст';
        textarea.value = item.content;
        textarea.rows = 4;

        textarea.addEventListener('input', () => {
            item.content = textarea.value;
            PreviewManager.update();
        });

        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'violation-list-delete-btn';
        deleteBtn.textContent = '×';
        deleteBtn.title = 'Удалить';
        deleteBtn.addEventListener('click', () => {
            violation.additionalContent.items.splice(index, 1);
            const container = wrapper.parentElement;
            this.renderContentItems(violation, container);
            PreviewManager.update();
        });

        itemDiv.appendChild(textarea);
        itemDiv.appendChild(deleteBtn);
        wrapper.appendChild(label);
        wrapper.appendChild(itemDiv);

        return wrapper;
    }

    /**
     * Получает порядковый номер элемента по типу
     */
    getTypeIndex(items, type, currentIndex) {
        let count = 0;
        for (let i = 0; i <= currentIndex; i++) {
            if (items[i].type === type) {
                count++;
            }
        }
        return count;
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
