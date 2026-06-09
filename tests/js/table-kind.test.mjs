/**
 * Тесты предикатов классификации специальных таблиц (table-kind.js).
 *
 * Проверяем:
 *  - isPinnedTable повторяет старую 6-флаговую OR-семантику tree-utils;
 *  - isRiskTable повторяет старую 4-флаговую OR-семантику state-tree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPinnedTable,
  isRiskTable,
} from '../../static/js/constructor/table/table-kind.js';

const TABLE = 'table';

/** Узел-таблица с одним выставленным флагом. */
function tableWith(flag) {
  return { type: TABLE, [flag]: true };
}

test('isPinnedTable — true для любого из 6 флагов (семантика tree-utils)', () => {
  for (const flag of [
    'isMetricsTable', 'isMainMetricsTable',
    'isRegularRiskTable', 'isOperationalRiskTable',
    'isTaxRiskTable', 'isOtherRiskTable',
  ]) {
    assert.equal(isPinnedTable(tableWith(flag)), true, flag);
  }
});

test('isPinnedTable — false для таблицы без флагов и для не-таблицы', () => {
  assert.equal(isPinnedTable({ type: TABLE }), false);
  assert.equal(isPinnedTable({ type: 'item', isMetricsTable: true }), false);
  assert.equal(isPinnedTable(null), false);
});

test('isRiskTable — true для любого из 4 риск-флагов (семантика state-tree)', () => {
  for (const flag of [
    'isRegularRiskTable', 'isOperationalRiskTable',
    'isTaxRiskTable', 'isOtherRiskTable',
  ]) {
    assert.equal(isRiskTable(tableWith(flag)), true, flag);
  }
});

test('isRiskTable — false для metrics-таблиц и не-таблицы', () => {
  assert.equal(isRiskTable(tableWith('isMetricsTable')), false);
  assert.equal(isRiskTable(tableWith('isMainMetricsTable')), false);
  assert.equal(isRiskTable({ type: TABLE }), false);
  assert.equal(isRiskTable({ type: 'item', isTaxRiskTable: true }), false);
  assert.equal(isRiskTable(null), false);
});
