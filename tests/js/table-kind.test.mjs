/**
 * Тесты единого дискриминатора подвида таблицы (table-kind.js).
 *
 * Дискриминатор — единственный источник истины классификации специальных
 * таблиц. Проверяем:
 *  - getTableKind для каждого из 6 подвидов и для generic;
 *  - isPinnedTable повторяет старую 6-флаговую OR-семантику tree-utils;
 *  - isRiskTable повторяет старую 4-флаговую OR-семантику state-tree;
 *  - isMetricsKind = isMetricsTable || isMainMetricsTable;
 *  - детерминированный приоритет при нескольких флагах одновременно.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  getTableKind,
  isPinnedTable,
  isRiskTable,
  isMetricsKind,
} from '../../static/js/constructor/table/table-kind.js';

const TABLE = 'table';

/** Узел-таблица с одним выставленным флагом. */
function tableWith(flag) {
  return { type: TABLE, [flag]: true };
}

test('getTableKind — каждый подвид определяется по своему флагу', () => {
  assert.equal(getTableKind(tableWith('isMetricsTable')), 'metrics');
  assert.equal(getTableKind(tableWith('isMainMetricsTable')), 'mainMetrics');
  assert.equal(getTableKind(tableWith('isRegularRiskTable')), 'regularRisk');
  assert.equal(getTableKind(tableWith('isOperationalRiskTable')), 'operationalRisk');
  assert.equal(getTableKind(tableWith('isTaxRiskTable')), 'taxRisk');
  assert.equal(getTableKind(tableWith('isOtherRiskTable')), 'otherRisk');
});

test('getTableKind — таблица без флагов → generic', () => {
  assert.equal(getTableKind({ type: TABLE }), 'generic');
});

test('getTableKind — не-таблица → generic (даже при выставленном флаге)', () => {
  assert.equal(getTableKind({ type: 'item', isMetricsTable: true }), 'generic');
  assert.equal(getTableKind(null), 'generic');
  assert.equal(getTableKind(undefined), 'generic');
});

test('getTableKind — детерминированный приоритет при нескольких флагах', () => {
  // Приоритет следует порядку TABLE_FLAG_NAMES:
  // metrics > mainMetrics > regularRisk > operationalRisk > taxRisk > otherRisk.
  const node = { type: TABLE, isMainMetricsTable: true, isOtherRiskTable: true };
  assert.equal(getTableKind(node), 'mainMetrics');
  const node2 = { type: TABLE, isMetricsTable: true, isMainMetricsTable: true };
  assert.equal(getTableKind(node2), 'metrics');
  const node3 = { type: TABLE, isRegularRiskTable: true, isTaxRiskTable: true };
  assert.equal(getTableKind(node3), 'regularRisk');
});

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

test('isMetricsKind — true для metrics/mainMetrics, false для рисков', () => {
  assert.equal(isMetricsKind(tableWith('isMetricsTable')), true);
  assert.equal(isMetricsKind(tableWith('isMainMetricsTable')), true);
  assert.equal(isMetricsKind(tableWith('isRegularRiskTable')), false);
  assert.equal(isMetricsKind({ type: TABLE }), false);
  assert.equal(isMetricsKind(null), false);
});
