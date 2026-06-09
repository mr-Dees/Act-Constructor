/**
 * Тесты ROOT-фикса сдвига spanOrigin в структурных операциях с ячейками.
 *
 * Проверяют, что при insert/delete колонки/строки ПЕРЕД ведущей ячейкой
 * объединения spanOrigin поглощённых ячеек сдвигается синхронно — и итоговая
 * сетка проходит validateGrid (полная согласованность). Покрыты ДВА формата
 * поглощённой ячейки:
 *   - 2-полевой user-merge: РОВНО {isSpanned:true, spanOrigin:{row,col}} —
 *     именно его генерит mergeRange при ручном объединении; КРИТИЧНО, потому что
 *     у такой ячейки НЕТ originCol/originRow, и гейт сдвига обязан опираться
 *     только на {isSpanned, spanOrigin};
 *   - 8-полевой metrics: ячейка со всеми производными полями (как в state-content).
 *
 * Реплики операций (inPlace*) зеркалят TableCellsOperations: splice + правка
 * originRow/originCol/colSpan/rowSpan ведущих + ROOT-сдвиг spanOrigin
 * поглощённых. DOM/AppState не нужны.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCell } from './_setup.mjs';
import { validateGrid } from '../../static/js/constructor/table/grid-merges.js';

// ──────────────────────────────────────────────────────────────────────────
// Реплики структурных операций (зеркало прод-арифметики, включая ROOT-сдвиг).
// ──────────────────────────────────────────────────────────────────────────

function inPlaceInsertColumn(grid, colIndex) {
  for (let r = 0; r < grid.length; r++) {
    grid[r].splice(colIndex, 0, makeCell({ originRow: r, originCol: colIndex }));
  }
  for (let r = 0; r < grid.length; r++) {
    for (let c = colIndex + 1; c < grid[r].length; c++) {
      if (grid[r][c].originCol !== undefined) grid[r][c].originCol = c;
    }
  }
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < colIndex; c++) {
      const cd = grid[r][c];
      if (!cd.isSpanned) {
        const end = c + (cd.colSpan || 1);
        if (end > colIndex) cd.colSpan = (cd.colSpan || 1) + 1;
      }
    }
  }
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const cd = grid[r][c];
      if (cd.isSpanned && cd.spanOrigin && cd.spanOrigin.col >= colIndex) {
        cd.spanOrigin.col += 1;
      }
    }
  }
  return grid;
}

function inPlaceDeleteColumn(grid, colIndex) {
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < colIndex; c++) {
      const cd = grid[r][c];
      if (!cd.isSpanned) {
        const end = c + (cd.colSpan || 1);
        if (end > colIndex) cd.colSpan = Math.max(1, (cd.colSpan || 1) - 1);
      }
    }
  }
  for (let r = 0; r < grid.length; r++) grid[r].splice(colIndex, 1);
  for (let r = 0; r < grid.length; r++) {
    for (let c = colIndex; c < grid[r].length; c++) {
      if (grid[r][c].originCol !== undefined) grid[r][c].originCol = c;
    }
  }
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const cd = grid[r][c];
      if (cd.isSpanned && cd.spanOrigin && cd.spanOrigin.col > colIndex) {
        cd.spanOrigin.col -= 1;
      }
    }
  }
  return grid;
}

function inPlaceInsertRow(grid, rowIndex) {
  const numCols = grid[0].length;
  const newRow = [];
  for (let c = 0; c < numCols; c++) newRow.push(makeCell({ originRow: rowIndex, originCol: c }));
  grid.splice(rowIndex, 0, newRow);
  for (let r = rowIndex + 1; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c].originRow !== undefined) grid[r][c].originRow = r;
    }
  }
  for (let r = 0; r < rowIndex; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const cd = grid[r][c];
      if (!cd.isSpanned) {
        const end = r + (cd.rowSpan || 1);
        if (end > rowIndex) cd.rowSpan = (cd.rowSpan || 1) + 1;
      }
    }
  }
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const cd = grid[r][c];
      if (cd.isSpanned && cd.spanOrigin && cd.spanOrigin.row >= rowIndex) {
        cd.spanOrigin.row += 1;
      }
    }
  }
  return grid;
}

function inPlaceDeleteRow(grid, rowIndex) {
  for (let r = 0; r < rowIndex; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const cd = grid[r][c];
      if (!cd.isSpanned) {
        const end = r + (cd.rowSpan || 1);
        if (end > rowIndex) cd.rowSpan = Math.max(1, (cd.rowSpan || 1) - 1);
      }
    }
  }
  grid.splice(rowIndex, 1);
  for (let r = rowIndex; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c].originRow !== undefined) grid[r][c].originRow = r;
    }
  }
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      const cd = grid[r][c];
      if (cd.isSpanned && cd.spanOrigin && cd.spanOrigin.row > rowIndex) {
        cd.spanOrigin.row -= 1;
      }
    }
  }
  return grid;
}

// ──────────────────────────────────────────────────────────────────────────
// Фикстуры.
// ──────────────────────────────────────────────────────────────────────────

/**
 * 3×3-сетка с 2-ПОЛЕВЫМ user-merge: ведущая (1,1) объединена с (1,2) по
 * горизонтали (colSpan=2). Поглощённая (1,2) — РОВНО {isSpanned, spanOrigin},
 * как после mergeRange. Остальные ячейки — обычные синглтоны makeCell.
 */
