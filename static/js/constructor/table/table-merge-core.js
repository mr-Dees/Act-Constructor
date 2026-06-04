/**
 * Чистое ядро операций объединения/разъединения ячеек таблицы.
 *
 * Работает на dense-grid (двумерный массив ячеек) и возвращает НОВУЮ сетку —
 * без DOM и без AppState. Хранимый формат ячейки НЕ меняется (см.
 * table-cells-operations.js и grid-merges.js):
 *   - ведущая ячейка несёт colSpan/rowSpan;
 *   - поглощённая — {isSpanned:true, spanOrigin:{row,col}};
 *   - одиночная/восстановленная — content/isHeader/colSpan/rowSpan/originRow/originCol.
 *
 * Эти функции — основа merge/unmerge/auto-unmerge в TableCellsOperations.
 * Реализованы поверх range-list ядра (grid-merges.js): прямоугольник
 * добавляется/убирается из набора объединений, затем сетка перестраивается.
 */
import { gridToMerges, applyMergesToGrid } from './grid-merges.js';

/**
 * Глубокая копия dense-сетки (ячейки — плоские объекты).
 * @param {Object[][]} grid
 * @returns {Object[][]}
 */
function cloneGrid(grid) {
    return grid.map((row) => row.map((cell) => ({ ...cell })));
}

/**
 * Объединяет прямоугольную область (minRow,minCol)-(maxRow,maxCol) в одну
 * ячейку. Ведущая ячейка склеивает непустой content всех ячеек области через
 * пробел и получает colSpan/rowSpan; поглощённые ячейки заменяются на
 * {isSpanned:true, spanOrigin:{row,col}}.
 *
 * Семантика идентична TableCellsOperations.mergeCells (без DOM/уведомлений).
 * Валидацию прямоугольника/типов выполняет вызывающий код.
 *
 * @param {Object[][]} grid Исходная сетка (не мутируется).
 * @param {number} minRow
 * @param {number} minCol
 * @param {number} maxRow
 * @param {number} maxCol
 * @returns {Object[][]} Новая сетка с объединением.
 */
export function mergeRange(grid, minRow, minCol, maxRow, maxCol) {
    const next = cloneGrid(grid);

    const rowspan = maxRow - minRow + 1;
    const colspan = maxCol - minCol + 1;

    // Склейка содержимого области (непустые через пробел).
    const parts = [];
    for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
            const content = next[r][c].content;
            if (content && content.trim()) parts.push(content);
        }
    }

    const origin = next[minRow][minCol];
    origin.content = parts.join(' ');
    origin.colSpan = colspan;
    origin.rowSpan = rowspan;

    for (let r = minRow; r <= maxRow; r++) {
        for (let c = minCol; c <= maxCol; c++) {
            if (r === minRow && c === minCol) continue;
            next[r][c] = { isSpanned: true, spanOrigin: { row: minRow, col: minCol } };
        }
    }

    return next;
}

/**
 * Разъединяет объединение, заданное координатами ведущей ячейки. Ведущая
 * ячейка сбрасывает colSpan/rowSpan в 1 (content/isHeader сохраняет); на месте
 * поглощённых создаются пустые ячейки, наследующие isHeader ведущей.
 *
 * Семантика идентична TableCellsOperations._unmergeAtOrigin.
 *
 * @param {Object[][]} grid Исходная сетка (не мутируется).
 * @param {number} row Строка ведущей ячейки.
 * @param {number} col Колонка ведущей ячейки.
 * @returns {Object[][]} Новая сетка без этого объединения.
 */
export function unmergeAt(grid, row, col) {
    const next = cloneGrid(grid);
    const cellData = next[row][col];
    const rowspan = cellData.rowSpan || 1;
    const colspan = cellData.colSpan || 1;
    const isHeaderCell = cellData.isHeader || false;

    for (let r = row; r < row + rowspan; r++) {
        for (let c = col; c < col + colspan; c++) {
            if (!next[r] || !next[r][c]) continue;
            if (r === row && c === col) {
                next[r][c].colSpan = 1;
                next[r][c].rowSpan = 1;
            } else {
                next[r][c] = {
                    content: '',
                    isHeader: isHeaderCell,
                    colSpan: 1,
                    rowSpan: 1,
                    originRow: r,
                    originCol: c,
                };
            }
        }
    }

    return next;
}

/**
 * Перед удалением строки разъединяет все объединения, чьи прямоугольники
 * покрывают эту строку: origin внутри строки ИЛИ объединение из строк выше,
 * доходящее до неё. Возвращает новую сетку.
 *
 * Семантика идентична TableCellsOperations._autoUnmergeRow, но устойчива к
 * поглощённым ячейкам без originRow/originCol: покрывающие объединения
 * определяются по range-list всей сетки (а не по полям поглощённой ячейки).
 *
 * @param {Object[][]} grid Исходная сетка (не мутируется).
 * @param {number} rowIndex Индекс удаляемой строки.
 * @returns {Object[][]} Новая сетка с разъединёнными покрывающими объединениями.
 */
export function autoUnmergeRow(grid, rowIndex) {
    // Объединения, чей прямоугольник пересекает целевую строку.
    const covering = gridToMerges(grid).filter(
        (m) => m.row <= rowIndex && rowIndex <= m.row + m.rowspan - 1,
    );

    let next = grid;
    for (const m of covering) {
        next = unmergeAt(next, m.row, m.col);
    }
    return next;
}

// Дублируем в window ради inline-скриптов в шаблонах (см. CLAUDE.md).
// Guard: модуль также импортируется в node:test, где window отсутствует.
if (typeof window !== 'undefined') {
    window.mergeRange = mergeRange;
    window.unmergeAt = unmergeAt;
    window.autoUnmergeRow = autoUnmergeRow;
}
