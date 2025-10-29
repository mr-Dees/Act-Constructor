/**
 * Управление нарушениями в документе
 * Создает и обрабатывает интерактивные формы для ввода нарушений
 */
class ViolationManager {
    constructor() {
        this.selectedViolation = null;
        // Переменная для отслеживания последней позиции при drag
        this.lastDragOverIndex = null;
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

        // Контейнер для элементов
        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'additional-content-items';
        itemsContainer.dataset.violationId = violation.id;

        // Обработчик контекстного меню
        itemsContainer.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Проверяем, клик по элементу или по пустой области
            const clickedWrapper = e.target.closest('.content-item-wrapper');

            if (clickedWrapper) {
                // Показываем меню удаления
                const itemIndex = Array.from(itemsContainer.children).indexOf(clickedWrapper);
                this.showContentItemDeleteMenu(e, violation, itemsContainer, itemIndex);
            } else {
                // Показываем меню добавления
                this.showContentItemAddMenu(e, violation, contentContainer);
            }
        });

        contentContainer.appendChild(itemsContainer);

        // Рендерим существующие элементы
        this.renderContentItems(violation, itemsContainer);

        fieldContainer.appendChild(contentContainer);
        return fieldContainer;
    }

    /**
     * Показывает контекстное меню для добавления элемента
     */
    showContentItemAddMenu(event, violation, contentContainer) {
        const existingMenu = document.querySelector('.violation-context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        const menu = document.createElement('div');
        menu.className = 'violation-context-menu';
        menu.style.cssText = `
            position: fixed;
            left: ${event.clientX}px;
            top: ${event.clientY}px;
            background: white;
            border: 1px solid var(--border);
            border-radius: var(--radius);
            box-shadow: var(--shadow-lg);
            z-index: 10000;
            min-width: 180px;
            padding: 4px 0;
        `;

        const menuItems = [
            {label: '📝 Добавить кейс', action: 'case'},
            {label: '🖼️ Добавить изображение', action: 'image'},
            {label: '📄 Добавить текст', action: 'text'}
        ];

        // Определяем позицию вставки
        const itemsContainer = contentContainer.querySelector('.additional-content-items');
        const insertIndex = this.calculateInsertPosition(event, itemsContainer);

        menuItems.forEach(item => {
            const menuItem = document.createElement('div');
            menuItem.className = 'violation-context-menu-item';
            menuItem.textContent = item.label;
            menuItem.style.cssText = `
                padding: 8px 16px;
                cursor: pointer;
                transition: background-color 0.2s;
            `;

            menuItem.addEventListener('mouseenter', () => {
                menuItem.style.backgroundColor = 'var(--primary-subtle)';
            });

            menuItem.addEventListener('mouseleave', () => {
                menuItem.style.backgroundColor = 'transparent';
            });

            menuItem.addEventListener('click', () => {
                this.handleContentItemAdd(violation, item.action, contentContainer, insertIndex);
                menu.remove();
            });

            menu.appendChild(menuItem);
        });

        document.body.appendChild(menu);

        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };

        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 0);
    }

    /**
     * Показывает контекстное меню для удаления элемента
     */
    showContentItemDeleteMenu(event, violation, itemsContainer, itemIndex) {
        const existingMenu = document.querySelector('.violation-context-menu');
        if (existingMenu) {
            existingMenu.remove();
        }

        const menu = document.createElement('div');
        menu.className = 'violation-context-menu';
        menu.style.cssText = `
            position: fixed;
            left: ${event.clientX}px;
            top: ${event.clientY}px;
            background: white;
            border: 1px solid var(--border);
            border-radius: var(--radius);
            box-shadow: var(--shadow-lg);
            z-index: 10000;
            min-width: 150px;
            padding: 4px 0;
        `;

        const deleteItem = document.createElement('div');
        deleteItem.className = 'violation-context-menu-item delete';
        deleteItem.textContent = '🗑️ Удалить';
        deleteItem.style.cssText = `
            padding: 8px 16px;
            cursor: pointer;
            color: var(--danger, #dc3545);
            transition: background-color 0.2s;
        `;

        deleteItem.addEventListener('mouseenter', () => {
            deleteItem.style.backgroundColor = 'rgba(220, 53, 69, 0.1)';
        });

        deleteItem.addEventListener('mouseleave', () => {
            deleteItem.style.backgroundColor = 'transparent';
        });

        deleteItem.addEventListener('click', () => {
            violation.additionalContent.items.splice(itemIndex, 1);
            this.renderContentItems(violation, itemsContainer);
            PreviewManager.update();
            menu.remove();
        });

        menu.appendChild(deleteItem);
        document.body.appendChild(menu);

        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                menu.remove();
                document.removeEventListener('click', closeMenu);
            }
        };

        setTimeout(() => {
            document.addEventListener('click', closeMenu);
        }, 0);
    }

    /**
     * Вычисляет позицию вставки на основе координат клика
     */
    calculateInsertPosition(event, container) {
        const wrappers = Array.from(container.querySelectorAll('.content-item-wrapper'));
        if (wrappers.length === 0) {
            return 0;
        }

        const clickY = event.clientY;

        for (let i = 0; i < wrappers.length; i++) {
            const wrapperRect = wrappers[i].getBoundingClientRect();
            const wrapperMiddle = wrapperRect.top + wrapperRect.height / 2;

            if (clickY < wrapperMiddle) {
                return i;
            }
        }
        return wrappers.length;
    }

    /**
     * Обрабатывает действие добавления элемента с указанной позицией
     */
    handleContentItemAdd(violation, action, contentContainer, insertIndex) {
        switch (action) {
            case 'case':
                this.addContentItemAtPosition(violation, 'case', contentContainer, insertIndex);
                break;
            case 'image':
                this.triggerImageUploadAtPosition(violation, contentContainer, insertIndex);
                break;
            case 'text':
                this.addContentItemAtPosition(violation, 'freeText', contentContainer, insertIndex);
                break;
        }
    }

    /**
     * Добавляет элемент контента в указанную позицию
     */
    addContentItemAtPosition(violation, type, container, insertIndex, extraData = {}) {
        const newItem = {
            id: `${type}_${Date.now()}`,
            type: type,
            content: '',
            url: extraData.url || '',
            caption: '',
            filename: extraData.filename || '',
            order: insertIndex
        };

        violation.additionalContent.items.splice(insertIndex, 0, newItem);

        violation.additionalContent.items.forEach((item, idx) => {
            item.order = idx;
        });

        const itemsContainer = container.querySelector('.additional-content-items');
        this.renderContentItems(violation, itemsContainer);
        PreviewManager.update();
    }

    /**
     * Инициирует выбор файла изображения с указанием позиции
     */
    triggerImageUploadAtPosition(violation, container, insertIndex) {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.style.display = 'none';

        fileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                this.addContentItemAtPosition(violation, 'image', container, insertIndex, {
                    url: event.target.result,
                    filename: file.name
                });
            };
            reader.readAsDataURL(file);
        });

        document.body.appendChild(fileInput);
        fileInput.click();
        document.body.removeChild(fileInput);
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
     * Вычисляет нумерацию для последовательных кейсов
     */
    renderContentItems(violation, container) {
        container.innerHTML = '';

        // Вычисляем нумерацию для последовательных кейсов
        const itemsWithNumbers = this.calculateCaseNumbers(violation.additionalContent.items);

        violation.additionalContent.items.forEach((item, index) => {
            let itemElement;

            if (item.type === 'case') {
                const caseNumber = itemsWithNumbers[index];
                itemElement = this.createCaseElement(violation, item, index, caseNumber);
            } else if (item.type === 'image') {
                const imageNumber = this.getTypeSequentialNumber(violation.additionalContent.items, 'image', index);
                itemElement = this.createImageElement(violation, item, index, imageNumber);
            } else if (item.type === 'freeText') {
                const textNumber = this.getTypeSequentialNumber(violation.additionalContent.items, 'freeText', index);
                itemElement = this.createFreeTextElement(violation, item, index, textNumber);
            }

            if (itemElement) {
                // Добавляем drag-and-drop атрибуты
                itemElement.draggable = true;
                itemElement.dataset.itemIndex = index;

                // Обработчики перетаскивания
                itemElement.addEventListener('dragstart', (e) => this.handleDragStart(e, violation, index, item));
                itemElement.addEventListener('dragover', (e) => this.handleDragOver(e, violation, container));
                itemElement.addEventListener('dragenter', (e) => this.handleDragEnter(e));
                itemElement.addEventListener('dragleave', (e) => this.handleDragLeave(e));
                itemElement.addEventListener('drop', (e) => this.handleDrop(e, violation, index, container));
                itemElement.addEventListener('dragend', (e) => this.handleDragEnd(e, container));

                container.appendChild(itemElement);
            }
        });

        // Сбрасываем последний индекс
        this.lastDragOverIndex = null;
    }

    /**
     * Получает порядковый номер элемента определенного типа (не прерываемый)
     */
    getTypeSequentialNumber(items, type, currentIndex) {
        let count = 0;
        for (let i = 0; i <= currentIndex; i++) {
            if (items[i].type === type) {
                count++;
            }
        }
        return count;
    }

    /**
     * Вычисляет номера для кейсов (сброс нумерации при прерывании)
     */
    calculateCaseNumbers(items) {
        const numbers = new Array(items.length).fill(null);
        let currentCaseNumber = 1;

        items.forEach((item, index) => {
            if (item.type === 'case') {
                numbers[index] = currentCaseNumber;
                currentCaseNumber++;
            } else {
                // Сбрасываем нумерацию при встрече не-кейса
                currentCaseNumber = 1;
            }
        });

        return numbers;
    }

    /**
     * Создает элемент кейса с нумерацией
     */
    createCaseElement(violation, item, index, caseNumber) {
        const wrapper = document.createElement('div');
        wrapper.className = 'content-item-wrapper';

        const label = document.createElement('div');
        label.className = 'content-item-label';
        label.innerHTML = `⋮⋮ Кейс ${caseNumber}`;

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

        itemDiv.appendChild(textarea);
        wrapper.appendChild(label);
        wrapper.appendChild(itemDiv);

        return wrapper;
    }

    /**
     * Создает элемент изображения с нумерацией
     */
    createImageElement(violation, item, index, imageNumber) {
        const wrapper = document.createElement('div');
        wrapper.className = 'content-item-wrapper';

        const label = document.createElement('div');
        label.className = 'content-item-label';
        label.innerHTML = `⋮⋮ Изображение ${imageNumber}`;

        const itemDiv = document.createElement('div');
        itemDiv.className = 'image-item';

        // Контейнер с фиксированной высотой для изображения
        const imgContainer = document.createElement('div');
        imgContainer.className = 'image-preview-container';

        const img = document.createElement('img');
        img.src = item.url;
        img.alt = item.caption || item.filename;
        img.className = 'image-preview';

        imgContainer.appendChild(img);

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

        itemDiv.appendChild(imgContainer);
        itemDiv.appendChild(filenameDiv);
        itemDiv.appendChild(captionInput);

        wrapper.appendChild(label);
        wrapper.appendChild(itemDiv);

        return wrapper;
    }

    /**
     * Создает элемент произвольного текста с нумерацией
     */
    createFreeTextElement(violation, item, index, textNumber) {
        const wrapper = document.createElement('div');
        wrapper.className = 'content-item-wrapper';

        const label = document.createElement('div');
        label.className = 'content-item-label';
        label.innerHTML = `⋮⋮ Текст ${textNumber}`;

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

        itemDiv.appendChild(textarea);
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

    /**
     * Обработчик начала перетаскивания с созданием миниатюры
     */
    handleDragStart(e, violation, index, item) {
        const wrapper = e.currentTarget;
        wrapper.classList.add('dragging');

        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', index);

        // Создаем миниатюру
        const miniature = this.createDragMiniature(item, index, violation.additionalContent.items);
        miniature.style.position = 'absolute';
        miniature.style.top = '-1000px';
        miniature.id = 'drag-miniature-temp';
        document.body.appendChild(miniature);

        e.dataTransfer.setDragImage(miniature, 20, 20);

        // Удаляем миниатюру после начала перетаскивания
        setTimeout(() => {
            const temp = document.getElementById('drag-miniature-temp');
            if (temp) temp.remove();
        }, 0);

        // Сбрасываем последний индекс при начале перетаскивания
        this.lastDragOverIndex = null;
    }

    /**
     * Создает миниатюру элемента для drag-and-drop
     */
    createDragMiniature(item, index, allItems) {
        const miniature = document.createElement('div');
        miniature.className = 'drag-miniature';

        let label = '';
        let icon = '';

        if (item.type === 'case') {
            const caseNumbers = this.calculateCaseNumbers(allItems);
            const caseNumber = caseNumbers[index];
            icon = '📋';
            label = `Кейс ${caseNumber}`;
        } else if (item.type === 'image') {
            const imageNumber = this.getTypeSequentialNumber(allItems, 'image', index);
            icon = '🖼️';
            label = `Изображение ${imageNumber}`;
        } else if (item.type === 'freeText') {
            const textNumber = this.getTypeSequentialNumber(allItems, 'freeText', index);
            icon = '📝';
            label = `Текст ${textNumber}`;
        }

        miniature.innerHTML = `${icon} ${label}`;
        return miniature;
    }

    /**
     * Обработчик входа в зону элемента
     */
    handleDragEnter(e) {
        e.preventDefault();
    }

    /**
     * Обработчик перемещения над элементом с физическим перемещением
     */
    handleDragOver(e, violation, container) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';

        const draggingElement = document.querySelector('.dragging');
        if (!draggingElement) return;

        const currentElement = e.target.closest('.content-item-wrapper');
        if (!currentElement || currentElement === draggingElement) {
            return;
        }

        // Получаем границы текущего элемента
        const rect = currentElement.getBoundingClientRect();
        const mouseY = e.clientY;
        const elementMiddle = rect.top + rect.height / 2;

        // Определяем, в какую половину элемента попал курсор
        const isTopHalf = mouseY < elementMiddle;

        // Получаем индекс текущего элемента
        const allWrappers = [...container.querySelectorAll('.content-item-wrapper')];
        const currentIndex = allWrappers.indexOf(currentElement);

        // Проверяем, изменилась ли позиция с последнего вызова
        const targetPosition = isTopHalf ? currentIndex : currentIndex + 1;

        if (this.lastDragOverIndex === targetPosition) {
            return; // Позиция не изменилась, не делаем ничего
        }

        this.lastDragOverIndex = targetPosition;

        // Физически перемещаем элемент в DOM
        if (isTopHalf) {
            container.insertBefore(draggingElement, currentElement);
        } else {
            container.insertBefore(draggingElement, currentElement.nextSibling);
        }
    }

    /**
     * Обработчик выхода курсора из зоны элемента
     */
    handleDragLeave(e) {
        // Оставляем пустым, визуальное перемещение происходит в handleDragOver
    }

    /**
     * Обработчик сброса элемента - фиксирует новый порядок в данных
     */
    handleDrop(e, violation, targetIndex, container) {
        e.preventDefault();
        e.stopPropagation();

        const draggingElement = document.querySelector('.dragging');
        if (!draggingElement) return;

        // Получаем все элементы в текущем визуальном порядке
        const allWrappers = [...container.querySelectorAll('.content-item-wrapper')];

        // Создаем новый массив items в визуальном порядке
        const newItems = allWrappers.map(wrapper => {
            const oldIndex = parseInt(wrapper.dataset.itemIndex);
            return violation.additionalContent.items[oldIndex];
        });

        // Заменяем массив items новым упорядоченным массивом
        violation.additionalContent.items = newItems;

        // Перерисовываем с обновленными индексами
        this.renderContentItems(violation, container);
        PreviewManager.update();
    }

    /**
     * Обработчик окончания перетаскивания
     */
    handleDragEnd(e, container) {
        e.target.classList.remove('dragging');

        // Удаляем все индикаторы перетаскивания
        const allWrappers = container.querySelectorAll('.content-item-wrapper');
        allWrappers.forEach(w => {
            w.classList.remove('drag-over-top', 'drag-over-bottom');
        });

        // Сбрасываем последний индекс
        this.lastDragOverIndex = null;
    }
}

// Глобальный экземпляр менеджера нарушений
const violationManager = new ViolationManager();