function gridUserMerge() {
  const g = [0, 1, 2].map((r) =>
    [0, 1, 2].map((c) => makeCell({ content: `${r}${c}`, originRow: r, originCol: c })),
  );
  g[1][1].colSpan = 2;
  g[1][2] = { isSpanned: true, spanOrigin: { row: 1, col: 1 } };
  return g;
}

/**
 * 3×2-сетка с 2-полевым ВЕРТИКАЛЬНЫМ user-merge: ведущая (1,1) объединена с (2,1).
 */
function gridUserMergeV() {
  const g = [0, 1, 2].map((r) =>
    [0, 1].map((c) => makeCell({ content: `${r}${c}`, originRow: r, originCol: c })),
  );
  g[1][1].rowSpan = 2;
  g[2][1] = { isSpanned: true, spanOrigin: { row: 1, col: 1 } };
  return g;
}

/**
 * Metrics-подобная 2×4-шапка с 8-полевыми поглощёнными ячейками (как
 * state-content.js): «Код метрики» (rowSpan=2), «Кол-во» (colSpan=2), «Сумма»
 * (rowSpan=2). Поглощённые несут полный набор производных полей.
 */
function gridMetrics() {
  return [
    [
      { content: 'Код метрики', isHeader: true, colSpan: 1, rowSpan: 2, originRow: 0, originCol: 0 },
      { content: 'Кол-во, ед.', isHeader: true, colSpan: 2, rowSpan: 1, originRow: 0, originCol: 1 },
      { content: '', isHeader: true, colSpan: 1, rowSpan: 1, isSpanned: true, spanOrigin: { row: 0, col: 1 }, originRow: 0, originCol: 2 },
      { content: 'Сумма, руб.', isHeader: true, colSpan: 1, rowSpan: 2, originRow: 0, originCol: 3 },
    ],
    [
      { content: '', isHeader: true, colSpan: 1, rowSpan: 1, isSpanned: true, spanOrigin: { row: 0, col: 0 }, originRow: 1, originCol: 0 },
      { content: 'ФЛ', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 1 },
      { content: 'ЮЛ', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 2 },
      { content: '', isHeader: true, colSpan: 1, rowSpan: 1, isSpanned: true, spanOrigin: { row: 0, col: 3 }, originRow: 1, originCol: 3 },
    ],
  ];
}

// ──────────────────────────────────────────────────────────────────────────
// 2-полевой user-merge — insert/delete не ломают согласованность spanOrigin.
// ──────────────────────────────────────────────────────────────────────────

test('user-merge: insertColumn ПЕРЕД ведущей сдвигает 2-полевой spanOrigin → сетка валидна', () => {
  const grid = inPlaceInsertColumn(gridUserMerge(), 0); // вставка перед origin (col 1)
  assert.equal(validateGrid(grid).valid, true, JSON.stringify(validateGrid(grid).errors));
  // Ведущая (1,2), поглощённая (1,3) с обновлённым spanOrigin.
  assert.equal(grid[1][2].colSpan, 2);
  assert.equal(grid[1][3].isSpanned, true);
  assert.deepEqual(grid[1][3].spanOrigin, { row: 1, col: 2 });
});

