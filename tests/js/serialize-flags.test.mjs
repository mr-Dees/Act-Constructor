/**
 * Тесты сериализации 6 флагов подвидов таблиц.
 *
 * Проверяют чистый хелпер pickTableFlags(node) и константу TABLE_FLAG_NAMES,
 * экспортируемые из state-core.js. Хелпер выделен из _serializeTree/_serializeTables,
 * чтобы тестировать сериализацию флагов без DOM-зависимостей модуля.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TABLE_FLAG_NAMES, pickTableFlags } from '../../static/js/constructor/state/flags.js';

test('TABLE_FLAG_NAMES содержит ровно 6 флагов подвидов таблиц', () => {
  assert.deepEqual(
    [...TABLE_FLAG_NAMES].sort(),
    [
      'isMainMetricsTable',
      'isMetricsTable',
      'isOperationalRiskTable',
      'isOtherRiskTable',
      'isRegularRiskTable',
      'isTaxRiskTable',
    ].sort()
  );
});

test('pickTableFlags возвращает только truthy-флаги узла', () => {
  const node = { id: 'n1', isRegularRiskTable: true };
  assert.deepEqual(pickTableFlags(node), { isRegularRiskTable: true });
});

test('pickTableFlags для metrics-флага', () => {
  const node = { id: 'n2', isMetricsTable: true };
  assert.deepEqual(pickTableFlags(node), { isMetricsTable: true });
});

test('pickTableFlags не эмитит false/отсутствующие флаги', () => {
  const node = { id: 'n3', isMetricsTable: false, isTaxRiskTable: undefined };
  assert.deepEqual(pickTableFlags(node), {});
});

test('pickTableFlags на null/без флагов возвращает пустой объект', () => {
  assert.deepEqual(pickTableFlags(null), {});
  assert.deepEqual(pickTableFlags({ id: 'n4' }), {});
});

test('pickTableFlags собирает несколько флагов одновременно', () => {
  const node = {
    id: 'n5',
    isMainMetricsTable: true,
    isOperationalRiskTable: true,
    isOtherRiskTable: false,
  };
  assert.deepEqual(pickTableFlags(node), {
    isMainMetricsTable: true,
    isOperationalRiskTable: true,
  });
});
