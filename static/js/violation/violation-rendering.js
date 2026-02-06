/**
 * Модуль рендеринга элементов дополнительного контента
 * Создание DOM-элементов для кейсов, изображений и текста
 */

// Расширение ViolationManager
Object.assign(ViolationManager.prototype, {
    /**
     * Отрисовывает все элементы в порядке добавления
     * Вычисляет нумерацию для последовательных кейсов
     * @param {Object} violation - Объект нарушения
     * @param {HTMLElement} container - Контейнер для элементов
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
                // Добавляем ID элемента в dataset для корректного удаления
                itemElement.dataset.itemId = item.id;
                itemElement.dataset.itemIndex = index;

                // Добавляем drag-and-drop атрибуты (только если не режим чтения)
                const isReadOnly = AppConfig.readOnlyMode?.isReadOnly;
                itemElement.draggable = !isReadOnly;

                // Обработчики перетаскивания (только если не режим чтения)
                if (!isReadOnly) {
                    itemElement.addEventListener('dragstart', (e) => this.handleDragStart(e, violation, index, item));
                    itemElement.addEventListener('dragover', (e) => this.handleDragOver(e, violation, container));
                    itemElement.addEventListener('dragenter', (e) => this.handleDragEnter(e));
                    itemElement.addEventListener('dragleave', (e) => this.handleDragLeave(e));
                    itemElement.addEventListener('drop', (e) => this.handleDrop(e, violation, index, container));
                    itemElement.addEventListener('dragend', (e) => this.handleDragEnd(e, container));
                }

                container.appendChild(itemElement);
            }
        });

        // Сбрасываем последний индекс
        this.lastDragOverIndex = null;
    },

    /**
     * Получает порядковый номер элемента определенного типа (не прерываемый)
     * @param {Array} items - Массив элементов
     * @param {string} type - Тип элемента
     * @param {number} currentIndex - Текущий индекс
     * @returns {number} Порядковый номер
     */
    getTypeSequentialNumber(items, type, currentIndex) {
        let count = 0;
        for (let i = 0; i <= currentIndex; i++) {
            if (items[i].type === type) {
                count++;
            }
        }
        return count;
    },

    /**
     * Вычисляет номера для кейсов (сброс нумерации при прерывании)
     * @param {Array} items - Массив элементов
     * @returns {Array} Массив с номерами кейсов
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
    },

    /**
     * Создает элемент кейса с нумерацией
     * @param {Object} violation - Объект нарушения
     * @param {Object} item - Данные элемента
     * @param {number} index - Индекс элемента
     * @param {number} caseNumber - Номер кейса
     * @returns {HTMLElement} Элемент кейса
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
    },

    /**
     * Создает элемент изображения с нумерацией
     * @param {Object} violation - Объект нарушения
     * @param {Object} item - Данные элемента
     * @param {number} index - Индекс элемента
     * @param {number} imageNumber - Номер изображения
     * @returns {HTMLElement} Элемент изображения
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

        // Запрещаем перетаскивание самого изображения
        img.draggable = false;
        img.style.pointerEvents = 'none';
        img.style.userSelect = 'none';

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
    },

    /**
     * Создает элемент произвольного текста с нумерацией
     * @param {Object} violation - Объект нарушения
     * @param {Object} item - Данные элемента
     * @param {number} index - Индекс элемента
     * @param {number} textNumber - Номер текстового блока
     * @returns {HTMLElement} Элемент текста
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
});