test('user-merge: insertColumn ПОСЛЕ объединения не трогает spanOrigin → сетка валидна', () => {
  const grid = inPlaceInsertColumn(gridUserMerge(), 3); // вставка справа от объединения
  assert.equal(validateGrid(grid).valid, true);
  // Объединение на месте: ведущая (1,1), поглощённая (1,2) spanOrigin {1,1}.
  assert.deepEqual(grid[1][2].spanOrigin, { row: 1, col: 1 });
});

test('user-merge: deleteColumn ПЕРЕД ведущей сдвигает 2-полевой spanOrigin → сетка валидна', () => {
  const grid = inPlaceDeleteColumn(gridUserMerge(), 0); // удаление колонки 0 (без объединений в ней)
  assert.equal(validateGrid(grid).valid, true);
  // Ведущая сдвинулась на (1,0), поглощённая (1,1) spanOrigin {1,0}.
  assert.equal(grid[1][0].colSpan, 2);
  assert.deepEqual(grid[1][1].spanOrigin, { row: 1, col: 0 });
});

test('user-merge: insertRow ПЕРЕД ведущей сдвигает 2-полевой spanOrigin (верт) → сетка валидна', () => {
  const grid = inPlaceInsertRow(gridUserMergeV(), 0); // вставка строки перед origin (row 1)
  assert.equal(validateGrid(grid).valid, true);
  assert.equal(grid[2][1].rowSpan, 2);
  assert.deepEqual(grid[3][1].spanOrigin, { row: 2, col: 1 });
});

test('user-merge: deleteRow ПЕРЕД ведущей сдвигает 2-полевой spanOrigin (верт) → сетка валидна', () => {
  const grid = inPlaceDeleteRow(gridUserMergeV(), 0); // удаление строки 0 (без объединений в ней)
  assert.equal(validateGrid(grid).valid, true);
  assert.equal(grid[0][1].rowSpan, 2);
  assert.deepEqual(grid[1][1].spanOrigin, { row: 0, col: 1 });
});

// ──────────────────────────────────────────────────────────────────────────
// 8-полевой metrics — те же операции на полноформатных поглощённых ячейках.
// ──────────────────────────────────────────────────────────────────────────

test('metrics: insertColumn перед «Сумма» сдвигает spanOrigin вертикального объединения → валидна', () => {
  // Колонка 3 — «Сумма, руб.» (rowSpan=2, поглощённая (1,3)). Вставка на col 3
  // сдвигает её origin вправо; spanOrigin поглощённой должен последовать.
  const grid = inPlaceInsertColumn(gridMetrics(), 3);
  assert.equal(validateGrid(grid).valid, true, JSON.stringify(validateGrid(grid).errors));
  // «Сумма» теперь на (0,4); её поглощённая на (1,4) с spanOrigin {0,4}.
  assert.equal(grid[0][4].rowSpan, 2);
  assert.deepEqual(grid[1][4].spanOrigin, { row: 0, col: 4 });
});

test('metrics: insertRow ниже шапки не ломает согласованность 8-полевых поглощённых → валидна', () => {
  // Вставка строки на index 2 (под двухстрочной шапкой). Объединения шапки
  // (rowSpan=2, origin в row 0) её НЕ пересекают (заканчиваются на row 1),
  // поэтому spanOrigin не меняется, а сетка остаётся согласованной.
  const grid = inPlaceInsertRow(gridMetrics(), 2);
  assert.equal(validateGrid(grid).valid, true);
  // spanOrigin поглощённых шапки на месте.
  assert.deepEqual(grid[1][0].spanOrigin, { row: 0, col: 0 });
  assert.deepEqual(grid[0][2].spanOrigin, { row: 0, col: 1 });
});

test('metrics: insertColumn перед «Кол-во» сдвигает spanOrigin гориз-объединения → валидна', () => {
  // Колонка 1 — «Кол-во, ед.» (colSpan=2), поглощённая (0,2). Вставка на col 1
  // сдвигает origin вправо; spanOrigin поглощённой должен последовать.
  const grid = inPlaceInsertColumn(gridMetrics(), 1);
  assert.equal(validateGrid(grid).valid, true, JSON.stringify(validateGrid(grid).errors));
  // «Кол-во» теперь ведущая на (0,2), поглощённая на (0,3) spanOrigin {0,2}.
  assert.equal(grid[0][2].colSpan, 2);
  assert.deepEqual(grid[0][3].spanOrigin, { row: 0, col: 2 });
});
