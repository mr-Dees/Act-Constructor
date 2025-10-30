/**
 * Модуль для обработки событий таблиц (клики, resize)
 */
class ItemsTableEvents {
    /**
     * Привязка событий к ячейкам таблиц
     */
    static attachTableEvents() {
        const container = document.getElementById('itemsContainer');
        if (!container) return;

        // Обрабатываем все ячейки таблиц
        container.querySelectorAll('td, th').forEach(cell => {
            // Клик для выделения ячейки
            cell.addEventListener('click', (e) => {
                // Игнорируем клики на ручки изменения размера
                if (e.target.classList.contains('resize-handle') ||
                    e.target.classList.contains('row-resize-handle')) {
                    return;
                }

                // Без Ctrl - снимаем выделение с других ячеек
                if (!e.ctrlKey) {
                    tableManager.clearSelection();
                }

                tableManager.selectCell(cell);
            });

            // Двойной клик для редактирования содержимого
            cell.addEventListener('dblclick', (e) => {
                if (e.target.classList.contains('resize-handle') ||
                    e.target.classList.contains('row-resize-handle')) {
                    return;
                }

                ItemsEditing.startEditingCell(cell);
            });

            // Контекстное меню правой кнопкой мыши
            cell.addEventListener('contextmenu', (e) => {
                if (e.target.classList.contains('resize-handle') ||
                    e.target.classList.contains('row-resize-handle')) {
                    return;
                }

                e.preventDefault();

                // Выделяем ячейку, если она еще не выделена
                if (!cell.classList.contains('selected') && tableManager.selectedCells.length === 0) {
                    tableManager.selectCell(cell);
                }

                ContextMenuManager.show(e.clientX, e.clientY, null, 'cell');
            });
        });

        // Обработка ручек изменения ширины колонок
        container.querySelectorAll('.resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.startColumnResize(e);
            });
        });

        // Обработка ручек изменения высоты строк
        container.querySelectorAll('.row-resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.startRowResize(e);
            });
        });
    }

    /**
     * Начало изменения ширины колонки
     * @param {MouseEvent} e - Событие мыши
     */
    static startColumnResize(e) {
        const cell = e.target.parentElement;
        const table = cell.closest('table');
        const section = table.closest('.table-section');
        const startX = e.clientX;
        const startWidth = cell.offsetWidth;
        const colIndex = parseInt(cell.dataset.col);

        // Находим следующую колонку для синхронного изменения размера
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

        // Ограничения размеров
        const minWidth = 80;
        const maxWidth = 800;

        // Устанавливаем курсор и блокируем выделение текста
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        table.classList.add('resizing');

        // Создаем вертикальную линию для визуализации изменения размера
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
         * Обработка движения мыши
         */
        const onMouseMove = (ev) => {
            const diff = ev.clientX - startX;
            let newWidth = startWidth + diff;
            newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));

            let nextNewWidth = nextStartWidth;
            if (nextColIndex !== null && nextCell) {
                // Вычисляем новую ширину соседней колонки
                const actualDiff = newWidth - startWidth;
                nextNewWidth = nextStartWidth - actualDiff;

                // Проверяем ограничения для соседней колонки
                if (nextNewWidth < minWidth) {
                    nextNewWidth = minWidth;
                    newWidth = startWidth + (nextStartWidth - minWidth);
                }
                if (nextNewWidth > maxWidth) {
                    nextNewWidth = maxWidth;
                    newWidth = startWidth + (nextStartWidth - maxWidth);
                }
            }

            // Обновляем позицию линии
            resizeLine.style.left = `${startX + (newWidth - startWidth)}px`;

            // Применяем размеры ко всем ячейкам в колонках
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
                        // Ячейка с colspan, которая накрывает изменяемую колонку
                        const currentCellWidth = rowCell.offsetWidth;
                        const delta = newWidth - startWidth;
                        const newCellWidth = currentCellWidth + delta;
                        rowCell.style.width = `${newCellWidth}px`;
                        rowCell.style.minWidth = `${newCellWidth}px`;
                        rowCell.style.maxWidth = `${newCellWidth}px`;
                        rowCell.style.wordBreak = 'normal';
                        rowCell.style.overflowWrap = 'anywhere';
                    } else if (nextColIndex !== null && cellColIndex === nextColIndex) {
                        // Соседняя колонка
                        rowCell.style.width = `${nextNewWidth}px`;
                        rowCell.style.minWidth = `${nextNewWidth}px`;
                        rowCell.style.maxWidth = `${nextNewWidth}px`;
                        rowCell.style.wordBreak = 'normal';
                        rowCell.style.overflowWrap = 'anywhere';
                    } else if (nextColIndex !== null && cellColIndex < nextColIndex && cellColIndex + colspan > nextColIndex) {
                        // Ячейка с colspan, которая накрывает соседнюю колонку
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
         * Завершение изменения размера
         */
        const onMouseUp = () => {
            // Восстанавливаем состояние
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            table.classList.remove('resizing');
            document.body.removeChild(resizeLine);

            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            // Сохраняем размеры в AppState
            if (section) {
                const tableId = section.dataset.tableId;
                ItemsTableSizes.persistTableSizes(tableId, table);
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    /**
     * Начало изменения высоты строки
     * @param {MouseEvent} e - Событие мыши
     */
    static startRowResize(e) {
        const cell = e.target.parentElement;
        const row = cell.parentElement;
        const table = cell.closest('table');
        const startY = e.clientY;
        const startHeight = row.offsetHeight;
        const rowIndex = parseInt(cell.dataset.row);

        // Ограничения размеров
        const minHeight = 28;
        const maxHeight = 600;

        // Устанавливаем курсор и блокируем выделение текста
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
        table.classList.add('resizing');

        // Создаем горизонтальную линию для визуализации изменения размера
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
         * Обработка движения мыши
         */
        const onMouseMove = (ev) => {
            const diff = ev.clientY - startY;
            let newHeight = startHeight + diff;
            newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));

            // Обновляем позицию линии
            resizeLine.style.top = `${startY + (newHeight - startHeight)}px`;

            // Применяем размеры ко всем ячейкам в строке
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
                        // Ячейка с rowspan, которая накрывает изменяемую строку
                        const currentCellHeight = rowCell.offsetHeight;
                        const delta = newHeight - startHeight;
                        const newCellHeight = currentCellHeight + delta;
                        rowCell.style.height = `${Math.max(minHeight * rowspan, Math.min(maxHeight * rowspan, newCellHeight))}px`;
                        rowCell.style.minHeight = `${Math.max(minHeight * rowspan, Math.min(maxHeight * rowspan, newCellHeight))}px`;
                    }
                });
            });

            // Применяем высоту к самой строке
            row.style.height = `${newHeight}px`;
            row.style.minHeight = `${newHeight}px`;
        };

        /**
         * Завершение изменения размера
         */
        const onMouseUp = () => {
            // Восстанавливаем состояние
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            table.classList.remove('resizing');
            document.body.removeChild(resizeLine);

            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);

            // Сохраняем размеры в AppState
            const section = table.closest('.table-section');
            if (section) {
                const tableId = section.dataset.tableId;
                ItemsTableSizes.persistTableSizes(tableId, table);
            }
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }
}
