/**
 * Валидация таблиц
 *
 * Проверяет заполненность заголовков, наличие строк данных,
 * корректность структуры таблиц.
 */
import { AppState } from '../state/state-core.js';
import { TreeUtils } from '../tree/tree-utils.js';
import { ValidationCore } from './validation-core.js';
import { hasEmptyHeaders, hasDataRows, countHeaderRows } from './validation-table-core.js';

export const ValidationTable = {
    /**
     * Проверяет заполненность и наличие заголовков всех таблиц.
     *
     * Блокирующая контентная проверка: ловит таблицы с пустыми ячейками шапки
     * И таблицы вовсе без строки заголовка (E6). Подсчёт шапки — через чистое
     * ядро (учитывает многострочную шапку).
     *
     * @returns {Object} Результат валидации с полями valid, message, isWarning
     */
    validateHeaders() {
        const emptyHeaders = [];
        const noHeaderTables = [];

        for (const tableId in AppState.tables) {
            const table = AppState.tables[tableId];

            if (!this._hasValidGrid(table)) continue;

            const tableName = this._getTableName(tableId);

            // E6: таблица без единой строки заголовка.
            if (countHeaderRows(table.grid) === 0) {
                noHeaderTables.push(`- ${tableName}`);
                continue;
            }

            if (hasEmptyHeaders(table.grid)) {
                emptyHeaders.push(`- ${tableName}`);
            }
        }

        const parts = [];
        if (noHeaderTables.length > 0) {
            parts.push(`Таблицы без строки заголовка:\n${noHeaderTables.join('\n')}`);
        }
        if (emptyHeaders.length > 0) {
            parts.push(`Не заполнены заголовки таблиц:\n${emptyHeaders.join('\n')}`);
        }

        if (parts.length > 0) {
            const message = `${parts.join('\n')}\nЗаполните заголовки таблиц перед экспортом.`;
            return ValidationCore.failure(message);
        }

        return ValidationCore.success();
    },

    /**
     * Проверяет наличие данных в таблицах.
     *
     * Учитывает многострочную шапку (E5): данными считается всё ниже всех
     * подряд идущих сверху строк-заголовков, поэтому вторая строка двухстрочной
     * шапки больше не засчитывается как данные.
     *
     * @returns {Object} Результат проверки (предупреждение)
     */
    validateData() {
        const emptyDataTables = [];

        for (const tableId in AppState.tables) {
            const table = AppState.tables[tableId];

            if (!this._hasValidGrid(table)) continue;

            if (!hasDataRows(table.grid)) {
                const tableName = this._getTableName(tableId);
                emptyDataTables.push(`- ${tableName}`);
            }
        }

        if (emptyDataTables.length > 0) {
            const message = `⚠️ Найдены таблицы без данных:\n${emptyDataTables.join('\n')}\nВы можете продолжить сохранение.`;
            return ValidationCore.warning(message);
        }

        return ValidationCore.success();
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
     * Получает название таблицы из дерева
     * @private
     * @param {string} tableId - ID таблицы
     * @returns {string} Название таблицы
     */
    _getTableName(tableId) {
        const node = TreeUtils.findNodeByTableId(tableId);
        return node?.label || `Таблица ${tableId}`;
    }
};

// Window-globals для совместимости с inline-скриптами в шаблонах.
window.ValidationTable = ValidationTable;
