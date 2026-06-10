/**
 * Write-through ввода в ячейку таблицы (M.26).
 *
 * Значение из textarea редактируемой ячейки пишется в
 * tables[tableId].grid[row][col].content на каждый input, а не только на
 * blur/Enter. Состояние — единственный источник истины: чтения DOM перед
 * сохранением больше нет.
 *
 * Отмена редактирования (Escape) откатывает состояние к значению на момент
 * первого ввода сессии. Ключ сессии — элемент textarea (в проде хранилище
 * исходников — WeakMap, в тестах подойдёт обычный Map).
 */

/**
 * Возвращает редактируемую (не поглощённую объединением) ячейку грида
 * по координатам или null, если координаты невалидны.
 * @param {Object} tables - Словарь таблиц (AppState.tables)
 * @param {string} tableId - ID таблицы
 * @param {number} row - Индекс строки
 * @param {number} col - Индекс колонки
 * @returns {Object|null}
 */
function getEditableCell(tables, tableId, row, col) {
    const cell = tables?.[tableId]?.grid?.[row]?.[col];
    return cell && !cell.isSpanned ? cell : null;
}

/**
 * Пишет значение ввода в ячейку состояния. При первом вводе сессии запоминает
 * исходное значение ячейки для возможного отката по Escape.
 * @param {Object} tables - Словарь таблиц (AppState.tables)
 * @param {string} tableId - ID таблицы
 * @param {number} row - Индекс строки
 * @param {number} col - Индекс колонки
 * @param {string} value - Текущее значение textarea
 * @param {WeakMap|Map} originals - Хранилище исходных значений сессий
 * @param {Object} sessionKey - Ключ сессии редактирования (элемент textarea)
 * @returns {boolean} true, если запись в состояние выполнена
 */
export function applyCellInput(tables, tableId, row, col, value, originals, sessionKey) {
    const cell = getEditableCell(tables, tableId, row, col);
    if (!cell) return false;
    if (!originals.has(sessionKey)) {
        originals.set(sessionKey, cell.content);
    }
    cell.content = value;
    return true;
}

/**
 * Откатывает отменённое редактирование (Escape): восстанавливает исходное
 * значение сессии в состоянии и забывает сессию.
 * @param {Object} tables - Словарь таблиц (AppState.tables)
 * @param {string} tableId - ID таблицы
 * @param {number} row - Индекс строки
 * @param {number} col - Индекс колонки
 * @param {WeakMap|Map} originals - Хранилище исходных значений сессий
 * @param {Object} sessionKey - Ключ сессии редактирования (элемент textarea)
 * @returns {boolean} true, если откат выполнен
 */
export function cancelCellInput(tables, tableId, row, col, originals, sessionKey) {
    if (!originals.has(sessionKey)) return false;
    const original = originals.get(sessionKey);
    originals.delete(sessionKey);
    const cell = getEditableCell(tables, tableId, row, col);
    if (!cell) return false;
    cell.content = original;
    return true;
}
