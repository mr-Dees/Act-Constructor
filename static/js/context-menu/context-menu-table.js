/**
 * Обработчик контекстного меню для ячеек таблицы
 */
class CellContextMenu {
    constructor(menu) {
        this.menu = menu;
        this.initHandlers();
    }

    initHandlers() {
        this.menu.querySelectorAll('.context-menu-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();

                const action = item.dataset.action;
                this.handleAction(action);
                ContextMenuManager.hide();
            });

            // Обработчик mouseenter для всех элементов
            item.addEventListener('mouseenter', (e) => {
                const action = item.dataset.action;
                this.showHint(action, item);
            });

            item.addEventListener('mouseleave', (e) => {
                this.hideTooltip();
                this.clearHighlights();
            });
        });
    }

    show(x, y, params = {}) {
        if (!this.menu) return;

        this.updateMenuState();
        ContextMenuManager.positionMenu(this.menu, x, y);
    }

    updateMenuState() {
        // Все пункты всегда активны - валидация перенесена в handleAction
        const selectedCount = tableManager.selectedCells.length;

        // Unmerge только если выбрана одна ячейка и она объединена
        const unmergeItem = this.menu.querySelector('[data-action="unmerge-cell"]');
        if (unmergeItem) {
            if (selectedCount === 1) {
                const cell = tableManager.selectedCells[0];
                const isMerged = cell.colSpan > 1 || cell.rowSpan > 1;
                unmergeItem.classList.toggle('disabled', !isMerged);
            } else {
                unmergeItem.classList.add('disabled');
            }
        }
    }

    /**
     * Показывает подсказку и подсветку (только информативные сообщения)
     */
    showHint(action, menuItem) {
        const selectedCount = tableManager.selectedCells.length;
        if (selectedCount === 0) return;

        const cell = tableManager.selectedCells[0];
        const tableId = cell.dataset.tableId;
        const rowIndex = parseInt(cell.dataset.row);
        const colIndex = parseInt(cell.dataset.col);
        const table = AppState.tables[tableId];

        let hint = '';
        let highlightType = null;

        switch (action) {
            case 'insert-row-above': {
                const actualRowIndex = this._findRowStartOfSpan(table, rowIndex);
                if (actualRowIndex !== rowIndex) {
                    hint = `Вставка будет выполнена выше объединенных ячеек (строка ${actualRowIndex + 1})`;
                }
                highlightType = 'insert-row-above';
                break;
            }

            case 'insert-row-below': {
                const actualRowIndex = this._findRowEndOfSpan(table, rowIndex);
                if (actualRowIndex !== rowIndex + 1) {
                    hint = `Вставка будет выполнена ниже объединенных ячеек (строка ${actualRowIndex + 1})`;
                }
                highlightType = 'insert-row-below';
                break;
            }

            case 'insert-col-left': {
                const actualColIndex = this._findColumnStartOfSpan(table, colIndex);
                if (actualColIndex !== colIndex) {
                    hint = `Вставка будет выполнена слева от объединенных ячеек (колонка ${actualColIndex + 1})`;
                }
                highlightType = 'insert-col-left';
                break;
            }

            case 'insert-col-right': {
                const actualColIndex = this._findColumnEndOfSpan(table, colIndex);
                if (actualColIndex !== colIndex + 1) {
                    hint = `Вставка будет выполнена справа от объединенных ячеек (колонка ${actualColIndex + 1})`;
                }
                highlightType = 'insert-col-right';
                break;
            }

            case 'delete-row':
                highlightType = 'delete-row';
                break;

            case 'delete-col':
                highlightType = 'delete-column';
                break;

            // Для остальных действий не показываем подсказку
        }

        if (hint) {
            this.showTooltip(hint, menuItem);
        }

        if (highlightType) {
            this.highlightOperation(table, rowIndex, colIndex, highlightType);
        }
    }

    /**
     * Показывает всплывающую подсказку рядом с пунктом меню
     */
    showTooltip(text, menuItem) {
        this.hideTooltip();

        const tooltip = document.createElement('div');
        tooltip.className = 'context-menu-tooltip';
        tooltip.textContent = text;
        tooltip.id = 'contextMenuTooltip';

        document.body.appendChild(tooltip);

        const itemRect = menuItem.getBoundingClientRect();
        tooltip.style.left = `${itemRect.right + 10}px`;
        tooltip.style.top = `${itemRect.top}px`;

        requestAnimationFrame(() => {
            const tooltipRect = tooltip.getBoundingClientRect();
            const viewportWidth = window.innerWidth;

            if (tooltipRect.right > viewportWidth) {
                tooltip.style.left = `${itemRect.left - tooltipRect.width - 10}px`;
            }
        });
    }

    /**
     * Скрывает подсказку
     */
    hideTooltip() {
        const tooltip = document.getElementById('contextMenuTooltip');
        if (tooltip) {
            tooltip.remove();
        }
    }

    /**
     * Универсальная подсветка для всех операций
     */
    highlightOperation(table, rowIndex, colIndex, type) {
        this.clearHighlights();

        if (!tableManager.selectedCells.length) return;

        const cell = tableManager.selectedCells[0];
        const tableElement = cell.closest('table');
        if (!tableElement) return;

        switch (type) {
            case 'insert-row-above': {
                const actualRowIndex = this._findRowStartOfSpan(table, rowIndex);
                this._highlightRowBorder(tableElement, table, actualRowIndex, 'top');
                break;
            }

            case 'insert-row-below': {
                const actualRowIndex = this._findRowEndOfSpan(table, rowIndex);
                // Подсвечиваем нижнюю границу предыдущей строки
                if (actualRowIndex > 0) {
                    this._highlightRowBorder(tableElement, table, actualRowIndex - 1, 'bottom');
                }
                break;
            }

            case 'insert-col-left': {
                const actualColIndex = this._findColumnStartOfSpan(table, colIndex);
                this._highlightColumnBorder(tableElement, table, actualColIndex, 'left');
                break;
            }

            case 'insert-col-right': {
                const actualColIndex = this._findColumnEndOfSpan(table, colIndex);
                // Подсвечиваем правую границу предыдущей колонки
                if (actualColIndex > 0) {
                    this._highlightColumnBorder(tableElement, table, actualColIndex - 1, 'right');
                }
                break;
            }

            case 'delete-row': {
                this._highlightRowBorder(tableElement, table, rowIndex, 'top');
                this._highlightRowBorder(tableElement, table, rowIndex, 'bottom');
                const rows = tableElement.querySelectorAll('tr');
                rows[rowIndex]?.querySelectorAll('td, th').forEach(c =>
                    c.classList.add('highlight-warning')
                );
                break;
            }

            case 'delete-column': {
                this._highlightColumnBorder(tableElement, table, colIndex, 'left');
                this._highlightColumnBorder(tableElement, table, colIndex, 'right');
                const rows = tableElement.querySelectorAll('tr');
                rows.forEach(row => {
                    row.querySelectorAll('td, th').forEach(c => {
                        if (parseInt(c.dataset.col) === colIndex) {
                            c.classList.add('highlight-warning');
                        }
                    });
                });
                break;
            }
        }
    }

    /**
     * Подсвечивает горизонтальную границу строки (верхнюю или нижнюю)
     * Учитывает colspan ячеек для непрерывной линии
     */
    _highlightRowBorder(tableElement, table, rowIndex, side) {
        const rows = tableElement.querySelectorAll('tr');
        const row = rows[rowIndex];
        if (!row) return;

        const numCols = table.grid[0].length;
        const borderClass = side === 'top' ? 'highlight-border-top' : 'highlight-border-bottom';

        // Создаем карту покрытия колонок для этой строки
        const colCoverage = new Array(numCols).fill(null);

        // Заполняем карту: какая DOM-ячейка покрывает какую логическую колонку
        const domCells = row.querySelectorAll('td, th');
        domCells.forEach(domCell => {
            const startCol = parseInt(domCell.dataset.col);
            const colspan = domCell.colSpan || 1;

            for (let c = startCol; c < startCol + colspan && c < numCols; c++) {
                colCoverage[c] = domCell;
            }
        });

        // Подсвечиваем все уникальные DOM-ячейки
        const highlightedCells = new Set();
        colCoverage.forEach(domCell => {
            if (domCell && !highlightedCells.has(domCell)) {
                domCell.classList.add(borderClass);
                highlightedCells.add(domCell);
            }
        });
    }

    /**
     * Подсвечивает вертикальную границу колонки (левую или правую)
     * Учитывает rowspan ячеек для непрерывной линии
     */
    _highlightColumnBorder(tableElement, table, colIndex, side) {
        const rows = tableElement.querySelectorAll('tr');
        const borderClass = side === 'left' ? 'highlight-border-left' : 'highlight-border-right';

        // Для каждой строки находим DOM-ячейку, которая покрывает нужную колонку
        rows.forEach((row, rowIndex) => {
            if (rowIndex >= table.grid.length) return;

            const cells = row.querySelectorAll('td, th');

            // Ищем ячейку, которая покрывает целевую колонку
            cells.forEach(domCell => {
                const startCol = parseInt(domCell.dataset.col);
                const colspan = domCell.colSpan || 1;
                const endCol = startCol + colspan - 1;

                // Проверяем, покрывает ли эта ячейка целевую колонку
                if (startCol <= colIndex && colIndex <= endCol) {
                    domCell.classList.add(borderClass);
                }
            });
        });
    }

    /**
     * Убирает подсветку
     */
    clearHighlights() {
        const classes = [
            'highlight-error',
            'highlight-insert',
            'highlight-warning',
            'highlight-border-top',
            'highlight-border-bottom',
            'highlight-border-left',
            'highlight-border-right'
        ];

        document.querySelectorAll(classes.map(c => '.' + c).join(',')).forEach(el => {
            classes.forEach(className => el.classList.remove(className));
        });
    }

    /**
     * Вспомогательные методы для определения позиций вставки
     */
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

    _findRowEndOfSpan(table, rowIndex) {
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
        return insertRowIndex;
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

    _findColumnEndOfSpan(table, colIndex) {
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
        return insertColIndex;
    }

    _rowHasAnyMergedCellsStrict(table, rowIndex) {
        for (let c = 0; c < table.grid[rowIndex].length; c++) {
            const cellData = table.grid[rowIndex][c];
            if (cellData.isSpanned) return true;
            if ((cellData.rowSpan || 1) > 1 || (cellData.colSpan || 1) > 1) return true;
        }

        for (let r = 0; r < rowIndex; r++) {
            for (let c = 0; c < table.grid[r].length; c++) {
                const cellData = table.grid[r][c];
                if (!cellData.isSpanned && cellData.rowSpan > 1) {
                    const cellEndRow = r + cellData.rowSpan;
                    if (cellEndRow > rowIndex) return true;
                }
            }
        }

        return false;
    }

    _columnHasAnyMergedCellsStrict(table, colIndex) {
        for (let r = 0; r < table.grid.length; r++) {
            const cellData = table.grid[r][colIndex];
            if (cellData.isSpanned) return true;
            if ((cellData.rowSpan || 1) > 1 || (cellData.colSpan || 1) > 1) return true;
        }

        for (let r = 0; r < table.grid.length; r++) {
            for (let c = 0; c < colIndex; c++) {
                const cellData = table.grid[r][c];
                if (!cellData.isSpanned && cellData.colSpan > 1) {
                    const cellEndCol = c + cellData.colSpan;
                    if (cellEndCol > colIndex) return true;
                }
            }
        }

        return false;
    }

    _canMergeCells() {
        const selectedCount = tableManager.selectedCells.length;
        if (selectedCount < 2) return false;

        const coords = tableManager.selectedCells.map(cell => ({
            row: parseInt(cell.dataset.row),
            col: parseInt(cell.dataset.col),
            tableId: cell.dataset.tableId
        }));

        const tableId = coords[0].tableId;
        if (!coords.every(c => c.tableId === tableId)) return false;

        const table = AppState.tables[tableId];
        if (!table) return false;

        const minRow = Math.min(...coords.map(c => c.row));
        const maxRow = Math.max(...coords.map(c => c.row));
        const minCol = Math.min(...coords.map(c => c.col));
        const maxCol = Math.max(...coords.map(c => c.col));

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

    handleAction(action) {
        const selectedCount = tableManager.selectedCells.length;

        // Валидация перед выполнением действия
        if (selectedCount === 0) {
            Notifications.error('Выберите ячейку');
            return;
        }

        const cell = tableManager.selectedCells[0];
        const tableId = cell.dataset.tableId;
        const rowIndex = parseInt(cell.dataset.row);
        const colIndex = parseInt(cell.dataset.col);
        const table = AppState.tables[tableId];

        switch (action) {
            case 'merge-cells':
                if (selectedCount < 2) {
                    Notifications.error('Выберите минимум 2 ячейки для объединения');
                    return;
                }
                if (!this._canMergeCells()) {
                    Notifications.error('Нельзя объединять ячейки заголовка с ячейками данных');
                    return;
                }
                break;

            case 'unmerge-cell':
                if (selectedCount !== 1) {
                    Notifications.error('Выберите одну ячейку для разъединения');
                    return;
                }
                const isMerged = cell.colSpan > 1 || cell.rowSpan > 1;
                if (!isMerged) {
                    Notifications.info('Ячейка не объединена');
                    return;
                }
                break;

            case 'insert-row-above':
                if (selectedCount !== 1) {
                    Notifications.error('Выберите одну ячейку');
                    return;
                }
                const isHeaderRow = table.grid[rowIndex].some(c => c.isHeader === true);
                if (isHeaderRow) {
                    Notifications.error('Нельзя вставить строку выше заголовка таблицы');
                    return;
                }
                break;

            case 'insert-row-below':
            case 'insert-col-left':
            case 'insert-col-right':
                if (selectedCount !== 1) {
                    Notifications.error('Выберите одну ячейку');
                    return;
                }
                break;

            case 'delete-row':
                if (selectedCount !== 1) {
                    Notifications.error('Выберите одну ячейку');
                    return;
                }
                const isHeader = table.grid[rowIndex].some(c => c.isHeader === true);
                if (isHeader) {
                    Notifications.error('Нельзя удалить строку заголовков');
                    return;
                }
                const rowHasMerged = this._rowHasAnyMergedCellsStrict(table, rowIndex);
                if (rowHasMerged) {
                    Notifications.error('Строка содержит объединенные ячейки. Сначала разъедините их.');
                    return;
                }
                break;

            case 'delete-col':
                if (selectedCount !== 1) {
                    Notifications.error('Выберите одну ячейку');
                    return;
                }
                const colHasMerged = this._columnHasAnyMergedCellsStrict(table, colIndex);
                if (colHasMerged) {
                    Notifications.error('Колонка содержит объединенные ячейки. Сначала разъедините их.');
                    return;
                }
                break;
        }

        // Выполняем действие
        const tableSizes = this.saveTableSizes();

        switch (action) {
            case 'merge-cells':
                tableManager.mergeCells();
                this.restoreTableSizes(tableSizes);
                // Уведомление НЕ показываем - оно выводится внутри mergeCells()
                break;
            case 'unmerge-cell':
                tableManager.unmergeCells();
                this.restoreTableSizes(tableSizes);
                // Уведомление НЕ показываем - оно выводится внутри unmergeCells()
                break;
            case 'insert-row-above':
                tableManager.cellsOps.insertRowAbove();
                this.restoreTableSizes({});
                Notifications.success('Строка добавлена');
                break;
            case 'insert-row-below':
                tableManager.cellsOps.insertRowBelow();
                this.restoreTableSizes({});
                Notifications.success('Строка добавлена');
                break;
            case 'insert-col-left':
                tableManager.cellsOps.insertColumnLeft();
                this.restoreTableSizes({});
                Notifications.success('Колонка добавлена');
                break;
            case 'insert-col-right':
                tableManager.cellsOps.insertColumnRight();
                this.restoreTableSizes({});
                Notifications.success('Колонка добавлена');
                break;
            case 'delete-row':
                tableManager.cellsOps.deleteRow();
                this.restoreTableSizes({});
                Notifications.success('Строка удалена');
                break;
            case 'delete-col':
                tableManager.cellsOps.deleteColumn();
                this.restoreTableSizes({});
                Notifications.success('Колонка удалена');
                break;
        }
    }

    saveTableSizes() {
        if (tableManager.selectedCells.length === 0) return {};
        const table = tableManager.selectedCells[0].closest('table');
        return tableManager.preserveTableSizes(table);
    }

    restoreTableSizes(tableSizes) {
        if (AppState.currentStep === 2) {
            ItemsRenderer.renderAll();
            setTimeout(() => {
                document.querySelectorAll('.editable-table').forEach(tbl => {
                    tableManager.applyTableSizes(tbl, tableSizes);
                    const section = tbl.closest('.table-section');
                    if (section) {
                        tableManager.persistTableSizes(section.dataset.tableId, tbl);
                    }
                });
            }, 50);
        } else {
            tableManager.renderAll();
            PreviewManager.update('previewTrim', 30);
        }
    }
}
