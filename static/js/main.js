/**
 * Главный класс приложения
 * Отвечает за инициализацию и управление всем приложением
 */
class App {
    /**
     * Инициализация приложения
     * Вызывается при загрузке страницы
     */
    static init() {
        // Создаем начальную структуру дерева
        AppState.initializeTree();
        // Генерируем нумерацию для всех элементов
        AppState.generateNumbering();

        // Создаем хранилище для размеров таблиц, если его еще нет
        if (!AppState.tableUISizes) {
            AppState.tableUISizes = {};
        }

        // Отрисовываем дерево в левой панели
        treeManager.render();
        // Обновляем превью с небольшой задержкой для корректного рендера
        setTimeout(() => PreviewManager.update('previewTrim'), 30);

        // Настраиваем навигацию между шагами
        this.setupNavigation();
        // Настраиваем меню выбора форматов
        this.setupFormatMenu();
        // Инициализируем контекстное меню
        ContextMenuManager.init();
        // Инициализируем систему подсказок
        HelpManager.init();
    }

    /**
     * Настройка навигации между шагами и обработчиков кнопок
     */
    static setupNavigation() {
        // Получаем элементы кнопок
        const nextBtn = document.getElementById('nextBtn');
        const backBtn = document.getElementById('backBtn');
        const generateBtn = document.getElementById('generateBtn');

        // Кнопка "Далее" - переход ко второму шагу
        if (nextBtn) {
            nextBtn.addEventListener('click', () => this.goToStep(2));
        }

        // Кнопка "Назад" - возврат к первому шагу
        backBtn.addEventListener('click', () => this.goToStep(1));

        // Кнопка "Сохранить" - генерация документов
        generateBtn.addEventListener('click', async () => {
            // Получаем выбранные форматы
            const selectedFormats = this.getSelectedFormats();

            // Проверяем, что выбран хотя бы один формат
            if (selectedFormats.length === 0) {
                alert('Выберите хотя бы один формат для сохранения');
                return;
            }

            // Проверяем данные акта на корректность
            const validationResult = this.validateActData();
            if (!validationResult.valid) {
                alert(validationResult.message);
                return;
            }

            // Сохраняем данные из DOM обратно в AppState
            ItemsRenderer.syncDataToState();

            // Блокируем кнопку на время операции
            generateBtn.disabled = true;
            const originalText = generateBtn.textContent;
            generateBtn.textContent = '⏳ Создаём акты...';

            try {
                // Отправляем запрос на создание актов во всех выбранных форматах
                const success = await APIClient.generateAct(selectedFormats);
            } catch (error) {
                // Показываем ошибку, если что-то пошло не так
                console.error('Критическая ошибка:', error);
                APIClient.showNotification(
                    'Критическая ошибка',
                    `Произошла непредвиденная ошибка: ${error.message}`,
                    'error'
                );
            } finally {
                // Возвращаем кнопку в исходное состояние
                generateBtn.disabled = false;
                generateBtn.textContent = originalText;
            }
        });

        // Клик по заголовкам шагов для быстрой навигации
        const header = document.querySelector('.header');
        header.querySelectorAll('.step').forEach(step => {
            step.addEventListener('click', () => {
                const stepNum = parseInt(step.dataset.step);
                this.goToStep(stepNum);
            });
        });

        // Горячая клавиша Ctrl+S для быстрого сохранения
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                // Сохраняем только если находимся на втором шаге
                if (AppState.currentStep === 2) {
                    generateBtn.click();
                }
            }
        });
    }

    /**
     * Настройка выпадающего меню выбора форматов
     */
    static setupFormatMenu() {
        const dropdownBtn = document.getElementById('formatDropdownBtn');
        const formatMenu = document.getElementById('formatMenu');
        const generateBtn = document.getElementById('generateBtn');

        // Если элементы не найдены - выходим
        if (!dropdownBtn || !formatMenu) return;

        // Открытие/закрытие меню по клику на кнопку
        dropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();

            // Умное позиционирование меню
            if (formatMenu.classList.contains('hidden')) {
                // Определяем доступное пространство сверху и снизу
                const buttonRect = dropdownBtn.getBoundingClientRect();
                const viewportHeight = window.innerHeight;
                const spaceBelow = viewportHeight - buttonRect.bottom;
                const spaceAbove = buttonRect.top;

                // Показываем меню сверху, если снизу недостаточно места
                if (spaceBelow < 200 && spaceAbove > 200) {
                    formatMenu.style.bottom = 'calc(100% + 8px)';
                    formatMenu.style.top = 'auto';
                } else {
                    formatMenu.style.top = 'calc(100% + 8px)';
                    formatMenu.style.bottom = 'auto';
                }
            }

            // Переключаем видимость меню
            formatMenu.classList.toggle('hidden');
            dropdownBtn.classList.toggle('active');
        });

        // Закрываем меню при клике вне его
        document.addEventListener('click', (e) => {
            if (!formatMenu.contains(e.target) && e.target !== dropdownBtn) {
                formatMenu.classList.add('hidden');
                dropdownBtn.classList.remove('active');
            }
        });

        // Обновляем индикатор при изменении чекбоксов
        const checkboxes = formatMenu.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                this.updateFormatIndicator();
            });
        });

        // Предотвращаем закрытие меню при клике на чекбоксы
        formatMenu.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Показываем начальное состояние индикатора
        this.updateFormatIndicator();
    }

    /**
     * Получение списка выбранных форматов
     * @returns {string[]} Массив выбранных форматов (например, ['txt', 'docx'])
     */
    static getSelectedFormats() {
        const checkboxes = document.querySelectorAll('#formatMenu input[type="checkbox"]:checked');
        return Array.from(checkboxes).map(cb => cb.value);
    }

    /**
     * Обновление визуального индикатора выбранных форматов
     */
    static updateFormatIndicator() {
        const generateBtn = document.getElementById('generateBtn');
        const dropdownBtn = document.getElementById('formatDropdownBtn');
        const selectedFormats = this.getSelectedFormats();

        if (selectedFormats.length > 0) {
            // Формируем текст с выбранными форматами
            const formatsText = selectedFormats.map(f => f.toUpperCase()).join(' + ');

            // Убираем индикатор с основной кнопки
            generateBtn.removeAttribute('data-formats');
            generateBtn.classList.remove('has-formats');

            // Добавляем индикатор на кнопку выпадающего меню
            dropdownBtn.setAttribute('data-formats', formatsText);
            dropdownBtn.classList.add('has-formats');
            dropdownBtn.title = `Выбрано: ${formatsText}`;

            generateBtn.title = `Сохранить в форматах: ${formatsText}`;
        } else {
            // Убираем все индикаторы
            generateBtn.removeAttribute('data-formats');
            generateBtn.classList.remove('has-formats');
            dropdownBtn.removeAttribute('data-formats');
            dropdownBtn.classList.remove('has-formats');

            generateBtn.title = 'Выберите хотя бы один формат';
            dropdownBtn.title = 'Выбрать форматы';
        }
    }

    /**
     * Проверка данных акта перед сохранением
     * @returns {{valid: boolean, message: string}} Результат валидации
     */
    static validateActData() {
        // Проверяем наличие структуры дерева
        if (!AppState.treeData || !AppState.treeData.children) {
            return {valid: false, message: 'Структура акта пуста'};
        }

        // Проверяем, что добавлен хотя бы один раздел
        if (AppState.treeData.children.length === 0) {
            return {valid: false, message: 'Добавьте хотя бы один раздел в акт'};
        }

        // Проверяем, что все таблицы заполнены
        for (const tableId in AppState.tables) {
            const table = AppState.tables[tableId];
            if (!table.rows || table.rows.length === 0) {
                return {valid: false, message: `Таблица ${tableId} пуста`};
            }
        }

        return {valid: true, message: 'OK'};
    }

    /**
     * Переключение между шагами приложения
     * @param {number} stepNum - Номер шага (1 или 2)
     */
    static goToStep(stepNum) {
        // Сохраняем текущий шаг
        AppState.currentStep = stepNum;

        // Обновляем активный шаг в заголовке
        document.querySelectorAll('.step').forEach(step => {
            step.classList.remove('active');
            if (parseInt(step.dataset.step) === stepNum) {
                step.classList.add('active');
            }
        });

        // Скрываем все шаги
        document.querySelectorAll('.step-content').forEach(content => {
            content.classList.add('hidden');
        });

        // Показываем нужный шаг
        const currentContent = document.getElementById(`step${stepNum}`);
        if (currentContent) {
            currentContent.classList.remove('hidden');
        }

        // На втором шаге показываем панели редактирования
        if (stepNum === 2) {
            textBlockManager.initGlobalToolbar();
            ItemsRenderer.renderAll();
        } else {
            textBlockManager.hideToolbar();
        }

        // На первом шаге обновляем превью
        if (stepNum === 1) {
            setTimeout(() => PreviewManager.update('previewTrim'), 30);
        }

        // Обновляем подсказки
        if (typeof HelpManager !== 'undefined') {
            HelpManager.updateTooltip();
        }
    }
}

