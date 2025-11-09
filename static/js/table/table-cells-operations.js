/**
 * Операции с ячейками таблиц.
 * Обрабатывает редактирование содержимого, выделение и объединение/разделение ячеек.
 * Работает с матричной grid-структурой таблиц в AppState.
 */
class TableCellsOperations {
    constructor(tableManager) {
        // Ссылка на TableManager для доступа к selectedCells и координации операций
        this.tableManager = tableManager;
    }

    /**
     * Запуск редактирования содержимого ячейки.
     * Создает textarea для многострочного ввода с поддержкой Shift+Enter.
     * Сохраняет изменения в grid-структуру таблицы в AppState.
     * @param {HTMLElement} cellEl - DOM-элемент ячейки
     */
    startEditingCell(cellEl) {
        const originalContent = cellEl.textContent;
        cellEl.classList.add('editing');

        // Textarea для редактирования с автоматической подстройкой размера
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
         * Завершение редактирования с сохранением или отменой изменений.
         * @param {boolean} cancel - Отменить изменения
         */
        const finishEditing = (cancel = false) => {
            if (cancel) {
                cellEl.textContent = originalContent;
            } else {
                const newValue = textarea.value.trim();
                cellEl.textContent = newValue;

                // Обновление данных в grid-матрице таблицы
                const tableId = cellEl.dataset.tableId;
                const row = parseInt(cellEl.dataset.row);
                const col = parseInt(cellEl.dataset.col);
                const table = AppState.tables[tableId];

                if (table && table.grid && table.grid[row] && table.grid[row][col]) {
                    if (!table.grid[row][col].isSpanned) {
                        table.grid[row][col].content = newValue;
                    }
                }

                PreviewManager.update();
            }

            cellEl.classList.remove('editing');
        };

        // Сохранение при потере фокуса
        const blurHandler = () => {
            finishEditing(false);
        };

        // Обработка клавиш: Enter - сохранить, Shift+Enter - новая строка, Escape - отменить
        const keydownHandler = (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                e.stopPropagation();
                textarea.removeEventListener('blur', blurHandler);
                textarea.removeEventListener('keydown', keydownHandler);
                finishEditing(false);
            } else if (e.key === 'Enter' && e.shiftKey) {
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
     * Вставка новой строки выше текущей строки выбранной ячейки.
     * Если текущая строка - часть объединения, вставляет выше всего объединения.
     */
    insertRowAbove() {
        if (this.tableManager.selectedCells.length === 0) return;

        const cell = this.tableManager.selectedCells[0];
        const tableId = cell.dataset.tableId;
        let rowIndex = parseInt(cell.dataset.row);
        const table = AppState.tables[tableId];

        if (!table || !table.grid) return;

        // Проверяем, является ли текущая строка строкой заголовков
        const isHeaderRow = table.grid[rowIndex].some(c => c.isHeader === true);
        if (isHeaderRow) {
            Notifications.error('Нельзя добавить строку выше заголовка таблицы');
            return;
        }

        // Находим начало объединения, если текущая строка является частью rowSpan
        rowIndex = this._findRowStartOfSpan(table, rowIndex);

        // Новая строка с пустыми ячейками
        const newRow = [];
        const numCols = table.grid[0].length;

        for (let c = 0; c < numCols; c++) {
            newRow.push({
                content: '',
                isHeader: false,
                colSpan: 1,
                rowSpan: 1,
                originRow: rowIndex,
                originCol: c
            });
        }

        // Вставляем новую строку в grid
        table.grid.splice(rowIndex, 0, newRow);

        // Обновляем originRow для всех ячеек ниже
        for (let r = rowIndex + 1; r < table.grid.length; r++) {
            for (let c = 0; c < table.grid[r].length; c++) {
                if (table.grid[r][c].originRow !== undefined) {
                    table.grid[r][c].originRow = r;
                }
            }
        }

        // Обновляем rowSpan для ячеек с объединением
        for (let r = 0; r < rowIndex; r++) {
            for (let c = 0; c < table.grid[r].length; c++) {
                const cellData = table.grid[r][c];
                if (!cellData.isSpanned) {
                    const cellEndRow = r + (cellData.rowSpan || 1);
                    if (cellEndRow > rowIndex) {
                        cellData.rowSpan = (cellData.rowSpan || 1) + 1;
                    }
                }
            }
        }

        this.clearSelection();
        ItemsRenderer.renderAll();
        PreviewManager.update();
    }

    /**
     * Вставка новой строки ниже текущей строки выбранной ячейки.
     * Если текущая строка - часть объединения, вставляет ниже всего объединения.
     */
    insertRowBelow() {
        if (this.tableManager.selectedCells.length === 0) return;

        const cell = this.tableManager.selectedCells[0];
        const tableId = cell.dataset.tableId;
        let rowIndex = parseInt(cell.dataset.row);
        const table = AppState.tables[tableId];

        if (!table || !table.grid) return;

        // Находим конец объединения в текущей строке (максимальный rowSpan)
        let insertRowIndex = rowIndex + 1;
        for (let c = 0; c < table.grid[rowIndex].length; c++) {
            const cellData = table.grid[rowIndex][c];
            if (!cellData.isSpanned && cellData.rowSpan > 1) {
                const cellEndRow = rowIndex + cellData.rowSpan;
                insertRowIndex = Math.max(insertRowIndex, cellEndRow);
            }
        }

        // Также проверяем, не является ли текущая строка частью объединения из предыдущих строк
        // и если да, используем конец того объединения
        for (let r = 0; r < rowIndex; r++) {
            for (let c = 0; c < table.grid[r].length; c++) {
                const cellData = table.grid[r][c];
                if (!cellData.isSpanned && cellData.rowSpan > 1) {
                    const cellEndRow = r + cellData.rowSpan;
                    if (cellEndRow > rowIndex) {
                        insertRowIndex = Math.max(insertRowIndex, cellEndRow);
                    }
                }
            }
        }

        // Новая строка с пустыми ячейками
        const newRow = [];
        const numCols = table.grid[0].length;

        for (let c = 0; c < numCols; c++) {
            newRow.push({
                content: '',
                isHeader: false,
                colSpan: 1,
                rowSpan: 1,
                originRow: insertRowIndex,
                originCol: c
            });
        }

        // Вставляем новую строку в grid
        table.grid.splice(insertRowIndex, 0, newRow);

        // Обновляем originRow для всех ячеек ниже
        for (let r = insertRowIndex + 1; r < table.grid.length; r++) {
            for (let c = 0; c < table.grid[r].length; c++) {
                if (table.grid[r][c].originRow !== undefined) {
                    table.grid[r][c].originRow = r;
                }
            }
        }

        // Обновляем rowSpan для ячеек с объединением
        for (let r = 0; r < insertRowIndex; r++) {
            for (let c = 0; c < table.grid[r].length; c++) {
                const cellData = table.grid[r][c];
                if (!cellData.isSpanned) {
                    const cellEndRow = r + (cellData.rowSpan || 1);
                    if (cellEndRow > insertRowIndex) {
                        cellData.rowSpan = (cellData.rowSpan || 1) + 1;
                    }
                }
            }
        }

        this.clearSelection();
        ItemsRenderer.renderAll();
        PreviewManager.update();
    }

    /**
     * Перераспределение ширины колонок для сохранения 100%.
     * Вызывается после вставки/удаления колонок.
     * @param {Object} table - Таблица из AppState
     */
    _redistributeColumnWidths(table) {
        if (!table || !table.grid || !table.grid[0]) return;

        const numCols = table.grid[0].length;

        // Равномерное распределение: каждая колонка получает одинаковый процент
        const equalWidthPercent = 100 / numCols;

        // Обновляем colWidths в таблице (если используется)
        if (table.colWidths) {
            table.colWidths = new Array(numCols).fill(equalWidthPercent);
        }

        // Сохраняем новые размеры в AppState для применения при рендеринге
        if (!AppState.tableUISizes) {
            AppState.tableUISizes = {};
        }

        const sizes = {};

        // Создаем запись размеров для каждой ячейки
        for (let r = 0; r < table.grid.length; r++) {
            for (let c = 0; c < table.grid[r].length; c++) {
                const cellData = table.grid[r][c];
                if (cellData.isSpanned) continue;

                const key = `${r}-${c}`;
                const colspan = cellData.colSpan || 1;
                const widthPercent = equalWidthPercent * colspan;

                sizes[key] = {
                    width: `${widthPercent}%`,
                    height: '',
                    minWidth: '80px',
                    minHeight: '28px',
                    wordBreak: 'normal',
                    overflowWrap: 'anywhere'
                };
            }
        }

        AppState.tableUISizes[table.id] = {
            cellSizes: sizes
        };
    }

    /**
     * Вставка новой колонки слева от текущей колонки выбранной ячейки.
     * Если текущая колонка - часть объединения, вставляет слева от всего объединения.
     * Верхняя ячейка новой колонки становится заголовком.
     */
    insertColumnLeft() {
        if (this.tableManager.selectedCells.length === 0) return;

        const cell = this.tableManager.selectedCells[0];
        const tableId = cell.dataset.tableId;
        let colIndex = parseInt(cell.dataset.col);
        const table = AppState.tables[tableId];

        if (!table || !table.grid) return;

        // Находим начало объединения, если текущая колонка является частью colSpan
        colIndex = this._findColumnStartOfSpan(table, colIndex);

        // Находим индекс строки заголовков
        let headerRowIndex = -1;
        for (let r = 0; r < table.grid.length; r++) {
            if (table.grid[r].some(c => c.isHeader === true)) {
                headerRowIndex = r;
                break;
            }
        }

        // Вставляем новую колонку во все строки
        for (let r = 0; r < table.grid.length; r++) {
            const isHeaderRow = r === headerRowIndex;
            table.grid[r].splice(colIndex, 0, {
                content: '',
                isHeader: isHeaderRow,
                colSpan: 1,
                rowSpan: 1,
                originRow: r,
                originCol: colIndex
            });
        }

        // Обновляем originCol для всех ячеек справа
        for (let r = 0; r < table.grid.length; r++) {
            for (let c = colIndex + 1; c < table.grid[r].length; c++) {
                if (table.grid[r][c].originCol !== undefined) {
                    table.grid[r][c].originCol = c;
                }
            }
        }

        // Обновляем colSpan для ячеек с объединением
        for (let r = 0; r < table.grid.length; r++) {
            for (let c = 0; c < colIndex; c++) {
                const cellData = table.grid[r][c];
                if (!cellData.isSpanned) {
                    const cellEndCol = c + (cellData.colSpan || 1);
                    if (cellEndCol > colIndex) {
                        cellData.colSpan = (cellData.colSpan || 1) + 1;
                    }
                }
            }
        }

        // КЛЮЧЕВОЕ ИЗМЕНЕНИЕ: перераспределяем ширину колонок
        this._redistributeColumnWidths(table);

        this.clearSelection();
        ItemsRenderer.renderAll();
        PreviewManager.update();
    }

    /**
     * Вставка новой колонки справа от текущей колонки выбранной ячейки.
     * Если текущая колонка - часть объединения, вставляет справа от всего объединения.
     * Верхняя ячейка новой колонки становится заголовком.
     */
    insertColumnRight() {
        if (this.tableManager.selectedCells.length === 0) return;

        const cell = this.tableManager.selectedCells[0];
        const tableId = cell.dataset.tableId;
        let colIndex = parseInt(cell.dataset.col);
        const table = AppState.tables[tableId];

        if (!table || !table.grid) return;

        // Находим конец объединения в текущей колонке (максимальный colSpan)
        let insertColIndex = colIndex + 1;
        for (let r = 0; r < table.grid.length; r++) {
            const cellData = table.grid[r][colIndex];
            if (cellData && !cellData.isSpanned && cellData.colSpan > 1) {
                const cellEndCol = colIndex + cellData.colSpan;
                insertColIndex = Math.max(insertColIndex, cellEndCol);
            }
        }

        // Также проверяем, не является ли текущая колонка частью объединения из левых колонок
        for (let r = 0; r < table.grid.length; r++) {
            for (let c = 0; c < colIndex; c++) {
                const cellData = table.grid[r][c];
                if (!cellData.isSpanned && cellData.colSpan > 1) {
                    const cellEndCol = c + cellData.colSpan;
                    if (cellEndCol > colIndex) {
                        insertColIndex = Math.max(insertColIndex, cellEndCol);
                    }
                }
            }
        }

        // Находим индекс строки заголовков
        let headerRowIndex = -1;
        for (let r = 0; r < table.grid.length; r++) {
            if (table.grid[r].some(c => c.isHeader === true)) {
                headerRowIndex = r;
                break;
            }
        }

        // Вставляем новую колонку во все строки
        for (let r = 0; r < table.grid.length; r++) {
            const isHeaderRow = r === headerRowIndex;
            table.grid[r].splice(insertColIndex, 0, {
                content: '',
                isHeader: isHeaderRow,
                colSpan: 1,
                rowSpan: 1,
                originRow: r,
                originCol: insertColIndex
            });
        }

        // Обновляем originCol для всех ячеек справа
        for (let r = 0; r < table.grid.length; r++) {
            for (let c = insertColIndex + 1; c < table.grid[r].length; c++) {
                if (table.grid[r][c].originCol !== undefined) {
                    table.grid[r][c].originCol = c;
                }
            }
        }

        // Обновляем colSpan для ячеек с объединением
        for (let r = 0; r < table.grid.length; r++) {
            for (let c = 0; c < insertColIndex; c++) {
                const cellData = table.grid[r][c];
                if (!cellData.isSpanned) {
                    const cellEndCol = c + (cellData.colSpan || 1);
                    if (cellEndCol > insertColIndex) {
                        cellData.colSpan = (cellData.colSpan || 1) + 1;
                    }
                }
            }
        }

        // КЛЮЧЕВОЕ ИЗМЕНЕНИЕ: перераспределяем ширину колонок
        this._redistributeColumnWidths(table);

        this.clearSelection();
        ItemsRenderer.renderAll();
        PreviewManager.update();
    }

    /**
     * Удаление строки, содержащей выбранную ячейку.
     * Запрещено удалять строку заголовков и строки с объединенными ячейками.
     */
    deleteRow() {
        if (this.tableManager.selectedCells.length === 0) return;

        const cell = this.tableManager.selectedCells[0];
        const tableId = cell.dataset.tableId;
        const rowIndex = parseInt(cell.dataset.row);
        const table = AppState.tables[tableId];

        if (!table || !table.grid) return;

        // Проверяем, является ли текущая строка строкой заголовков
        const isHeaderRow = table.grid[rowIndex].some(c => c.isHeader === true);
        if (isHeaderRow) {
            Notifications.error('Нельзя удалить строку заголовков');
            return;
        }

        // Проверяем наличие объединенных ячеек в строке
        const hasMergedCells = this._rowHasAnyMergedCells(table, rowIndex);
        if (hasMergedCells) {
            Notifications.error('Нельзя удалить строку с объединенными ячейками. Сначала разъедините их.');
            return;
        }

        // Проверяем, что в таблице остается хотя бы одна строка данных
        const headerRowCount = table.grid.filter(row => row.some(c => c.isHeader === true)).length;
        if (table.grid.length - headerRowCount <= 1) {
            Notifications.error('Таблица должна содержать хотя бы одну строку данных');
            return;
        }

        // Уменьшаем rowSpan для ячеек, которые охватывают удаляемую строку
        for (let r = 0; r < rowIndex; r++) {
            for (let c = 0; c < table.grid[r].length; c++) {
                const cellData = table.grid[r][c];
                if (!cellData.isSpanned) {
                    const cellEndRow = r + (cellData.rowSpan || 1);
                    if (cellEndRow > rowIndex) {
                        cellData.rowSpan = Math.max(1, (cellData.rowSpan || 1) - 1);
                    }
                }
            }
        }

        // Удаляем строку
        table.grid.splice(rowIndex, 1);

        // Обновляем originRow для всех ячеек ниже
        for (let r = rowIndex; r < table.grid.length; r++) {
            for (let c = 0; c < table.grid[r].length; c++) {
                if (table.grid[r][c].originRow !== undefined) {
                    table.grid[r][c].originRow = r;
                }
            }
        }

        this.clearSelection();
        ItemsRenderer.renderAll();
        PreviewManager.update();
    }

    /**
     * Удаление колонки, содержащей выбранную ячейку.
     * Запрещено удалять колонки с объединенными ячейками.
     */
    deleteColumn() {
        if (this.tableManager.selectedCells.length === 0) return;

        const cell = this.tableManager.selectedCells[0];
        const tableId = cell.dataset.tableId;
        const colIndex = parseInt(cell.dataset.col);
        const table = AppState.tables[tableId];

        if (!table || !table.grid) return;

        // Проверяем, что в таблице остается хотя бы одна колонка
        if (table.grid[0].length <= 1) {
            Notifications.error('Таблица должна содержать хотя бы одну колонку');
            return;
        }

        // Проверяем наличие объединенных ячеек в колонке
        const hasMergedCells = this._columnHasAnyMergedCells(table, colIndex);
        if (hasMergedCells) {
            Notifications.error('Нельзя удалить колонку с объединенными ячейками. Сначала разъедините их.');
            return;
        }

        // Уменьшаем colSpan для ячеек, которые охватывают удаляемую колонку
        for (let r = 0; r < table.grid.length; r++) {
            for (let c = 0; c < colIndex; c++) {
                const cellData = table.grid[r][c];
                if (!cellData.isSpanned) {
                    const cellEndCol = c + (cellData.colSpan || 1);
                    if (cellEndCol > colIndex) {
                        cellData.colSpan = Math.max(1, (cellData.colSpan || 1) - 1);
                    }
                }
            }
        }

        // Удаляем колонку из всех строк
        for (let r = 0; r < table.grid.length; r++) {
            table.grid[r].splice(colIndex, 1);
        }

        // Обновляем originCol для всех ячеек справа
        for (let r = 0; r < table.grid.length; r++) {
            for (let c = colIndex; c < table.grid[r].length; c++) {
                if (table.grid[r][c].originCol !== undefined) {
                    table.grid[r][c].originCol = c;
                }
            }
        }

        // КЛЮЧЕВОЕ ИЗМЕНЕНИЕ: перераспределяем ширину колонок
        this._redistributeColumnWidths(table);

        this.clearSelection();
        ItemsRenderer.renderAll();
        PreviewManager.update();
    }

    /**
     * Найти начало объединения по строкам (если текущая строка - часть rowSpan).
     * @param {Object} table - Таблица
     * @param {number} rowIndex - Текущий индекс строки
     * @returns {number} Индекс начала объединения
     */
    _findRowStartOfSpan(table, rowIndex) {
        // Проверяем, не является ли текущая строка частью объединения из предыдущих строк
        for (let r = 0; r < rowIndex; r++) {
            for (let c = 0; c < table.grid[r].length; c++) {
                const cellData = table.grid[r][c];
                if (!cellData.isSpanned && cellData.rowSpan > 1) {
                    const cellEndRow = r + cellData.rowSpan;
                    if (cellEndRow > rowIndex) {
                        // Текущая строка входит в диапазон этого объединения
                        return r;
                    }
                }
            }
        }
        return rowIndex;
    }

    /**
     * Найти начало объединения по колонкам (если текущая колонка - часть colSpan).
     * @param {Object} table - Таблица
     * @param {number} colIndex - Текущий индекс колонки
     * @returns {number} Индекс начала объединения
     */
    _findColumnStartOfSpan(table, colIndex) {
        // Проверяем, не является ли текущая колонка частью объединения из левых колонок
        for (let r = 0; r < table.grid.length; r++) {
            for (let c = 0; c < colIndex; c++) {
                const cellData = table.grid[r][c];
                if (!cellData.isSpanned && cellData.colSpan > 1) {
                    const cellEndCol = c + cellData.colSpan;
                    if (cellEndCol > colIndex) {
                        // Текущая колонка входит в диапазон этого объединения
                        return c;
                    }
                }
            }
        }
        return colIndex;
    }

    /**
     * Проверка наличие объединенных ячеек (любые span > 1) в строке.
     * @param {Object} table - Таблица
     * @param {number} rowIndex - Индекс строки
     * @returns {boolean} true если найдены объединенные ячейки
     */
    _rowHasAnyMergedCells(table, rowIndex) {
        for (let c = 0; c < table.grid[rowIndex].length; c++) {
            const cellData = table.grid[rowIndex][c];

            // Пропускаем spanned ячейки
            if (cellData.isSpanned) continue;

            // Проверяем наличие rowSpan > 1 или colSpan > 1
            if ((cellData.rowSpan || 1) > 1 || (cellData.colSpan || 1) > 1) {
                return true;
            }
        }
        return false;
    }

    /**
     * Проверка наличие объединенных ячеек (любые span > 1) в колонке.
     * @param {Object} table - Таблица
     * @param {number} colIndex - Индекс колонки
     * @returns {boolean} true если найдены объединенные ячейки
     */
    _columnHasAnyMergedCells(table, colIndex) {
        for (let r = 0; r < table.grid.length; r++) {
            const cellData = table.grid[r][colIndex];

            // Пропускаем spanned ячейки
            if (cellData.isSpanned) continue;

            // Проверяем наличие rowSpan > 1 или colSpan > 1
            if ((cellData.rowSpan || 1) > 1 || (cellData.colSpan || 1) > 1) {
                return true;
            }
        }
        return false;
    }

    /**
     * Вспомогательный метод для проверки возможности объединения ячеек.
     * Запрещает объединение заголовков с данными.
     * @param {Object} table - Таблица
     * @param {number} minRow - Минимальный индекс строки
     * @param {number} maxRow - Максимальный индекс строки
     * @param {number} minCol - Минимальный индекс колонки
     * @param {number} maxCol - Максимальный индекс колонки
     * @returns {boolean} true если объединение допустимо
     */
    _canMergeCellsAcrossTypes(table, minRow, maxRow, minCol, maxCol) {
        let hasHeader = false;
        let hasData = false;

        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                const cellData = table.grid[r][c];
                if (!cellData.isSpanned) {
                    if (cellData.isHeader) {
                        hasHeader = true;
                    } else {
                        hasData = true;
                    }
                }
            }
        }

        // Если есть и заголовки, и данные - запрещаем объединение
        return !(hasHeader && hasData);
    }

