/**
 * ГОЛДЕН-тесты текущей семантики merge/unmerge/auto-unmerge.
 *
 * Фиксируют ТОЧНЫЙ хранимый dense-формат grid после каждой операции —
 * прежде чем переписать операции поверх range-list (T4b.3). Любой дрейф
 * формата (новые/исчезнувшие поля у ведущей/поглощённой/одиночной ячейки)
 * упадёт здесь. Семантика — ровно как в table-cells-operations.js:
 *   - merge: ведущая ячейка склеивает непустой content через ' ', несёт
 *     colSpan/rowSpan; поглощённые — РОВНО {isSpanned:true, spanOrigin:{row,col}};
 *   - unmerge: ведущая → colSpan/rowSpan=1; на месте поглощённых — пустые
 *     ячейки {content:'', isHeader:<от ведущей>, colSpan:1, rowSpan:1, originRow, originCol};
 *   - auto-unmerge строки: разъединяет все объединения, покрывающие строку.
 *
 * Чистое ядро (mergeRange/unmergeAt/autoUnmergeRow) работает на dense-grid и
 * возвращает НОВУЮ сетку — без DOM/AppState.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergeRange,
  unmergeAt,
  autoUnmergeRow,
} from '../../static/js/constructor/table/table-merge-core.js';

/**
 * Сетка данных rows×cols с буквенным content (A, B, …) и заданным isHeader.
 */
function dataGrid(rows, cols, { isHeader = false } = {}) {
  const grid = [];
  let code = 65; // 'A'
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      row.push({
        content: String.fromCharCode(code++),
        isHeader,
        colSpan: 1,
        rowSpan: 1,
        originRow: r,
        originCol: c,
      });
    }
    grid.push(row);
  }
  return grid;
}

// ──────────────────────────────────────────────────────────────────────────
// merge: 2×2 блок
// ──────────────────────────────────────────────────────────────────────────

test('GOLDEN merge 2×2: ведущая склеивает content, поглощённые — {isSpanned,spanOrigin}', () => {
  const grid = dataGrid(2, 2);
  const result = mergeRange(grid, 0, 0, 1, 1);
  assert.deepEqual(result, [
    [
      { content: 'A B C D', isHeader: false, colSpan: 2, rowSpan: 2, originRow: 0, originCol: 0 },
      { isSpanned: true, spanOrigin: { row: 0, col: 0 } },
    ],
    [
      { isSpanned: true, spanOrigin: { row: 0, col: 0 } },
      { isSpanned: true, spanOrigin: { row: 0, col: 0 } },
    ],
  ]);
});

// ──────────────────────────────────────────────────────────────────────────
// unmerge: восстановление 2×2 в синглтоны
// ──────────────────────────────────────────────────────────────────────────

test('GOLDEN unmerge 2×2: ведущая → синглтон, на месте поглощённых — пустые ячейки', () => {
  const merged = mergeRange(dataGrid(2, 2), 0, 0, 1, 1);
  const result = unmergeAt(merged, 0, 0);
  assert.deepEqual(result, [
    [
      // Ведущая: content/isHeader сохраняются, colSpan/rowSpan → 1.
      { content: 'A B C D', isHeader: false, colSpan: 1, rowSpan: 1, originRow: 0, originCol: 0 },
      { content: '', isHeader: false, colSpan: 1, rowSpan: 1, originRow: 0, originCol: 1 },
    ],
    [
      { content: '', isHeader: false, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 0 },
      { content: '', isHeader: false, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 1 },
    ],
  ]);
});

// ──────────────────────────────────────────────────────────────────────────
// merge: 1×3 шапка
// ──────────────────────────────────────────────────────────────────────────

test('GOLDEN merge 1×3 шапки: ведущая colSpan=3, две поглощённые', () => {
  const grid = dataGrid(1, 3, { isHeader: true });
  const result = mergeRange(grid, 0, 0, 0, 2);
  assert.deepEqual(result, [
    [
      { content: 'A B C', isHeader: true, colSpan: 3, rowSpan: 1, originRow: 0, originCol: 0 },
      { isSpanned: true, spanOrigin: { row: 0, col: 0 } },
      { isSpanned: true, spanOrigin: { row: 0, col: 0 } },
    ],
  ]);
});