/**
 * Менеджер отрисовки элементов на втором шаге
 * Отвечает за рендеринг таблиц, текстовых блоков и нарушений
 */
class ItemsRenderer {
    /**
     * Отрисовка всех элементов дерева
     */
    static renderAll() {
        const container = document.getElementById('itemsContainer');
        if (!container) return;

        // Очищаем контейнер
        container.innerHTML = '';
        // Снимаем выделение с ячеек таблиц
        tableManager.clearSelection();

        // Отрисовываем все элементы из дерева
        if (AppState.treeData && AppState.treeData.children) {
            AppState.treeData.children.forEach(item => {
                const itemElement = this.renderItem(item, 1);
                container.appendChild(itemElement);
            });
        }

        // Привязываем события к таблицам
        this.attachTableEvents();

        // Восстанавливаем сохраненные размеры ячеек
        setTimeout(() => {
            document.querySelectorAll('.table-section').forEach(section => {
                const tableId = section.dataset.tableId;
                const tableEl = section.querySelector('.editable-table');
                this.applyPersistedSizes(tableId, tableEl);
            });
        }, 0);
    }

    /**
     * Рекурсивная отрисовка элемента дерева
     * @param {Object} node - Узел дерева
     * @param {number} level - Уровень вложенности
     * @returns {HTMLElement} Созданный DOM элемент
     */
    static renderItem(node, level) {
        // Создаем контейнер для элемента
        const itemDiv = document.createElement('div');
        itemDiv.className = `item-block level-${level}`;
        itemDiv.dataset.nodeId = node.id;

        // Отрисовка таблицы
        if (node.type === 'table') {
            const table = AppState.tables[node.tableId];
            if (table) {
                const tableSection = this.renderTable(table, node);
                itemDiv.appendChild(tableSection);
            }
            return itemDiv;
        }

        // Отрисовка текстового блока
        if (node.type === 'textblock') {
            const textBlock = AppState.textBlocks[node.textBlockId];
            if (textBlock) {
                const textBlockSection = textBlockManager.createTextBlockElement(textBlock, node);
                itemDiv.appendChild(textBlockSection);
            }
            return itemDiv;
        }

        // Отрисовка нарушения
        if (node.type === 'violation') {
            const violation = AppState.violations[node.violationId];
            if (violation) {
                const violationSection = violationManager.createViolationElement(violation, node);
                itemDiv.appendChild(violationSection);
            }
            return itemDiv;
        }

        // Отрисовка обычного заголовка
        const header = document.createElement('div');
        header.className = 'item-header';

        const title = document.createElement(`h${Math.min(level + 1, 6)}`);
        title.className = 'item-title';
        title.textContent = node.label;

        // Добавляем возможность редактирования незащищенных элементов
        if (!node.protected) {
            let clickCount = 0;
            let clickTimer = null;

            // Обработка двойного клика для редактирования
            title.addEventListener('click', (e) => {
                clickCount++;
                if (clickCount === 1) {
                    // Ждем второй клик
                    clickTimer = setTimeout(() => {
                        clickCount = 0;
                    }, 300);
                } else if (clickCount === 2) {
                    // Двойной клик - начинаем редактирование
                    clearTimeout(clickTimer);
                    clickCount = 0;
                    this.startEditingItemTitle(title, node);
                }
            });

            title.style.cursor = 'pointer';
        }

        header.appendChild(title);
        itemDiv.appendChild(header);

        // Отрисовка дочерних элементов
        if (node.children && node.children.length > 0) {
            const childrenDiv = document.createElement('div');
            childrenDiv.className = 'item-children';

            node.children.forEach(child => {
                // Для таблиц и блоков не увеличиваем уровень
                const childElement = this.renderItem(
                    child,
                    (child.type === 'table' || child.type === 'textblock' || child.type === 'violation') ? level : level + 1
                );
                childrenDiv.appendChild(childElement);
            });

            itemDiv.appendChild(childrenDiv);
        }

        return itemDiv;
    }

