// Управление таблицами

class TableManager {
    constructor(containerId) {
        this.container = document.getElementById(containerId);
        this.selectedCells = [];
        this.isResizing = false;
    }

    renderAll() {
        this.container.innerHTML = '';
        Object.values(AppState.tables).forEach(table => {
            const section = this.createTableSection(table);
            this.container.appendChild(section);
        });
        this.attachEventListeners();
    }

    createTableSection(table) {
        const section = document.createElement('div');
        section.className = 'table-section';
        section.dataset.tableId = table.id;

        const node = AppState.findNodeById(table.nodeId);
        const title = document.createElement('h3');
        title.textContent = node ? node.label : 'Таблица';
        section.appendChild(title);

        const tableEl = this.createTableElement(table);
        section.appendChild(tableEl);

        return section;
    }

    createTableElement(table) {
        const tableEl = document.createElement('table');
        tableEl.className = 'editable-table';

        table.rows.forEach((row, rowIndex) => {
            const tr = document.createElement('tr');
            row.cells.forEach((cell, colIndex) => {
                if (cell.merged) return; // Пропустить объединенные

                const cellEl = document.createElement(cell.isHeader ? 'th' : 'td');
                cellEl.textContent = cell.content;

                if (cell.colspan > 1) {
                    cellEl.colSpan = cell.colspan;
                    cellEl.style.width = 'auto'; // Позволить ячейке растягиваться
                }
                if (cell.rowspan > 1) {
                    cellEl.rowSpan = cell.rowspan;
                    cellEl.style.height = 'auto'; // Позволить ячейке растягиваться по высоте
                }

                cellEl.dataset.row = rowIndex;
                cellEl.dataset.col = colIndex;
                cellEl.dataset.tableId = table.id;

                // Добавить ручки изменения размера
                if (cell.isHeader) {
                    const resizeHandle = document.createElement('div');
                    resizeHandle.className = 'resize-handle';
                    cellEl.appendChild(resizeHandle);

                    const rowResizeHandle = document.createElement('div');
                    rowResizeHandle.className = 'row-resize-handle';
                    cellEl.appendChild(rowResizeHandle);
                }

                tr.appendChild(cellEl);
            });
            tableEl.appendChild(tr);
        });

        return tableEl;
    }

