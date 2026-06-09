/**
 * Тесты реконсайлера 6 флагов подвидов таблиц при загрузке.
 *
 * reconcileTableFlags(node, tables) синхронизирует флаги node↔table:
 * узел — источник истины; legacy-флаг с table поднимается на узел; объект
 * таблицы всегда синхронизируется с узлом. Флаги ВЗАИМОИСКЛЮЧАЮЩИЕ (тип
 * таблицы) — выставляется ровно один (узел победил), прочие гасятся.
 * Рекурсивно по детям.
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

test('(а) конфликт типов: узел побеждает, табличный тип-флаг гасится', () => {
  // Флаги взаимоисключающие: node и table «спорят» о типе таблицы.
  // Узел — источник истины → остаётся ТОЛЬКО его флаг, табличный снимается.
  const node = { id: 'n1', type: NODE_TYPE_TABLE, tableId: 't1', isRegularRiskTable: true };
  const tables = { t1: { id: 't1', nodeId: 'n1', isOperationalRiskTable: true } };
  reconcileTableFlags(node, tables);
  assert.equal(node.isRegularRiskTable, true, 'node.isRegularRiskTable');
  assert.equal(tables.t1.isRegularRiskTable, true, 'table.isRegularRiskTable');
  // Конфликтующий тип неактивен с обеих сторон. На узле его не было — реконсиляция
  // не пишет лишний false (узел остаётся без ключа), поэтому проверяем falsy, а не
  // строгий false. На таблице он БЫЛ true → активно гасится в false.
  assert.ok(!node.isOperationalRiskTable, 'node.isOperationalRiskTable неактивен');
  assert.equal(tables.t1.isOperationalRiskTable, false, 'table.isOperationalRiskTable');
});

test('(б) legacy-подъём: узел без флагов, тип берётся с таблицы', () => {
  const node = { id: 'n1', type: NODE_TYPE_TABLE, tableId: 't1' };
  const tables = { t1: { id: 't1', nodeId: 'n1', isMetricsTable: true } };
  reconcileTableFlags(node, tables);
  assert.equal(node.isMetricsTable, true, 'node.isMetricsTable');
  assert.equal(tables.t1.isMetricsTable, true, 'table.isMetricsTable');
});

test('(в) идемпотентность: совпадающий тип не пишется повторно', () => {
  const node = { id: 'n1', type: NODE_TYPE_TABLE, tableId: 't1', isRegularRiskTable: true };
  const tables = { t1: { id: 't1', nodeId: 'n1', isRegularRiskTable: true } };

  // Ловушки на запись: реконсиляция совпадающего состояния не должна
  // присваивать флаги заново (иначе AppState-Proxy пометит акт несохранённым).
  let nodeWrites = 0;
  let tableWrites = 0;
  const nodeProxy = new Proxy(node, {
    set(target, prop, value) {
      if (typeof prop === 'string' && prop.startsWith('is')) nodeWrites += 1;
      target[prop] = value;
      return true;
    },
  });
  const tablesProxy = {
    t1: new Proxy(tables.t1, {
      set(target, prop, value) {
        if (typeof prop === 'string' && prop.startsWith('is')) tableWrites += 1;
        target[prop] = value;
        return true;
      },
    }),
  };

  reconcileTableFlags(nodeProxy, tablesProxy);

  // Значения не изменились.
  assert.equal(node.isRegularRiskTable, true, 'node.isRegularRiskTable');
  assert.equal(tables.t1.isRegularRiskTable, true, 'table.isRegularRiskTable');
  // И ни одной лишней записи.
  assert.equal(nodeWrites, 0, 'лишних записей в узел нет');
  assert.equal(tableWrites, 0, 'лишних записей в таблицу нет');
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