    /**
     * Пересчет ширины колонок при вставке/удалении.
     * УСТАРЕВШИЙ МЕТОД - теперь используется _redistributeColumnWidths
     * Оставлен для обратной совместимости.
     * @param {Object} table - Таблица, для которой пересчитываются размеры
     */
    _recalculateColumnWidths(table) {
        // Перенаправляем на новый метод
        this._redistributeColumnWidths(table);
    }

    /**
     * Добавление ячейки в список выбранных.
     * Синхронизирует с глобальным состоянием AppState.
     * @param {HTMLElement} cell - DOM-элемент ячейки
     */
    selectCell(cell) {
        cell.classList.add('selected');
        this.tableManager.selectedCells.push(cell);
        AppState.selectedCells = this.tableManager.selectedCells;
    }

    /**
     * Снятие выделения со всех ячеек.
     * Очищает визуальное выделение и список в AppState.
     */
    clearSelection() {
        this.tableManager.selectedCells.forEach(cell => cell.classList.remove('selected'));
        this.tableManager.selectedCells = [];
        AppState.selectedCells = [];
    }

    /**
     * Объединение выбранных ячеек в одну с colspan/rowspan.
     * Проверяет корректность прямоугольной области и отсутствие конфликтов с уже объединенными ячейками.
     * Запрещает объединение заголовков с данными.
     * Содержимое всех ячеек объединяется через пробел.
     */
    mergeCells() {
        if (this.tableManager.selectedCells.length < 2) return;

        // Сбор координат всех выбранных ячеек
        const coords = this.tableManager.selectedCells.map(cell => ({
            row: parseInt(cell.dataset.row),
            col: parseInt(cell.dataset.col),
            tableId: cell.dataset.tableId,
            cell: cell
        }));

        // Проверка: все ячейки из одной таблицы
        const tableId = coords[0].tableId;
        if (!coords.every(c => c.tableId === tableId)) {
            Notifications.error('Можно объединять только ячейки из одной таблицы');
            return;
        }

        const table = AppState.tables[tableId];
        if (!table) return;

        // Проверка: ни одна ячейка не должна быть частью другого объединения
        for (let coord of coords) {
            const cellData = table.grid[coord.row][coord.col];
            if (cellData.isSpanned) {
                Notifications.error('Нельзя объединять уже объединенные ячейки. Сначала разделите их.');
                return;
            }
            if (cellData.colSpan > 1 || cellData.rowSpan > 1) {
                Notifications.error('Нельзя объединять ячейки, если среди них есть уже объединенные.');
                return;
            }
        }

        // Определение границ прямоугольной области
        const minRow = Math.min(...coords.map(c => c.row));
        const maxRow = Math.max(...coords.map(c => c.row));
        const minCol = Math.min(...coords.map(c => c.col));
        const maxCol = Math.max(...coords.map(c => c.col));

        const rowspan = maxRow - minRow + 1;
        const colspan = maxCol - minCol + 1;

        // Проверка полноты прямоугольника
        const expectedCellsCount = rowspan * colspan;
        if (this.tableManager.selectedCells.length !== expectedCellsCount) {
            Notifications.error('Можно объединять только полную прямоугольную область ячеек');
            return;
        }

        const selectedSet = new Set(coords.map(c => `${c.row}-${c.col}`));
        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                if (!selectedSet.has(`${r}-${c}`)) {
                    Notifications.error('Можно объединять только полную прямоугольную область ячеек');
                    return;
                }
            }
        }

        // Проверка: нельзя объединять заголовок с данными
        if (!this._canMergeCellsAcrossTypes(table, minRow, maxRow, minCol, maxCol)) {
            Notifications.error('Нельзя объединять ячейки заголовка с ячейками данных');
            return;
        }

        // Объединение содержимого всех ячеек
        let mergedContent = [];
        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                const content = table.grid[r][c].content;
                if (content && content.trim()) {
                    mergedContent.push(content);
                }
            }
        }

        // Обновление главной ячейки (верхняя левая угловая)
        const originCell = table.grid[minRow][minCol];
        originCell.content = mergedContent.join(' ');
        originCell.colSpan = colspan;
        originCell.rowSpan = rowspan;

        // Пометка остальных ячеек как поглощенных (spanned)
        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                if (r !== minRow || c !== minCol) {
                    table.grid[r][c] = {
                        isSpanned: true,
                        spanOrigin: {row: minRow, col: minCol}
                    };
                }
            }
        }

        this.clearSelection();
        ItemsRenderer.renderAll();
        PreviewManager.update();

        // Показываем уведомление об успехе
        Notifications.success('Ячейки объединены');
    }

    /**
     * Разделение объединенной ячейки на отдельные ячейки.
     * Восстанавливает grid-структуру, создавая пустые ячейки на месте spanned.
     */
    unmergeCells() {
        if (this.tableManager.selectedCells.length !== 1) return;

        const cell = this.tableManager.selectedCells[0];
        const tableId = cell.dataset.tableId;
        const row = parseInt(cell.dataset.row);
        const col = parseInt(cell.dataset.col);

        const table = AppState.tables[tableId];
        if (!table) return;

        const cellData = table.grid[row][col];

        // Проверка наличия объединения
        if (cellData.colSpan <= 1 && cellData.rowSpan <= 1) {
            return;
        }

        const rowspan = cellData.rowSpan || 1;
        const colspan = cellData.colSpan || 1;

        // Восстановление всех ячеек в области объединения
        for (let r = row; r < row + rowspan; r++) {
            for (let c = col; c < col + colspan; c++) {
                if (table.grid[r] && table.grid[r][c]) {
                    if (r === row && c === col) {
                        // Главная ячейка - сброс colspan/rowspan
                        table.grid[r][c].colSpan = 1;
                        table.grid[r][c].rowSpan = 1;
                    } else {
                        // Создание новых пустых ячеек
                        table.grid[r][c] = {
                            content: '',
                            isHeader: false,
                            colSpan: 1,
                            rowSpan: 1,
                            originRow: r,
                            originCol: c
                        };
                    }
                }
            }
        }

        this.clearSelection();
        ItemsRenderer.renderAll();
        PreviewManager.update();

        // Показываем уведомление об успехе
        Notifications.success('Ячейка разъединена');
    }
}