    attachEventListeners() {
        // Выбор ячеек
        this.container.querySelectorAll('td, th').forEach(cell => {
            cell.addEventListener('click', (e) => {
                if (e.target.classList.contains('resize-handle') ||
                    e.target.classList.contains('row-resize-handle')) return;

                if (!e.ctrlKey) {  // Изменено с e.shiftKey на e.ctrlKey
                    this.clearSelection();
                }
                this.selectCell(cell);
            });

            // Двойной клик для редактирования
            cell.addEventListener('dblclick', (e) => {
                if (e.target.tagName !== 'TH' && e.target.tagName !== 'TD') return;
                this.startEditing(cell);
            });

            // Правый клик для контекстного меню
            cell.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (this.selectedCells.length === 0) {
                    this.selectCell(cell);
                }
                ContextMenuManager.show(e.clientX, e.clientY, null, 'cell');
            });
        });

        // Изменение размера колонок
        this.container.querySelectorAll('.resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.startColumnResize(e);
            });
        });

        // Изменение размера строк
        this.container.querySelectorAll('.row-resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.startRowResize(e);
            });
        });
    }

    selectCell(cell) {
        cell.classList.add('selected');
        this.selectedCells.push(cell);
        AppState.selectedCells = this.selectedCells;
    }

    clearSelection() {
        this.selectedCells.forEach(cell => cell.classList.remove('selected'));
        this.selectedCells = [];
        AppState.selectedCells = [];
    }

    startEditing(cell) {
        const originalContent = cell.textContent;
        cell.classList.add('editing');

        const input = document.createElement('input');
        input.type = 'text';
        input.value = originalContent;
        cell.textContent = '';
        cell.appendChild(input);
        input.focus();

        const finishEditing = () => {
            const newValue = input.value.trim();
            cell.textContent = newValue;
            cell.classList.remove('editing');

            // Обновить в состоянии
            const tableId = cell.dataset.tableId;
            const row = parseInt(cell.dataset.row);
            const col = parseInt(cell.dataset.col);
            const table = AppState.tables[tableId];

            if (table && table.rows[row] && table.rows[row].cells[col]) {
                table.rows[row].cells[col].content = newValue;
            }
        };

        input.addEventListener('blur', finishEditing, { once: true });

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            }
            if (e.key === 'Escape') {
                cell.textContent = originalContent;
                cell.classList.remove('editing');
            }
        }, { once: true });
    }

    startColumnResize(e) {
        const th = e.target.parentElement;
        const startX = e.clientX;
        const startWidth = th.offsetWidth;

        const onMouseMove = (e) => {
            const diff = e.clientX - startX;
            th.style.width = (startWidth + diff) + 'px';
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    startRowResize(e) {
        const cell = e.target.parentElement;
        const startY = e.clientY;
        const startHeight = cell.offsetHeight;

        const onMouseMove = (e) => {
            const diff = e.clientY - startY;
            cell.style.height = (startHeight + diff) + 'px';
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    mergeCells() {
        if (this.selectedCells.length < 2) return;

        // Получить координаты выбранных ячеек
        const coords = this.selectedCells.map(cell => ({
            row: parseInt(cell.dataset.row),
            col: parseInt(cell.dataset.col),
            tableId: cell.dataset.tableId,
            cell: cell
        }));

        // Все ячейки должны быть из одной таблицы
        const tableId = coords[0].tableId;
        if (!coords.every(c => c.tableId === tableId)) {
            alert('Можно объединять только ячейки из одной таблицы');
            return;
        }

        const table = AppState.tables[tableId];
        if (!table) return;

        // Проверка: ни одна из выбранных ячеек не должна быть уже объединенной
        for (let coord of coords) {
            const cellData = table.rows[coord.row].cells[coord.col];
            if (cellData.colspan > 1 || cellData.rowspan > 1) {
                alert('Нельзя объединять ячейки, если среди них есть уже объединенные. Сначала разделите объединенные ячейки.');
                return;
            }
        }

        // Найти минимальные и максимальные координаты
        const minRow = Math.min(...coords.map(c => c.row));
        const maxRow = Math.max(...coords.map(c => c.row));
        const minCol = Math.min(...coords.map(c => c.col));
        const maxCol = Math.max(...coords.map(c => c.col));

        const rowspan = maxRow - minRow + 1;
        const colspan = maxCol - minCol + 1;

        // Проверка: должны быть выбраны ВСЕ ячейки прямоугольной области
        const expectedCellsCount = rowspan * colspan;
        if (this.selectedCells.length !== expectedCellsCount) {
            alert('Можно объединять только полную прямоугольную или квадратную область ячеек');
            return;
        }

        // Проверка: все ячейки в прямоугольнике должны быть выбраны
        const selectedSet = new Set(coords.map(c => `${c.row}-${c.col}`));
        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                if (!selectedSet.has(`${r}-${c}`)) {
                    alert('Можно объединять только полную прямоугольную или квадратную область ячеек');
                    return;
                }
            }
        }

        // Дополнительная проверка: убедиться, что в выделенной области нет merged ячеек
        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                if (table.rows[r].cells[c].merged) {
                    alert('В выделенной области содержатся объединенные ячейки. Сначала разделите их.');
                    return;
                }
            }
        }

        // Установить colspan и rowspan для первой ячейки
        const firstCell = table.rows[minRow].cells[minCol];
        firstCell.colspan = colspan;
        firstCell.rowspan = rowspan;

        // Объединить содержимое всех ячеек
        let mergedContent = [];
        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                const cellContent = table.rows[r].cells[c].content;
                if (cellContent && cellContent.trim()) {
                    mergedContent.push(cellContent);
                }
            }
        }
        firstCell.content = mergedContent.join(' ');

        // Пометить остальные ячейки как объединенные
        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                if (r !== minRow || c !== minCol) {
                    table.rows[r].cells[c].merged = true;
                }
            }
        }

        this.clearSelection();
    }

    unmergeCells() {
        if (this.selectedCells.length !== 1) return;

        const cell = this.selectedCells[0];
        const tableId = cell.dataset.tableId;
        const row = parseInt(cell.dataset.row);
        const col = parseInt(cell.dataset.col);

        const table = AppState.tables[tableId];
        if (!table) return;

        const cellData = table.rows[row].cells[col];

        // Проверить, что ячейка действительно объединена
        if (cellData.colspan <= 1 && cellData.rowspan <= 1) {
            return;
        }

        const rowspan = cellData.rowspan || 1;
        const colspan = cellData.colspan || 1;

        // Восстановить все ячейки
        for (let r = row; r < row + rowspan; r++) {
            for (let c = col; c < col + colspan; c++) {
                if (table.rows[r] && table.rows[r].cells[c]) {
                    table.rows[r].cells[c].merged = false;
                    table.rows[r].cells[c].colspan = 1;
                    table.rows[r].cells[c].rowspan = 1;
                    // Очистить содержимое всех кроме первой
                    if (r !== row || c !== col) {
                        table.rows[r].cells[c].content = '';
                    }
                }
            }
        }

        this.clearSelection();
    }
}

const tableManager = new TableManager('tablesContainer');
