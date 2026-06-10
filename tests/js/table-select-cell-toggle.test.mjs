/**
 * M.14: selectCell — toggle вместо безусловного push.
 *
 * Прежний баг: повторный Ctrl+клик по уже выбранной ячейке клал ДУБЛЬ в
 * selectedCells и ломал счётчик mergeCells (length !== rowspan*colspan →
 * ложный отказ «только полную прямоугольную область»). Новая семантика:
 * повторный клик по выбранной ячейке СНИМАЕТ выделение (и CSS-класс
 * 'selected' — UI красится именно этим классом).
 *
 * Клик-флоу безопасен для toggle (table-core.js):
 *  - обычный клик: clearSelection() → selectCell() — toggle всегда добавляет;
 *  - contextmenu: selectCell() зовётся только если ячейки НЕТ в выделении.
 *
 * Тестируются РЕАЛЬНЫЕ методы (стабы браузерных глобалов — _browser-stub.mjs,
 * импорт ПЕРВЫМ — порядок load-bearing).
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeCell } from './_browser-stub.mjs';
import { AppState } from '../../static/js/constructor/state/state-core.js';
import { TableCellsOperations } from '../../static/js/constructor/table/table-cells-operations.js';

/** Создаёт ops с пустым выделением. */
function setup() {
  const tableManager = { selectedCells: [] };
  AppState.selectedCells = [];
  return { ops: new TableCellsOperations(tableManager), tableManager };
}

test('selectCell: первый клик выделяет — ячейка в списке, класс selected стоит', () => {
  const { ops, tableManager } = setup();
  const cell = makeFakeCell('t1', 1, 0);

  ops.selectCell(cell);

  assert.deepEqual(tableManager.selectedCells, [cell]);
  assert.equal(cell.classList.contains('selected'), true);
  assert.deepEqual(AppState.selectedCells, [cell]);
});

test('selectCell: повторный клик по выбранной — снимает выделение и класс (toggle)', () => {
  const { ops, tableManager } = setup();
  const cell = makeFakeCell('t1', 1, 0);

  ops.selectCell(cell);
  ops.selectCell(cell);

  assert.deepEqual(tableManager.selectedCells, []);
  assert.equal(cell.classList.contains('selected'), false);
  assert.deepEqual(AppState.selectedCells, []);
});

test('selectCell: A, B, снова A → остаётся только B; класс снят только с A', () => {
  const { ops, tableManager } = setup();
  const a = makeFakeCell('t1', 1, 0);
  const b = makeFakeCell('t1', 1, 1);

  ops.selectCell(a);
  ops.selectCell(b);
  ops.selectCell(a);

  assert.deepEqual(tableManager.selectedCells, [b]);
  assert.equal(a.classList.contains('selected'), false);
  assert.equal(b.classList.contains('selected'), true);
});

test('selectCell: дублей в selectedCells не бывает (счётчик mergeCells не ломается)', () => {
  const { ops, tableManager } = setup();
  const cell = makeFakeCell('t1', 1, 0);

  // Нечётное число кликов — ячейка выбрана ровно один раз.
  ops.selectCell(cell);
  ops.selectCell(cell);
  ops.selectCell(cell);

  assert.equal(tableManager.selectedCells.length, 1);
  assert.equal(new Set(tableManager.selectedCells).size, tableManager.selectedCells.length);
});

test('selectCell: после toggle-снятия AppState.selectedCells синхронен со списком менеджера', () => {
  const { ops, tableManager } = setup();
  const a = makeFakeCell('t1', 1, 0);
  const b = makeFakeCell('t1', 2, 0);

  ops.selectCell(a);
  ops.selectCell(b);
  ops.selectCell(a); // снятие A

  assert.deepEqual(AppState.selectedCells, tableManager.selectedCells);
});
