/**
 * tables-3 / render-9: точечный перерендер таблицы обязан снимать выделение
 * ячеек — replaceChild оставляет в tableManager.selectedCells detached
 * DOM-узлы (операции merge/insert по ним читают устаревшие координаты).
 * renderAll выделение снимает; updateTable должен вести себя так же.
 * Путь ресайза колонок (TableSizes._commitColWidths) завершается именно
 * updateTable — этим же закрывается утечка выделения после ресайза.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeFakeCell } from './_browser-stub.mjs';
import { AppState } from '../../static/js/constructor/state/state-core.js';
import { ItemsRenderer } from '../../static/js/constructor/items/items-renderer.js';
import { tableManager } from '../../static/js/constructor/table/table-core.js';

test('updateTable снимает выделение ячеек (selectedCells и AppState.selectedCells пустеют)', () => {
  AppState.tables = {
    t1: {
      id: 't1',
      nodeId: 'n1',
      grid: [[{ content: '', isHeader: false, colSpan: 1, rowSpan: 1, originRow: 0, originCol: 0 }]],
      colWidths: [100],
      protected: false,
      deletable: true,
    },
  };
  AppState.findNodeById = () => ({ id: 'n1', type: 'table', tableId: 't1', customLabel: '' });

  // Старая section в индексе DOM-узлов; parentNode принимает replaceChild.
  const oldSection = {
    parentNode: { replaceChild() {} },
    dataset: { tableId: 't1' },
    querySelectorAll: () => [],
  };
  ItemsRenderer._domIndex.set('table:t1', oldSection);

  // renderTable подменяем заглушкой — здесь проверяется только выделение.
  const origRenderTable = ItemsRenderer.renderTable;
  ItemsRenderer.renderTable = () => ({ dataset: {}, querySelectorAll: () => [] });

  const selected = makeFakeCell('t1', 0, 0);
  selected.classList.add('selected');
  tableManager.selectedCells = [selected];
  AppState.selectedCells = tableManager.selectedCells;

  try {
    ItemsRenderer.updateTable('t1');
  } finally {
    ItemsRenderer.renderTable = origRenderTable;
    ItemsRenderer._domIndex.delete('table:t1');
  }

  assert.equal(tableManager.selectedCells.length, 0, 'selectedCells не очищены после updateTable');
  assert.equal(AppState.selectedCells.length, 0, 'AppState.selectedCells не очищены');
  assert.ok(!selected.classList.contains('selected'), 'подсветка selected не снята');
});
