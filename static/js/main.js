/**
 * Главный класс приложения
 */
class App {
    static init() {
        AppState.initializeTree();
        AppState.generateNumbering();

        // Инициализация хранилища размеров таблиц
        if (!AppState.tableUISizes) {
            AppState.tableUISizes = {};
        }

        treeManager.render();
        setTimeout(() => PreviewManager.update('previewTrim'), 30);

        this.setupNavigation();
        this.setupFormatMenu();
        ContextMenuManager.init();
        HelpManager.init();
    }

    static setupNavigation() {
        const nextBtn = document.getElementById('nextBtn');
        const backBtn = document.getElementById('backBtn');
        const generateBtn = document.getElementById('generateBtn');

        if (nextBtn) {
            nextBtn.addEventListener('click', () => this.goToStep(2));
        }

        backBtn.addEventListener('click', () => this.goToStep(1));

        // Передаем в обработчик ВСЕ форматы сразу
        generateBtn.addEventListener('click', async () => {
            const selectedFormats = this.getSelectedFormats();

            if (selectedFormats.length === 0) {
                alert('Выберите хотя бы один формат для сохранения');
                return;
            }

            // Валидация данных
            const validationResult = this.validateActData();
            if (!validationResult.valid) {
                alert(validationResult.message);
                return;
            }

            // Синхронизируем DOM с AppState
            ItemsRenderer.syncDataToState();

            // Блокируем кнопку на время операции
            generateBtn.disabled = true;
            const originalText = generateBtn.textContent;
            generateBtn.textContent = '⏳ Создаём акты...';

            try {
                // Передаем весь массив форматов ОДНИМ вызовом
                const success = await APIClient.generateAct(selectedFormats);
            } catch (error) {
                console.error('Критическая ошибка:', error);
                APIClient.showNotification(
                    'Критическая ошибка',
                    `Произошла непредвиденная ошибка: ${error.message}`,
                    'error'
                );
            } finally {
                // Восстанавливаем кнопку
                generateBtn.disabled = false;
                generateBtn.textContent = originalText;
            }
        });

        // Навигация по шагам через клик на заголовки
        const header = document.querySelector('.header');
        header.querySelectorAll('.step').forEach(step => {
            step.addEventListener('click', () => {
                const stepNum = parseInt(step.dataset.step);
                this.goToStep(stepNum);
            });
        });

        // Ctrl+S для быстрого сохранения
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
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

        if (!dropdownBtn || !formatMenu) return;

        // Открытие/закрытие меню с умным позиционированием
        dropdownBtn.addEventListener('click', (e) => {
            e.stopPropagation();

            if (formatMenu.classList.contains('hidden')) {
                // Определяем, где больше места - сверху или снизу
                const buttonRect = dropdownBtn.getBoundingClientRect();
                const viewportHeight = window.innerHeight;
                const spaceBelow = viewportHeight - buttonRect.bottom;
                const spaceAbove = buttonRect.top;

                // Если снизу мало места, но сверху достаточно - показываем сверху
                if (spaceBelow < 200 && spaceAbove > 200) {
                    formatMenu.style.bottom = 'calc(100% + 8px)';
                    formatMenu.style.top = 'auto';
                } else {
                    // Иначе показываем снизу (на случай если захотите переключиться обратно)
                    formatMenu.style.top = 'calc(100% + 8px)';
                    formatMenu.style.bottom = 'auto';
                }
            }

            formatMenu.classList.toggle('hidden');
            dropdownBtn.classList.toggle('active');
        });

        // Закрытие меню при клике вне его
        document.addEventListener('click', (e) => {
            if (!formatMenu.contains(e.target) && e.target !== dropdownBtn) {
                formatMenu.classList.add('hidden');
                dropdownBtn.classList.remove('active');
            }
        });

        // Обновление индикатора при изменении чекбоксов
        const checkboxes = formatMenu.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                this.updateFormatIndicator();
            });
        });

        // Предотвращение закрытия меню при клике на чекбокс
        formatMenu.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Инициализация индикатора
        this.updateFormatIndicator();
    }

    /**
     * Получение массива выбранных форматов
     * @returns {string[]} Массив выбранных форматов (например, ['txt', 'docx'])
     */
    static getSelectedFormats() {
        const checkboxes = document.querySelectorAll('#formatMenu input[type="checkbox"]:checked');
        return Array.from(checkboxes).map(cb => cb.value);
    }

    /**
     * Обновление визуального индикатора выбранных форматов на кнопке
     */
    static updateFormatIndicator() {
        const generateBtn = document.getElementById('generateBtn');
        const dropdownBtn = document.getElementById('formatDropdownBtn'); // Добавлено
        const selectedFormats = this.getSelectedFormats();

        if (selectedFormats.length > 0) {
            const formatsText = selectedFormats.map(f => f.toUpperCase()).join(' + ');

            // Убираем индикатор с основной кнопки
            generateBtn.removeAttribute('data-formats');
            generateBtn.classList.remove('has-formats');

            // Добавляем индикатор на стрелочку
            dropdownBtn.setAttribute('data-formats', formatsText);
            dropdownBtn.classList.add('has-formats');
            dropdownBtn.title = `Выбрано: ${formatsText}`;

            generateBtn.title = `Сохранить в форматах: ${formatsText}`;
        } else {
            // Убираем индикаторы
            generateBtn.removeAttribute('data-formats');
            generateBtn.classList.remove('has-formats');
            dropdownBtn.removeAttribute('data-formats');
            dropdownBtn.classList.remove('has-formats');

            generateBtn.title = 'Выберите хотя бы один формат';
            dropdownBtn.title = 'Выбрать форматы';
        }
    }

    /**
     * Валидация данных акта перед сохранением
     * @returns {{valid: boolean, message: string}}
     */
    static validateActData() {
        if (!AppState.treeData || !AppState.treeData.children) {
            return {valid: false, message: 'Структура акта пуста'};
        }

        if (AppState.treeData.children.length === 0) {
            return {valid: false, message: 'Добавьте хотя бы один раздел в акт'};
        }

        // Проверка таблиц
        for (const tableId in AppState.tables) {
            const table = AppState.tables[tableId];
            if (!table.rows || table.rows.length === 0) {
                return {valid: false, message: `Таблица ${tableId} пуста`};
            }
        }

        return {valid: true, message: 'OK'};
    }

    /**
     * Переключение между шагами
     * @param {number} stepNum - Номер шага (1 или 2)
     */
    static goToStep(stepNum) {
        AppState.currentStep = stepNum;

        // Обновление активного шага в header
        document.querySelectorAll('.step').forEach(step => {
            step.classList.remove('active');
            if (parseInt(step.dataset.step) === stepNum) {
                step.classList.add('active');
            }
        });

        // Скрытие всех шагов
        document.querySelectorAll('.step-content').forEach(content => {
            content.classList.add('hidden');
        });

        // Показ текущего шага
        const currentContent = document.getElementById(`step${stepNum}`);
        if (currentContent) {
            currentContent.classList.remove('hidden');
        }

        // Шаг 2: инициализация панелей редактирования
        if (stepNum === 2) {
            textBlockManager.initGlobalToolbar();
            ItemsRenderer.renderAll();
        } else {
            textBlockManager.hideToolbar();
        }

        // Шаг 1: обновление превью
        if (stepNum === 1) {
            setTimeout(() => PreviewManager.update('previewTrim'), 30);
        }

        if (typeof HelpManager !== 'undefined') {
            HelpManager.updateTooltip();
        }
    }
}

