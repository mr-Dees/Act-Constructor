/**
 * Изменение размеров ячеек таблиц.
 * Обрабатывает интерактивное изменение ширины колонок и высоты строк с визуализацией.
 * Сохраняет размеры в AppState для восстановления после перерисовки.
 * Использует относительные единицы (%) для адаптивности.
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
     * Использует проценты для адаптивности к размеру экрана.
     * @param {MouseEvent} e - событие mousedown на ручке изменения размера
     */
    startColumnResize(e) {
        const cell = e.target.parentElement;
        const table = cell.closest('table');
        const section = table.closest('.table-section');
        const startX = e.clientX;

        // Определяем колонку, которую изменяем (для colspan берем первую колонку)
        const colIndex = parseInt(cell.dataset.col);
        const rowIndex = parseInt(cell.dataset.row);

        // Получаем текущую ширину таблицы для расчета процентов
        const tableWidth = table.offsetWidth;
        const startWidth = cell.offsetWidth;
        const startWidthPercent = (startWidth / tableWidth) * 100;

        // Поиск следующей колонки для компенсирующего изменения ширины
        const allRows = table.querySelectorAll('tr');

        // Ищем следующую колонку на основе реальной структуры grid
        // Используем первую строку для определения всех колонок
        let nextColIndex = colIndex + 1;
        let nextCell = null;
        let nextStartWidth = 0;
        let nextStartWidthPercent = 0;

        // Находим ячейку в той же строке справа
        const currentRow = allRows[rowIndex];
        const cellsInCurrentRow = Array.from(currentRow.querySelectorAll('td, th'));
        const currentCellIndex = cellsInCurrentRow.indexOf(cell);

        if (currentCellIndex >= 0 && currentCellIndex < cellsInCurrentRow.length - 1) {
            nextCell = cellsInCurrentRow[currentCellIndex + 1];
            nextColIndex = parseInt(nextCell.dataset.col);
            nextStartWidth = nextCell.offsetWidth;
            nextStartWidthPercent = (nextStartWidth / tableWidth) * 100;
        }

        // Ограничения размеров колонок в процентах от ширины таблицы
        const minWidthPx = 80;
        const minWidthPercent = (minWidthPx / tableWidth) * 100;
        const maxWidthPercent = 80;

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
         * Правильный расчет для ячеек с colspan и их дочерних ячеек.
         */
        const onMouseMove = (ev) => {
            const diff = ev.clientX - startX;
            const diffPercent = (diff / tableWidth) * 100;

            let newWidthPercent = startWidthPercent + diffPercent;
            newWidthPercent = Math.max(minWidthPercent, Math.min(maxWidthPercent, newWidthPercent));

            let nextNewWidthPercent = nextStartWidthPercent;
            if (nextCell) {
                const actualDiffPercent = newWidthPercent - startWidthPercent;
                nextNewWidthPercent = nextStartWidthPercent - actualDiffPercent;

                // Проверка ограничений для соседней колонки
                if (nextNewWidthPercent < minWidthPercent) {
                    nextNewWidthPercent = minWidthPercent;
                    newWidthPercent = startWidthPercent + (nextStartWidthPercent - nextNewWidthPercent);
                }
                if (nextNewWidthPercent > maxWidthPercent) {
                    nextNewWidthPercent = maxWidthPercent;
                    newWidthPercent = startWidthPercent + (nextStartWidthPercent - maxWidthPercent);
                }
            }

            // Обновление позиции визуальной линии
            const newWidthPx = (newWidthPercent / 100) * tableWidth;
            resizeLine.style.left = `${startX + (newWidthPx - startWidth)}px`;

            // Применяем размеры только к ячейкам в той же колонке
            allRows.forEach(row => {
                const cellsInRow = row.querySelectorAll('td, th');
                cellsInRow.forEach(rowCell => {
                    const cellColIndex = parseInt(rowCell.dataset.col);

                    // Изменяем только ячейки, которые начинаются с той же колонки
                    if (cellColIndex === colIndex) {
                        rowCell.style.width = `${newWidthPercent}%`;
                        rowCell.style.minWidth = `${minWidthPx}px`;
                        rowCell.style.maxWidth = 'none';
                        rowCell.style.wordBreak = 'normal';
                        rowCell.style.overflowWrap = 'anywhere';
                    } else if (nextCell && cellColIndex === nextColIndex) {
                        rowCell.style.width = `${nextNewWidthPercent}%`;
                        rowCell.style.minWidth = `${minWidthPx}px`;
                        rowCell.style.maxWidth = 'none';
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
     * Изолированное изменение высоты только для затрагиваемых ячеек.
     * @param {MouseEvent} e - событие mousedown на ручке изменения размера
     */
    startRowResize(e) {
        const cell = e.target.parentElement;
        const table = cell.closest('table');
        const startY = e.clientY;

        // Определяем диапазон строк, которые покрывает эта ячейка
        const rowIndex = parseInt(cell.dataset.row);
        const rowspan = cell.rowSpan || 1;
        const lastRowIndex = rowIndex + rowspan - 1;

        // Получаем начальную высоту ТОЛЬКО этой ячейки
        const startHeight = cell.offsetHeight;

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

        // Собираем информацию обо всех ячейках, которые нужно изменять
        const allRows = table.querySelectorAll('tr');
        const affectedCells = new Map(); // Map<HTMLElement, {startHeight: number, rowspan: number}>

        // Находим все ячейки, которые пересекаются с изменяемым диапазоном строк
        allRows.forEach(tableRow => {
            const cellsInRow = tableRow.querySelectorAll('td, th');
            cellsInRow.forEach(rowCell => {
                const cellRowIndex = parseInt(rowCell.dataset.row);
                const cellRowspan = rowCell.rowSpan || 1;
                const cellLastRowIndex = cellRowIndex + cellRowspan - 1;

                // Проверяем, пересекается ли ячейка с изменяемым диапазоном
                const isAffected = (
                    // Ячейка начинается в диапазоне
                    (cellRowIndex >= rowIndex && cellRowIndex <= lastRowIndex) ||
                    // Ячейка заканчивается в диапазоне
                    (cellLastRowIndex >= rowIndex && cellLastRowIndex <= lastRowIndex) ||
                    // Ячейка полностью охватывает диапазон
                    (cellRowIndex < rowIndex && cellLastRowIndex > lastRowIndex)
                );

                if (isAffected && !affectedCells.has(rowCell)) {
                    affectedCells.set(rowCell, {
                        startHeight: rowCell.offsetHeight,
                        rowspan: cellRowspan,
                        rowIndex: cellRowIndex,
                        lastRowIndex: cellLastRowIndex
                    });
                }
            });
        });

        /**
         * Обработка движения мыши - изменение высоты строки в реальном времени.
         * Применяем изменение только к конкретной ячейке и её зависимым.
         */
        const onMouseMove = (ev) => {
            const diff = ev.clientY - startY;
            let newHeight = startHeight + diff;

            // Применяем ограничения с учетом rowspan исходной ячейки
            newHeight = Math.max(minHeight * rowspan, Math.min(maxHeight * rowspan, newHeight));

            // Обновление позиции визуальной линии
            resizeLine.style.top = `${startY + (newHeight - startHeight)}px`;

            // Рассчитываем дельту изменения
            const delta = newHeight - startHeight;

            // Применяем изменения только к затронутым ячейкам
            affectedCells.forEach((info, rowCell) => {
                const cellRowIndex = info.rowIndex;
                const cellLastRowIndex = info.lastRowIndex;
                const cellRowspan = info.rowspan;

                if (cellRowIndex === rowIndex && cellLastRowIndex === lastRowIndex) {
                    // Это точно наша изменяемая ячейка
                    rowCell.style.height = `${newHeight}px`;
                    rowCell.style.minHeight = `${newHeight}px`;
                } else if (cellRowIndex <= rowIndex && cellLastRowIndex >= lastRowIndex) {
                    // Ячейка с большим rowspan, полностью включающая изменяемый диапазон
                    // Увеличиваем её на ту же дельту
                    const newCellHeight = info.startHeight + delta;
                    const constrainedHeight = Math.max(
                        minHeight * cellRowspan,
                        Math.min(maxHeight * cellRowspan, newCellHeight)
                    );
                    rowCell.style.height = `${constrainedHeight}px`;
                    rowCell.style.minHeight = `${constrainedHeight}px`;
                } else if (cellRowIndex >= rowIndex && cellRowIndex <= lastRowIndex) {
                    // Ячейка начинается внутри изменяемого диапазона
                    // Пропорционально изменяем её высоту
                    const overlap = Math.min(cellLastRowIndex, lastRowIndex) - cellRowIndex + 1;
                    const proportion = overlap / rowspan;
                    const cellDelta = delta * proportion;
                    const newCellHeight = info.startHeight + cellDelta;
                    const constrainedHeight = Math.max(
                        minHeight * cellRowspan,
                        Math.min(maxHeight * cellRowspan, newCellHeight)
                    );
                    rowCell.style.height = `${constrainedHeight}px`;
                    rowCell.style.minHeight = `${constrainedHeight}px`;
                } else if (cellLastRowIndex >= rowIndex && cellLastRowIndex <= lastRowIndex) {
                    // Ячейка заканчивается внутри изменяемого диапазона
                    const overlap = cellLastRowIndex - Math.max(cellRowIndex, rowIndex) + 1;
                    const proportion = overlap / rowspan;
                    const cellDelta = delta * proportion;
                    const newCellHeight = info.startHeight + cellDelta;
                    const constrainedHeight = Math.max(
                        minHeight * cellRowspan,
                        Math.min(maxHeight * cellRowspan, newCellHeight)
                    );
                    rowCell.style.height = `${constrainedHeight}px`;
                    rowCell.style.minHeight = `${constrainedHeight}px`;
                }
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
     * Сохраняет ширину в процентах для адаптивности.
     * @param {string} tableId - ID таблицы
     * @param {HTMLElement} tableElement - DOM-элемент таблицы
     */
    persistTableSizes(tableId, tableElement) {
        if (!tableId || !tableElement) return;

        if (!AppState.tableUISizes) {
            AppState.tableUISizes = {};
        }

        const sizes = {};
        const tableWidth = tableElement.offsetWidth;

        // Сбор размеров со всех ячеек по координатам
        tableElement.querySelectorAll('th, td').forEach(cell => {
            const row = cell.dataset.row;
            const col = cell.dataset.col;
            if (row === null || col === null) return;

            const key = `${row}-${col}`;

            // Извлекаем процентную ширину, если она задана
            let widthValue = cell.style.width;
            if (widthValue && widthValue.includes('%')) {
                widthValue = widthValue;
            } else if (widthValue && widthValue.includes('px')) {
                const widthPx = parseFloat(widthValue);
                widthValue = `${(widthPx / tableWidth) * 100}%`;
            } else if (cell.offsetWidth) {
                widthValue = `${(cell.offsetWidth / tableWidth) * 100}%`;
            } else {
                widthValue = '';
            }

            sizes[key] = {
                width: widthValue,
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

        const tableData = AppState.tables[tableId];
        const currentNumCols = tableData?.grid?.[0]?.length || 0;

        // ВАЛИДАЦИЯ: проверяем, что количество колонок совпадает
        // Если не совпадает - не применяем размеры (они устаревшие)
        const savedCols = new Set();
        for (const key in saved.cellSizes) {
            const [, col] = key.split('-').map(Number);
            savedCols.add(col);
        }

        const maxSavedCol = Math.max(...Array.from(savedCols));
        if (maxSavedCol >= currentNumCols) {
            // Размеры устарели, не применяем их
            console.warn(`Размеры для таблицы ${tableId} устарели (сохранено ${maxSavedCol + 1} колонок, текущих ${currentNumCols})`);
            return;
        }

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
        const tableWidth = tableElement.offsetWidth;

        cells.forEach(cell => {
            const row = cell.dataset.row;
            const col = cell.dataset.col;
            const key = `${row}-${col}`;

            // Извлекаем процентную ширину
            let widthValue = cell.style.width;
            if (widthValue && widthValue.includes('%')) {
                widthValue = widthValue;
            } else if (widthValue && widthValue.includes('px')) {
                const widthPx = parseFloat(widthValue);
                widthValue = `${(widthPx / tableWidth) * 100}%`;
            } else if (cell.offsetWidth) {
                widthValue = `${(cell.offsetWidth / tableWidth) * 100}%`;
            } else {
                widthValue = '';
            }

            sizes[key] = {
                width: widthValue,
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
