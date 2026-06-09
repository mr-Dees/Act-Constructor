/**
 * Чистое ядро range-list объединений ячеек таблицы.
 *
 * Range-list — массив прямоугольников `{row, col, rowspan, colspan}` (ведущая
 * ячейка = верхний левый угол; поглощённые в список НЕ входят). Это ВНУТРЕННЕЕ
 * представление для корректного merge/unmerge и единого обхода span'ов; оно
 * НИКОГДА не сохраняется в `table.grid`.
 *
 * Хранимый dense-формат ячейки НЕ меняется:
 *   - ведущая ячейка несёт `colSpan`/`rowSpan` (>1),
 *   - поглощённая — `isSpanned:true` + `spanOrigin:{row,col}` + `originRow`/`originCol`,
 *   - не объединённая — `colSpan:1, rowSpan:1, isSpanned:false, spanOrigin:null`.
 *
 * Все функции чистые (без DOM) и не мутируют входную сетку: возвращают новую.
 */

/**
 * Извлекает range-list объединений из dense-сетки.
 *
 * Прямоугольник создаётся для каждой ведущей ячейки (не `isSpanned`) с
 * `colSpan>1` или `rowSpan>1`. Обход построчный слева направо — порядок
 * детерминирован.
 *
 * @param {Object[][]} grid Dense-сетка ячеек.
 * @returns {{row:number,col:number,rowspan:number,colspan:number}[]} Range-list.
 */
export function gridToMerges(grid) {
    const merges = [];
    for (let r = 0; r < grid.length; r++) {
        const row = grid[r];
        for (let c = 0; c < row.length; c++) {
            const cell = row[c];
            if (cell.isSpanned) continue;
            const rowspan = cell.rowSpan || 1;
            const colspan = cell.colSpan || 1;
            if (rowspan > 1 || colspan > 1) {
                merges.push({ row: r, col: c, rowspan, colspan });
            }
        }
    }
    return merges;
}

/**
 * Применяет range-list к dense-сетке, возвращая НОВУЮ сетку того же хранимого
 * формата.
 *
 * Для каждой ведущей ячейки объединения выставляются `colSpan`/`rowSpan`;
 * поглощённые ячейки помечаются `isSpanned:true` + `spanOrigin` + `originRow/Col`
 * (их `content`/`isHeader` сохраняются). Все ячейки вне объединений
 * сбрасываются в синглтоны (`colSpan:1, rowSpan:1, isSpanned:false,
 * spanOrigin:null`). Координаты `originRow`/`originCol` выставляются по позиции
 * в сетке.
 *
 * @param {Object[][]} grid Исходная dense-сетка (не мутируется).
 * @param {{row:number,col:number,rowspan:number,colspan:number}[]} merges Range-list.
 * @returns {Object[][]} Новая dense-сетка.
 */
export function applyMergesToGrid(grid, merges) {
    // Карта: "r:c" поглощённой ячейки → ведущая {row,col}.
    const absorbedBy = new Map();
    // Множество ведущих координат с их span'ами.
    const originSpan = new Map();

    for (const m of merges) {
        const rowspan = m.rowspan || 1;
        const colspan = m.colspan || 1;
        if (rowspan <= 1 && colspan <= 1) continue;
        originSpan.set(`${m.row}:${m.col}`, { rowspan, colspan });
        for (let r = m.row; r < m.row + rowspan; r++) {
            for (let c = m.col; c < m.col + colspan; c++) {
                if (r === m.row && c === m.col) continue;
                absorbedBy.set(`${r}:${c}`, { row: m.row, col: m.col });
            }
        }
    }

    return grid.map((row, r) =>
        row.map((cell, c) => {
            const key = `${r}:${c}`;
            const span = originSpan.get(key);
            const absorbed = absorbedBy.get(key);

            if (absorbed) {
                // Поглощённая ячейка: content/isHeader сохраняем, span-поля задаём.
                // Хранимый формат поглощённой ячейки несёт isSpanned + spanOrigin.
                const next = {
                    ...cell,
                    colSpan: 1,
                    rowSpan: 1,
                    isSpanned: true,
                    spanOrigin: { row: absorbed.row, col: absorbed.col },
                    originRow: r,
                    originCol: c,
                };
                return next;
            }

            // Ведущая ячейка объединения или одиночная ячейка. В обоих случаях
            // хранимый формат — БЕЗ isSpanned/spanOrigin (синглтоны и ведущие
            // ячейки их не несут; pydantic-дефолты isSpanned=False/spanOrigin=None
            // эквивалентны их отсутствию). Чистим возможные «висячие» span-метки.
            const next = {
                ...cell,
                colSpan: span ? span.colspan : 1,
                rowSpan: span ? span.rowspan : 1,
                originRow: r,
                originCol: c,
            };
            delete next.isSpanned;
            delete next.spanOrigin;
            return next;
        }),
    );
}

