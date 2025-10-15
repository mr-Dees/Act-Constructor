// Управление нарушениями
class ViolationManager {
    constructor() {
        this.selectedViolation = null;
    }

    // Создание элемента нарушения для отображения на шаге 2
    createViolationElement(violation, node) {
        const section = document.createElement('div');
        section.className = 'violation-section';
        section.dataset.violationId = violation.id;

        // Контейнер с двумя колонками
        const columnsContainer = document.createElement('div');
        columnsContainer.className = 'violation-columns';

        // Левая колонка - "Нарушено"
        const violatedColumn = document.createElement('div');
        violatedColumn.className = 'violation-column';

        const violatedLabel = document.createElement('div');
        violatedLabel.className = 'violation-label';
        violatedLabel.textContent = 'Нарушено';
        violatedColumn.appendChild(violatedLabel);

        const violatedTextarea = document.createElement('textarea');
        violatedTextarea.className = 'violation-textarea';
        violatedTextarea.placeholder = 'Опишите нарушение...';
        violatedTextarea.value = violation.violated || '';
        violatedTextarea.rows = 4;
        violatedTextarea.addEventListener('input', () => {
            violation.violated = violatedTextarea.value;
            PreviewManager.update();
        });
        violatedColumn.appendChild(violatedTextarea);

        // Правая колонка - "Установлено"
        const establishedColumn = document.createElement('div');
        establishedColumn.className = 'violation-column';

        const establishedLabel = document.createElement('div');
        establishedLabel.className = 'violation-label';
        establishedLabel.textContent = 'Установлено';
        establishedColumn.appendChild(establishedLabel);

        const establishedTextarea = document.createElement('textarea');
        establishedTextarea.className = 'violation-textarea';
        establishedTextarea.placeholder = 'Опишите установленные факты...';
        establishedTextarea.value = violation.established || '';
        establishedTextarea.rows = 4;
        establishedTextarea.addEventListener('input', () => {
            violation.established = establishedTextarea.value;
            PreviewManager.update();
        });
        establishedColumn.appendChild(establishedTextarea);

        columnsContainer.appendChild(violatedColumn);
        columnsContainer.appendChild(establishedColumn);
        section.appendChild(columnsContainer);

        // Опциональные поля
        const optionalFieldsContainer = document.createElement('div');
        optionalFieldsContainer.className = 'violation-optional-fields';

        // 1. Список описаний (буллитный)
        optionalFieldsContainer.appendChild(
            this.createOptionalField(
                violation,
                'descriptionList',
                'Расшифровка описания',
                'list'
            )
        );

        // 2. Дополнительный текст (без заголовка)
        optionalFieldsContainer.appendChild(
            this.createOptionalField(
                violation,
                'additionalText',
                null,
                'text'
            )
        );

        // 3. Причины
        optionalFieldsContainer.appendChild(
            this.createOptionalField(
                violation,
                'reasons',
                'Причины',
                'text'
            )
        );

        // 4. Последствия
        optionalFieldsContainer.appendChild(
            this.createOptionalField(
                violation,
                'consequences',
                'Последствия',
                'text'
            )
        );

        // 5. Ответственные
        optionalFieldsContainer.appendChild(
            this.createOptionalField(
                violation,
                'responsible',
                'Ответственный за решение проблем',
                'text'
            )
        );

        section.appendChild(optionalFieldsContainer);

        return section;
    }

    // Создание опционального поля
    createOptionalField(violation, fieldName, label, type) {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'violation-optional-field';

        // Чекбокс для включения/выключения
        const checkboxContainer = document.createElement('div');
        checkboxContainer.className = 'violation-field-toggle';

        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `${violation.id}_${fieldName}`;
        checkbox.checked = violation[fieldName].enabled;
        checkbox.addEventListener('change', () => {
            violation[fieldName].enabled = checkbox.checked;
            contentContainer.style.display = checkbox.checked ? 'block' : 'none';
            PreviewManager.update();
        });

        const checkboxLabel = document.createElement('label');
        checkboxLabel.htmlFor = checkbox.id;
        checkboxLabel.textContent = label || 'Дополнительное поле';
        checkboxLabel.className = 'violation-field-label';

        checkboxContainer.appendChild(checkbox);
        checkboxContainer.appendChild(checkboxLabel);
        fieldContainer.appendChild(checkboxContainer);

        // Контейнер для содержимого поля
        const contentContainer = document.createElement('div');
        contentContainer.className = 'violation-field-content';
        contentContainer.style.display = violation[fieldName].enabled ? 'block' : 'none';

        if (type === 'list') {
            // Буллитный список
            const listContainer = document.createElement('div');
            listContainer.className = 'violation-list-container';

            // Кнопка добавления пункта
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
            // Текстовое поле
            const textarea = document.createElement('textarea');
            textarea.className = 'violation-textarea';
            textarea.placeholder = label ? `Введите ${label.toLowerCase()}...` : 'Введите текст...';
            textarea.value = violation[fieldName].content || '';
            textarea.rows = 3;
            textarea.addEventListener('input', () => {
                violation[fieldName].content = textarea.value;
                PreviewManager.update();
            });
            contentContainer.appendChild(textarea);
        }

        fieldContainer.appendChild(contentContainer);
        return fieldContainer;
    }

    // Отрисовка буллитного списка
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
            input.addEventListener('input', () => {
                violation[fieldName].items[index] = input.value;
                PreviewManager.update();
            });

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

// Глобальный экземпляр
const violationManager = new ViolationManager();
