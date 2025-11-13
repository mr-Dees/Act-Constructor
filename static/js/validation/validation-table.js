/**
 * Валидация таблиц
 *
 * Проверяет заполненность заголовков, наличие строк данных,
 * корректность структуры таблиц.
 */
const ValidationTable = {
    /**
     * Проверяет заполненность заголовков всех таблиц
     * @returns {Object} Результат валидации
     */
    validateHeaders() {
        const emptyHeaders = [];

        for (const tableId in AppState.tables) {
            const table = AppState.tables[tableId];

            if (!this._hasValidGrid(table)) continue;

            const headerRow = this._findHeaderRow(table.grid);
            if (!headerRow) continue;

            if (this._hasEmptyHeaders(headerRow)) {
                const tableName = this._getTableName(tableId);
                emptyHeaders.push(`-  ${tableName}`);
            }
        }

        if (emptyHeaders.length > 0) {
            return {
                valid: false,
                message: `Не заполнены заголовки таблиц:\n${emptyHeaders.join('\n')}\n\nЗаполните все заголовки перед сохранением.`
            };
        }

        return {valid: true, message: 'OK'};
    },

    /**
     * Проверяет наличие данных в таблицах
     * @returns {Object} Результат проверки (предупреждение)
     */
    validateData() {
        const emptyDataTables = [];

        for (const tableId in AppState.tables) {
            const table = AppState.tables[tableId];

            if (!this._hasValidGrid(table)) continue;

            const headerRowIndex = this._findHeaderRowIndex(table.grid);
            const dataStartIndex = headerRowIndex >= 0 ? headerRowIndex + 1 : 0;

            if (dataStartIndex >= table.grid.length) continue;

            if (!this._hasDataInRows(table.grid, dataStartIndex)) {
                const tableName = this._getTableName(tableId);
                emptyDataTables.push(`-  ${tableName}`);
            }
        }

        if (emptyDataTables.length > 0) {
            return {
                valid: false,
                message: `⚠️ Найдены таблицы без данных:\n${emptyDataTables.join('\n')}\n\nВы можете продолжить сохранение.`
            };
        }

        return {valid: true, message: 'OK'};
    },

    /**
     * Проверяет наличие валидной grid-структуры
     * @private
     * @param {Object} table - Объект таблицы
     * @returns {boolean} Есть ли валидная grid
     */
    _hasValidGrid(table) {
        return table.grid && Array.isArray(table.grid) && table.grid.length > 0;
    },

    /**
     * Находит строку с заголовками
     * @private
     * @param {Array} grid - Матрица таблицы
     * @returns {Array|null} Строка заголовков или null
     */
    _findHeaderRow(grid) {
        return grid.find(row => row.some(cell => cell.isHeader === true));
    },

    /**
     * Находит индекс строки с заголовками
     * @private
     * @param {Array} grid - Матрица таблицы
     * @returns {number} Индекс строки или -1
     */
    _findHeaderRowIndex(grid) {
        return grid.findIndex(row => row.some(cell => cell.isHeader === true));
    },

    /**
     * Проверяет наличие пустых заголовков
     * @private
     * @param {Array} headerRow - Строка заголовков
     * @returns {boolean} Есть ли пустые заголовки
     */
    _hasEmptyHeaders(headerRow) {
        return headerRow.some(cell =>
            !cell.isSpanned &&
            cell.isHeader &&
            (!cell.content || !cell.content.trim())
        );
    },

    /**
     * Проверяет наличие данных в строках
     * @private
     * @param {Array} grid - Матрица таблицы
     * @param {number} startIndex - Индекс начала данных
     * @returns {boolean} Есть ли данные
     */
    _hasDataInRows(grid, startIndex) {
        for (let i = startIndex; i < grid.length; i++) {
            for (const cell of grid[i]) {
                if (!cell.isSpanned && cell.content?.trim()) {
                    return true;
                }
            }
        }
        return false;
    },

    /**
     * Получает название таблицы из дерева
     * @private
     * @param {string} tableId - ID таблицы
     * @returns {string} Название таблицы
     */
    _getTableName(tableId) {
        const foundNode = this._findNodeByTableId(AppState.treeData, tableId);
        return foundNode?.label || `Таблица ${tableId}`;
    },

    /**
     * Рекурсивно ищет узел таблицы в дереве
     * @private
     * @param {Object} node - Узел для поиска
     * @param {string} tableId - ID таблицы
     * @returns {Object|null} Найденный узел или null
     */
    _findNodeByTableId(node, tableId) {
        if (!node) return null;

        if (node.tableId === tableId) return node;

        if (node.children?.length) {
            for (const child of node.children) {
                const found = this._findNodeByTableId(child, tableId);
                if (found) return found;
            }
        }

        return null;
    }
};