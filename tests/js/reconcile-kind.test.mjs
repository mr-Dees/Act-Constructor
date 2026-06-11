/**
 * Тесты реконсайлера подвида таблицы (kind) при загрузке.
 *
 * reconcileTableKind(node, tables) синхронизирует kind node↔table:
 * узел — источник истины; kind, заданный только на table, поднимается на
 * узел; объект таблицы всегда синхронизируется с узлом. Пишет только при
 * реальном изменении (Proxy-AppState). Рекурсивно по детям.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reconcileTableKind } from '../../static/js/constructor/table/table-kind.js';

const NODE_TYPE_TABLE = 'table';

test('kind только на table поднимается на узел и остаётся на table', () => {
  const node = { id: 'n1', type: NODE_TYPE_TABLE, tableId: 't1' };
  const tables = { t1: { id: 't1', nodeId: 'n1', kind: 'regularRisk' } };
  reconcileTableKind(node, tables);
  assert.equal(node.kind, 'regularRisk');
  assert.equal(tables.t1.kind, 'regularRisk');
});

test('kind на узле проставляется на объект таблицы', () => {
  const node = { id: 'n1', type: NODE_TYPE_TABLE, tableId: 't1', kind: 'metrics' };
  const tables = { t1: { id: 't1', nodeId: 'n1' } };
  reconcileTableKind(node, tables);
  assert.equal(node.kind, 'metrics');
  assert.equal(tables.t1.kind, 'metrics');
});

test('(а) конфликт подвидов: узел побеждает, табличный kind перезаписывается', () => {
  // node и table «спорят» о подвиде. Узел — источник истины → у таблицы
  // выставляется значение узла.
  const node = { id: 'n1', type: NODE_TYPE_TABLE, tableId: 't1', kind: 'regularRisk' };
  const tables = { t1: { id: 't1', nodeId: 'n1', kind: 'operationalRisk' } };
  reconcileTableKind(node, tables);
  assert.equal(node.kind, 'regularRisk', 'node.kind');
  assert.equal(tables.t1.kind, 'regularRisk', 'table.kind');
});

test('(б) legacy-подъём: узел без kind (или regular), подвид берётся с таблицы', () => {
  const node = { id: 'n1', type: NODE_TYPE_TABLE, tableId: 't1', kind: 'regular' };
  const tables = { t1: { id: 't1', nodeId: 'n1', kind: 'metrics' } };
  reconcileTableKind(node, tables);
  assert.equal(node.kind, 'metrics', 'node.kind');
  assert.equal(tables.t1.kind, 'metrics', 'table.kind');
});

test('(в) идемпотентность: совпадающий kind не пишется повторно', () => {
  const node = { id: 'n1', type: NODE_TYPE_TABLE, tableId: 't1', kind: 'regularRisk' };
  const tables = { t1: { id: 't1', nodeId: 'n1', kind: 'regularRisk' } };

  // Ловушки на запись: реконсиляция совпадающего состояния не должна
  // присваивать kind заново (иначе AppState-Proxy пометит акт несохранённым).
  let nodeWrites = 0;
  let tableWrites = 0;
  const nodeProxy = new Proxy(node, {
    set(target, prop, value) {
      if (prop === 'kind') nodeWrites += 1;
      target[prop] = value;
      return true;
    },
  });
  const tablesProxy = {
    t1: new Proxy(tables.t1, {
      set(target, prop, value) {
        if (prop === 'kind') tableWrites += 1;
        target[prop] = value;
        return true;
      },
    }),
  };

  reconcileTableKind(nodeProxy, tablesProxy);

  // Значения не изменились.
  assert.equal(node.kind, 'regularRisk', 'node.kind');
  assert.equal(tables.t1.kind, 'regularRisk', 'table.kind');
  // И ни одной лишней записи.
  assert.equal(nodeWrites, 0, 'лишних записей в узел нет');
  assert.equal(tableWrites, 0, 'лишних записей в таблицу нет');
});

test('обе стороны без kind — ни одной записи (чистая загрузка обычной таблицы)', () => {
  const node = { id: 'n1', type: NODE_TYPE_TABLE, tableId: 't1' };
  const tables = { t1: { id: 't1', nodeId: 'n1' } };

  let writes = 0;
  const nodeProxy = new Proxy(node, {
    set(target, prop, value) {
      if (prop === 'kind') writes += 1;
      target[prop] = value;
      return true;
    },
  });
  reconcileTableKind(nodeProxy, tables);
  // Обычная таблица остаётся БЕЗ ключа kind — лишний markAsUnsaved не нужен.
  assert.equal(writes, 0);
  assert.ok(!('kind' in node));
  assert.ok(!('kind' in tables.t1));
});

test('рекурсия по детям', () => {
  const tree = {
    id: 'root',
    children: [
      {
        id: 'sec',
        children: [
          { id: 'n1', type: NODE_TYPE_TABLE, tableId: 't1', kind: 'operationalRisk' },
        ],
      },
    ],
  };
  const tables = { t1: { id: 't1', nodeId: 'n1' } };
  reconcileTableKind(tree, tables);
  assert.equal(tables.t1.kind, 'operationalRisk');
});

test('узел без tableId / без таблицы — no-op без падения', () => {
  const node = { id: 'n1', type: 'item' };
  assert.doesNotThrow(() => reconcileTableKind(node, {}));
  const tableNode = { id: 'n2', type: NODE_TYPE_TABLE, tableId: 'missing' };
  assert.doesNotThrow(() => reconcileTableKind(tableNode, {}));
});

test('null-узел — no-op', () => {
  assert.doesNotThrow(() => reconcileTableKind(null, {}));
});
