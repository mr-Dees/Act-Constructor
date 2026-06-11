/**
 * Тесты enum kind и предикатов классификации специальных таблиц (table-kind.js).
 *
 * Проверяем:
 *  - TABLE_KINDS — ровно 7 значений (синхронизация с бэкендом ручная);
 *  - getTableKind — 'regular' при отсутствии kind;
 *  - isPinnedTable — true для любого подвида, кроме 'regular';
 *  - isRiskTable — true только для 4 риск-подвидов.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KIND_REGULAR,
  TABLE_KINDS,
  getTableKind,
  isPinnedTable,
  isRiskTable,
} from '../../static/js/constructor/table/table-kind.js';

const TABLE = 'table';

const SPECIAL_KINDS = [
  'metrics', 'mainMetrics',
  'regularRisk', 'operationalRisk', 'taxRisk', 'otherRisk',
];
const RISK_KINDS = ['regularRisk', 'operationalRisk', 'taxRisk', 'otherRisk'];

/** Узел-таблица с заданным подвидом. */
function tableWith(kind) {
  return { type: TABLE, kind };
}

test('TABLE_KINDS — ровно 7 значений (regular + 6 спецподвидов)', () => {
  assert.deepEqual(
    [...TABLE_KINDS].sort(),
    ['regular', ...SPECIAL_KINDS].sort()
  );
});

test('getTableKind — kind узла, либо regular при отсутствии/null', () => {
  assert.equal(getTableKind(tableWith('metrics')), 'metrics');
  assert.equal(getTableKind({ type: TABLE }), KIND_REGULAR);
  assert.equal(getTableKind(null), KIND_REGULAR);
  assert.equal(getTableKind(undefined), KIND_REGULAR);
});

test('isPinnedTable — true для любого спецподвида', () => {
  for (const kind of SPECIAL_KINDS) {
    assert.equal(isPinnedTable(tableWith(kind)), true, kind);
  }
});

test('isPinnedTable — false для regular-таблицы и для не-таблицы', () => {
  assert.equal(isPinnedTable({ type: TABLE }), false);
  assert.equal(isPinnedTable(tableWith(KIND_REGULAR)), false);
  assert.equal(isPinnedTable({ type: 'item', kind: 'metrics' }), false);
  assert.equal(isPinnedTable(null), false);
});

test('isRiskTable — true для любого из 4 риск-подвидов', () => {
  for (const kind of RISK_KINDS) {
    assert.equal(isRiskTable(tableWith(kind)), true, kind);
  }
});

test('isRiskTable — false для metrics-подвидов и не-таблицы', () => {
  assert.equal(isRiskTable(tableWith('metrics')), false);
  assert.equal(isRiskTable(tableWith('mainMetrics')), false);
  assert.equal(isRiskTable({ type: TABLE }), false);
  assert.equal(isRiskTable({ type: 'item', kind: 'taxRisk' }), false);
  assert.equal(isRiskTable(null), false);
});
