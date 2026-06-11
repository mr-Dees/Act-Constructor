/**
 * ГОЛДЕН-тесты текущей семантики merge/unmerge/auto-unmerge.
 *
 * Фиксируют ТОЧНЫЙ хранимый dense-формат grid после каждой операции —
 * прежде чем переписать операции поверх range-list (T4b.3). Любой дрейф
 * формата (новые/исчезнувшие поля у ведущей/поглощённой/одиночной ячейки)
 * упадёт здесь. Семантика — ровно как в table-cells-operations.js:
 *   - merge: ведущая ячейка склеивает непустой content через ' ', несёт
 *     colSpan/rowSpan и mergeSnapshot (runtime-снапшот содержимого области
 *     до объединения, НЕ сериализуется); поглощённые — РОВНО
 *     {isSpanned:true, spanOrigin:{row,col}};
 *   - unmerge: ведущая → colSpan/rowSpan=1; содержимое области
 *     восстанавливается из mergeSnapshot, если склеенный content не
 *     редактировался после merge; иначе поглощённые пустеют
 *     ({content:'', isHeader:<от ведущей>, colSpan:1, rowSpan:1, originRow, originCol});
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
import { gridToMerges } from '../../static/js/constructor/table/grid-merges.js';

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

test('GOLDEN merge 2×2: ведущая склеивает content и несёт mergeSnapshot, поглощённые — {isSpanned,spanOrigin}', () => {
  const grid = dataGrid(2, 2);
  const result = mergeRange(grid, 0, 0, 1, 1);
  assert.deepEqual(result, [
    [
      {
        content: 'A B C D', isHeader: false, colSpan: 2, rowSpan: 2, originRow: 0, originCol: 0,
        mergeSnapshot: { joined: 'A B C D', contents: [['A', 'B'], ['C', 'D']] },
      },
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

test('GOLDEN unmerge 2×2: содержимое области восстанавливается из mergeSnapshot', () => {
  const merged = mergeRange(dataGrid(2, 2), 0, 0, 1, 1);
  const result = unmergeAt(merged, 0, 0);
  // Склеенный content не редактировался → полный откат к исходной сетке.
  assert.deepEqual(result, dataGrid(2, 2));
});

test('GOLDEN unmerge 2×2 после правки склеенного content: ведущая хранит правку, поглощённые пустые', () => {
  const merged = mergeRange(dataGrid(2, 2), 0, 0, 1, 1);
  merged[0][0].content = 'Переписано';
  const result = unmergeAt(merged, 0, 0);
  assert.deepEqual(result, [
    [
      // Ведущая: правка сохраняется, восстановление снапшота не выполняется.
      { content: 'Переписано', isHeader: false, colSpan: 1, rowSpan: 1, originRow: 0, originCol: 0 },
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

test('GOLDEN merge 1×3 шапки: ведущая colSpan=3 с mergeSnapshot, две поглощённые', () => {
  const grid = dataGrid(1, 3, { isHeader: true });
  const result = mergeRange(grid, 0, 0, 0, 2);
  assert.deepEqual(result, [
    [
      {
        content: 'A B C', isHeader: true, colSpan: 3, rowSpan: 1, originRow: 0, originCol: 0,
        mergeSnapshot: { joined: 'A B C', contents: [['A', 'B', 'C']] },
      },
      { isSpanned: true, spanOrigin: { row: 0, col: 0 } },
      { isSpanned: true, spanOrigin: { row: 0, col: 0 } },
    ],
  ]);
});

test('GOLDEN unmerge 1×3 шапки: содержимое восстановлено, ячейки наследуют isHeader ведущей', () => {
  const merged = mergeRange(dataGrid(1, 3, { isHeader: true }), 0, 0, 0, 2);
  const result = unmergeAt(merged, 0, 0);
  assert.deepEqual(result, dataGrid(1, 3, { isHeader: true }));
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
      {
        content: 'Код', isHeader: true, colSpan: 1, rowSpan: 2, originRow: 0, originCol: 0,
        mergeSnapshot: { joined: 'Код', contents: [['Код'], ['']] },
      },
      {
        content: 'Кол', isHeader: true, colSpan: 2, rowSpan: 1, originRow: 0, originCol: 1,
        mergeSnapshot: { joined: 'Кол', contents: [['Кол', '']] },
      },
      { isSpanned: true, spanOrigin: { row: 0, col: 1 } },
      {
        content: 'Сумма', isHeader: true, colSpan: 1, rowSpan: 2, originRow: 0, originCol: 3,
        mergeSnapshot: { joined: 'Сумма', contents: [['Сумма'], ['']] },
      },
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
  // Склеенный content не редактировался → содержимое восстановлено из снапшота.
  const grid = mergeRange(dataGrid(2, 2), 0, 0, 1, 0);
  const result = autoUnmergeRow(grid, 1);
  assert.deepEqual(result, dataGrid(2, 2));
});

test('GOLDEN autoUnmergeRow: разъединяет origin внутри удаляемой строки', () => {
  // (1,0) объединена горизонтально (1,0)-(1,1); auto-unmerge строки 1.
  // Содержимое восстановлено из снапшота (склейку не редактировали).
  const grid = mergeRange(dataGrid(2, 2), 1, 0, 1, 1);
  const result = autoUnmergeRow(grid, 1);
  assert.deepEqual(result, dataGrid(2, 2));
});

// ──────────────────────────────────────────────────────────────────────────
// T4b.5: adversarial self-check — round-trip safety + no range-list leak
// ──────────────────────────────────────────────────────────────────────────

test('SELF-CHECK round-trip: merge→unmerge восстанавливает структуру (origin-only content)', () => {
  // Регион, где непустой content только в ведущей ячейке: склейка — no-op,
  // поэтому полный цикл merge→unmerge даёт байт-идентичную исходную сетку.
  const original = [
    [
      { content: 'Шапка', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 0, originCol: 0 },
      { content: '', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 0, originCol: 1 },
    ],
    [
      { content: '', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 0 },
      { content: '', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 1 },
    ],
  ];
  const cycled = unmergeAt(mergeRange(original, 0, 0, 1, 1), 0, 0);
  assert.deepEqual(cycled, original);
});

test('SELF-CHECK: range-list НЕ просачивается в хранимый grid (ячейки — dense, не {rowspan,colspan})', () => {
  // merge/unmerge возвращают dense-grid; ни одна ячейка не должна нести
  // range-list-форму {row,col,rowspan,colspan} (lowercase span-ключи).
  const merged = mergeRange(dataGrid(2, 2), 0, 0, 1, 1);
  const grids = [merged, unmergeAt(merged, 0, 0), autoUnmergeRow(mergeRange(dataGrid(2, 2), 0, 0, 1, 0), 1)];
  for (const grid of grids) {
    for (const row of grid) {
      for (const cell of row) {
        assert.ok(!('rowspan' in cell), `утечка range-list rowspan: ${JSON.stringify(cell)}`);
        assert.ok(!('colspan' in cell), `утечка range-list colspan: ${JSON.stringify(cell)}`);
        // Поглощённые несут isSpanned/spanOrigin; ведущие/одиночные — colSpan/rowSpan.
        const isDense = cell.isSpanned === true
          ? 'spanOrigin' in cell
          : ('colSpan' in cell && 'rowSpan' in cell);
        assert.ok(isDense, `ячейка не в dense-формате: ${JSON.stringify(cell)}`);
      }
    }
  }
  // gridToMerges возвращает ИМЕННО range-list (внутреннее представление) —
  // подтверждаем, что это отдельная структура, а не часть grid.
  const merges = gridToMerges(merged);
  assert.ok(merges.every((m) => 'rowspan' in m && 'colspan' in m));
});
