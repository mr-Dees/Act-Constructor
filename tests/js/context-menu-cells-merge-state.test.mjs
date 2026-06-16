/**
 * tables-6: контекстное меню должно судить об объединении ячейки по
 * grid-модели (AppState.tables[..].grid), а не по DOM-свойствам td.colSpan —
 * DOM-узел в selectedCells может быть detached/устаревшим (рассинхрон с ядром,
 * которое всегда работает по grid-модели).
 */
import './_browser-stub.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeCell } from './_browser-stub.mjs';
import { AppState } from '../../static/js/constructor/state/state-core.js';
import { CellContextMenu } from '../../static/js/constructor/context-menu/context-menu-cells.js';
import { Notifications } from '../../static/js/shared/notifications.js';

// Шпион уведомлений.
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

/** Фейковый пункт меню с трекингом disabled через classList.toggle/add/remove. */
function makeMenuItem() {
  const classes = new Set();
  return {
    dataset: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      toggle: (c, force) => (force ? classes.add(c) : classes.delete(c)),
      contains: (c) => classes.has(c),
    },
  };
}

/** Меню с одним пунктом unmerge-cell; querySelector отдаёт его по data-action. */
function makeMenu(items) {
  return {
    querySelectorAll: () => [],
    querySelector: (sel) => {
      const m = sel.match(/data-action="([^"]+)"/);
      return (m && items[m[1]]) || null;
    },
  };
}

/** Грид 1×2: (0,0) — ведущая объединения colSpan=2, (0,1) — поглощённая. */
function mergedGridTable() {
  AppState.tables = {
    t1: {
      id: 't1',
      nodeId: 'n1',
      grid: [[
        { content: 'A B', isHeader: false, colSpan: 2, rowSpan: 1, originRow: 0, originCol: 0 },
        { isSpanned: true, spanOrigin: { row: 0, col: 0 } },
      ]],
      colWidths: [100, 100],
      protected: false,
      deletable: true,
    },
  };
}

test('updateMenuState: unmerge доступен по grid-модели, даже если DOM-ячейка устарела (colSpan=1)', () => {
  mergedGridTable();
  // Фейковая DOM-ячейка БЕЗ colSpan (detached/устаревшая) — grid знает об объединении.
  const cell = makeFakeCell('t1', 0, 0);
  globalThis.tableManager = { selectedCells: [cell] };

  const unmergeItem = makeMenuItem();
  const menu = makeMenu({ 'unmerge-cell': unmergeItem });
  const cellMenu = new CellContextMenu(menu);

  cellMenu.updateMenuState();

  assert.ok(!unmergeItem.classList.contains('disabled'),
    'unmerge должен быть доступен: grid-модель содержит colSpan=2');
});

test('updateMenuState: unmerge недоступен для одиночной ячейки по grid-модели', () => {
  AppState.tables = {
    t1: {
      id: 't1',
      nodeId: 'n1',
      grid: [[{ content: 'A', isHeader: false, colSpan: 1, rowSpan: 1, originRow: 0, originCol: 0 }]],
      colWidths: [100],
      protected: false,
      deletable: true,
    },
  };
  // DOM врёт, что ячейка объединена — grid-модель главнее.
  const cell = makeFakeCell('t1', 0, 0);
  cell.colSpan = 3;
  globalThis.tableManager = { selectedCells: [cell] };

  const unmergeItem = makeMenuItem();
  const cellMenu = new CellContextMenu(makeMenu({ 'unmerge-cell': unmergeItem }));

  cellMenu.updateMenuState();

  assert.ok(unmergeItem.classList.contains('disabled'),
    'unmerge должен быть заблокирован: grid-модель — синглтон');
});

test('handleAction unmerge-cell: решение по grid-модели — unmergeCells вызывается', () => {
  mergedGridTable();
  const cell = makeFakeCell('t1', 0, 0); // DOM без colSpan
  let unmergeCalls = 0;
  globalThis.tableManager = {
    selectedCells: [cell],
    unmergeCells: () => { unmergeCalls++; },
  };

  const cellMenu = new CellContextMenu(makeMenu({}));
  cellMenu.handleAction('unmerge-cell');

  assert.equal(unmergeCalls, 1, 'unmergeCells не вызван — меню судило по DOM');
  assert.equal(shown.info.length, 0, 'ложное «Ячейка не объединена»');
});
