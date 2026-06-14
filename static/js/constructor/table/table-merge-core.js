/**
 * Чистое ядро операций объединения/разъединения ячеек таблицы.
 *
 * Работает на dense-grid (двумерный массив ячеек) и возвращает НОВУЮ сетку —
 * без DOM и без AppState. Хранимый формат ячейки НЕ меняется (см.
 * table-cells-operations.js и grid-merges.js):
 *   - ведущая ячейка несёт colSpan/rowSpan (+ runtime-поле mergeSnapshot
 *     с содержимым области до merge — НЕ сериализуется, см. mergeRange);
 *   - поглощённая — {isSpanned:true, spanOrigin:{row,col}};
 *   - одиночная/восстановленная — content/isHeader/colSpan/rowSpan/originRow/originCol.
 *
 * Эти функции — основа merge/unmerge в TableCellsOperations. Работают
 * напрямую на dense-grid (клон → правка span'ов → новая сетка).
 */

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
 * Ведущая ячейка дополнительно получает `mergeSnapshot` — снапшот содержимого
 * области до объединения для восстановления при unmerge. Это runtime-состояние
 * UI: живёт в модели таблицы (переживает перерендер), но НЕ сериализуется —
 * `_serializeTables` (state-core.js) перечисляет поля ячейки явно, поэтому
 * снапшот не попадает в PUT-payload, на бэк и в DOCX.
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

    // Склейка содержимого области (непустые через пробел) и параллельно —
    // пер-ячеечный снапшот для восстановления при unmerge.
    const parts = [];
    const contents = [];
    for (let r = minRow; r <= maxRow; r++) {
        const rowContents = [];
        for (let c = minCol; c <= maxCol; c++) {
            const content = next[r][c].content;
            rowContents.push(content || '');
            if (content && content.trim()) parts.push(content);
        }
        contents.push(rowContents);
    }

    const origin = next[minRow][minCol];
    origin.content = parts.join(' ');
    origin.colSpan = colspan;
    origin.rowSpan = rowspan;
    if (rowspan > 1 || colspan > 1) {
        origin.mergeSnapshot = { joined: origin.content, contents };
    }

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
 * ячейка сбрасывает colSpan/rowSpan в 1; на месте поглощённых создаются
 * ячейки, наследующие isHeader ведущей.
 *
 * Если ведущая ячейка несёт `mergeSnapshot` (объединение сделано в этой
 * сессии) и её склеенный content не редактировался после merge — содержимое
 * всех ячеек области восстанавливается из снапшота. Если content правили
 * после объединения, раскладка снапшота продублировала бы уже переписанный
 * текст — тогда ведущая сохраняет текущий content, поглощённые пустеют
 * (прежнее поведение). Снапшот в любом случае снимается.
 *
 * Семантика идентична разъединению в TableCellsOperations.unmergeCells.
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

    const snapshot = cellData.mergeSnapshot;
    const canRestore = Boolean(
        snapshot &&
        Array.isArray(snapshot.contents) &&
        (cellData.content || '') === (snapshot.joined || ''),
    );

    for (let r = row; r < row + rowspan; r++) {
        for (let c = col; c < col + colspan; c++) {
            if (!next[r] || !next[r][c]) continue;
            if (r === row && c === col) {
                next[r][c].colSpan = 1;
                next[r][c].rowSpan = 1;
                if (canRestore) {
                    next[r][c].content = snapshot.contents[0]?.[0] ?? '';
                }
                delete next[r][c].mergeSnapshot;
            } else {
                next[r][c] = {
                    content: canRestore ? (snapshot.contents[r - row]?.[c - col] ?? '') : '',
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

// Дублируем в window ради inline-скриптов в шаблонах (см. CLAUDE.md).
// Guard: модуль также импортируется в node:test, где window отсутствует.
if (typeof window !== 'undefined') {
    window.mergeRange = mergeRange;
    window.unmergeAt = unmergeAt;
}
