/**
 * Изменение размеров ячеек таблиц.
 * Обрабатывает интерактивное изменение ширины колонок и высоты строк с визуализацией.
 * Сохраняет размеры в AppState для восстановления после перерисовки.
 */
class TableSizes {
    constructor(tableManager) {
        // Ссылка на TableManager для координации операций с таблицами
        this.tableManager = tableManager;
    }

    /**
     * Начало изменения ширины колонки.
     * Синхронно изменяет ширину текущей и соседней колонки (компенсация).
     * Учитывает ячейки с colspan, которые перекрывают изменяемые колонки.
     * @param {MouseEvent} e - событие mousedown на ручке изменения размера
     */
    startColumnResize(e) {
        const cell = e.target.parentElement;
        const table = cell.closest('table');
        const section = table.closest('.table-section');
        const startX = e.clientX;
        const startWidth = cell.offsetWidth;
        const colIndex = parseInt(cell.dataset.col);

        // Поиск следующей колонки для компенсирующего изменения ширины
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

        // Ограничения размеров колонок
        const minWidth = 80;
        const maxWidth = 800;

        // Визуальная индикация процесса изменения размера
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        table.classList.add('resizing');

        // Вертикальная линия для визуализации новой позиции границы
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
         * Обработка движения мыши - изменение ширины колонок в реальном времени.
         * Применяет размеры с учетом ограничений и компенсации соседней колонки.
         */
        const onMouseMove = (ev) => {
            const diff = ev.clientX - startX;
            let newWidth = startWidth + diff;
            newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

            let nextNewWidth = nextStartWidth;
            if (nextColIndex !== null && nextCell) {
                const actualDiff = newWidth - startWidth;
                nextNewWidth = nextStartWidth - actualDiff;

                // Проверка ограничений для соседней колонки
                if (nextNewWidth < minWidth) {
                    nextNewWidth = minWidth;
                    newWidth = startWidth + (nextStartWidth - minWidth);
                }
                if (nextNewWidth > maxWidth) {
                    nextNewWidth = maxWidth;
                    newWidth = startWidth + (nextStartWidth - maxWidth);
                }
            }

            // Обновление позиции визуальной линии
            resizeLine.style.left = `${startX + (newWidth - startWidth)}px`;

            // Применение размеров ко всем строкам таблицы
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
                        // Ячейка с colspan, перекрывающая изменяемую колонку
                        const currentCellWidth = rowCell.offsetWidth;
                        const delta = newWidth - startWidth;
                        const newCellWidth = currentCellWidth + delta;
                        rowCell.style.width = `${newCellWidth}px`;
                        rowCell.style.minWidth = `${newCellWidth}px`;
                        rowCell.style.maxWidth = `${newCellWidth}px`;
                        rowCell.style.wordBreak = 'normal';
                        rowCell.style.overflowWrap = 'anywhere';
                    } else if (nextColIndex !== null && cellColIndex === nextColIndex) {
                        // Соседняя колонка с компенсирующим изменением
                        rowCell.style.width = `${nextNewWidth}px`;
                        rowCell.style.minWidth = `${nextNewWidth}px`;
                        rowCell.style.maxWidth = `${nextNewWidth}px`;
                        rowCell.style.wordBreak = 'normal';
                        rowCell.style.overflowWrap = 'anywhere';
                    } else if (nextColIndex !== null && cellColIndex < nextColIndex && cellColIndex + colspan > nextColIndex) {
                        // Ячейка с colspan, перекрывающая соседнюю колонку
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
         * Завершение операции изменения размера.
         * Сохраняет финальные размеры в AppState.
         */
        const onMouseUp = () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            table.classList.remove('resizing');
            document.body.removeChild(resizeLine);

            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            // Сохранение размеров для восстановления после перерисовки
            if (section) {
                const tableId = section.dataset.tableId;
                this.persistTableSizes(tableId, table);
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    /**
     * Начало изменения высоты строки.
     * Учитывает ячейки с rowspan, которые перекрывают изменяемую строку.
     * @param {MouseEvent} e - событие mousedown на ручке изменения размера
     */
    startRowResize(e) {
        const cell = e.target.parentElement;
        const row = cell.parentElement;
        const table = cell.closest('table');
        const startY = e.clientY;
        const startHeight = row.offsetHeight;
        const rowIndex = parseInt(cell.dataset.row);

        // Ограничения размеров строк
        const minHeight = 28;
        const maxHeight = 600;

        // Визуальная индикация процесса изменения размера
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        table.classList.add('resizing');

        // Горизонтальная линия для визуализации новой позиции границы
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
         * Обработка движения мыши - изменение высоты строки в реальном времени.
         * Применяет размеры с учетом ограничений и ячеек с rowspan.
         */
        const onMouseMove = (ev) => {
            const diff = ev.clientY - startY;
            let newHeight = startHeight + diff;
            newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));

            // Обновление позиции визуальной линии
            resizeLine.style.top = `${startY + (newHeight - startHeight)}px`;

            // Применение размеров ко всем ячейкам таблицы
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
                        // Ячейка с rowspan, перекрывающая изменяемую строку
                        const currentCellHeight = rowCell.offsetHeight;
                        const delta = newHeight - startHeight;
                        const newCellHeight = currentCellHeight + delta;
                        rowCell.style.height = `${Math.max(minHeight * rowspan, Math.min(maxHeight * rowspan, newCellHeight))}px`;
                        rowCell.style.minHeight = `${Math.max(minHeight * rowspan, Math.min(maxHeight * rowspan, newCellHeight))}px`;
                    }
                });
            });

            // Применение высоты к самому элементу строки
            row.style.height = `${newHeight}px`;
            row.style.minHeight = `${newHeight}px`;
        };

        /**
         * Завершение операции изменения размера.
         * Сохраняет финальные размеры в AppState.
         */
        const onMouseUp = () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            table.classList.remove('resizing');
            document.body.removeChild(resizeLine);

            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            // Сохранение размеров для восстановления после перерисовки
            const section = table.closest('.table-section');
            if (section) {
                const tableId = section.dataset.tableId;
                this.persistTableSizes(tableId, table);
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    /**
     * Сохранение размеров всех ячеек таблицы в AppState.
     * Используется для восстановления размеров после перерисовки.
     * @param {string} tableId - ID таблицы
     * @param {HTMLElement} tableElement - DOM-элемент таблицы
     */
    persistTableSizes(tableId, tableElement) {
        if (!tableId || !tableElement) return;

        if (!AppState.tableUISizes) {
            AppState.tableUISizes = {};
        }

        const sizes = {};

        // Сбор размеров со всех ячеек по координатам
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

        // Сохранение в глобальное состояние приложения
        AppState.tableUISizes[tableId] = {
            cellSizes: sizes
        };
    }

    /**
     * Применение сохраненных размеров к таблице после перерисовки.
     * Восстанавливает ширину колонок и высоту строк из AppState.
     * @param {string} tableId - ID таблицы
     * @param {HTMLElement} tableElement - DOM-элемент таблицы
     */
    applyPersistedSizes(tableId, tableElement) {
        if (!tableId || !tableElement) return;

        const saved = AppState.tableUISizes && AppState.tableUISizes[tableId];
        if (!saved || !saved.cellSizes) return;

        // Применение сохраненных размеров к ячейкам по координатам
        tableElement.querySelectorAll('th, td').forEach(cell => {
            const row = cell.dataset.row;
            const col = cell.dataset.col;
            if (row === null || col === null) return;

            const key = `${row}-${col}`;
            const s = saved.cellSizes[key];

            if (s) {
                // Восстановление сохраненных стилей
                if (s.width) cell.style.width = s.width;
                if (s.height) cell.style.height = s.height;
                if (s.minWidth) cell.style.minWidth = s.minWidth;
                if (s.minHeight) cell.style.minHeight = s.minHeight;
                cell.style.wordBreak = s.wordBreak || 'normal';
                cell.style.overflowWrap = s.overflowWrap || 'anywhere';
            } else {
                // Размеры по умолчанию для новых ячеек
                cell.style.minWidth = '80px';
                cell.style.minHeight = '28px';
                cell.style.wordBreak = 'normal';
                cell.style.overflowWrap = 'anywhere';
            }
        });
    }

    /**
     * Сохранение текущих размеров таблицы в локальный объект.
     * Используется для временного хранения размеров между операциями.
     * @param {HTMLElement} tableElement - DOM-элемент таблицы
     * @returns {Object} Объект с размерами всех ячеек
     */
    preserveTableSizes(tableElement) {
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
     * Применение размеров к таблице из локального объекта.
     * Используется для восстановления размеров после локальных операций.
     * @param {HTMLElement} tableElement - DOM-элемент таблицы
     * @param {Object} sizes - Объект с размерами ячеек
     */
    applyTableSizes(tableElement, sizes) {
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
}