    /**
     * Отрисовка таблицы
     * @param {Object} table - Данные таблицы
     * @param {Object} node - Узел дерева
     * @returns {HTMLElement} Созданный элемент таблицы
     */
    static renderTable(table, node) {
        const section = document.createElement('div');
        section.className = 'table-section';
        section.dataset.tableId = table.id;

        // Создаем заголовок таблицы
        const tableTitle = document.createElement('h4');
        tableTitle.className = 'table-title';
        tableTitle.contentEditable = false;
        tableTitle.textContent = node.label;
        tableTitle.style.marginBottom = '10px';
        tableTitle.style.fontWeight = 'bold';
        tableTitle.style.cursor = 'pointer';

        let clickCount = 0;
        let clickTimer = null;

        // Обработка двойного клика для редактирования заголовка
        tableTitle.addEventListener('click', (e) => {
            clickCount++;
            if (clickCount === 1) {
                clickTimer = setTimeout(() => {
                    clickCount = 0;
                }, 300);
            } else if (clickCount === 2) {
                clearTimeout(clickTimer);
                clickCount = 0;
                this.startEditingTableTitle(tableTitle, node);
            }
        });

        section.appendChild(tableTitle);

        // Создаем HTML таблицу
        const tableEl = document.createElement('table');
        tableEl.className = 'editable-table';

        // Вычисляем максимальное количество колонок с учетом объединенных ячеек
        let maxCols = 0;
        table.rows.forEach(row => {
            let colCount = 0;
            row.cells.forEach(cell => {
                if (!cell.merged) {
                    colCount += (cell.colspan || 1);
                }
            });
            maxCols = Math.max(maxCols, colCount);
        });

        // Отрисовываем строки и ячейки
        table.rows.forEach((row, rowIndex) => {
            const tr = document.createElement('tr');

            row.cells.forEach((cell, colIndex) => {
                // Пропускаем объединенные ячейки
                if (cell.merged) return;

                // Создаем ячейку (th или td)
                const cellEl = document.createElement(cell.isHeader ? 'th' : 'td');
                cellEl.textContent = cell.content;

                // Устанавливаем colspan и rowspan
                if (cell.colspan > 1) {
                    cellEl.colSpan = cell.colspan;
                }
                if (cell.rowspan > 1) {
                    cellEl.rowSpan = cell.rowspan;
                }

                // Сохраняем координаты ячейки
                cellEl.dataset.row = rowIndex;
                cellEl.dataset.col = colIndex;
                cellEl.dataset.tableId = table.id;

                // Добавляем ручку изменения ширины для некрайних колонок
                const colspan = cell.colspan || 1;
                const cellEndCol = colIndex + colspan - 1;
                const isLastColumn = cellEndCol >= maxCols - 1;

                if (!isLastColumn) {
                    const resizeHandle = document.createElement('div');
                    resizeHandle.className = 'resize-handle';
                    cellEl.appendChild(resizeHandle);
                }

                // Добавляем ручку изменения высоты строки
                const rowResizeHandle = document.createElement('div');
                rowResizeHandle.className = 'row-resize-handle';
                cellEl.appendChild(rowResizeHandle);

                tr.appendChild(cellEl);
            });

            tableEl.appendChild(tr);
        });

        section.appendChild(tableEl);
        return section;
    }

