/**
 * Класс для управления таблицами с матричной структурой данных.
 * Обеспечивает рендеринг, редактирование, изменение размеров и объединение ячеек.
 */
class TableManager {
    constructor(containerId) {
        // Контейнер для всех таблиц в документе
        this.container = document.getElementById(containerId);
        // Массив выбранных ячеек для операций объединения/разделения
        this.selectedCells = [];
        // Флаг активного процесса изменения размера
        this.isResizing = false;
    }

    /**
     * Полный рендеринг всех таблиц из глобального состояния.
     * Очищает контейнер и создает DOM-элементы для каждой таблицы.
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
     * Создает секцию таблицы с заголовком и скроллируемым контейнером.
     * @param {Object} table - Объект таблицы из AppState
     * @returns {HTMLElement} Готовая секция с таблицей
     */
    createTableSection(table) {
        const section = document.createElement('div');
        section.className = 'table-section';
        section.dataset.tableId = table.id;

        // Получаем название из связанного узла дерева
        const node = AppState.findNodeById(table.nodeId);
        const title = document.createElement('h3');
        title.textContent = node ? node.label : 'Таблица';
        section.appendChild(title);

        // Обертка для горизонтального скролла
        const scroll = document.createElement('div');
        scroll.className = 'table-scroll';

        const tableEl = this.createTableElement(table);
        scroll.appendChild(tableEl);
        section.appendChild(scroll);

        return section;
    }

