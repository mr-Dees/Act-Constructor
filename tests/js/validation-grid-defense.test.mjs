/**
 * Тесты контракта клиентской защиты целостности grid (T6b.6).
 *
 * TableCellsOperations прогоняет результат чистых merge/unmerge
 * (table-merge-core.js) через региональную проверку целостности — там сетка
 * пересобирается из range-list и spanOrigin всегда согласован, страховка
 * by-construction не срабатывает. Фиксируем этот контракт (блок 1-2 ниже).
 *
 * Блок 3 — ROOT-фикс stale spanOrigin: in-place insert/delete строк/колонок
 * ТЕПЕРЬ синхронно сдвигают spanOrigin поглощённых ячеек вслед за сдвигом
 * ведущей (при вставке/удалении ПЕРЕД origin'ом). Раньше spanOrigin оставался
 * устаревшим, и сетка не проходила validateGrid; после фикса spanOrigin
 * указывает на актуальную ведущую и сетка валидна. Эти тесты воспроизводят
 * 5 кейсов и утверждают: (а) операция сдвигает spanOrigin на новую позицию
 * ведущей, (б) итоговая сетка проходит validateGrid (полная согласованность).
 * Инлайн-реплики операций зеркалят прод-сдвиг spanOrigin.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCell } from './_setup.mjs';
import { validateGrid } from '../../static/js/constructor/table/grid-merges.js';
import {
  mergeRange,
  unmergeAt,
  autoUnmergeRow,
} from '../../static/js/constructor/table/table-merge-core.js';

/**
 * Простая 3×3 сетка одиночных ячеек.
 */
