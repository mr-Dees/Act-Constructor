/**
 * Тесты реконсайлера 6 флагов подвидов таблиц при загрузке.
 *
 * reconcileTableFlags(node, tables) синхронизирует флаги node↔table:
 * узел — источник истины; legacy-флаг с table поднимается на узел; объект
 * таблицы всегда синхронизируется с узлом. Рекурсивно по детям.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileTableFlags } from '../../static/js/constructor/state/flags.js';

const NODE_TYPE_TABLE = 'table';

test('legacy-флаг только на table поднимается на узел и остаётся на table', () => {
  const node = { id: 'n1', type: NODE_TYPE_TABLE, tableId: 't1' };
  const tables = { t1: { id: 't1', nodeId: 'n1', isRegularRiskTable: true } };
  reconcileTableFlags(node, tables);
  assert.equal(node.isRegularRiskTable, true);
  assert.equal(tables.t1.isRegularRiskTable, true);
});

test('флаг на узле проставляется на объект таблицы', () => {
  const node = { id: 'n1', type: NODE_TYPE_TABLE, tableId: 't1', isMetricsTable: true };
  const tables = { t1: { id: 't1', nodeId: 'n1' } };
  reconcileTableFlags(node, tables);
  assert.equal(node.isMetricsTable, true);
  assert.equal(tables.t1.isMetricsTable, true);
});

test('все 6 флагов синхронизируются в обе стороны', () => {
  const node = {
    id: 'n1', type: NODE_TYPE_TABLE, tableId: 't1',
    isMetricsTable: true,
    isTaxRiskTable: true,
  };
  const tables = {
    t1: {
      id: 't1', nodeId: 'n1',
      isMainMetricsTable: true,
      isOtherRiskTable: true,
    },
  };
  reconcileTableFlags(node, tables);
  for (const f of ['isMetricsTable', 'isTaxRiskTable', 'isMainMetricsTable', 'isOtherRiskTable']) {
    assert.equal(node[f], true, `node.${f}`);
    assert.equal(tables.t1[f], true, `table.${f}`);
  }
});

test('рекурсия по детям', () => {
  const tree = {
    id: 'root',
    children: [
      {
        id: 'sec',
        children: [
          { id: 'n1', type: NODE_TYPE_TABLE, tableId: 't1', isOperationalRiskTable: true },
        ],
      },
    ],
  };
  const tables = { t1: { id: 't1', nodeId: 'n1' } };
  reconcileTableFlags(tree, tables);
  assert.equal(tables.t1.isOperationalRiskTable, true);
});

test('узел без tableId / без таблицы — no-op без падения', () => {
  const node = { id: 'n1', type: 'item' };
  assert.doesNotThrow(() => reconcileTableFlags(node, {}));
  const tableNode = { id: 'n2', type: NODE_TYPE_TABLE, tableId: 'missing' };
  assert.doesNotThrow(() => reconcileTableFlags(tableNode, {}));
});

test('null-узел — no-op', () => {
  assert.doesNotThrow(() => reconcileTableFlags(null, {}));
});
