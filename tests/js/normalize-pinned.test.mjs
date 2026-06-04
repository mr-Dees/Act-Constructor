/**
 * Тесты нормализатора pinned-first порядка детей (normalizePinnedOrder).
 *
 * Закреплённые таблицы (метрики / риски) должны стоять в начале children.
 * Нормализатор — стабильная партиция: pinned-первыми, относительный порядок
 * внутри pinned и внутри non-pinned сохраняется. Рекурсивно по дереву.
 * Консервативен: если порядок уже корректен — массив не меняется (по содержимому).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePinnedOrder } from '../../static/js/constructor/table/table-kind.js';

const TABLE = 'table';

function pinned(id) {
  return { id, type: TABLE, isMetricsTable: true };
}
function risk(id) {
  return { id, type: TABLE, isRegularRiskTable: true };
}
function normal(id) {
  return { id, type: 'item' };
}

test('pinned-таблица после обычного ребёнка поднимается в начало', () => {
  const parent = { id: 'p', children: [normal('a'), pinned('m'), normal('b')] };
  normalizePinnedOrder(parent);
  assert.deepEqual(parent.children.map(c => c.id), ['m', 'a', 'b']);
});

test('относительный порядок pinned и non-pinned сохраняется', () => {
  const parent = {
    id: 'p',
    children: [normal('a'), risk('r'), normal('b'), pinned('m'), normal('c')],
  };
  normalizePinnedOrder(parent);
  // pinned r, m (в исходном порядке) → затем non-pinned a, b, c (в исходном порядке)
  assert.deepEqual(parent.children.map(c => c.id), ['r', 'm', 'a', 'b', 'c']);
});

test('уже корректный порядок не меняется', () => {
  const parent = { id: 'p', children: [pinned('m'), normal('a'), normal('b')] };
  normalizePinnedOrder(parent);
  assert.deepEqual(parent.children.map(c => c.id), ['m', 'a', 'b']);
});

test('рекурсия по детям', () => {
  const parent = {
    id: 'root',
    children: [
      { id: 'sec', children: [normal('x'), pinned('m')] },
    ],
  };
  normalizePinnedOrder(parent);
  assert.deepEqual(parent.children[0].children.map(c => c.id), ['m', 'x']);
});

test('узел без детей / null — no-op без падения', () => {
  assert.doesNotThrow(() => normalizePinnedOrder({ id: 'p' }));
  assert.doesNotThrow(() => normalizePinnedOrder(null));
});

test('несколько pinned среди обычных — все в начало в исходном порядке', () => {
  const parent = {
    id: 'p',
    children: [normal('a'), pinned('m1'), normal('b'), pinned('m2')],
  };
  normalizePinnedOrder(parent);
  assert.deepEqual(parent.children.map(c => c.id), ['m1', 'm2', 'a', 'b']);
});