function grid3x3() {
  return [0, 1, 2].map((r) =>
    [0, 1, 2].map((c) => makeCell({ content: `${r}${c}`, originRow: r, originCol: c })),
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Точные реплики in-place мутаций TableCellsOperations (без DOM/AppState).
// Зеркалят splice + правку originRow/originCol/colSpan/rowSpan ведущих ячеек
// И ROOT-фикс: сдвиг spanOrigin поглощённых ячеек вслед за ведущей. Гейт сдвига —
// {isSpanned && spanOrigin} (НЕ originCol/originRow: user-merge ячейки несут лишь
// эти два поля). Арифметика зеркалит _shiftSpanOriginsFor* в проде.
// ──────────────────────────────────────────────────────────────────────────

/** insertColumnLeft / insertColumnRight: вставка пустой колонки на colIndex. */
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
  // ROOT-фикс: сдвиг spanOrigin поглощённых вслед за ведущей.
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

/** insertRowAbove: вставка пустой строки на rowIndex. */
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
  // ROOT-фикс: сдвиг spanOrigin поглощённых вслед за ведущей.
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

/** deleteColumn: удаление колонки colIndex (без объединений В колонке). */
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
  // ROOT-фикс: сдвиг spanOrigin поглощённых вслед за ведущей.
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

/** deleteRow: удаление строки rowIndex (без объединений В строке). */
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
  // ROOT-фикс: сдвиг spanOrigin поглощённых вслед за ведущей.
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

/** Сетка 2×3 с горизонтальным объединением (0,1)-(0,2). */
function gridHMerge() {
  return [
    [
      makeCell({ content: 'A', originRow: 0, originCol: 0 }),
      makeCell({ content: 'M', colSpan: 2, originRow: 0, originCol: 1 }),
      makeCell({ content: '', isSpanned: true, spanOrigin: { row: 0, col: 1 }, originRow: 0, originCol: 2 }),
    ],
    [
      makeCell({ content: '1', originRow: 1, originCol: 0 }),
      makeCell({ content: '2', originRow: 1, originCol: 1 }),
      makeCell({ content: '3', originRow: 1, originCol: 2 }),
    ],
  ];
}

/** Сетка 3×2 с вертикальным объединением (1,0)-(2,0). */
function gridVMerge() {
  return [
    [makeCell({ content: 'H0', originRow: 0, originCol: 0 }), makeCell({ content: 'H1', originRow: 0, originCol: 1 })],
    [makeCell({ content: 'M', rowSpan: 2, originRow: 1, originCol: 0 }), makeCell({ content: 'b', originRow: 1, originCol: 1 })],
    [makeCell({ content: '', isSpanned: true, spanOrigin: { row: 1, col: 0 }, originRow: 2, originCol: 0 }), makeCell({ content: 'c', originRow: 2, originCol: 1 })],
  ];
}

test('защита: выход mergeRange проходит validateGrid', () => {
  const merged = mergeRange(grid3x3(), 0, 0, 1, 1); // 2×2 объединение
  const res = validateGrid(merged);
  assert.equal(res.valid, true, JSON.stringify(res.errors));
});

test('защита: merge → unmerge возвращает валидную сетку', () => {
  const merged = mergeRange(grid3x3(), 0, 0, 0, 2); // 1×3 шапка
  const unmerged = unmergeAt(merged, 0, 0);
  assert.equal(validateGrid(unmerged).valid, true);
});

test('защита: autoUnmergeRow даёт валидную сетку перед удалением строки', () => {
  const merged = mergeRange(grid3x3(), 0, 0, 2, 0); // вертикальное 3×1
  const cleared = autoUnmergeRow(merged, 1);
  assert.equal(validateGrid(cleared).valid, true);
});

test('защита: повреждённая сетка (рваная строка) ловится гардом', () => {
  // Имитация будущей регрессии структурной операции: одна строка короче.
  const broken = grid3x3();
  broken[1].pop();
  const res = validateGrid(broken);
  assert.equal(res.valid, false);
  assert.ok(res.errors.length > 0);
});

test('защита: повреждённая сетка (объединение за границей) ловится гардом', () => {
  const broken = grid3x3();
  broken[0][0].colSpan = 9; // выходит за 3 колонки
  const res = validateGrid(broken);
  assert.equal(res.valid, false);
});

// ──────────────────────────────────────────────────────────────────────────
// ROOT-фикс: in-place insert/delete синхронно сдвигают spanOrigin поглощённых
// ячеек, и итоговая сетка остаётся полностью согласованной (validateGrid==true).
// До фикса каждый из кейсов оставлял устаревший spanOrigin → невалидную сетку.
// ──────────────────────────────────────────────────────────────────────────

test('ROOT: insertColumnLeft перед гориз-объединением сдвигает spanOrigin, сетка валидна', () => {
  const grid = inPlaceInsertColumn(gridHMerge(), 0); // вставка ПЕРЕД origin (col 1)
  // Операция выполнена: добавлена колонка, объединение сдвинулось вправо.
  assert.equal(grid[0].length, 4);
  // Ведущая объединения теперь на (0,2), её colSpan сохранён.
  assert.equal(grid[0][2].colSpan, 2);
  // Поглощённая на (0,3) осталась isSpanned, spanOrigin СДВИНУТ на новую ведущую.
  assert.equal(grid[0][3].isSpanned, true);
  assert.deepEqual(grid[0][3].spanOrigin, { row: 0, col: 2 });
  // spanOrigin согласован с ведущей → validateGrid принимает сетку.
  assert.equal(validateGrid(grid).valid, true);
});

test('ROOT: insertColumnRight в позицию origin объединения сдвигает spanOrigin, сетка валидна', () => {
  // insertColumnRight при выборе col 0 даёт insertColIndex=1 — ровно индекс
  // origin'а объединения (вставка АТ origin сдвигает его вправо).
  const grid = inPlaceInsertColumn(gridHMerge(), 1);
  assert.equal(grid[0].length, 4);
  // Ведущая объединения сдвинулась с (0,1) на (0,2), colSpan сохранён.
  assert.equal(grid[0][2].colSpan, 2);
  // Поглощённая теперь на (0,3), spanOrigin СДВИНУТ на (0,2).
  assert.equal(grid[0][3].isSpanned, true);
  assert.deepEqual(grid[0][3].spanOrigin, { row: 0, col: 2 });
  assert.equal(validateGrid(grid).valid, true);
});

test('ROOT: insertRowAbove перед верт-объединением сдвигает spanOrigin, сетка валидна', () => {
  const grid = inPlaceInsertRow(gridVMerge(), 0); // вставка ПЕРЕД origin (row 1)
  assert.equal(grid.length, 4);
  // Ведущая объединения теперь на (2,0), rowSpan сохранён.
  assert.equal(grid[2][0].rowSpan, 2);
  // Поглощённая на (3,0) — isSpanned, spanOrigin СДВИНУТ на (2,0).
  assert.equal(grid[3][0].isSpanned, true);
  assert.deepEqual(grid[3][0].spanOrigin, { row: 2, col: 0 });
  assert.equal(validateGrid(grid).valid, true);
});

test('ROOT: deleteColumn перед гориз-объединением сдвигает spanOrigin, сетка валидна', () => {
  const grid = inPlaceDeleteColumn(gridHMerge(), 0); // удаление ПЕРЕД origin (col 1)
  assert.equal(grid[0].length, 2);
  // Ведущая объединения сдвинулась на (0,0), colSpan сохранён.
  assert.equal(grid[0][0].colSpan, 2);
  // Поглощённая на (0,1) — isSpanned, spanOrigin СДВИНУТ на (0,0).
  assert.equal(grid[0][1].isSpanned, true);
  assert.deepEqual(grid[0][1].spanOrigin, { row: 0, col: 0 });
  assert.equal(validateGrid(grid).valid, true);
});

test('ROOT: deleteRow перед верт-объединением сдвигает spanOrigin, сетка валидна', () => {
  const grid = inPlaceDeleteRow(gridVMerge(), 0); // удаление строки ПЕРЕД origin (row 1)
  assert.equal(grid.length, 2);
  // Ведущая объединения сдвинулась на (0,0), rowSpan сохранён.
  assert.equal(grid[0][0].rowSpan, 2);
  // Поглощённая на (1,0) — isSpanned, spanOrigin СДВИНУТ на (0,0).
  assert.equal(grid[1][0].isSpanned, true);
  assert.deepEqual(grid[1][0].spanOrigin, { row: 0, col: 0 });
  assert.equal(validateGrid(grid).valid, true);
});