    /**
     * Создает HTML-элемент таблицы на основе матричной структуры grid.
     * Обрабатывает объединенные ячейки (colspan/rowspan) и добавляет ручки изменения размеров.
     * @param {Object} table - Объект таблицы с grid-структурой
     * @returns {HTMLTableElement} Готовая HTML-таблица
     */
    createTableElement(table) {
        const tableEl = document.createElement('table');
        tableEl.className = 'editable-table';

        table.grid.forEach((rowData, rowIndex) => {
            const tr = document.createElement('tr');

            rowData.forEach((cellData, colIndex) => {
                // Пропускаем ячейки, которые поглощены объединением (spanned)
                if (cellData.isSpanned) return;

                const cellEl = document.createElement(cellData.isHeader ? 'th' : 'td');

                // Корректное отображение многострочного контента с переносами
                if (cellData.content) {
                    const lines = cellData.content.split('\n');
                    lines.forEach((line, index) => {
                        const textNode = document.createTextNode(line);
                        cellEl.appendChild(textNode);
                        if (index < lines.length - 1) {
                            cellEl.appendChild(document.createElement('br'));
                        }
                    });
                }

                // Атрибуты для объединения ячеек
                if (cellData.colSpan > 1) cellEl.colSpan = cellData.colSpan;
                if (cellData.rowSpan > 1) cellEl.rowSpan = cellData.rowSpan;

                // Сохраняем координаты для операций с ячейкой
                cellEl.dataset.row = rowIndex;
                cellEl.dataset.col = colIndex;
                cellEl.dataset.tableId = table.id;

                // Ручка изменения ширины колонки (кроме последней)
                const numCols = table.grid[0].length;
                const isLastColumn = colIndex + (cellData.colSpan || 1) >= numCols;

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
     * Привязывает обработчики событий ко всем ячейкам и ручкам изменения размеров.
     * Обрабатывает клики, двойные клики, контекстное меню и resize операции.
     */
    attachEventListeners() {
        // Обработчики для ячеек таблицы
        this.container.querySelectorAll('td, th').forEach(cell => {
            // Выбор ячейки с поддержкой Ctrl для множественного выбора
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

            // Контекстное меню для операций с ячейкой
            cell.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                if (this.selectedCells.length === 0) this.selectCell(cell);
                ContextMenuManager.show(e.clientX, e.clientY, null, 'cell');
            });
        });

        // Обработчики для изменения ширины колонок
        this.container.querySelectorAll('.resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.startColumnResize(e);
            });
        });

        // Обработчики для изменения высоты строк
        this.container.querySelectorAll('.row-resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                this.startRowResize(e);
            });
        });
    }

    /**
     * Добавляет ячейку в список выбранных и синхронизирует с глобальным состоянием.
     * @param {HTMLElement} cell - DOM-элемент ячейки
     */
    selectCell(cell) {
        cell.classList.add('selected');
        this.selectedCells.push(cell);
        AppState.selectedCells = this.selectedCells;
    }

    /**
     * Снимает выделение со всех ячеек и очищает список выбранных.
     */
    clearSelection() {
        this.selectedCells.forEach(cell => cell.classList.remove('selected'));
        this.selectedCells = [];
        AppState.selectedCells = [];
    }

    /**
     * Запускает режим редактирования ячейки с textarea для многострочного ввода.
     * Поддерживает Shift+Enter для переноса строки, Enter для сохранения, Escape для отмены.
     * @param {HTMLElement} cell - DOM-элемент редактируемой ячейки
     */
    startEditing(cell) {
        const originalContent = cell.textContent;
        cell.classList.add('editing');

        // Создаем textarea для редактирования
        const textarea = document.createElement('textarea');
        textarea.className = 'cell-editor';
        textarea.value = originalContent;
        cell.textContent = '';
        cell.appendChild(textarea);
        textarea.focus();

        // Автоматическая подстройка высоты под содержимое
        const adjustHeight = () => {
            textarea.style.height = 'auto';
            textarea.style.height = textarea.scrollHeight + 'px';
        };

        adjustHeight();
        textarea.addEventListener('input', adjustHeight);

        /**
         * Завершает редактирование и восстанавливает или сохраняет содержимое.
         * @param {boolean} cancel - Если true, отменяет изменения
         */
        const finishEditing = (cancel = false) => {
            const newValue = cancel ? originalContent : textarea.value;
            cell.textContent = '';

            // Восстанавливаем многострочное содержимое с <br>
            const lines = newValue.split('\n');
            lines.forEach((line, index) => {
                const textNode = document.createTextNode(line);
                cell.appendChild(textNode);
                if (index < lines.length - 1) {
                    cell.appendChild(document.createElement('br'));
                }
            });

            cell.classList.remove('editing');

            // Сохраняем изменения в состояние
            if (!cancel) {
                const tableId = cell.dataset.tableId;
                const row = parseInt(cell.dataset.row);
                const col = parseInt(cell.dataset.col);
                const table = AppState.tables[tableId];

                if (table && table.grid[row] && table.grid[row][col]) {
                    table.grid[row][col].content = newValue;
                    PreviewManager.update();
                }
            }
        };

        // Обработчики для завершения редактирования
        const blurHandler = () => {
            finishEditing(false);
        };

        const keydownHandler = (e) => {
            // Shift+Enter - новая строка внутри ячейки
            if (e.key === 'Enter' && e.shiftKey) {
                e.stopPropagation();
                // Enter - сохранить и выйти
            } else if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                textarea.removeEventListener('blur', blurHandler);
                textarea.removeEventListener('keydown', keydownHandler);
                finishEditing(false);
                // Escape - отменить и выйти
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
     * Запускает интерактивное изменение ширины колонки.
     * Показывает визуальную линию resize и применяет ширину ко всем ячейкам колонки.
     * Ограничивает минимальную (80px) и максимальную (800px) ширину.
     * @param {MouseEvent} e - Событие mousedown на resize-ручке
     */
    startColumnResize(e) {
        const cell = e.target.parentElement;
        const table = cell.closest('table');
        const scrollContainer = table.closest('.table-scroll');
        const startX = e.clientX;
        const startWidth = cell.offsetWidth;
        const colIndex = parseInt(cell.dataset.col);

        // Сохраняем текущие ширины всех колонок
        const allRows = table.querySelectorAll('tr');
        const firstRowCells = allRows[0].querySelectorAll('td, th');
        let colWidths = [];

        firstRowCells.forEach((cell, idx) => {
            colWidths.push(cell.offsetWidth);
        });

        const minWidth = 80;
        const maxWidth = 800;

        // Визуальные индикаторы процесса resize
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        table.classList.add('resizing');

        // Создаем линию-индикатор позиции новой границы
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
         * Вычисляет максимально допустимую ширину с учетом размера контейнера.
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

        // Обработчик движения мыши - обновляет ширину в реальном времени
        const onMouseMove = (ev) => {
            const diff = ev.clientX - startX;
            let newWidth = startWidth + diff;
            const allowed = getMaxAllowedWidth();

            if (newWidth > allowed) newWidth = allowed;
            newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

            resizeLine.style.left = (startX + (newWidth - startWidth)) + 'px';

            // Применяем новую ширину ко всем ячейкам колонки
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

        // Завершение resize - сохраняем размеры в персистентное хранилище
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
                ItemsTableSizes.persistTableSizes(tableId, table);
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    /**
     * Запускает интерактивное изменение высоты строки.
     * @param {MouseEvent} e - Событие mousedown на row-resize-ручке
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
     * Объединяет выбранные ячейки в одну, используя матричную модель с colspan/rowspan.
     * Проверяет, что выбрана полная прямоугольная область без уже объединенных ячеек.
     * Объединяет содержимое всех ячеек через пробел.
     */
    mergeCells() {
        if (this.selectedCells.length < 2) return;

        // Собираем координаты всех выбранных ячеек
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

        // Определяем границы прямоугольной области
        const minRow = Math.min(...coords.map(c => c.row));
        const maxRow = Math.max(...coords.map(c => c.row));
        const minCol = Math.min(...coords.map(c => c.col));
        const maxCol = Math.max(...coords.map(c => c.col));

        const rowspan = maxRow - minRow + 1;
        const colspan = maxCol - minCol + 1;

        // Проверка, что выбраны все ячейки прямоугольника
        const expectedCellsCount = rowspan * colspan;
        if (this.selectedCells.length !== expectedCellsCount) {
            alert('Можно объединять только полную прямоугольную область ячеек');
            return;
        }

        // Проверка полноты прямоугольника через Set
        const selectedSet = new Set(coords.map(c => `${c.row}-${c.col}`));
        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                if (!selectedSet.has(`${r}-${c}`)) {
                    alert('Можно объединять только полную прямоугольную область ячеек');
                    return;
                }
            }
        }

        // Собираем содержимое всех объединяемых ячеек
        let mergedContent = [];
        for (let r = minRow; r <= maxRow; r++) {
            for (let c = minCol; c <= maxCol; c++) {
                const content = table.grid[r][c].content;
                if (content && content.trim()) {
                    mergedContent.push(content);
                }
            }
        }

        // Обновляем главную ячейку (верхняя левая)
        const originCell = table.grid[minRow][minCol];
        originCell.content = mergedContent.join(' ');
        originCell.colSpan = colspan;
        originCell.rowSpan = rowspan;

        // Помечаем остальные ячейки как поглощенные (spanned)
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
     * Разделяет объединенную ячейку обратно на отдельные ячейки.
     * Восстанавливает grid-структуру, создавая пустые ячейки на месте spanned.
     */
    unmergeCells() {
        if (this.selectedCells.length !== 1) return;

        const cell = this.selectedCells[0];
        const tableId = cell.dataset.tableId;
        const row = parseInt(cell.dataset.row);
        const col = parseInt(cell.dataset.col);

        const table = AppState.tables[tableId];
        if (!table) return;

        const cellData = table.grid[row][col];

        // Проверка, что ячейка действительно объединенная
        if (cellData.colSpan <= 1 && cellData.rowSpan <= 1) {
            return;
        }

        const rowspan = cellData.rowSpan || 1;
        const colspan = cellData.colSpan || 1;

        // Восстанавливаем все ячейки в области объединения
        for (let r = row; r < row + rowspan; r++) {
            for (let c = col; c < col + colspan; c++) {
                if (table.grid[r] && table.grid[r][c]) {
                    if (r === row && c === col) {
                        // Главная ячейка - сбрасываем colspan/rowspan
                        table.grid[r][c].colSpan = 1;
                        table.grid[r][c].rowSpan = 1;
                    } else {
                        // Создаем новую пустую ячейку
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

// Глобальный экземпляр менеджера таблиц
const tableManager = new TableManager('tablesContainer');
