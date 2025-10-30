/**
 * Модуль управления дополнительным контентом
 * Кейсы, изображения, произвольный текст
 */

// Расширение ViolationManager
Object.assign(ViolationManager.prototype, {
    /**
     * Создает расширяемую секцию дополнительного контента
     * @param {Object} violation - Объект нарушения
     * @returns {HTMLElement} Контейнер с подсущностями
     */
    createAdditionalContentField(violation) {
        const fieldContainer = document.createElement('div');
        fieldContainer.className = 'violation-optional-field violation-additional-content';

        // Регистрируем violation в хранилище для быстрого доступа
        this.activeViolations.set(violation.id, violation);

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

            // Если выключаем - сбрасываем активный контейнер
            if (!checkbox.checked && this.currentActiveContainer === contentContainer) {
                this.currentActiveContainer = null;
                this.cursorInsertPosition = null;
            }

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

        // Делаем контейнер focusable для перехвата Ctrl+V
        contentContainer.setAttribute('tabindex', '0');

        // Контейнер для элементов
        const itemsContainer = document.createElement('div');
        itemsContainer.className = 'additional-content-items';
        itemsContainer.dataset.violationId = violation.id;

        // Отслеживаем вход мыши в contentContainer
        contentContainer.addEventListener('mouseenter', () => {
            if (violation.additionalContent.enabled) {
                this.currentActiveContainer = contentContainer;
            }
        });

        // Отслеживаем выход мыши из contentContainer
        contentContainer.addEventListener('mouseleave', () => {
            if (this.currentActiveContainer === contentContainer) {
                this.currentActiveContainer = null;
                this.cursorInsertPosition = null;
                // Удаляем индикатор при выходе мыши
                const indicators = itemsContainer.querySelectorAll('.insert-indicator');
                indicators.forEach(ind => ind.remove());
            }
        });

        // Отслеживаем движение мыши для определения позиции курсора
        contentContainer.addEventListener('mousemove', (e) => {
            if (violation.additionalContent.enabled && this.currentActiveContainer === contentContainer) {
                // Вычисляем позицию курсора относительно элементов
                const position = this.calculateCursorPosition(e, itemsContainer);
                this.cursorInsertPosition = position;

                // Визуализируем позицию вставки
                this.updateInsertIndicator(itemsContainer, position);
            }
        });

        // Настраиваем Drag and Drop для файлов
        this.setupFileDragAndDrop(itemsContainer, violation, contentContainer);

        // Обработчик контекстного меню
        itemsContainer.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Вычисляем позицию для вставки на основе клика
            const insertPosition = this.calculateCursorPosition(e, itemsContainer);

            // Проверяем, клик по элементу или по пустой области
            const clickedWrapper = e.target.closest('.content-item-wrapper');

            if (clickedWrapper) {
                // Получаем реальный ID элемента из dataset
                const itemId = clickedWrapper.dataset.itemId;
                this.showContextMenu(e, violation, contentContainer, itemId, insertPosition);
            } else {
                this.showContextMenu(e, violation, contentContainer, null, insertPosition);
            }
        });

        contentContainer.appendChild(itemsContainer);

        // Рендерим существующие элементы
        this.renderContentItems(violation, itemsContainer);

        fieldContainer.appendChild(contentContainer);
        return fieldContainer;
    },

    /**
     * Вычисляет позицию курсора для вставки элементов
     * @param {Event} event - Событие мыши
     * @param {HTMLElement} container - Контейнер с элементами
     * @returns {number} Индекс позиции для вставки
     */
    calculateCursorPosition(event, container) {
        const wrappers = Array.from(container.querySelectorAll('.content-item-wrapper'));

        if (wrappers.length === 0) {
            return 0;
        }

        const clickY = event.clientY;

        for (let i = 0; i < wrappers.length; i++) {
            const wrapperRect = wrappers[i].getBoundingClientRect();
            const wrapperTop = wrapperRect.top;
            const wrapperBottom = wrapperRect.bottom;
            const wrapperHeight = wrapperRect.height;

            // Делим элемент на три зоны: верхняя треть, средняя треть, нижняя треть
            const topThird = wrapperTop + wrapperHeight / 3;
            const bottomThird = wrapperTop + (wrapperHeight * 2) / 3;

            if (clickY < topThird) {
                // Курсор в верхней трети элемента - вставляем перед ним
                return i;
            } else if (clickY >= topThird && clickY < bottomThird) {
                // Курсор в средней трети - вставляем перед элементом
                return i;
            } else if (clickY >= bottomThird && clickY <= wrapperBottom) {
                // Курсор в нижней трети - вставляем после элемента
                return i + 1;
            }
        }

        // Если курсор ниже всех элементов - вставляем в конец
        return wrappers.length;
    },

    /**
     * Визуализирует индикатор места вставки
     * @param {HTMLElement} container - Контейнер с элементами
     * @param {number} position - Позиция для вставки
     */
    updateInsertIndicator(container, position) {
        // Удаляем предыдущие индикаторы
        const oldIndicators = container.querySelectorAll('.insert-indicator');
        oldIndicators.forEach(ind => ind.remove());

        const wrappers = Array.from(container.querySelectorAll('.content-item-wrapper'));

        if (wrappers.length === 0) {
            return;
        }

        // Создаем индикатор
        const indicator = document.createElement('div');
        indicator.className = 'insert-indicator';

        if (position === 0) {
            // Вставка в начало
            container.insertBefore(indicator, wrappers[0]);
        } else if (position >= wrappers.length) {
            // Вставка в конец
            container.appendChild(indicator);
        } else {
            // Вставка между элементами
            container.insertBefore(indicator, wrappers[position]);
        }
    },

    /**
     * Добавляет элемент контента в указанную позицию
     * @param {Object} violation - Объект нарушения
     * @param {string} type - Тип элемента ('case', 'image', 'freeText')
     * @param {HTMLElement} container - Контейнер содержимого
     * @param {number} insertIndex - Позиция для вставки
     * @param {Object} extraData - Дополнительные данные элемента
     */
    addContentItemAtPosition(violation, type, container, insertIndex, extraData = {}) {
        const newItem = {
            id: `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: type,
            content: extraData.content || '',
            url: extraData.url || '',
            caption: '',
            filename: extraData.filename || '',
            order: insertIndex
        };

        // Вставляем элемент в нужную позицию
        violation.additionalContent.items.splice(insertIndex, 0, newItem);

        // Обновляем порядок всех элементов
        violation.additionalContent.items.forEach((item, idx) => {
            item.order = idx;
        });

        const itemsContainer = container.querySelector('.additional-content-items');

        // Сохраняем текущее состояние активности
        const wasActive = this.currentActiveContainer === container;

        this.renderContentItems(violation, itemsContainer);

        // Восстанавливаем активность после перерисовки
        if (wasActive) {
            this.currentActiveContainer = container;
        }

        PreviewManager.update();
    },

    /**
     * Инициирует выбор файлов изображений с указанием позиции
     * @param {Object} violation - Объект нарушения
     * @param {HTMLElement} container - Контейнер содержимого
     * @param {number} insertIndex - Позиция для вставки
     */
    triggerImageUploadAtPosition(violation, container, insertIndex) {
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.accept = 'image/*';
        fileInput.multiple = true;
        fileInput.style.display = 'none';

        fileInput.addEventListener('change', (e) => {
            const files = e.target.files;
            if (!files || files.length === 0) return;

            let addedCount = 0;

            // Обрабатываем каждый файл
            Array.from(files).forEach((file, idx) => {
                const reader = new FileReader();

                reader.onload = (event) => {
                    // Добавляем изображения последовательно с увеличением позиции
                    this.addContentItemAtPosition(violation, 'image', container, insertIndex + idx, {
                        url: event.target.result,
                        filename: file.name
                    });

                    addedCount++;

                    // Показываем уведомление после последнего файла
                    if (addedCount === files.length) {
                        const message = files.length === 1
                            ? 'Изображение добавлено'
                            : `Добавлено изображений: ${files.length}`;

                        Notifications.success(message);
                    }
                };

                reader.onerror = (error) => {
                    console.error('Error reading file:', file.name, error);
                    Notifications.error(`Ошибка при чтении ${file.name}`);
                };

                reader.readAsDataURL(file);
            });
        });

        document.body.appendChild(fileInput);
        fileInput.click();
        document.body.removeChild(fileInput);
    }
});
