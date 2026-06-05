/**
 * Тесты контракта клиентской защиты целостности grid (T6b.6).
 *
 * TableCellsOperations прогоняет table.grid через validateGrid ТОЛЬКО после
 * чистых merge/unmerge (table-merge-core.js) — там результат пересобирается из
 * range-list и spanOrigin всегда согласован, страховка by-construction не
 * срабатывает. Фиксируем этот контракт (блок 1-2 ниже).
 *
 * Блок 3 — регрессия на ложный откат: in-place insert/delete строк/колонок
 * НЕ должны прогоняться через validateGrid, потому что при сдвиге объединения
 * (вставка/удаление ПЕРЕД origin'ом) они оставляют ИНЕРТНЫЙ устаревший
 * spanOrigin у поглощённых ячеек. validateGrid (правило spanOrigin) строже
 * серверного контракта P6a (который spanOrigin не проверяет) → guard там
 * откатил бы операцию, работавшую до P6b. Эти тесты воспроизводят 5 кейсов и
 * утверждают: (а) операция даёт ожидаемую tolerated-форму (не откатывается на
 * исходную сетку), (б) такая сетка действительно режется validateGrid — то
 * есть именно поэтому guard на in-place операции вешать нельзя.
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
// Зеркалят splice + правку originRow/originCol/colSpan/rowSpan ведущих ячеек.
// spanOrigin поглощённых ячеек НЕ трогают — ровно как реальные операции.
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
// Регрессия: in-place insert/delete НЕ должны откатываться guard'ом.
// До удаления guard'а с этих операций каждый из кейсов молча откатывался.
// ──────────────────────────────────────────────────────────────────────────

test('регрессия: insertColumnLeft перед гориз-объединением не откатывается (tolerated stale spanOrigin)', () => {
  const grid = inPlaceInsertColumn(gridHMerge(), 0); // вставка ПЕРЕД origin (col 1)
  // Операция выполнена: добавлена колонка, объединение сдвинулось вправо.
  assert.equal(grid[0].length, 4);
  // Ведущая объединения теперь на (0,2), её colSpan сохранён.
  assert.equal(grid[0][2].colSpan, 2);
  // Поглощённая на (0,3) осталась isSpanned, но spanOrigin УСТАРЕЛ ({0,1}).
  assert.equal(grid[0][3].isSpanned, true);
  assert.deepEqual(grid[0][3].spanOrigin, { row: 0, col: 1 });
  // Именно поэтому validateGrid режет эту сетку — guard здесь дал бы ложный откат.
  assert.equal(validateGrid(grid).valid, false);
});

test('регрессия: insertColumnRight в позицию origin объединения не откатывается', () => {
  // insertColumnRight при выборе col 0 даёт insertColIndex=1 — ровно индекс
  // origin'а объединения (вставка АТ origin сдвигает его вправо).
  const grid = inPlaceInsertColumn(gridHMerge(), 1);
  assert.equal(grid[0].length, 4);
  // Ведущая объединения сдвинулась с (0,1) на (0,2), colSpan сохранён.
  assert.equal(grid[0][2].colSpan, 2);
  // Поглощённая теперь на (0,3), spanOrigin УСТАРЕЛ ({0,1}).
  assert.equal(grid[0][3].isSpanned, true);
  assert.deepEqual(grid[0][3].spanOrigin, { row: 0, col: 1 });
  assert.equal(validateGrid(grid).valid, false);
});

test('регрессия: insertRowAbove перед верт-объединением не откатывается', () => {
  const grid = inPlaceInsertRow(gridVMerge(), 0); // вставка ПЕРЕД origin (row 1)
  assert.equal(grid.length, 4);
  // Ведущая объединения теперь на (2,0), rowSpan сохранён.
  assert.equal(grid[2][0].rowSpan, 2);
  // Поглощённая на (3,0) — isSpanned, spanOrigin устарел ({1,0}).
  assert.equal(grid[3][0].isSpanned, true);
  assert.deepEqual(grid[3][0].spanOrigin, { row: 1, col: 0 });
  assert.equal(validateGrid(grid).valid, false);
});

test('регрессия: deleteColumn перед гориз-объединением не откатывается', () => {
  const grid = inPlaceDeleteColumn(gridHMerge(), 0); // удаление ПЕРЕД origin (col 1)
  assert.equal(grid[0].length, 2);
  // Ведущая объединения сдвинулась на (0,0), colSpan сохранён.
  assert.equal(grid[0][0].colSpan, 2);
  // Поглощённая на (0,1) — isSpanned, spanOrigin устарел ({0,1}).
  assert.equal(grid[0][1].isSpanned, true);
  assert.deepEqual(grid[0][1].spanOrigin, { row: 0, col: 1 });
  assert.equal(validateGrid(grid).valid, false);
});

test('регрессия: deleteRow перед верт-объединением не откатывается', () => {
  const grid = inPlaceDeleteRow(gridVMerge(), 0); // удаление строки ПЕРЕД origin (row 1)
  assert.equal(grid.length, 2);
  // Ведущая объединения сдвинулась на (0,0), rowSpan сохранён.
  assert.equal(grid[0][0].rowSpan, 2);
  // Поглощённая на (1,0) — isSpanned, spanOrigin устарел ({1,0}).
  assert.equal(grid[1][0].isSpanned, true);
  assert.deepEqual(grid[1][0].spanOrigin, { row: 1, col: 0 });
  assert.equal(validateGrid(grid).valid, false);
});