/**
 * Рендерер элементов акта на шаге 2
 */
class ItemsRenderer {
    /**
     * Рендер всех элементов дерева
     */
    static renderAll() {
        const container = document.getElementById('itemsContainer');
        if (!container) return;

        container.innerHTML = '';
        tableManager.clearSelection();

        if (AppState.treeData && AppState.treeData.children) {
            AppState.treeData.children.forEach(item => {
                const itemElement = this.renderItem(item, 1);
                container.appendChild(itemElement);
            });
        }

        // Привязка событий к таблицам и UI элементам
        this.attachTableEvents();

        // Восстановление сохранённых размеров ячеек таблиц
        setTimeout(() => {
            document.querySelectorAll('.table-section').forEach(section => {
                const tableId = section.dataset.tableId;
                const tableEl = section.querySelector('.editable-table');
                this.applyPersistedSizes(tableId, tableEl);
            });
        }, 0);
    }

    /**
     * Рекурсивный рендер элемента дерева
     * @param {Object} node - Узел дерева
     * @param {number} level - Уровень вложенности
     * @returns {HTMLElement}
     */
    static renderItem(node, level) {
        const itemDiv = document.createElement('div');
        itemDiv.className = `item-block level-${level}`;
        itemDiv.dataset.nodeId = node.id;

        if (node.type === 'table') {
            const table = AppState.tables[node.tableId];
            if (table) {
                const tableSection = this.renderTable(table, node);
                itemDiv.appendChild(tableSection);
            }
            return itemDiv;
        }

        if (node.type === 'textblock') {
            const textBlock = AppState.textBlocks[node.textBlockId];
            if (textBlock) {
                const textBlockSection = textBlockManager.createTextBlockElement(textBlock, node);
                itemDiv.appendChild(textBlockSection);
            }
            return itemDiv;
        }

        if (node.type === 'violation') {
            const violation = AppState.violations[node.violationId];
            if (violation) {
                const violationSection = violationManager.createViolationElement(violation, node);
                itemDiv.appendChild(violationSection);
            }
            return itemDiv;
        }

        // Обычный заголовок элемента
        const header = document.createElement('div');
        header.className = 'item-header';

        const title = document.createElement(`h${Math.min(level + 1, 6)}`);
        title.className = 'item-title';
        title.textContent = node.label;

        if (!node.protected) {
            let clickCount = 0;
            let clickTimer = null;

            title.addEventListener('click', (e) => {
                clickCount++;
                if (clickCount === 1) {
                    clickTimer = setTimeout(() => {
                        clickCount = 0;
                    }, 300);
                } else if (clickCount === 2) {
                    clearTimeout(clickTimer);
                    clickCount = 0;
                    this.startEditingItemTitle(title, node);
                }
            });

            title.style.cursor = 'pointer';
        }

        header.appendChild(title);
        itemDiv.appendChild(header);

        // Дочерние элементы
        if (node.children && node.children.length > 0) {
            const childrenDiv = document.createElement('div');
            childrenDiv.className = 'item-children';

            node.children.forEach(child => {
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
     * Рендер таблицы
     * @param {Object} table - Данные таблицы
     * @param {Object} node - Узел дерева
     * @returns {HTMLElement}
     */
    static renderTable(table, node) {
        const section = document.createElement('div');
        section.className = 'table-section';
        section.dataset.tableId = table.id;

        // Заголовок таблицы (редактируемый по двойному клику)
        const tableTitle = document.createElement('h4');
        tableTitle.className = 'table-title';
        tableTitle.contentEditable = false;
        tableTitle.textContent = node.label;
        tableTitle.style.marginBottom = '10px';
        tableTitle.style.fontWeight = 'bold';
        tableTitle.style.cursor = 'pointer';

        let clickCount = 0;
        let clickTimer = null;

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

        // Создание HTML таблицы
        const tableEl = document.createElement('table');
        tableEl.className = 'editable-table';

        // Вычисление максимального количества колонок с учётом colspan
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

        // Рендер строк и ячеек
        table.rows.forEach((row, rowIndex) => {
            const tr = document.createElement('tr');

            row.cells.forEach((cell, colIndex) => {
                if (cell.merged) return;

                const cellEl = document.createElement(cell.isHeader ? 'th' : 'td');
                cellEl.textContent = cell.content;

                if (cell.colspan > 1) {
                    cellEl.colSpan = cell.colspan;
                }
                if (cell.rowspan > 1) {
                    cellEl.rowSpan = cell.rowspan;
                }

                cellEl.dataset.row = rowIndex;
                cellEl.dataset.col = colIndex;
                cellEl.dataset.tableId = table.id;

                // Ручки изменения размера только для некрайних колонок
                const colspan = cell.colspan || 1;
                const cellEndCol = colIndex + colspan - 1;
                const isLastColumn = cellEndCol >= maxCols - 1;

                if (!isLastColumn) {
                    const resizeHandle = document.createElement('div');
                    resizeHandle.className = 'resize-handle';
                    cellEl.appendChild(resizeHandle);
                }

                // Ручка изменения высоты строки
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
     * Начало редактирования заголовка элемента (на шаге 2)
     * @param {HTMLElement} titleElement - DOM элемент заголовка
     * @param {Object} node - Узел дерева
     */
    static startEditingItemTitle(titleElement, node) {
        if (titleElement.classList.contains('editing')) {
            return;
        }

        titleElement.classList.add('editing');
        titleElement.contentEditable = 'true';

        // Извлекаем текст без нумерации для редактирования
        const labelMatch = node.label.match(/^\d+(?:\.\d+)*\.\s*(.+)$/);
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

        const finishEditing = (cancel = false) => {
            titleElement.contentEditable = 'false';
            titleElement.classList.remove('editing');

            if (cancel) {
                titleElement.textContent = originalLabel;
                return;
            }

            const newBaseLabel = titleElement.textContent.trim();

            if (newBaseLabel && newBaseLabel !== baseLabel) {
                // Сохраняем нумерацию, если она была
                const numberMatch = node.label.match(/^(\d+(?:\.\d+)*\.)\s*/);
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
                // Возвращаем старую метку, если новая пустая
                titleElement.textContent = originalLabel;
            } else {
                titleElement.textContent = node.label;
            }
        };

        const blurHandler = () => {
            finishEditing(false);
        };

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
     * Начало редактирования заголовка таблицы (на шаге 2)
     * @param {HTMLElement} titleElement - DOM элемент заголовка таблицы
     * @param {Object} node - Узел дерева таблицы
     */
    static startEditingTableTitle(titleElement, node) {
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

        const finishEditing = (cancel = false) => {
            titleElement.contentEditable = 'false';
            titleElement.classList.remove('editing');

            if (cancel) {
                titleElement.textContent = originalLabel;
                return;
            }

            const newLabel = titleElement.textContent.trim();

            if (newLabel) {
                node.customLabel = newLabel;
                node.label = newLabel;
            } else {
                // Если пустая строка, удаляем customLabel
                delete node.customLabel;
                node.label = node.number || originalLabel;
            }

            AppState.generateNumbering();
            titleElement.textContent = node.label;
            treeManager.render();
            PreviewManager.update();
        };

        const blurHandler = () => {
            finishEditing(false);
        };

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

        // События ячеек
        container.querySelectorAll('td, th').forEach(cell => {
            // Клик для выделения
            cell.addEventListener('click', (e) => {
                if (e.target.classList.contains('resize-handle') ||
                    e.target.classList.contains('row-resize-handle')) {
                    return;
                }

                if (!e.ctrlKey) {
                    tableManager.clearSelection();
                }
                tableManager.selectCell(cell);
            });

            // Двойной клик для редактирования
            cell.addEventListener('dblclick', (e) => {
                if (e.target.classList.contains('resize-handle') ||
                    e.target.classList.contains('row-resize-handle')) {
                    return;
                }
                this.startEditingCell(cell);
            });

            // Контекстное меню
            cell.addEventListener('contextmenu', (e) => {
                if (e.target.classList.contains('resize-handle') ||
                    e.target.classList.contains('row-resize-handle')) {
                    return;
                }

                e.preventDefault();

                if (!cell.classList.contains('selected') && tableManager.selectedCells.length === 0) {
                    tableManager.selectCell(cell);
                }

                ContextMenuManager.show(e.clientX, e.clientY, null, 'cell');
            });
        });

        // Ручки изменения ширины колонок
        container.querySelectorAll('.resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.startColumnResize(e);
            });
        });

        // Ручки изменения высоты строк
        container.querySelectorAll('.row-resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.startRowResize(e);
            });
        });
    }

    /**
     * Начало редактирования ячейки таблицы
     * @param {HTMLElement} cellEl - DOM элемент ячейки
     */
    static startEditingCell(cellEl) {
        const originalContent = cellEl.textContent;
        cellEl.classList.add('editing');

        // Создаем textarea вместо input для поддержки многострочного текста
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

        const blurHandler = () => {
            finishEditing(false);
        };

        const keydownHandler = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                // Enter без Shift - завершить редактирование
                e.preventDefault();
                e.stopPropagation();
                textarea.removeEventListener('blur', blurHandler);
                textarea.removeEventListener('keydown', keydownHandler);
                finishEditing(false);
            } else if (e.key === 'Enter' && e.shiftKey) {
                // Shift+Enter - разрешаем перенос строки (не делаем preventDefault)
                e.stopPropagation();
            } else if (e.key === 'Escape') {
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
     * Изменение ширины колонки
     * @param {MouseEvent} e - Событие мыши
     */
    static startColumnResize(e) {
        const cell = e.target.parentElement;
        const table = cell.closest('table');
        const section = table.closest('.table-section');
        const startX = e.clientX;
        const startWidth = cell.offsetWidth;
        const colIndex = parseInt(cell.dataset.col);

        // Найти следующую колонку
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

        const minWidth = 80;
        const maxWidth = 800;

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        table.classList.add('resizing');

        // Линия ресайза
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

        const onMouseMove = (ev) => {
            const diff = ev.clientX - startX;
            let newWidth = startWidth + diff;
            newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

            let nextNewWidth = nextStartWidth;
            if (nextColIndex !== null && nextCell) {
                const actualDiff = newWidth - startWidth;
                nextNewWidth = nextStartWidth - actualDiff;

                if (nextNewWidth < minWidth) {
                    nextNewWidth = minWidth;
                    newWidth = startWidth + (nextStartWidth - minWidth);
                }
                if (nextNewWidth > maxWidth) {
                    nextNewWidth = maxWidth;
                    newWidth = startWidth + (nextStartWidth - maxWidth);
                }
            }

            resizeLine.style.left = `${startX + (newWidth - startWidth)}px`;

            // Применить размеры ко всем ячейкам в колонках
            allRows.forEach(row => {
                const cellsInRow = row.querySelectorAll('td, th');
                cellsInRow.forEach(rowCell => {
                    const cellColIndex = parseInt(rowCell.dataset.col);
                    const colspan = rowCell.colSpan || 1;

                    if (cellColIndex === colIndex) {
                        rowCell.style.width = `${newWidth}px`;
                        rowCell.style.minWidth = `${newWidth}px`;
                        rowCell.style.maxWidth = `${newWidth}px`;
                        rowCell.style.wordBreak = 'normal';
                        rowCell.style.overflowWrap = 'anywhere';
                    } else if (cellColIndex < colIndex && cellColIndex + colspan > colIndex) {
                        // Ячейка с colspan, которая накрывает текущую колонку
                        const currentCellWidth = rowCell.offsetWidth;
                        const delta = newWidth - startWidth;
                        const newCellWidth = currentCellWidth + delta;
                        rowCell.style.width = `${newCellWidth}px`;
                        rowCell.style.minWidth = `${newCellWidth}px`;
                        rowCell.style.maxWidth = `${newCellWidth}px`;
                        rowCell.style.wordBreak = 'normal';
                        rowCell.style.overflowWrap = 'anywhere';
                    } else if (nextColIndex !== null && cellColIndex === nextColIndex) {
                        rowCell.style.width = `${nextNewWidth}px`;
                        rowCell.style.minWidth = `${nextNewWidth}px`;
                        rowCell.style.maxWidth = `${nextNewWidth}px`;
                        rowCell.style.wordBreak = 'normal';
                        rowCell.style.overflowWrap = 'anywhere';
                    } else if (nextColIndex !== null && cellColIndex < nextColIndex && cellColIndex + colspan > nextColIndex) {
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

        const onMouseUp = () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            table.classList.remove('resizing');
            document.body.removeChild(resizeLine);

            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            // Сохранение размеров в AppState
            if (section) {
                const tableId = section.dataset.tableId;
                ItemsRenderer.persistTableSizes(tableId, table);
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    /**
     * Изменение высоты строки
     * @param {MouseEvent} e - Событие мыши
     */
    static startRowResize(e) {
        const cell = e.target.parentElement;
        const row = cell.parentElement;
        const table = cell.closest('table');
        const startY = e.clientY;
        const startHeight = row.offsetHeight;
        const rowIndex = parseInt(cell.dataset.row);

        const minHeight = 28;
        const maxHeight = 600;

        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        table.classList.add('resizing');

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

        const onMouseMove = (ev) => {
            const diff = ev.clientY - startY;
            let newHeight = startHeight + diff;
            newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));

            resizeLine.style.top = `${startY + (newHeight - startHeight)}px`;

            const allRows = table.querySelectorAll('tr');
            allRows.forEach(tableRow => {
                const cellsInRow = tableRow.querySelectorAll('td, th');
                cellsInRow.forEach(rowCell => {
                    const cellRowIndex = parseInt(rowCell.dataset.row);
                    const rowspan = rowCell.rowSpan || 1;

                    if (cellRowIndex === rowIndex) {
                        rowCell.style.height = `${newHeight}px`;
                        rowCell.style.minHeight = `${newHeight}px`;
                    } else if (cellRowIndex < rowIndex && cellRowIndex + rowspan > rowIndex) {
                        const currentCellHeight = rowCell.offsetHeight;
                        const delta = newHeight - startHeight;
                        const newCellHeight = currentCellHeight + delta;
                        rowCell.style.height = `${Math.max(minHeight * rowspan, Math.min(maxHeight * rowspan, newCellHeight))}px`;
                        rowCell.style.minHeight = `${Math.max(minHeight * rowspan, Math.min(maxHeight * rowspan, newCellHeight))}px`;
                    }
                });
            });

            row.style.height = `${newHeight}px`;
            row.style.minHeight = `${newHeight}px`;
        };

        const onMouseUp = () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            table.classList.remove('resizing');
            document.body.removeChild(resizeLine);

            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

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
     * Сохранение размеров ячеек таблицы в AppState.tableUISizes[tableId]
     * @param {string} tableId - ID таблицы
     * @param {HTMLElement} tableElement - DOM элемент таблицы
     */
    static persistTableSizes(tableId, tableElement) {
        if (!tableId || !tableElement) return;

        if (!AppState.tableUISizes) {
            AppState.tableUISizes = {};
        }

        const sizes = {};

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

        AppState.tableUISizes[tableId] = {
            cellSizes: sizes
        };
    }

    /**
     * Применение сохранённых размеров к таблице
     * @param {string} tableId - ID таблицы
     * @param {HTMLElement} tableElement - DOM элемент таблицы
     */
    static applyPersistedSizes(tableId, tableElement) {
        if (!tableId || !tableElement) return;

        const saved = AppState.tableUISizes && AppState.tableUISizes[tableId];
        if (!saved || !saved.cellSizes) return;

        tableElement.querySelectorAll('th, td').forEach(cell => {
            const row = cell.dataset.row;
            const col = cell.dataset.col;
            if (row === null || col === null) return;

            const key = `${row}-${col}`;
            const s = saved.cellSizes[key];

            if (s) {
                if (s.width) cell.style.width = s.width;
                if (s.height) cell.style.height = s.height;
                if (s.minWidth) cell.style.minWidth = s.minWidth;
                if (s.minHeight) cell.style.minHeight = s.minHeight;
                cell.style.wordBreak = s.wordBreak || 'normal';
                cell.style.overflowWrap = s.overflowWrap || 'anywhere';
            } else {
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
     * Синхронизация данных из DOM обратно в AppState перед сохранением
     */
    static syncDataToState() {
        // Синхронизация таблиц
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

        // Синхронизация нарушений
        document.querySelectorAll('.violation-section').forEach(section => {
            const violationId = section.dataset.violationId;
            const violation = AppState.violations[violationId];
            if (!violation) return;

            // Синхронизация полей нарушения
            const violatedInput = section.querySelector('input[data-field="violated"]');
            if (violatedInput) {
                violation.violated = violatedInput.value;
            }

            const establishedInput = section.querySelector('textarea[data-field="established"]');
            if (establishedInput) {
                violation.established = establishedInput.value;
            }

            // Синхронизация описаний
            const descItems = section.querySelectorAll('.violation-desc-item');
            if (descItems.length > 0) {
                violation.descriptionList.items = Array.from(descItems).map(item => item.value);
            }

            // Дополнительные поля
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

/**
 * Менеджер контекстного меню
 */
class ContextMenuManager {
    static menu = null;
    static cellMenu = null;
    static currentNodeId = null;

    static init() {
        this.menu = document.getElementById('contextMenu');
        this.cellMenu = document.getElementById('cellContextMenu');

        // Закрытие меню при клике вне его
        document.addEventListener('click', () => this.hide());

        // Обработка пунктов меню дерева
        this.menu?.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                this.handleTreeAction(action);
                this.hide();
            });
        });

        // Обработка пунктов меню ячеек
        this.cellMenu?.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const action = item.dataset.action;
                if (item.classList.contains('disabled')) return;
                this.handleCellAction(action);
                this.hide();
            });
        });
    }

    static show(x, y, nodeId, type) {
        this.hide();

        const menu = type === 'cell' ? this.cellMenu : this.menu;
        this.currentNodeId = nodeId;

        if (type === 'cell') {
            const selectedCellsCount = tableManager.selectedCells.length;

            // Управление доступностью пунктов меню
            const mergeCellsItem = this.cellMenu?.querySelector('[data-action="merge-cells"]');
            const unmergeCellItem = this.cellMenu?.querySelector('[data-action="unmerge-cell"]');

            if (mergeCellsItem) {
                if (selectedCellsCount < 2) {
                    mergeCellsItem.classList.add('disabled');
                } else {
                    mergeCellsItem.classList.remove('disabled');
                }
            }

            if (unmergeCellItem) {
                if (selectedCellsCount === 1) {
                    const cell = tableManager.selectedCells[0];
                    const isMerged = cell.colSpan > 1 || cell.rowSpan > 1;
                    if (isMerged) {
                        unmergeCellItem.classList.remove('disabled');
                    } else {
                        unmergeCellItem.classList.add('disabled');
                    }
                } else {
                    unmergeCellItem.classList.add('disabled');
                }
            }
        }

        if (!menu) return;

        // Позиционирование меню
        menu.style.left = '-9999px';
        menu.style.top = '-9999px';
        menu.classList.remove('hidden');

        setTimeout(() => {
            const menuRect = menu.getBoundingClientRect();
            const menuWidth = menuRect.width;
            const menuHeight = menuRect.height;

            const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
            const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

            let finalX = x;
            let finalY = y;

            // Коррекция, если меню выходит за границы
            if (finalX + menuWidth > viewportWidth) {
                finalX = x - menuWidth;
            }
            if (finalX < 0) finalX = 10;

            if (finalY + menuHeight > viewportHeight) {
                finalY = y - menuHeight;
            }
            if (finalY < 0) finalY = 10;

            menu.style.left = `${finalX}px`;
            menu.style.top = `${finalY}px`;
        }, 1);
    }

    static hide() {
        if (this.menu) this.menu.classList.add('hidden');
        if (this.cellMenu) this.cellMenu.classList.add('hidden');
    }

    static handleTreeAction(action) {
        const nodeId = this.currentNodeId;
        if (!nodeId) return;

        const node = AppState.findNodeById(nodeId);
        if (!node) return;

        switch (action) {
            case 'add-child':
                if (node.type === 'table') {
                    alert('Нельзя добавить дочерний элемент к таблице');
                    return;
                }

                const childResult = AppState.addNode(nodeId, 'Новый пункт', true);  // <- изменить пустую строку на 'Новый пункт'
                if (childResult.success) {
                    treeManager.render();
                    PreviewManager.update('previewTrim', 30);
                    if (AppState.currentStep === 2) {
                        ItemsRenderer.renderAll();
                    }
                } else {
                    alert(childResult.reason);
                }
                break;

            case 'add-sibling':
                const siblingResult = AppState.addNode(nodeId, 'Новый пункт', false);  // <- изменить пустую строку на 'Новый пункт'
                if (siblingResult.success) {
                    treeManager.render();
                    PreviewManager.update('previewTrim', 30);
                    if (AppState.currentStep === 2) {
                        ItemsRenderer.renderAll();
                    }
                } else {
                    alert(siblingResult.reason);
                }
                break;

            case 'add-table':
                if (node.type === 'table') {
                    alert('Нельзя добавить таблицу к таблице');
                    return;
                }

                const tableResult = AppState.addTableToNode(nodeId);
                if (tableResult.success) {
                    treeManager.render();
                    PreviewManager.update('previewTrim', 30);
                    if (AppState.currentStep === 2) {
                        ItemsRenderer.renderAll();
                    }
                } else {
                    alert(tableResult.reason);
                }
                break;

            case 'add-textblock':
                if (node.type === 'table' || node.type === 'textblock') {
                    alert('Нельзя добавить текстовый блок к таблице или текстовому блоку');
                    return;
                }

                const textBlockResult = AppState.addTextBlockToNode(nodeId);
                if (textBlockResult.success) {
                    treeManager.render();
                    PreviewManager.update('previewTrim', 30);
                    if (AppState.currentStep === 2) {
                        ItemsRenderer.renderAll();
                    }
                } else {
                    alert(textBlockResult.reason);
                }
                break;

            case 'add-violation':
                if (node.type === 'table' || node.type === 'textblock' || node.type === 'violation') {
                    alert('Нельзя добавить нарушение к таблице, текстовому блоку или нарушению');
                    return;
                }

                const violationResult = AppState.addViolationToNode(nodeId);
                if (violationResult.success) {
                    treeManager.render();
                    PreviewManager.update('previewTrim', 30);
                    if (AppState.currentStep === 2) {
                        ItemsRenderer.renderAll();
                    }
                } else {
                    alert(violationResult.reason);
                }
                break;

            case 'delete':
                if (node.protected) {
                    alert('Этот элемент защищен от удаления');
                    return;
                }

                if (confirm('Удалить элемент?')) {
                    AppState.deleteNode(nodeId);
                    treeManager.render();
                    PreviewManager.update('previewTrim', 30);
                    if (AppState.currentStep === 2) {
                        ItemsRenderer.renderAll();
                    }
                }
                break;
        }
    }

    static handleCellAction(action) {
        let tableSizes;

        if (tableManager.selectedCells.length > 0) {
            const table = tableManager.selectedCells[0].closest('table');
            tableSizes = ItemsRenderer.preserveTableSizes(table);
        }

        switch (action) {
            case 'merge-cells':
                tableManager.mergeCells();
                if (AppState.currentStep === 2) {
                    ItemsRenderer.renderAll();
                    setTimeout(() => {
                        const tables = document.querySelectorAll('.editable-table');
                        tables.forEach(tbl => {
                            ItemsRenderer.applyTableSizes(tbl, tableSizes);
                            const section = tbl.closest('.table-section');
                            if (section) {
                                ItemsRenderer.persistTableSizes(section.dataset.tableId, tbl);
                            }
                        });
                    }, 50);
                } else {
                    tableManager.renderAll();
                    PreviewManager.update('previewTrim', 30);
                }
                break;

            case 'unmerge-cell':
                tableManager.unmergeCells();
                if (AppState.currentStep === 2) {
                    ItemsRenderer.renderAll();
                    setTimeout(() => {
                        const tables = document.querySelectorAll('.editable-table');
                        tables.forEach(tbl => {
                            ItemsRenderer.applyTableSizes(tbl, tableSizes);
                            const section = tbl.closest('.table-section');
                            if (section) {
                                ItemsRenderer.persistTableSizes(section.dataset.tableId, tbl);
                            }
                        });
                    }, 50);
                } else {
                    tableManager.renderAll();
                    PreviewManager.update('previewTrim', 30);
                }
                break;
        }
    }
}

// Инициализация приложения при загрузке DOM
document.addEventListener('DOMContentLoaded', () => App.init());