/**
 * Проверяет целостность dense-сетки.
 *
 * Проверяет:
 *   - прямоугольность (все строки одной длины);
 *   - каждый прямоугольник объединения в границах сетки;
 *   - объединения не пересекаются;
 *   - каждая поглощённая ячейка покрыта реальным объединением, чей
 *     `spanOrigin` ведёт на ведущую ячейку, действительно её покрывающую;
 *   - нет «висячих» `isSpanned` без покрывающего объединения.
 *
 * @param {Object[][]} grid Dense-сетка.
 * @returns {{valid:boolean, errors:string[]}} Результат с сообщениями (рус.).
 */
export function validateGrid(grid) {
    const errors = [];

    if (!Array.isArray(grid) || grid.length === 0) {
        return { valid: true, errors: [] };
    }

    // 1. Прямоугольность.
    const width = grid[0].length;
    let rectangular = true;
    for (let r = 0; r < grid.length; r++) {
        if (grid[r].length !== width) {
            rectangular = false;
            errors.push(
                `Строка ${r} имеет длину ${grid[r].length}, ожидалось ${width} (сетка не прямоугольная)`,
            );
        }
    }
    if (!rectangular) {
        // Дальнейшие индексные проверки небезопасны на рваной сетке.
        return { valid: false, errors };
    }

    const rows = grid.length;
    const cols = width;

    // Карта покрытия: для каждой ячейки — ведущая координата объединения,
    // её покрывающего (или null). Используется для проверки пересечений.
    const coverage = Array.from({ length: rows }, () => new Array(cols).fill(null));

    const merges = gridToMerges(grid);

    // 2. Границы + 3. Пересечения.
    for (const m of merges) {
        const endRow = m.row + m.rowspan - 1;
        const endCol = m.col + m.colspan - 1;
        if (endRow >= rows || endCol >= cols) {
            errors.push(
                `Объединение в (${m.row},${m.col}) ${m.rowspan}×${m.colspan} выходит за границы сетки ${rows}×${cols}`,
            );
            continue;
        }
        for (let r = m.row; r <= endRow; r++) {
            for (let c = m.col; c <= endCol; c++) {
                if (coverage[r][c] !== null) {
                    errors.push(
                        `Объединения пересекаются в ячейке (${r},${c}): (${m.row},${m.col}) и (${coverage[r][c].row},${coverage[r][c].col})`,
                    );
                } else {
                    coverage[r][c] = { row: m.row, col: m.col };
                }
            }
        }
    }

    // 4 + 5. Поглощённые ячейки: spanOrigin ведёт на реальную ведущую, которая
    // её покрывает; нет «висячих» isSpanned.
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            const cell = grid[r][c];
            if (!cell.isSpanned) continue;

            const cover = coverage[r][c];
            if (!cover) {
                errors.push(
                    `Ячейка (${r},${c}) помечена isSpanned, но не покрыта ни одним объединением (висячий isSpanned)`,
                );
                continue;
            }
            const so = cell.spanOrigin;
            if (!so || so.row !== cover.row || so.col !== cover.col) {
                errors.push(
                    `spanOrigin ячейки (${r},${c}) указывает на (${so ? so.row : '∅'},${so ? so.col : '∅'}), а покрывающее объединение ведёт из (${cover.row},${cover.col})`,
                );
            }
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Региональная проверка целостности dense-сетки.
 *
 * В отличие от `validateGrid` (глобальная строгая проверка), валидирует только
 * окрестность локальной операции: всегда дёшево проверяет глобальную
 * прямоугольность (равная длина строк), а правила границ/пересечений/spanOrigin
 * применяет ТОЛЬКО к объединениям, чьи прямоугольники пересекают регион
 * `[minRow..maxRow] × [minCol..maxCol]`. Так локальный merge/unmerge не зависит
 * от устаревшего spanOrigin-мусора в других частях таблицы (например, инертного
 * stale spanOrigin после in-place вставки/удаления строк/колонок).
 *
 * Объединение «пересекает регион», если его прямоугольник перекрывается с
 * регионом хотя бы одной ячейкой. Поглощённые ячейки проверяются только внутри
 * региона; покрывающее их объединение по определению пересекает регион.
 *
 * @param {Object[][]} grid Dense-сетка.
 * @param {number} minRow Верхняя граница региона (включительно).
 * @param {number} minCol Левая граница региона (включительно).
 * @param {number} maxRow Нижняя граница региона (включительно).
 * @param {number} maxCol Правая граница региона (включительно).
 * @returns {{valid:boolean, errors:string[]}} Результат с сообщениями (рус.).
 */
export function validateGridRegion(grid, minRow, minCol, maxRow, maxCol) {
    const errors = [];

    if (!Array.isArray(grid) || grid.length === 0) {
        return { valid: true, errors: [] };
    }

    // 1. Прямоугольность — всегда глобально и дёшево.
    const width = grid[0].length;
    let rectangular = true;
    for (let r = 0; r < grid.length; r++) {
        if (grid[r].length !== width) {
            rectangular = false;
            errors.push(
                `Строка ${r} имеет длину ${grid[r].length}, ожидалось ${width} (сетка не прямоугольная)`,
            );
        }
    }
    if (!rectangular) {
        // Дальнейшие индексные проверки небезопасны на рваной сетке.
        return { valid: false, errors };
    }

    const rows = grid.length;
    const cols = width;

    // Объединения, чьи прямоугольники пересекают регион. Остальные (вместе с их
    // возможным устаревшим spanOrigin) игнорируем — они вне зоны операции.
    const intersecting = gridToMerges(grid).filter((m) => {
        const endRow = m.row + m.rowspan - 1;
        const endCol = m.col + m.colspan - 1;
        return (
            m.row <= maxRow && endRow >= minRow && m.col <= maxCol && endCol >= minCol
        );
    });

    const coverage = Array.from({ length: rows }, () => new Array(cols).fill(null));

    // 2. Границы + 3. Пересечения — только по пересекающим регион объединениям.
    for (const m of intersecting) {
        const endRow = m.row + m.rowspan - 1;
        const endCol = m.col + m.colspan - 1;
        if (endRow >= rows || endCol >= cols) {
            errors.push(
                `Объединение в (${m.row},${m.col}) ${m.rowspan}×${m.colspan} выходит за границы сетки ${rows}×${cols}`,
            );
            continue;
        }
        for (let r = m.row; r <= endRow; r++) {
            for (let c = m.col; c <= endCol; c++) {
                if (coverage[r][c] !== null) {
                    errors.push(
                        `Объединения пересекаются в ячейке (${r},${c}): (${m.row},${m.col}) и (${coverage[r][c].row},${coverage[r][c].col})`,
                    );
                } else {
                    coverage[r][c] = { row: m.row, col: m.col };
                }
            }
        }
    }

    // 4 + 5. Поглощённые ячейки — только ВНУТРИ региона (покрывающее их
    // объединение по определению пересекает регион).
    const r0 = Math.max(0, minRow);
    const r1 = Math.min(rows - 1, maxRow);
    const c0 = Math.max(0, minCol);
    const c1 = Math.min(cols - 1, maxCol);
    for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
            const cell = grid[r][c];
            if (!cell.isSpanned) continue;

            const cover = coverage[r][c];
            if (!cover) {
                errors.push(
                    `Ячейка (${r},${c}) помечена isSpanned, но не покрыта ни одним объединением (висячий isSpanned)`,
                );
                continue;
            }
            const so = cell.spanOrigin;
            if (!so || so.row !== cover.row || so.col !== cover.col) {
                errors.push(
                    `spanOrigin ячейки (${r},${c}) указывает на (${so ? so.row : '∅'},${so ? so.col : '∅'}), а покрывающее объединение ведёт из (${cover.row},${cover.col})`,
                );
            }
        }
    }

    return { valid: errors.length === 0, errors };
}

/**
 * Единый обход видимых (не поглощённых) ячеек сетки — общий «skip isSpanned»
 * для всех рендереров. Колбэк получает `(cell, r, c)` для каждой не-`isSpanned`
 * ячейки.
 *
 * @param {Object[][]} grid Dense-сетка.
 * @param {(cell:Object, r:number, c:number) => void} cb Колбэк на видимую ячейку.
 */
export function iterateVisibleCells(grid, cb) {
    for (let r = 0; r < grid.length; r++) {
        const row = grid[r];
        for (let c = 0; c < row.length; c++) {
            const cell = row[c];
            if (cell.isSpanned) continue;
            cb(cell, r, c);
        }
    }
}

// Дублируем в window ради inline-скриптов в шаблонах (см. CLAUDE.md).
// Guard: модуль также импортируется в node:test, где window отсутствует.
if (typeof window !== 'undefined') {
    window.gridToMerges = gridToMerges;
    window.applyMergesToGrid = applyMergesToGrid;
    window.validateGrid = validateGrid;
    window.iterateVisibleCells = iterateVisibleCells;
}
