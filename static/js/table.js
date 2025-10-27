/**
 * Класс для управления таблицами в редакторе
 * Обрабатывает рендеринг, редактирование, изменение размеров и объединение ячеек
 */
class TableManager {
    /**
     * Создаёт экземпляр менеджера таблиц
     * @param {string} containerId - ID контейнера для отображения таблиц
     */
    constructor(containerId) {
        // DOM-элемент контейнера
        this.container = document.getElementById(containerId);
        // Массив выбранных ячеек
        this.selectedCells = [];
        // Флаг процесса изменения размеров
        this.isResizing = false;
    }

    /**
     * Отрисовывает все таблицы из состояния приложения
     * Очищает контейнер и создаёт новые элементы для каждой таблицы
     */
    renderAll() {
        this.container.innerHTML = '';
        Object.values(AppState.tables).forEach(table => {
            const section = this.createTableSection(table);
            this.container.appendChild(section);
        });
        this.attachEventListeners();
    }

    /**
     * Создаёт секцию для таблицы с заголовком и скролл-контейнером
     * @param {Object} table - Данные таблицы
     * @returns {HTMLElement} DOM-элемент секции таблицы
     */
    createTableSection(table) {
        const section = document.createElement('div');
        section.className = 'table-section';
        section.dataset.tableId = table.id;

        const node = AppState.findNodeById(table.nodeId);
        const title = document.createElement('h3');
        title.textContent = node ? node.label : 'Таблица';
        section.appendChild(title);

        // Контейнер со скроллом для предотвращения выхода таблицы за границы
        const scroll = document.createElement('div');
        scroll.className = 'table-scroll';
        const tableEl = this.createTableElement(table);
        scroll.appendChild(tableEl);
        section.appendChild(scroll);

        return section;
    }

    /**
     * Создаёт HTML-элемент таблицы с обработкой объединённых ячеек
     * @param {Object} table - Данные таблицы
     * @returns {HTMLElement} DOM-элемент таблицы
     */
    createTableElement(table) {
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

        table.rows.forEach((row, rowIndex) => {
            const tr = document.createElement('tr');
            row.cells.forEach((cell, colIndex) => {
                if (cell.merged) return;

                const cellEl = document.createElement(cell.isHeader ? 'th' : 'td');

                // Корректное отображение многострочного контента
                if (cell.content) {
                    const lines = cell.content.split('\n');
                    lines.forEach((line, index) => {
                        const textNode = document.createTextNode(line);
                        cellEl.appendChild(textNode);
                        if (index < lines.length - 1) {
                            cellEl.appendChild(document.createElement('br'));
                        }
                    });
                }

                if (cell.colspan > 1) cellEl.colSpan = cell.colspan;
                if (cell.rowspan > 1) cellEl.rowSpan = cell.rowspan;

                cellEl.dataset.row = rowIndex;
                cellEl.dataset.col = colIndex;
                cellEl.dataset.tableId = table.id;

                // Добавление ручки изменения ширины колонки (кроме последней колонки)
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

        return tableEl;
    }

    /**
     * Подключает обработчики событий ко всем ячейкам и ручкам изменения размеров
     * Обрабатывает клики, двойные клики, контекстное меню и изменение размеров
     */
    attachEventListeners() {
        // Обработка кликов по ячейкам
        this.container.querySelectorAll('td, th').forEach(cell => {
            cell.addEventListener('click', (e) => {
                if (e.target.classList.contains('resize-handle') ||
                    e.target.classList.contains('row-resize-handle')) return;

                if (!e.ctrlKey) this.clearSelection();
                this.selectCell(cell);
            });

            // Двойной клик запускает режим редактирования
            cell.addEventListener('dblclick', (e) => {
                if (e.target.classList.contains('resize-handle') ||
                    e.target.classList.contains('row-resize-handle')) return;
                this.startEditing(cell);
            });

            // Контекстное меню для дополнительных операций
            cell.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (this.selectedCells.length === 0) this.selectCell(cell);
                ContextMenuManager.show(e.clientX, e.clientY, null, 'cell');
            });
        });

        // Обработчики изменения ширины колонок
        this.container.querySelectorAll('.resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.startColumnResize(e);
            });
        });