    /**
     * Начало редактирования заголовка элемента
     * @param {HTMLElement} titleElement - Элемент заголовка
     * @param {Object} node - Узел дерева
     */
    static startEditingItemTitle(titleElement, node) {
        // Если уже редактируется - выходим
        if (titleElement.classList.contains('editing')) {
            return;
        }

        titleElement.classList.add('editing');
        titleElement.contentEditable = 'true';

        // Извлекаем текст без нумерации
        const labelMatch = node.label.match(/^\\d+(?:\\.\\d+)*\\.\\s*(.+)$/);
        const baseLabel = labelMatch ? labelMatch[1] : node.label;
        const originalLabel = node.label;

        titleElement.textContent = baseLabel;
        titleElement.focus();

        // Выделяем весь текст
        const range = document.createRange();
        range.selectNodeContents(titleElement);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        /**
         * Завершение редактирования
         * @param {boolean} cancel - Отменить изменения
         */
        const finishEditing = (cancel = false) => {
            titleElement.contentEditable = 'false';
            titleElement.classList.remove('editing');

            if (cancel) {
                titleElement.textContent = originalLabel;
                return;
            }

            const newBaseLabel = titleElement.textContent.trim();

            if (newBaseLabel && newBaseLabel !== baseLabel) {
                // Сохраняем нумерацию
                const numberMatch = node.label.match(/^(\\d+(?:\\.\\d+)*\\.)\\s*/);
                if (numberMatch) {
                    node.label = numberMatch[1] + ' ' + newBaseLabel;
                } else {
                    node.label = newBaseLabel;
                }
                AppState.generateNumbering();
                titleElement.textContent = node.label;
                treeManager.render();
                PreviewManager.update();
            } else if (!newBaseLabel) {
                // Возвращаем старую метку если новая пустая
                titleElement.textContent = originalLabel;
            } else {
                titleElement.textContent = node.label;
            }
        };

        // Завершение редактирования при потере фокуса
        const blurHandler = () => {
            finishEditing(false);
        };

        // Обработка клавиш
        const keydownHandler = (e) => {
            if (e.key === 'Enter') {
                // Enter - сохранить
                e.preventDefault();
                e.stopPropagation();
                titleElement.removeEventListener('blur', blurHandler);
                titleElement.removeEventListener('keydown', keydownHandler);
                finishEditing(false);
            } else if (e.key === 'Escape') {
                // Escape - отменить
                e.preventDefault();
                e.stopPropagation();
                titleElement.removeEventListener('blur', blurHandler);
                titleElement.removeEventListener('keydown', keydownHandler);
                finishEditing(true);
            }
        };

        titleElement.addEventListener('blur', blurHandler);
        titleElement.addEventListener('keydown', keydownHandler);
    }

    /**
     * Начало редактирования заголовка таблицы
     * @param {HTMLElement} titleElement - Элемент заголовка таблицы
     * @param {Object} node - Узел дерева таблицы
     */
    static startEditingTableTitle(titleElement, node) {
        // Если уже редактируется - выходим
        if (titleElement.classList.contains('editing')) {
            return;
        }

        titleElement.classList.add('editing');
        titleElement.contentEditable = 'true';

        const currentLabel = node.customLabel || node.label;
        const originalLabel = currentLabel;

        titleElement.textContent = currentLabel;
        titleElement.focus();

        // Выделяем весь текст
        const range = document.createRange();
        range.selectNodeContents(titleElement);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);

        /**
         * Завершение редактирования
         * @param {boolean} cancel - Отменить изменения
         */
        const finishEditing = (cancel = false) => {
            titleElement.contentEditable = 'false';
            titleElement.classList.remove('editing');

            if (cancel) {
                titleElement.textContent = originalLabel;
                return;
            }

            const newLabel = titleElement.textContent.trim();

            if (newLabel) {
                // Сохраняем новое название
                node.customLabel = newLabel;
                node.label = newLabel;
            } else {
                // Удаляем кастомное название если пустое
                delete node.customLabel;
                node.label = node.number || originalLabel;
            }

            AppState.generateNumbering();
            titleElement.textContent = node.label;
            treeManager.render();
            PreviewManager.update();
        };

        // Завершение редактирования при потере фокуса
        const blurHandler = () => {
            finishEditing(false);
        };

