/**
 * Управление таблицами с матричной структурой данных.
 * Координирует рендеринг, редактирование и взаимодействие с ячейками.
 * Делегирует операции с ячейками в TableCellsOperations и изменение размеров в TableSizes.
 */
class TableManager {
    constructor(containerId) {
        // DOM-контейнер для отображения всех таблиц
        this.container = document.getElementById(containerId);
        // Список выбранных ячеек для групповых операций (объединение/разделение)
        this.selectedCells = [];
        // Модуль операций с ячейками (выделение, редактирование, объединение)
        this.cellsOps = new TableCellsOperations(this);
        // Модуль изменения размеров (ширина колонок, высота строк)
        this.sizes = new TableSizes(this);

        // Инициализация глобальных обработчиков
        this.initGlobalHandlers();
    }

    /**
     * Инициализация глобальных обработчиков событий.
     * Обрабатывает клики вне таблицы и нажатие Escape для снятия выделения.
     */
    initGlobalHandlers() {
        // Обработчик кликов вне таблицы
        document.addEventListener('click', (e) => {
            // Проверяем, что клик НЕ по ячейке таблицы и НЕ по контекстному меню
            const isTableCell = e.target.closest('td, th');
            const isContextMenu = e.target.closest('.context-menu, #cellContextMenu');
            const isResizeHandle = e.target.classList.contains('resize-handle') ||
                e.target.classList.contains('row-resize-handle');

            if (!isTableCell && !isContextMenu && !isResizeHandle) {
                // Клик вне таблицы - снимаем выделение
                this.clearSelection();
            }
        });

        // Обработчик нажатия Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // Снимаем выделение с ячеек
                this.clearSelection();
                // Скрываем контекстное меню
                if (typeof ContextMenuManager !== 'undefined') {
                    ContextMenuManager.hide();
                }
            }
        });
    }

    /**
     * Полный перерисовка всех таблиц из AppState.
     * Очищает контейнер и создает DOM для каждой таблицы.
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
     * Привязка обработчиков событий к ячейкам и ручкам изменения размеров.
     * Обрабатывает клики, двойные клики, контекстное меню и начало resize-операций.
     */
    attachEventListeners() {
        const container = document.getElementById('itemsContainer');
        if (!container) return;

        // Обработка событий на ячейках
        container.querySelectorAll('td, th').forEach(cell => {
            // Одинарный клик - выделение ячейки (с Ctrl - множественное)
            cell.addEventListener('click', (e) => {
                if (e.target.classList.contains('resize-handle') ||
                    e.target.classList.contains('row-resize-handle')) {
                    return;
                }

                // Добавляем stopPropagation для предотвращения всплытия к document
                e.stopPropagation();

                if (!e.ctrlKey) {
                    this.cellsOps.clearSelection();
                }

                this.cellsOps.selectCell(cell);
            });

            // Двойной клик для редактирования ячейки
            cell.addEventListener('dblclick', (e) => {
                const tableId = cell.dataset.tableId;
                const table = AppState.tables[tableId];

                // ПРОВЕРКА: блокируем редактирование заголовков защищенных таблиц
                const isProtectedTable = table && table.protected === true;
                const isHeaderCell = cell.tagName.toLowerCase() === 'th';

                if (isProtectedTable && isHeaderCell) {
                    Notifications.info('Заголовки защищенной таблицы нельзя редактировать');
                    return;
                }

                this.cellsOps.startEditingCell(cell);
            });

            // Правая кнопка мыши - контекстное меню
            cell.addEventListener('contextmenu', (e) => {
                if (e.target.classList.contains('resize-handle') ||
                    e.target.classList.contains('row-resize-handle')) {
                    return;
                }

                e.preventDefault();
                e.stopPropagation();

                // Если нет выделенных ячеек или текущая ячейка не входит в выделение - выбираем её
                if (this.selectedCells.length === 0 || !this.selectedCells.includes(cell)) {
                    this.cellsOps.clearSelection();
                    this.cellsOps.selectCell(cell);
                }

                ContextMenuManager.show(e.clientX, e.clientY, null, 'cell');
            });
        });

        // Обработка ручек изменения ширины колонок
        container.querySelectorAll('.resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Делегируем к модулю sizes
                this.sizes.startColumnResize(e);
            });
        });

        // Обработка ручек изменения высоты строк
        container.querySelectorAll('.row-resize-handle').forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                // Делегируем к модулю sizes
                this.sizes.startRowResize(e);
            });
        });
    }

    /**
     * Создание секции таблицы с заголовком и скроллируемым контейнером.
     * @param {Object} table - Объект таблицы из AppState с grid-структурой
     * @returns {HTMLElement} DOM-элемент секции с таблицей
     */
    createTableSection(table) {
        const section = document.createElement('div');
        section.className = 'table-section';
        section.dataset.tableId = table.id;

        // Заголовок берется из связанного узла дерева
        const node = AppState.findNodeById(table.nodeId);
        const title = document.createElement('h3');
        title.textContent = node ? node.label : 'Таблица';
        section.appendChild(title);

        // Контейнер с горизонтальной прокруткой
        const scroll = document.createElement('div');
        scroll.className = 'table-scroll';

        const tableEl = this.createTableElement(table);
        scroll.appendChild(tableEl);
        section.appendChild(scroll);

        return section;
    }

    /**
     * Создание HTML-таблицы из матричной grid-структуры.
     * Обрабатывает объединенные ячейки (colspan/rowspan) и добавляет ручки изменения размеров.
     * @param {Object} table - Объект таблицы с grid-матрицей
     * @returns {HTMLTableElement} Готовая HTML-таблица
     */
    createTableElement(table) {
        const tableEl = document.createElement('table');
        tableEl.className = 'editable-table';

        table.grid.forEach((rowData, rowIndex) => {
            const tr = document.createElement('tr');

            rowData.forEach((cellData, colIndex) => {
                // Пропускаем ячейки, поглощенные объединением
                if (cellData.isSpanned) return;

                const cellEl = document.createElement(cellData.isHeader ? 'th' : 'td');

                // Отображение многострочного текста с сохранением переносов
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

                // Атрибуты для объединенных ячеек
                if (cellData.colSpan > 1) cellEl.colSpan = cellData.colSpan;
                if (cellData.rowSpan > 1) cellEl.rowSpan = cellData.rowSpan;

                // Координаты для идентификации ячейки при операциях
                cellEl.dataset.row = rowIndex;
                cellEl.dataset.col = colIndex;
                cellEl.dataset.tableId = table.id;

                // Ручка изменения ширины (кроме последней колонки)
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

    // Делегирующие методы для операций с ячейками
    /**
     * Снимает выделение со всех ячеек.
     * Делегирует выполнение в TableCellsOperations.
     */
    clearSelection() {
        this.cellsOps.clearSelection();
    }

    /**
     * Объединяет выбранные ячейки в одну с colspan/rowspan.
     * Делегирует выполнение в TableCellsOperations.
     */
    mergeCells() {
        this.cellsOps.mergeCells();
    }

    /**
     * Разделяет объединенную ячейку на отдельные ячейки.
     * Делегирует выполнение в TableCellsOperations.
     */
    unmergeCells() {
        this.cellsOps.unmergeCells();
    }

    // Делегирующие методы для изменения размеров
    /**
     * Начинает интерактивное изменение ширины колонки.
     * Делегирует выполнение в TableSizes.
     * @param {MouseEvent} e - событие mousedown на ручке изменения размера
     */
    startColumnResize(e) {
        this.sizes.startColumnResize(e);
    }

    /**
     * Начинает интерактивное изменение высоты строки.
     * Делегирует выполнение в TableSizes.
     * @param {MouseEvent} e - событие mousedown на ручке изменения размера
     */
    startRowResize(e) {
        this.sizes.startRowResize(e);
    }

    /**
     * Сохраняет размеры ячеек таблицы в AppState после изменения.
     * Делегирует выполнение в TableSizes.
     * @param {string} tableId - ID таблицы
     * @param {HTMLElement} tableElement - DOM-элемент таблицы
     */
    persistTableSizes(tableId, tableElement) {
        this.sizes.persistTableSizes(tableId, tableElement);
    }

    /**
     * Применяет сохраненные размеры из AppState после перерисовки.
     * Делегирует выполнение в TableSizes.
     * @param {string} tableId - ID таблицы
     * @param {HTMLElement} tableElement - DOM-элемент таблицы
     */
    applyPersistedSizes(tableId, tableElement) {
        this.sizes.applyPersistedSizes(tableId, tableElement);
    }

    /**
     * Сохраняет размеры таблицы во временный объект перед операциями.
     * Делегирует выполнение в TableSizes.
     * @param {HTMLElement} tableElement - DOM-элемент таблицы
     * @returns {Object} Объект с размерами ячеек
     */
    preserveTableSizes(tableElement) {
        return this.sizes.preserveTableSizes(tableElement);
    }

    /**
     * Применяет размеры из временного объекта после операций.
     * Делегирует выполнение в TableSizes.
     * @param {HTMLElement} tableElement - DOM-элемент таблицы
     * @param {Object} sizes - Объект с размерами ячеек
     */
    applyTableSizes(tableElement, sizes) {
        this.sizes.applyTableSizes(tableElement, sizes);
    }
}

// Глобальный экземпляр для управления всеми таблицами в приложении
const tableManager = new TableManager('tablesContainer');
