/**
 * tables-7: вставка строки строит новый ряд по ширине grid[0] без проверки,
 * что остальные строки той же ширины. На рваной (не прямоугольной) сетке это
 * молча вставляло несовместимый ряд и усугубляло повреждение (бэк ответит 422).
 * Ожидание: отказ с понятной ошибкой ДО мутации grid.
 */
import './_browser-stub.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeCell, makeHeaderedGrid } from './_browser-stub.mjs';
import { AppState } from '../../static/js/constructor/state/state-core.js';
import { Notifications } from '../../static/js/shared/notifications.js';
import { TableCellsOperations } from '../../static/js/constructor/table/table-cells-operations.js';

const shown = { warning: [], error: [], success: [], info: [] };
Notifications.warning = (m) => shown.warning.push(m);
Notifications.error = (m) => shown.error.push(m);
Notifications.success = (m) => shown.success.push(m);
Notifications.info = (m) => shown.info.push(m);

beforeEach(() => {
  shown.warning.length = 0;
  shown.error.length = 0;
  shown.success.length = 0;
  shown.info.length = 0;
});

/** ops с таблицей rows×cols и выбранной ячейкой (selRow, selCol). */
function setup(rows, cols, selRow = 1, selCol = 0) {
  const tableManager = { selectedCells: [makeFakeCell('t1', selRow, selCol)] };
  AppState.tables = {
    t1: {
      id: 't1',
      nodeId: 'n1',
      grid: makeHeaderedGrid(rows, cols),
      colWidths: new Array(cols).fill(100),
      protected: false,
      deletable: true,
    },
  };
  AppState.selectedCells = tableManager.selectedCells;
  return { ops: new TableCellsOperations(tableManager), table: AppState.tables.t1 };
}

test('insertRowBelow на рваной сетке — отказ: grid не изменился, показана ошибка', () => {
  const { ops, table } = setup(3, 3);
  table.grid[2].pop(); // строка 2 теперь короче остальных
  const before = JSON.parse(JSON.stringify(table.grid));

  ops.insertRowBelow();

  assert.deepEqual(table.grid, before, 'grid изменился несмотря на рваную сетку');
  assert.equal(shown.error.length, 1);
  assert.ok(shown.error[0].includes('колонок'), shown.error[0]);
});

test('insertRowAbove на рваной сетке — отказ: grid не изменился, показана ошибка', () => {
  const { ops, table } = setup(3, 3, 2);
  table.grid[1].push({
    content: 'лишняя', isHeader: false, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 3,
  }); // строка 1 длиннее остальных
  const before = JSON.parse(JSON.stringify(table.grid));

  ops.insertRowAbove();

  assert.deepEqual(table.grid, before, 'grid изменился несмотря на рваную сетку');
  assert.equal(shown.error.length, 1);
  assert.ok(shown.error[0].includes('колонок'), shown.error[0]);
});

test('insertRowBelow на прямоугольной сетке — вставка проходит, новый ряд той же ширины', () => {
  const { ops, table } = setup(3, 3);

  ops.insertRowBelow();

  assert.equal(table.grid.length, 4);
  assert.ok(table.grid.every(row => row.length === 3), 'строки разной ширины после вставки');
  assert.equal(shown.error.length, 0);
});
