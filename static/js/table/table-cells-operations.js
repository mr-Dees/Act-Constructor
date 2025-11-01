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
            alert('Можно объединять только ячейки из одной таблицы');
            return;
        }

        const table = AppState.tables[tableId];
        if (!table) return;

        // Проверка: ни одна ячейка не должна быть частью другого объединения
        for (let coord of coords) {
            const cellData = table.grid[coord.row][coord.col];
            if (cellData.isSpanned) {
                alert('Нельзя объединять уже объединенные ячейки. Сначала разделите их.');
                return;
            }
            if (cellData.colSpan > 1 || cellData.rowSpan > 1) {
                alert('Нельзя объединять ячейки, если среди них есть уже объединенные.');
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
            alert('Можно объединять только полную прямоугольную область ячеек');
            return;
        }

        const selectedSet = new Set(coords.map(c => `${c.row}-${c.col}`));
        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                if (!selectedSet.has(`${r}-${c}`)) {
                    alert('Можно объединять только полную прямоугольную область ячеек');
                    return;
                }
            }
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
    }
}
