/**
 * H5: инвариант защищённых таблиц (protected:true) — закрепление ТЕКУЩЕГО
 * поведения, признанного корректным (решение по аудиту: «по H5 делать нечего»).
 *
 *  - операции со СТРОКАМИ разрешены: insertRowAbove/insertRowBelow/deleteRow
 *    (гейта protected в них нет намеренно);
 *  - удаление ПОСЛЕДНЕЙ строки данных (grid.length - headerRowCount <= 1) —
 *    отказ (молчаливый return, меню показывает своё сообщение раньше);
 *  - операции с КОЛОНКАМИ и объединениями запрещены: insertColumnLeft/Right,
 *    deleteColumn, mergeCells, unmergeCells — отказ «Структуру этой таблицы
 *    нельзя изменять».
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
import { TableCellsOperations } from '../../static/js/constructor/table/table-cells-operations.js';

const PROTECTED_MSG = 'Структуру этой таблицы нельзя изменять';

// Шпион уведомлений: подменяем методы синглтона, копим сообщения.
const shown = { warning: [], error: [], success: [], info: [] };
Notifications.warning = (msg) => shown.warning.push(msg);
Notifications.error = (msg) => shown.error.push(msg);
Notifications.success = (msg) => shown.success.push(msg);
Notifications.info = (msg) => shown.info.push(msg);

/** Создаёт ops с PROTECTED-таблицей на заданном grid и выбранными ячейками. */
function setup(grid, selections) {
  const cells = selections.map(([r, c]) => makeFakeCell('t1', r, c));
  const tableManager = { selectedCells: cells };
  AppState.tables = {
    t1: {
      id: 't1',
      nodeId: 'n1',
      grid,
      colWidths: new Array(grid[0].length).fill(100),
      protected: true,
      deletable: false,
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

// ──────────────────────────────────────────────────────────────────────────
// Операции со строками — РАЗРЕШЕНЫ.
// ──────────────────────────────────────────────────────────────────────────

test('protected: insertRowAbove по строке данных РАБОТАЕТ (+1 строка)', () => {
  const { ops, table } = setup(makeHeaderedGrid(3, 3), [[1, 0]]);

  ops.insertRowAbove();

  assert.equal(table.grid.length, 4);
  assert.deepEqual(shown.error, []);
});

test('protected: insertRowBelow РАБОТАЕТ (+1 строка)', () => {
  const { ops, table } = setup(makeHeaderedGrid(3, 3), [[1, 0]]);

  ops.insertRowBelow();

  assert.equal(table.grid.length, 4);
  assert.deepEqual(shown.error, []);
});

test('protected: deleteRow строки данных РАБОТАЕТ, пока остаётся хотя бы одна строка данных', () => {
  // 1 заголовок + 2 строки данных → удаление одной разрешено.
  const { ops, table } = setup(makeHeaderedGrid(3, 3), [[2, 0]]);

  ops.deleteRow();

  assert.equal(table.grid.length, 2);
  assert.deepEqual(shown.error, []);
});

// ──────────────────────────────────────────────────────────────────────────
// Последняя строка данных — отказ.
// ──────────────────────────────────────────────────────────────────────────

test('protected: deleteRow ПОСЛЕДНЕЙ строки данных — отказ, grid не изменился', () => {
  // 1 заголовок + 1 строка данных: grid.length - headerRowCount <= 1.
  const { ops, table } = setup(makeHeaderedGrid(2, 3), [[1, 0]]);
  const before = JSON.parse(JSON.stringify(table.grid));

  ops.deleteRow();

  assert.deepEqual(table.grid, before);
});

test('protected: deleteRow строки заголовка — отказ, grid не изменился', () => {
  const { ops, table } = setup(makeHeaderedGrid(3, 3), [[0, 0]]);
  const before = JSON.parse(JSON.stringify(table.grid));

  ops.deleteRow();

  assert.deepEqual(table.grid, before);
});

// ──────────────────────────────────────────────────────────────────────────
// Операции с колонками — ЗАПРЕЩЕНЫ.
// ──────────────────────────────────────────────────────────────────────────

test('protected: insertColumnLeft — отказ с сообщением, grid не изменился', () => {
  const { ops, table } = setup(makeHeaderedGrid(3, 3), [[1, 1]]);
  const before = JSON.parse(JSON.stringify(table.grid));

  ops.insertColumnLeft();

  assert.deepEqual(table.grid, before);
  assert.deepEqual(shown.error, [PROTECTED_MSG]);
});

test('protected: insertColumnRight — отказ с сообщением, grid не изменился', () => {
  const { ops, table } = setup(makeHeaderedGrid(3, 3), [[1, 1]]);
  const before = JSON.parse(JSON.stringify(table.grid));

  ops.insertColumnRight();

  assert.deepEqual(table.grid, before);
  assert.deepEqual(shown.error, [PROTECTED_MSG]);
});

test('protected: deleteColumn — отказ с сообщением, grid не изменился', () => {
  const { ops, table } = setup(makeHeaderedGrid(3, 3), [[1, 1]]);
  const before = JSON.parse(JSON.stringify(table.grid));

  ops.deleteColumn();

  assert.deepEqual(table.grid, before);
  assert.deepEqual(shown.error, [PROTECTED_MSG]);
});

// ──────────────────────────────────────────────────────────────────────────
// Объединение / разъединение — ЗАПРЕЩЕНЫ.
// ──────────────────────────────────────────────────────────────────────────

test('protected: mergeCells двух ячеек данных — отказ с сообщением, grid не изменился', () => {
  const { ops, table } = setup(makeHeaderedGrid(3, 3), [[1, 0], [1, 1]]);
  const before = JSON.parse(JSON.stringify(table.grid));

  ops.mergeCells();

  assert.deepEqual(table.grid, before);
  assert.deepEqual(shown.error, [PROTECTED_MSG]);
});

test('protected: unmergeCells объединённой ячейки — отказ с сообщением, grid не изменился', () => {
  // Объединение в строке данных (как у спецтаблиц со склейками).
  const grid = makeHeaderedGrid(3, 3);
  grid[1][0].colSpan = 2;
  grid[1][1] = { isSpanned: true, spanOrigin: { row: 1, col: 0 } };
  const { ops, table } = setup(grid, [[1, 0]]);
  const before = JSON.parse(JSON.stringify(table.grid));

  ops.unmergeCells();

  assert.deepEqual(table.grid, before);
  assert.deepEqual(shown.error, [PROTECTED_MSG]);
});