        // Обработчики изменения высоты строк
        this.container.querySelectorAll('.row-resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.startRowResize(e);
            });
        });
    }

    /**
     * Добавляет ячейку в список выбранных
     * @param {HTMLElement} cell - DOM-элемент ячейки
     */
    selectCell(cell) {
        cell.classList.add('selected');
        this.selectedCells.push(cell);
        AppState.selectedCells = this.selectedCells;
    }

    /**
     * Снимает выделение со всех ячеек
     */
    clearSelection() {
        this.selectedCells.forEach(cell => cell.classList.remove('selected'));
        this.selectedCells = [];
        AppState.selectedCells = [];
    }

    /**
     * Запускает режим редактирования ячейки
     * Создаёт textarea для многострочного ввода текста
     * @param {HTMLElement} cell - DOM-элемент ячейки
     */
    startEditing(cell) {
        const originalContent = cell.textContent;
        cell.classList.add('editing');

        // Используем textarea для поддержки многострочного текста
        const textarea = document.createElement('textarea');
        textarea.className = 'cell-editor';
        textarea.value = originalContent;
        cell.textContent = '';
        cell.appendChild(textarea);
        textarea.focus();

        // Автоматическая подстройка высоты под контент
        const adjustHeight = () => {
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
        };
        adjustHeight();
        textarea.addEventListener('input', adjustHeight);

        /**
         * Завершает редактирование и сохраняет изменения
         * @param {boolean} [cancel=false] - True для отмены изменений
         */
        const finishEditing = (cancel = false) => {
            const newValue = cancel ? originalContent : textarea.value;
            cell.textContent = '';

            // Создание элементов для корректного отображения переносов строк
            const lines = newValue.split('\n');
            lines.forEach((line, index) => {
                const textNode = document.createTextNode(line);
                cell.appendChild(textNode);
                if (index < lines.length - 1) {
                    cell.appendChild(document.createElement('br'));
                }
            });

            cell.classList.remove('editing');

            // Сохранение в состояние
            if (!cancel) {
                const tableId = cell.dataset.tableId;
                const row = parseInt(cell.dataset.row);
                const col = parseInt(cell.dataset.col);
                const table = AppState.tables[tableId];

                if (table && table.rows[row] && table.rows[row].cells[col]) {
                    table.rows[row].cells[col].content = newValue;
                    PreviewManager.update();
                }
            }
        };

        const blurHandler = () => {
            finishEditing(false);
        };

        const keydownHandler = (e) => {
            if (e.key === 'Enter' && e.shiftKey) {
                // Shift+Enter - добавление новой строки
                e.stopPropagation();
            } else if (e.key === 'Enter' && !e.shiftKey) {
                // Enter - сохранение и выход из редактирования
                e.preventDefault();
                textarea.removeEventListener('blur', blurHandler);
                textarea.removeEventListener('keydown', keydownHandler);
                finishEditing(false);
            } else if (e.key === 'Escape') {
                // Escape - отмена изменений
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
     * Запускает процесс изменения ширины колонки
     * Создаёт визуальную линию и обрабатывает перемещение мыши
     * @param {MouseEvent} e - Событие mousedown на ручке изменения размера
     */
    static startColumnResize(e) {
        const cell = e.target.parentElement;
        const table = cell.closest('table');
        const scrollContainer = table.closest('.table-scroll');
        const startX = e.clientX;
        const startWidth = cell.offsetWidth;
        const colIndex = parseInt(cell.dataset.col);

        // Вычисление текущих ширин колонок
        const allRows = table.querySelectorAll('tr');
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

        // Визуальная линия для отображения новой позиции границы
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

        /**
         * Вычисляет максимально допустимую ширину колонки
         * @returns {number} Максимальная ширина в пикселях
         */
        const getMaxAllowedWidth = () => {
            const scrollWidth = scrollContainer.offsetWidth;
            let otherColsTotal = 0;
            colWidths.forEach((w, idx) => {
                if (idx !== colIndex) otherColsTotal += w;
            });
            return Math.max(minWidth, Math.min(maxWidth, scrollWidth - otherColsTotal));
        };

        const onMouseMove = (ev) => {
            const diff = ev.clientX - startX;
            let newWidth = startWidth + diff;
            const allowed = getMaxAllowedWidth();

            if (newWidth > allowed) newWidth = allowed;
            newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

            resizeLine.style.left = (startX + (newWidth - startWidth)) + 'px';

            // Применение новой ширины ко всем ячейкам колонки
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

            // Сохранение размеров таблицы
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
     * Запускает процесс изменения высоты строки
     * @param {MouseEvent} e - Событие mousedown на ручке изменения размера
     */
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

    /**
     * Объединяет выбранные ячейки в одну
     * Проверяет корректность выделенной области и объединяет содержимое
     */
    mergeCells() {
        if (this.selectedCells.length < 2) return;

        // Получение координат всех выбранных ячеек
        const coords = this.selectedCells.map(cell => ({
            row: parseInt(cell.dataset.row),
            col: parseInt(cell.dataset.col),
            tableId: cell.dataset.tableId,
            cell: cell
        }));

        // Проверка: все ячейки должны быть из одной таблицы
        const tableId = coords[0].tableId;
        if (!coords.every(c => c.tableId === tableId)) {
            alert('Можно объединять только ячейки из одной таблицы');
            return;
        }

        const table = AppState.tables[tableId];
        if (!table) return;

        // Проверка: ни одна ячейка не должна быть уже объединённой
        for (let coord of coords) {
            const cellData = table.rows[coord.row].cells[coord.col];
            if (cellData.colspan > 1 || cellData.rowspan > 1) {
                alert('Нельзя объединять ячейки, если среди них есть уже объединенные. Сначала разделите объединенные ячейки.');
                return;
            }
        }

        // Определение границ выделенной области
        const minRow = Math.min(...coords.map(c => c.row));
        const maxRow = Math.max(...coords.map(c => c.row));
        const minCol = Math.min(...coords.map(c => c.col));
        const maxCol = Math.max(...coords.map(c => c.col));

        const rowspan = maxRow - minRow + 1;
        const colspan = maxCol - minCol + 1;

        // Проверка: должна быть выбрана полная прямоугольная область
        const expectedCellsCount = rowspan * colspan;
        if (this.selectedCells.length !== expectedCellsCount) {
            alert('Можно объединять только полную прямоугольную или квадратную область ячеек');
            return;
        }

        // Проверка: все ячейки прямоугольника должны быть выбраны
        const selectedSet = new Set(coords.map(c => `${c.row}-${c.col}`));
        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                if (!selectedSet.has(`${r}-${c}`)) {
                    alert('Можно объединять только полную прямоугольную или квадратную область ячеек');
                    return;
                }
            }
        }

        // Проверка на уже объединённые ячейки в области
        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                if (table.rows[r].cells[c].merged) {
                    alert('В выделенной области содержатся объединенные ячейки. Сначала разделите их.');
                    return;
                }
            }
        }

        // Установка параметров объединения для первой ячейки
        const firstCell = table.rows[minRow].cells[minCol];
        firstCell.colspan = colspan;
        firstCell.rowspan = rowspan;

        // Объединение содержимого всех ячеек
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

        // Пометка остальных ячеек как объединённых
        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                if (r !== minRow || c !== minCol) {
                    table.rows[r].cells[c].merged = true;
                }
            }
        }

        this.clearSelection();
    }

    /**
     * Разделяет объединённую ячейку
     * Восстанавливает все ячейки в исходное состояние
     */
    unmergeCells() {
        if (this.selectedCells.length !== 1) return;

        const cell = this.selectedCells[0];
        const tableId = cell.dataset.tableId;
        const row = parseInt(cell.dataset.row);
        const col = parseInt(cell.dataset.col);

        const table = AppState.tables[tableId];
        if (!table) return;

        const cellData = table.rows[row].cells[col];

        // Проверка: ячейка должна быть объединённой
        if (cellData.colspan <= 1 && cellData.rowspan <= 1) {
            return;
        }

        const rowspan = cellData.rowspan || 1;
        const colspan = cellData.colspan || 1;

        // Восстановление всех ячеек
        for (let r = row; r < row + rowspan; r++) {
            for (let c = col; c < col + colspan; c++) {
                if (table.rows[r] && table.rows[r].cells[c]) {
                    table.rows[r].cells[c].merged = false;
                    table.rows[r].cells[c].colspan = 1;
                    table.rows[r].cells[c].rowspan = 1;

                    // Очистка содержимого всех ячеек кроме первой
                    if (r !== row || c !== col) {
                        table.rows[r].cells[c].content = '';
                    }
                }
            }
        }

        this.clearSelection();
    }
}

/** Глобальный экземпляр менеджера таблиц */
const tableManager = new TableManager('tablesContainer');