        // Обработка клавиш
        const keydownHandler = (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                titleElement.removeEventListener('blur', blurHandler);
                titleElement.removeEventListener('keydown', keydownHandler);
                finishEditing(false);
            } else if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                titleElement.removeEventListener('blur', blurHandler);
                titleElement.removeEventListener('keydown', keydownHandler);
                finishEditing(true);
            }
        };

        titleElement.addEventListener('blur', blurHandler);
        titleElement.addEventListener('keydown', keydownHandler);
    }

    /**
     * Привязка событий к ячейкам таблиц
     */
    static attachTableEvents() {
        const container = document.getElementById('itemsContainer');
        if (!container) return;

        // Обрабатываем все ячейки таблиц
        container.querySelectorAll('td, th').forEach(cell => {
            // Клик для выделения ячейки
            cell.addEventListener('click', (e) => {
                // Игнорируем клики на ручки изменения размера
                if (e.target.classList.contains('resize-handle') ||
                    e.target.classList.contains('row-resize-handle')) {
                    return;
                }

                // Без Ctrl - снимаем выделение с других ячеек
                if (!e.ctrlKey) {
                    tableManager.clearSelection();
                }
                tableManager.selectCell(cell);
            });

            // Двойной клик для редактирования содержимого
            cell.addEventListener('dblclick', (e) => {
                if (e.target.classList.contains('resize-handle') ||
                    e.target.classList.contains('row-resize-handle')) {
                    return;
                }
                this.startEditingCell(cell);
            });

            // Контекстное меню правой кнопкой мыши
            cell.addEventListener('contextmenu', (e) => {
                if (e.target.classList.contains('resize-handle') ||
                    e.target.classList.contains('row-resize-handle')) {
                    return;
                }

                e.preventDefault();

                // Выделяем ячейку, если она еще не выделена
                if (!cell.classList.contains('selected') && tableManager.selectedCells.length === 0) {
                    tableManager.selectCell(cell);
                }

                ContextMenuManager.show(e.clientX, e.clientY, null, 'cell');
            });
        });

        // Обработка ручек изменения ширины колонок
        container.querySelectorAll('.resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.startColumnResize(e);
            });
        });

        // Обработка ручек изменения высоты строк
        container.querySelectorAll('.row-resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.startRowResize(e);
            });
        });
    }

    /**
     * Начало редактирования содержимого ячейки
     * @param {HTMLElement} cellEl - Элемент ячейки
     */
    static startEditingCell(cellEl) {
        const originalContent = cellEl.textContent;
        cellEl.classList.add('editing');

        // Создаем textarea для многострочного ввода
        const textarea = document.createElement('textarea');
        textarea.value = originalContent;
        textarea.style.width = '100%';
        textarea.style.height = '100%';
        textarea.style.minHeight = '28px';
        textarea.style.border = 'none';
        textarea.style.outline = 'none';
        textarea.style.resize = 'none';
        textarea.style.padding = '4px';
        textarea.style.fontFamily = 'inherit';
        textarea.style.fontSize = 'inherit';

        cellEl.textContent = '';
        cellEl.appendChild(textarea);
        textarea.focus();

        /**
         * Завершение редактирования
         * @param {boolean} cancel - Отменить изменения
         */
        const finishEditing = (cancel = false) => {
            if (cancel) {
                cellEl.textContent = originalContent;
            } else {
                const newValue = textarea.value.trim();
                cellEl.textContent = newValue;

                // Обновляем данные в AppState
                const tableId = cellEl.dataset.tableId;
                const row = parseInt(cellEl.dataset.row);
                const col = parseInt(cellEl.dataset.col);

                const table = AppState.tables[tableId];
                if (table && table.rows[row] && table.rows[row].cells[col]) {
                    table.rows[row].cells[col].content = newValue;
                }

                PreviewManager.update();
            }

            cellEl.classList.remove('editing');
        };

        // Завершение редактирования при потере фокуса
        const blurHandler = () => {
            finishEditing(false);
        };

        // Обработка клавиш
        const keydownHandler = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                // Enter без Shift - сохранить
                e.preventDefault();
                e.stopPropagation();
                textarea.removeEventListener('blur', blurHandler);
                textarea.removeEventListener('keydown', keydownHandler);
                finishEditing(false);
            } else if (e.key === 'Enter' && e.shiftKey) {
                // Shift+Enter - перенос строки
                e.stopPropagation();
            } else if (e.key === 'Escape') {
                // Escape - отменить
                e.preventDefault();
                e.stopPropagation();
                textarea.removeEventListener('blur', blurHandler);
                textarea.removeEventListener('keydown', keydownHandler);
                finishEditing(true);
            }
        };

        textarea.addEventListener('blur', blurHandler);
        textarea.addEventListener('keydown', keydownHandler);
    }

    /**
     * Начало изменения ширины колонки
     * @param {MouseEvent} e - Событие мыши
     */
    static startColumnResize(e) {
        const cell = e.target.parentElement;
        const table = cell.closest('table');
        const section = table.closest('.table-section');
        const startX = e.clientX;
        const startWidth = cell.offsetWidth;
        const colIndex = parseInt(cell.dataset.col);

        // Находим следующую колонку для синхронного изменения размера
        const allRows = table.querySelectorAll('tr');
        const firstRow = allRows[0];
        const firstRowCells = firstRow.querySelectorAll('td, th');

        let nextColIndex = null;
        let nextCell = null;
        let nextStartWidth = 0;

        for (let i = 0; i < firstRowCells.length; i++) {
            const testCell = firstRowCells[i];
            const testColIndex = parseInt(testCell.dataset.col);
            if (testColIndex > colIndex) {
                nextColIndex = testColIndex;
                nextCell = testCell;
                nextStartWidth = testCell.offsetWidth;
                break;
            }
        }

        // Ограничения размеров
        const minWidth = 80;
        const maxWidth = 800;

        // Устанавливаем курсор и блокируем выделение текста
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        table.classList.add('resizing');

        // Создаем вертикальную линию для визуализации изменения размера
        const resizeLine = document.createElement('div');
        resizeLine.style.position = 'fixed';
        resizeLine.style.top = '0';
        resizeLine.style.bottom = '0';
        resizeLine.style.width = '2px';
        resizeLine.style.backgroundColor = '#667eea';
        resizeLine.style.zIndex = '9999';
        resizeLine.style.pointerEvents = 'none';
        resizeLine.style.left = `${e.clientX}px`;
        document.body.appendChild(resizeLine);

        /**
         * Обработка движения мыши
         */
        const onMouseMove = (ev) => {
            const diff = ev.clientX - startX;
            let newWidth = startWidth + diff;
            newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

            let nextNewWidth = nextStartWidth;
            if (nextColIndex !== null && nextCell) {
                // Вычисляем новую ширину соседней колонки
                const actualDiff = newWidth - startWidth;
                nextNewWidth = nextStartWidth - actualDiff;

                // Проверяем ограничения для соседней колонки
                if (nextNewWidth < minWidth) {
                    nextNewWidth = minWidth;
                    newWidth = startWidth + (nextStartWidth - minWidth);
                }
                if (nextNewWidth > maxWidth) {
                    nextNewWidth = maxWidth;
                    newWidth = startWidth + (nextStartWidth - maxWidth);
                }
            }

            // Обновляем позицию линии
            resizeLine.style.left = `${startX + (newWidth - startWidth)}px`;

            // Применяем размеры ко всем ячейкам в колонках
            allRows.forEach(row => {
                const cellsInRow = row.querySelectorAll('td, th');
                cellsInRow.forEach(rowCell => {
                    const cellColIndex = parseInt(rowCell.dataset.col);
                    const colspan = rowCell.colSpan || 1;

                    if (cellColIndex === colIndex) {
                        // Изменяемая колонка
                        rowCell.style.width = `${newWidth}px`;
                        rowCell.style.minWidth = `${newWidth}px`;
                        rowCell.style.maxWidth = `${newWidth}px`;
                        rowCell.style.wordBreak = 'normal';
                        rowCell.style.overflowWrap = 'anywhere';
                    } else if (cellColIndex < colIndex && cellColIndex + colspan > colIndex) {
                        // Ячейка с colspan, которая накрывает изменяемую колонку
                        const currentCellWidth = rowCell.offsetWidth;
                        const delta = newWidth - startWidth;
                        const newCellWidth = currentCellWidth + delta;
                        rowCell.style.width = `${newCellWidth}px`;
                        rowCell.style.minWidth = `${newCellWidth}px`;
                        rowCell.style.maxWidth = `${newCellWidth}px`;
                        rowCell.style.wordBreak = 'normal';
                        rowCell.style.overflowWrap = 'anywhere';
                    } else if (nextColIndex !== null && cellColIndex === nextColIndex) {
                        // Соседняя колонка
                        rowCell.style.width = `${nextNewWidth}px`;
                        rowCell.style.minWidth = `${nextNewWidth}px`;
                        rowCell.style.maxWidth = `${nextNewWidth}px`;
                        rowCell.style.wordBreak = 'normal';
                        rowCell.style.overflowWrap = 'anywhere';
                    } else if (nextColIndex !== null && cellColIndex < nextColIndex && cellColIndex + colspan > nextColIndex) {
                        // Ячейка с colspan, которая накрывает соседнюю колонку
                        const currentCellWidth = rowCell.offsetWidth;
                        const delta = nextNewWidth - nextStartWidth;
                        const newCellWidth = currentCellWidth + delta;
                        rowCell.style.width = `${newCellWidth}px`;
                        rowCell.style.minWidth = `${newCellWidth}px`;
                        rowCell.style.maxWidth = `${newCellWidth}px`;
                        rowCell.style.wordBreak = 'normal';
                        rowCell.style.overflowWrap = 'anywhere';
                    }
                });
            });
        };

        /**
         * Завершение изменения размера
         */
        const onMouseUp = () => {
            // Восстанавливаем состояние
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            table.classList.remove('resizing');
            document.body.removeChild(resizeLine);

            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            // Сохраняем размеры в AppState
            if (section) {
                const tableId = section.dataset.tableId;
                ItemsRenderer.persistTableSizes(tableId, table);
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    /**
     * Начало изменения высоты строки
     * @param {MouseEvent} e - Событие мыши
     */
    static startRowResize(e) {
        const cell = e.target.parentElement;
        const row = cell.parentElement;
        const table = cell.closest('table');
        const startY = e.clientY;
        const startHeight = row.offsetHeight;
        const rowIndex = parseInt(cell.dataset.row);

        // Ограничения размеров
        const minHeight = 28;
        const maxHeight = 600;

        // Устанавливаем курсор и блокируем выделение текста
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        table.classList.add('resizing');

        // Создаем горизонтальную линию для визуализации изменения размера
        const resizeLine = document.createElement('div');
        resizeLine.style.position = 'fixed';
        resizeLine.style.left = '0';
        resizeLine.style.right = '0';
        resizeLine.style.height = '2px';
        resizeLine.style.backgroundColor = '#667eea';
        resizeLine.style.zIndex = '9999';
        resizeLine.style.pointerEvents = 'none';
        resizeLine.style.top = `${e.clientY}px`;
        document.body.appendChild(resizeLine);

        /**
         * Обработка движения мыши
         */
        const onMouseMove = (ev) => {
            const diff = ev.clientY - startY;
            let newHeight = startHeight + diff;
            newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));

            // Обновляем позицию линии
            resizeLine.style.top = `${startY + (newHeight - startHeight)}px`;

            // Применяем размеры ко всем ячейкам в строке
            const allRows = table.querySelectorAll('tr');
            allRows.forEach(tableRow => {
                const cellsInRow = tableRow.querySelectorAll('td, th');
                cellsInRow.forEach(rowCell => {
                    const cellRowIndex = parseInt(rowCell.dataset.row);
                    const rowspan = rowCell.rowSpan || 1;

                    if (cellRowIndex === rowIndex) {
                        // Изменяемая строка
                        rowCell.style.height = `${newHeight}px`;
                        rowCell.style.minHeight = `${newHeight}px`;
                    } else if (cellRowIndex < rowIndex && cellRowIndex + rowspan > rowIndex) {
                        // Ячейка с rowspan, которая накрывает изменяемую строку
                        const currentCellHeight = rowCell.offsetHeight;
                        const delta = newHeight - startHeight;
                        const newCellHeight = currentCellHeight + delta;
                        rowCell.style.height = `${Math.max(minHeight * rowspan, Math.min(maxHeight * rowspan, newCellHeight))}px`;
                        rowCell.style.minHeight = `${Math.max(minHeight * rowspan, Math.min(maxHeight * rowspan, newCellHeight))}px`;
                    }
                });
            });

            // Применяем высоту к самой строке
            row.style.height = `${newHeight}px`;
            row.style.minHeight = `${newHeight}px`;
        };

        /**
         * Завершение изменения размера
         */
        const onMouseUp = () => {
            // Восстанавливаем состояние
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            table.classList.remove('resizing');
            document.body.removeChild(resizeLine);

            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            // Сохраняем размеры в AppState
            const section = table.closest('.table-section');
            if (section) {
                const tableId = section.dataset.tableId;
                ItemsRenderer.persistTableSizes(tableId, table);
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    /**
     * Сохранение размеров ячеек таблицы в AppState
     * @param {string} tableId - ID таблицы
     * @param {HTMLElement} tableElement - DOM элемент таблицы
     */
    static persistTableSizes(tableId, tableElement) {
        if (!tableId || !tableElement) return;

        if (!AppState.tableUISizes) {
            AppState.tableUISizes = {};
        }

        const sizes = {};

        // Собираем размеры всех ячеек
        tableElement.querySelectorAll('th, td').forEach(cell => {
            const row = cell.dataset.row;
            const col = cell.dataset.col;
            if (row === null || col === null) return;

            const key = `${row}-${col}`;
            sizes[key] = {
                width: cell.style.width || '',
                height: cell.style.height || '',
                minWidth: cell.style.minWidth || '',
                minHeight: cell.style.minHeight || '',
                wordBreak: cell.style.wordBreak || '',
                overflowWrap: cell.style.overflowWrap || ''
            };
        });

        // Сохраняем в глобальное хранилище
        AppState.tableUISizes[tableId] = {
            cellSizes: sizes
        };
    }

    /**
     * Применение сохраненных размеров к таблице
     * @param {string} tableId - ID таблицы
     * @param {HTMLElement} tableElement - DOM элемент таблицы
     */
    static applyPersistedSizes(tableId, tableElement) {
        if (!tableId || !tableElement) return;

        const saved = AppState.tableUISizes && AppState.tableUISizes[tableId];
        if (!saved || !saved.cellSizes) return;

        // Применяем сохраненные размеры к ячейкам
        tableElement.querySelectorAll('th, td').forEach(cell => {
            const row = cell.dataset.row;
            const col = cell.dataset.col;
            if (row === null || col === null) return;

            const key = `${row}-${col}`;
            const s = saved.cellSizes[key];

            if (s) {
                // Применяем сохраненные стили
                if (s.width) cell.style.width = s.width;
                if (s.height) cell.style.height = s.height;
                if (s.minWidth) cell.style.minWidth = s.minWidth;
                if (s.minHeight) cell.style.minHeight = s.minHeight;
                cell.style.wordBreak = s.wordBreak || 'normal';
                cell.style.overflowWrap = s.overflowWrap || 'anywhere';
            } else {
                // Устанавливаем размеры по умолчанию
                cell.style.minWidth = '80px';
                cell.style.minHeight = '28px';
                cell.style.wordBreak = 'normal';
                cell.style.overflowWrap = 'anywhere';
            }
        });
    }

    /**
     * Сохранение текущих размеров таблицы
     * @param {HTMLElement} tableElement - DOM элемент таблицы
     * @returns {Object} Объект с размерами ячеек
     */
    static preserveTableSizes(tableElement) {
        const sizes = {};
        const cells = tableElement.querySelectorAll('th, td');

        cells.forEach(cell => {
            const row = cell.dataset.row;
            const col = cell.dataset.col;
            const key = `${row}-${col}`;

            sizes[key] = {
                width: cell.style.width || '',
                height: cell.style.height || '',
                minWidth: cell.style.minWidth || '',
                minHeight: cell.style.minHeight || '',
                wordBreak: cell.style.wordBreak || '',
                overflowWrap: cell.style.overflowWrap || ''
            };
        });

        return sizes;
    }

    /**
     * Применение размеров к таблице
     * @param {HTMLElement} tableElement - DOM элемент таблицы
     * @param {Object} sizes - Объект с размерами ячеек
     */
    static applyTableSizes(tableElement, sizes) {
        if (!sizes) return;

        const cells = tableElement.querySelectorAll('th, td');

        cells.forEach(cell => {
            const row = cell.dataset.row;
            const col = cell.dataset.col;
            const key = `${row}-${col}`;

            if (sizes[key]) {
                if (sizes[key].width) cell.style.width = sizes[key].width;
                if (sizes[key].height) cell.style.height = sizes[key].height;
                if (sizes[key].minWidth) cell.style.minWidth = sizes[key].minWidth;
                if (sizes[key].minHeight) cell.style.minHeight = sizes[key].minHeight;
                cell.style.wordBreak = sizes[key].wordBreak || 'normal';
                cell.style.overflowWrap = sizes[key].overflowWrap || 'anywhere';
            }
        });
    }

    /**
     * Синхронизация данных из DOM обратно в AppState
     * Вызывается перед сохранением документа
     */
    static syncDataToState() {
        // Синхронизация содержимого таблиц
        document.querySelectorAll('.table-section').forEach(section => {
            const tableId = section.dataset.tableId;
            const table = AppState.tables[tableId];
            if (!table) return;

            const tableEl = section.querySelector('.editable-table');
            if (!tableEl) return;

            const rows = tableEl.querySelectorAll('tr');

            rows.forEach((tr, rowIndex) => {
                const cells = tr.querySelectorAll('td, th');

                cells.forEach((cell, cellIndex) => {
                    const row = parseInt(cell.dataset.row);
                    const col = parseInt(cell.dataset.col);

                    if (table.rows[row] && table.rows[row].cells[col]) {
                        table.rows[row].cells[col].content = cell.textContent.trim();
                    }
                });
            });
        });

        // Синхронизация текстовых блоков
        document.querySelectorAll('.text-block-section').forEach(section => {
            const textBlockId = section.dataset.textBlockId;
            const textBlock = AppState.textBlocks[textBlockId];
            if (!textBlock) return;

            const editor = section.querySelector('.text-block-editor');
            if (editor) {
                textBlock.content = editor.innerHTML;
            }
        });

        // Синхронизация данных нарушений
        document.querySelectorAll('.violation-section').forEach(section => {
            const violationId = section.dataset.violationId;
            const violation = AppState.violations[violationId];
            if (!violation) return;

            // Синхронизация основных полей
            const violatedInput = section.querySelector('input[data-field="violated"]');
            if (violatedInput) {
                violation.violated = violatedInput.value;
            }

            const establishedInput = section.querySelector('textarea[data-field="established"]');
            if (establishedInput) {
                violation.established = establishedInput.value;
            }

            // Синхронизация списка описаний
            const descItems = section.querySelectorAll('.violation-desc-item');
            if (descItems.length > 0) {
                violation.descriptionList.items = Array.from(descItems).map(item => item.value);
            }

            // Синхронизация дополнительных полей
            const additionalTextArea = section.querySelector('textarea[data-field="additionalText"]');
            if (additionalTextArea && violation.additionalText) {
                violation.additionalText.content = additionalTextArea.value;
            }

            const reasonsArea = section.querySelector('textarea[data-field="reasons"]');
            if (reasonsArea && violation.reasons) {
                violation.reasons.content = reasonsArea.value;
            }

            const consequencesArea = section.querySelector('textarea[data-field="consequences"]');
            if (consequencesArea && violation.consequences) {
                violation.consequences.content = consequencesArea.value;
            }

            const responsibleArea = section.querySelector('textarea[data-field="responsible"]');
            if (responsibleArea && violation.responsible) {
                violation.responsible.content = responsibleArea.value;
            }
        });
    }
}

// Запуск приложения при загрузке DOM
document.addEventListener('DOMContentLoaded', () => App.init());
