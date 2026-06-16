/**
 * M.22: deleteRow НЕ авто-разъединяет объединения — отказывает.
 *
 * Семантика (решение пользователя): «сначала разделить, потом удалять».
 * Контекстное меню (context-menu-cells.js) и раньше отсекало merged-строки с
 * сообщением «Сначала разъедините их» — но ядро deleteRow звало _autoUnmergeRow
 * (недостижимо через UI). Теперь ядро при объединениях в строке возвращает
 * отказ с ТЕМ ЖЕ сообщением (единая константа MSG_ROW_HAS_MERGED_CELLS),
 * grid не меняется.
 *
 * Тестируются РЕАЛЬНЫЕ методы (стабы браузерных глобалов — _browser-stub.mjs,
 * импорт ПЕРВЫМ — порядок load-bearing).
 */
import './_browser-stub.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeCell, makeHeaderedGrid } from './_browser-stub.mjs';
import { AppState } from '../../static/js/constructor/state/state-core.js';
import { Notifications } from '../../static/js/shared/notifications.js';
import {
  TableCellsOperations,
  MSG_ROW_HAS_MERGED_CELLS,
} from '../../static/js/constructor/table/table-cells-operations.js';

// Шпион уведомлений: подменяем методы синглтона, копим сообщения.
const shown = { warning: [], error: [], success: [], info: [] };
Notifications.warning = (msg) => shown.warning.push(msg);
Notifications.error = (msg) => shown.error.push(msg);
Notifications.success = (msg) => shown.success.push(msg);
Notifications.info = (msg) => shown.info.push(msg);

/** Создаёт ops с таблицей на заданном grid и выбранной ячейкой (row,col). */
function setup(grid, selRow, selCol = 0) {
  const tableManager = { selectedCells: [makeFakeCell('t1', selRow, selCol)] };
  AppState.tables = {
    t1: {
      id: 't1',
      nodeId: 'n1',
      grid,
      colWidths: new Array(grid[0].length).fill(100),
      protected: false,
      deletable: true,
    },
  };
  AppState.selectedCells = tableManager.selectedCells;
  return { ops: new TableCellsOperations(tableManager), table: AppState.tables.t1 };
}

beforeEach(() => {
  shown.warning.length = 0;
  shown.error.length = 0;
  shown.success.length = 0;
  shown.info.length = 0;
});

test('константа сообщения совпадает с текстом контекстного меню', () => {
  assert.equal(
    MSG_ROW_HAS_MERGED_CELLS,
    'Строка содержит объединенные ячейки. Сначала разъедините их.',
  );
});

test('deleteRow по строке с горизонтальным объединением — отказ тем же сообщением, grid не изменился', () => {
  // 4×3: строка 2 содержит ведущую colSpan=2 + поглощённую.
  const grid = makeHeaderedGrid(4, 3);
  grid[2][0].colSpan = 2;
  grid[2][1] = { isSpanned: true, spanOrigin: { row: 2, col: 0 } };
  const { ops, table } = setup(grid, 2);
  const before = JSON.parse(JSON.stringify(table.grid));

  ops.deleteRow();

  assert.deepEqual(table.grid, before, 'grid обязан остаться нетронутым (без авто-разъединения)');
  assert.deepEqual(shown.error, [MSG_ROW_HAS_MERGED_CELLS]);
});

test('deleteRow по строке, накрытой вертикальным объединением сверху, — отказ, grid не изменился', () => {
  // 4×3: ведущая (1,1) rowSpan=2 накрывает строку 2 (в ней — поглощённая).
  const grid = makeHeaderedGrid(4, 3);
  grid[1][1].rowSpan = 2;
  grid[2][1] = { isSpanned: true, spanOrigin: { row: 1, col: 1 } };
  const { ops, table } = setup(grid, 2);
  const before = JSON.parse(JSON.stringify(table.grid));

  ops.deleteRow();

  assert.deepEqual(table.grid, before, 'grid обязан остаться нетронутым (без авто-разъединения)');
  assert.deepEqual(shown.error, [MSG_ROW_HAS_MERGED_CELLS]);
});

test('deleteRow по строке с ведущей вертикального объединения — отказ, grid не изменился', () => {
  // 4×3: ведущая (2,1) rowSpan=2 (origin в удаляемой строке).
  const grid = makeHeaderedGrid(4, 3);
  grid[2][1].rowSpan = 2;
  grid[3][1] = { isSpanned: true, spanOrigin: { row: 2, col: 1 } };
  const { ops, table } = setup(grid, 2);
  const before = JSON.parse(JSON.stringify(table.grid));

  ops.deleteRow();

  assert.deepEqual(table.grid, before);
  assert.deepEqual(shown.error, [MSG_ROW_HAS_MERGED_CELLS]);
});

test('deleteRow по чистой строке — удаляет (объединения в других строках не мешают)', () => {
  // 5×3: объединение в строке 1, удаляем чистую строку 3.
  const grid = makeHeaderedGrid(5, 3);
  grid[1][0].colSpan = 2;
  grid[1][1] = { isSpanned: true, spanOrigin: { row: 1, col: 0 } };
  const { ops, table } = setup(grid, 3);

  ops.deleteRow();

  assert.equal(table.grid.length, 4);
  assert.deepEqual(shown.error, []);
});

test('deleteRow: объединение заголовка (rowSpan до удаляемой строки НЕ доходит) не блокирует удаление', () => {
  // 4×3: шапка (0,0) rowSpan=2 покрывает строки 0-1; удаляем строку 2 — можно.
  const grid = makeHeaderedGrid(4, 3);
  grid[0][0].rowSpan = 2;
  grid[1][0] = { isSpanned: true, spanOrigin: { row: 0, col: 0 } };
  const { ops, table } = setup(grid, 2);

  ops.deleteRow();

  assert.equal(table.grid.length, 3);
  assert.deepEqual(shown.error, []);
});
