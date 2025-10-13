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

        // Враппер для скролла — предотвращает выход таблицы за пределы секции
        const scroll = document.createElement('div');
        scroll.className = 'table-scroll';

        const tableEl = this.createTableElement(table);
        scroll.appendChild(tableEl);
        section.appendChild(scroll);

        return section;
    }

    createTableElement(table) {
        const tableEl = document.createElement('table');
        tableEl.className = 'editable-table';

        // Определить максимальное количество колонок
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

        table.rows.forEach((row, rowIndex) => {
            const tr = document.createElement('tr');
            row.cells.forEach((cell, colIndex) => {
                if (cell.merged) return;
                const cellEl = document.createElement(cell.isHeader ? 'th' : 'td');
                cellEl.textContent = cell.content;
                if (cell.colspan > 1) cellEl.colSpan = cell.colspan;
                if (cell.rowspan > 1) cellEl.rowSpan = cell.rowspan;
                cellEl.dataset.row = rowIndex;
                cellEl.dataset.col = colIndex;
                cellEl.dataset.tableId = table.id;

                // Определить, является ли это последней видимой колонкой
                const colspan = cell.colspan || 1;
                const cellEndCol = colIndex + colspan - 1;
                const isLastColumn = (cellEndCol === maxCols - 1);

                // Добавить правую ручку только если это НЕ последняя колонка
                if (!isLastColumn) {
                    const resizeHandle = document.createElement('div');
                    resizeHandle.className = 'resize-handle';
                    cellEl.appendChild(resizeHandle);
                }

                const rowResizeHandle = document.createElement('div');
                rowResizeHandle.className = 'row-resize-handle';
                cellEl.appendChild(rowResizeHandle);

                tr.appendChild(cellEl);
            });
            tableEl.appendChild(tr);
        });

        return tableEl;
    }

    attachEventListeners() {
        // Выбор и редактирование — без изменений, но важная деталь:
        // в CSS ручки имеют z-index и pointer-events: auto, поэтому остаются доступны.
        this.container.querySelectorAll('td, th').forEach(cell => {
            cell.addEventListener('click', (e) => {
                if (e.target.classList.contains('resize-handle') ||
                    e.target.classList.contains('row-resize-handle')) return;
                if (!e.ctrlKey) this.clearSelection();
                this.selectCell(cell);
            });

            cell.addEventListener('dblclick', (e) => {
                if (e.target.classList.contains('resize-handle') ||
                    e.target.classList.contains('row-resize-handle')) return;
                this.startEditing(cell);
            });

            cell.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (this.selectedCells.length === 0) this.selectCell(cell);
                ContextMenuManager.show(e.clientX, e.clientY, null, 'cell');
            });
        });

        // Колонки
        this.container.querySelectorAll('.resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.startColumnResize(e);
            });
        });

        // Строки
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

        input.addEventListener('blur', finishEditing, {once: true});

        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                input.blur();
            }
            if (e.key === 'Escape') {
                cell.textContent = originalContent;
                cell.classList.remove('editing');
            }
        }, {once: true});
    }

    static startColumnResize(e) {
        const cell = e.target.parentElement;
        const table = cell.closest('table');
        const scrollContainer = table.closest('.table-scroll');
        const startX = e.clientX;
        const startWidth = cell.offsetWidth;
        const colIndex = parseInt(cell.dataset.col);

        // Пересчёт суммарной ширины колонок для вычисления максимального ограничения
        const allRows = table.querySelectorAll('tr');
        // Берём первую строку как эталонную по числу видимых колонок
        const firstRowCells = allRows[0].querySelectorAll('td, th');
        let colWidths = [];
        firstRowCells.forEach((cell, idx) => {
            colWidths.push(cell.offsetWidth);
        });

        const minWidth = 80;
        const maxWidth = 800;

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        table.classList.add('resizing');

        // Вспомогательная линия
        const resizeLine = document.createElement('div');
        resizeLine.style.position = 'fixed';
        resizeLine.style.top = '0';
        resizeLine.style.bottom = '0';
        resizeLine.style.width = '2px';
        resizeLine.style.backgroundColor = '#667eea';
        resizeLine.style.zIndex = '9999';
        resizeLine.style.pointerEvents = 'none';
        resizeLine.style.left = e.clientX + 'px';
        document.body.appendChild(resizeLine);

        // Рассчитываем максимально допустимую ширину для изменения чтобы не вылезать за scrollContainer
        const getMaxAllowedWidth = () => {
            const scrollWidth = scrollContainer.offsetWidth; // видимая ширина секции
            let otherColsTotal = 0;
            colWidths.forEach((w, idx) => {
                if (idx !== colIndex) otherColsTotal += w;
            });
            // Не даём ширине превышать (scrollWidth - сумма прочих колонок), но с учётом minWidth
            return Math.max(minWidth, Math.min(maxWidth, scrollWidth - otherColsTotal));
        };

        const onMouseMove = (ev) => {
            const diff = ev.clientX - startX;
            let newWidth = startWidth + diff; // тянем правую границу
            const allowed = getMaxAllowedWidth();
            if (newWidth > allowed) newWidth = allowed;
            newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
            resizeLine.style.left = (startX + (newWidth - startWidth)) + 'px';

            allRows.forEach(row => {
                const cellsInRow = row.querySelectorAll('td, th');
                cellsInRow.forEach(rowCell => {
                    const cellColIndex = parseInt(rowCell.dataset.col);
                    if (cellColIndex === colIndex) {
                        rowCell.style.width = newWidth + 'px';
                        rowCell.style.minWidth = newWidth + 'px';
                        rowCell.style.maxWidth = maxWidth + 'px';
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

            const section = table.closest('.table-section');
            if (section) {
                const tableId = section.dataset.tableId;
                ItemsRenderer.persistTableSizes(tableId, table);
            }
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