test('GOLDEN unmerge 1×3 шапки: пустые ячейки наследуют isHeader ведущей', () => {
  const merged = mergeRange(dataGrid(1, 3, { isHeader: true }), 0, 0, 0, 2);
  const result = unmergeAt(merged, 0, 0);
  assert.deepEqual(result, [
    [
      { content: 'A B C', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 0, originCol: 0 },
      { content: '', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 0, originCol: 1 },
      { content: '', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 0, originCol: 2 },
    ],
  ]);
});

// ──────────────────────────────────────────────────────────────────────────
// merge: построение metrics-подобной 2-строчной шапки (rowSpan + colSpan)
// ──────────────────────────────────────────────────────────────────────────

test('GOLDEN metrics-шапка: rowSpan=2 + colSpan=2 склейки из последовательных merge', () => {
  // Старт: 2×4 шапка-данных «Код», «Кол», «X», «Сумма» / нижняя строка.
  const grid = [
    [
      { content: 'Код', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 0, originCol: 0 },
      { content: 'Кол', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 0, originCol: 1 },
      { content: '', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 0, originCol: 2 },
      { content: 'Сумма', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 0, originCol: 3 },
    ],
    [
      { content: '', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 0 },
      { content: 'ФЛ', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 1 },
      { content: 'ЮЛ', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 2 },
      { content: '', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 3 },
    ],
  ];

  // «Код метрики»: вертикальное объединение (0,0)-(1,0).
  let g = mergeRange(grid, 0, 0, 1, 0);
  // «Кол-во»: горизонтальное объединение (0,1)-(0,2).
  g = mergeRange(g, 0, 1, 0, 2);
  // «Сумма»: вертикальное объединение (0,3)-(1,3).
  g = mergeRange(g, 0, 3, 1, 3);

  assert.deepEqual(g, [
    [
      { content: 'Код', isHeader: true, colSpan: 1, rowSpan: 2, originRow: 0, originCol: 0 },
      { content: 'Кол', isHeader: true, colSpan: 2, rowSpan: 1, originRow: 0, originCol: 1 },
      { isSpanned: true, spanOrigin: { row: 0, col: 1 } },
      { content: 'Сумма', isHeader: true, colSpan: 1, rowSpan: 2, originRow: 0, originCol: 3 },
    ],
    [
      { isSpanned: true, spanOrigin: { row: 0, col: 0 } },
      { content: 'ФЛ', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 1 },
      { content: 'ЮЛ', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 2 },
      { isSpanned: true, spanOrigin: { row: 0, col: 3 } },
    ],
  ]);
});

// ──────────────────────────────────────────────────────────────────────────
// auto-unmerge строки (защитный путь при удалении строки)
// ──────────────────────────────────────────────────────────────────────────

test('GOLDEN autoUnmergeRow: разъединяет rowSpan, покрывающий целевую строку', () => {
  // (0,0) объединена вертикально на 2 строки; удаляем строку 1 → авто-разъединение.
  const grid = mergeRange(dataGrid(2, 2), 0, 0, 1, 0);
  const result = autoUnmergeRow(grid, 1);
  assert.deepEqual(result, [
    [
      { content: 'A C', isHeader: false, colSpan: 1, rowSpan: 1, originRow: 0, originCol: 0 },
      { content: 'B', isHeader: false, colSpan: 1, rowSpan: 1, originRow: 0, originCol: 1 },
    ],
    [
      { content: '', isHeader: false, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 0 },
      { content: 'D', isHeader: false, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 1 },
    ],
  ]);
});

test('GOLDEN autoUnmergeRow: разъединяет origin внутри удаляемой строки', () => {
  // (1,0) объединена горизонтально (1,0)-(1,1); auto-unmerge строки 1.
  const grid = mergeRange(dataGrid(2, 2), 1, 0, 1, 1);
  const result = autoUnmergeRow(grid, 1);
  assert.deepEqual(result, [
    [
      { content: 'A', isHeader: false, colSpan: 1, rowSpan: 1, originRow: 0, originCol: 0 },
      { content: 'B', isHeader: false, colSpan: 1, rowSpan: 1, originRow: 0, originCol: 1 },
    ],
    [
      { content: 'C D', isHeader: false, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 0 },
      { content: '', isHeader: false, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 1 },
    ],
  ]);
});
