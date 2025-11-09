/**
 * Операции с ячейками таблиц.
 * Обрабатывает редактирование содержимого, выделение и объединение/разделение ячеек.
 * Работает с матричной grid-структурой таблиц в AppState.
 */
class TableCellsOperations {
    constructor(tableManager) {
        this.tableManager = tableManager;
    }

    startEditingCell(cellEl) {
        const originalContent = cellEl.textContent;
        cellEl.classList.add('editing');

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

        const blurHandler = () => {
            finishEditing(false);
        };

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

    insertRowAbove() {
        if (this.tableManager.selectedCells.length === 0) return;

        const cell = this.tableManager.selectedCells[0];
        const tableId = cell.dataset.tableId;
        let rowIndex = parseInt(cell.dataset.row);
        const table = AppState.tables[tableId];

        if (!table || !table.grid) return;

        const isHeaderRow = table.grid[rowIndex].some(c => c.isHeader === true);
        if (isHeaderRow) {
            Notifications.error('Нельзя добавить строку выше заголовка таблицы');
            return;
        }

        rowIndex = this._findRowStartOfSpan(table, rowIndex);

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

        table.grid.splice(rowIndex, 0, newRow);

        for (let r = rowIndex + 1; r < table.grid.length; r++) {
            for (let c = 0; c < table.grid[r].length; c++) {
                if (table.grid[r][c].originRow !== undefined) {
                    table.grid[r][c].originRow = r;
                }
            }
        }

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

    insertRowBelow() {
        if (this.tableManager.selectedCells.length === 0) return;

        const cell = this.tableManager.selectedCells[0];
        const tableId = cell.dataset.tableId;
        let rowIndex = parseInt(cell.dataset.row);
        const table = AppState.tables[tableId];

        if (!table || !table.grid) return;

        let insertRowIndex = rowIndex + 1;
        for (let c = 0; c < table.grid[rowIndex].length; c++) {
            const cellData = table.grid[rowIndex][c];
            if (!cellData.isSpanned && cellData.rowSpan > 1) {
                const cellEndRow = rowIndex + cellData.rowSpan;
                insertRowIndex = Math.max(insertRowIndex, cellEndRow);
            }
        }

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

        table.grid.splice(insertRowIndex, 0, newRow);

        for (let r = insertRowIndex + 1; r < table.grid.length; r++) {
            for (let c = 0; c < table.grid[r].length; c++) {
                if (table.grid[r][c].originRow !== undefined) {
                    table.grid[r][c].originRow = r;
                }
            }
        }

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
     * ИСПРАВЛЕННЫЙ МЕТОД: Полностью пересоздает размеры при изменении структуры колонок
     */
    _redistributeColumnWidths(table) {
        if (!table || !table.grid || !table.grid[0]) return;

        const numCols = table.grid[0].length;
        const equalWidthPercent = 100 / numCols;

        if (table.colWidths) {
            table.colWidths = new Array(numCols).fill(equalWidthPercent);
        }

        if (!AppState.tableUISizes) {
            AppState.tableUISizes = {};
        }

        // КРИТИЧЕСКИ ВАЖНО: удаляем старые размеры полностью
        delete AppState.tableUISizes[table.id];

        const sizes = {};

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

    insertColumnLeft() {
        if (this.tableManager.selectedCells.length === 0) return;

        const cell = this.tableManager.selectedCells[0];
        const tableId = cell.dataset.tableId;
        let colIndex = parseInt(cell.dataset.col);
        const table = AppState.tables[tableId];

        if (!table || !table.grid) return;

        colIndex = this._findColumnStartOfSpan(table, colIndex);

        let headerRowIndex = -1;
        for (let r = 0; r < table.grid.length; r++) {
            if (table.grid[r].some(c => c.isHeader === true)) {
                headerRowIndex = r;
                break;
            }
        }

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

        for (let r = 0; r < table.grid.length; r++) {
            for (let c = colIndex + 1; c < table.grid[r].length; c++) {
                if (table.grid[r][c].originCol !== undefined) {
                    table.grid[r][c].originCol = c;
                }
            }
        }

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

        this._redistributeColumnWidths(table);
        this.clearSelection();
        ItemsRenderer.renderAll();
        PreviewManager.update();
    }

    insertColumnRight() {
        if (this.tableManager.selectedCells.length === 0) return;

        const cell = this.tableManager.selectedCells[0];
        const tableId = cell.dataset.tableId;
        let colIndex = parseInt(cell.dataset.col);
        const table = AppState.tables[tableId];

        if (!table || !table.grid) return;

        let insertColIndex = colIndex + 1;
        for (let r = 0; r < table.grid.length; r++) {
            const cellData = table.grid[r][colIndex];
            if (cellData && !cellData.isSpanned && cellData.colSpan > 1) {
                const cellEndCol = colIndex + cellData.colSpan;
                insertColIndex = Math.max(insertColIndex, cellEndCol);
            }
        }

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

        let headerRowIndex = -1;
        for (let r = 0; r < table.grid.length; r++) {
            if (table.grid[r].some(c => c.isHeader === true)) {
                headerRowIndex = r;
                break;
            }
        }

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

        for (let r = 0; r < table.grid.length; r++) {
            for (let c = insertColIndex + 1; c < table.grid[r].length; c++) {
                if (table.grid[r][c].originCol !== undefined) {
                    table.grid[r][c].originCol = c;
                }
            }
        }

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

        this._redistributeColumnWidths(table);
        this.clearSelection();
        ItemsRenderer.renderAll();
        PreviewManager.update();
    }

    deleteRow() {
        if (this.tableManager.selectedCells.length === 0) return;

        const cell = this.tableManager.selectedCells[0];
        const tableId = cell.dataset.tableId;
        const rowIndex = parseInt(cell.dataset.row);
        const table = AppState.tables[tableId];

        if (!table || !table.grid) return;

        const isHeaderRow = table.grid[rowIndex].some(c => c.isHeader === true);
        if (isHeaderRow) {
            Notifications.error('Нельзя удалить строку заголовков');
            return;
        }

        const hasMergedCells = this._rowHasAnyMergedCells(table, rowIndex);
        if (hasMergedCells) {
            Notifications.error('Нельзя удалить строку с объединенными ячейками. Сначала разъедините их.');
            return;
        }

        const headerRowCount = table.grid.filter(row => row.some(c => c.isHeader === true)).length;
        if (table.grid.length - headerRowCount <= 1) {
            Notifications.error('Таблица должна содержать хотя бы одну строку данных');
            return;
        }

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

        table.grid.splice(rowIndex, 1);

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

    deleteColumn() {
        if (this.tableManager.selectedCells.length === 0) return;

        const cell = this.tableManager.selectedCells[0];
        const tableId = cell.dataset.tableId;
        const colIndex = parseInt(cell.dataset.col);
        const table = AppState.tables[tableId];

        if (!table || !table.grid) return;

        if (table.grid[0].length <= 1) {
            Notifications.error('Таблица должна содержать хотя бы одну колонку');
            return;
        }

        const hasMergedCells = this._columnHasAnyMergedCells(table, colIndex);
        if (hasMergedCells) {
            Notifications.error('Нельзя удалить колонку с объединенными ячейками. Сначала разъедините их.');
            return;
        }

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

        for (let r = 0; r < table.grid.length; r++) {
            table.grid[r].splice(colIndex, 1);
        }

        for (let r = 0; r < table.grid.length; r++) {
            for (let c = colIndex; c < table.grid[r].length; c++) {
                if (table.grid[r][c].originCol !== undefined) {
                    table.grid[r][c].originCol = c;
                }
            }
        }

        this._redistributeColumnWidths(table);
        this.clearSelection();
        ItemsRenderer.renderAll();
        PreviewManager.update();
    }

    _findRowStartOfSpan(table, rowIndex) {
        for (let r = 0; r < rowIndex; r++) {
            for (let c = 0; c < table.grid[r].length; c++) {
                const cellData = table.grid[r][c];
                if (!cellData.isSpanned && cellData.rowSpan > 1) {
                    const cellEndRow = r + cellData.rowSpan;
                    if (cellEndRow > rowIndex) {
                        return r;
                    }
                }
            }
        }
        return rowIndex;
    }

    _findColumnStartOfSpan(table, colIndex) {
        for (let r = 0; r < table.grid.length; r++) {
            for (let c = 0; c < colIndex; c++) {
                const cellData = table.grid[r][c];
                if (!cellData.isSpanned && cellData.colSpan > 1) {
                    const cellEndCol = c + cellData.colSpan;
                    if (cellEndCol > colIndex) {
                        return c;
                    }
                }
            }
        }
        return colIndex;
    }

    _rowHasAnyMergedCells(table, rowIndex) {
        for (let c = 0; c < table.grid[rowIndex].length; c++) {
            const cellData = table.grid[rowIndex][c];
            if (cellData.isSpanned) continue;
            if ((cellData.rowSpan || 1) > 1 || (cellData.colSpan || 1) > 1) {
                return true;
            }
        }
        return false;
    }

    _columnHasAnyMergedCells(table, colIndex) {
        for (let r = 0; r < table.grid.length; r++) {
            const cellData = table.grid[r][colIndex];
            if (cellData.isSpanned) continue;
            if ((cellData.rowSpan || 1) > 1 || (cellData.colSpan || 1) > 1) {
                return true;
            }
        }
        return false;
    }

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

        return !(hasHeader && hasData);
    }

    _recalculateColumnWidths(table) {
        this._redistributeColumnWidths(table);
    }

    selectCell(cell) {
        cell.classList.add('selected');
        this.tableManager.selectedCells.push(cell);
        AppState.selectedCells = this.tableManager.selectedCells;
    }

    clearSelection() {
        this.tableManager.selectedCells.forEach(cell => cell.classList.remove('selected'));
        this.tableManager.selectedCells = [];
        AppState.selectedCells = [];
    }

    mergeCells() {
        if (this.tableManager.selectedCells.length < 2) return;

        const coords = this.tableManager.selectedCells.map(cell => ({
            row: parseInt(cell.dataset.row),
            col: parseInt(cell.dataset.col),
            tableId: cell.dataset.tableId,
            cell: cell
        }));

        const tableId = coords[0].tableId;
        if (!coords.every(c => c.tableId === tableId)) {
            Notifications.error('Можно объединять только ячейки из одной таблицы');
            return;
        }

        const table = AppState.tables[tableId];
        if (!table) return;

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

        const minRow = Math.min(...coords.map(c => c.row));
        const maxRow = Math.max(...coords.map(c => c.row));
        const minCol = Math.min(...coords.map(c => c.col));
        const maxCol = Math.max(...coords.map(c => c.col));

        const rowspan = maxRow - minRow + 1;
        const colspan = maxCol - minCol + 1;

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

        if (!this._canMergeCellsAcrossTypes(table, minRow, maxRow, minCol, maxCol)) {
            Notifications.error('Нельзя объединять ячейки заголовка с ячейками данных');
            return;
        }

        let mergedContent = [];
        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                const content = table.grid[r][c].content;
                if (content && content.trim()) {
                    mergedContent.push(content);
                }
            }
        }

        const originCell = table.grid[minRow][minCol];
        originCell.content = mergedContent.join(' ');
        originCell.colSpan = colspan;
        originCell.rowSpan = rowspan;

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
        Notifications.success('Ячейки объединены');
    }

    unmergeCells() {
        if (this.tableManager.selectedCells.length !== 1) return;

        const cell = this.tableManager.selectedCells[0];
        const tableId = cell.dataset.tableId;
        const row = parseInt(cell.dataset.row);
        const col = parseInt(cell.dataset.col);

        const table = AppState.tables[tableId];
        if (!table) return;

        const cellData = table.grid[row][col];

        if (cellData.colSpan <= 1 && cellData.rowSpan <= 1) {
            return;
        }

        const rowspan = cellData.rowSpan || 1;
        const colspan = cellData.colSpan || 1;

        for (let r = row; r < row + rowspan; r++) {
            for (let c = col; c < col + colspan; c++) {
                if (table.grid[r] && table.grid[r][c]) {
                    if (r === row && c === col) {
                        table.grid[r][c].colSpan = 1;
                        table.grid[r][c].rowSpan = 1;
                    } else {
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
        Notifications.success('Ячейка разъединена');
    }
}
