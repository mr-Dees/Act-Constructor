/**
 * Юнит-тесты канонического предиката необходимости сводных таблиц (D2).
 *
 * shouldHaveMetricsTable(node5x): per-section сводная на 5.X нужна ⟺ в поддереве
 *   item-ребёнка (5.X.Y+) есть риск-таблица. Риск прямо на 5.X сводную НЕ создаёт.
 * shouldHaveMainMetrics(section5): главная сводная §5 нужна ⟺ где-либо в §5 есть риск.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldHaveMetricsTable,
  shouldHaveMainMetrics,
} from '../../static/js/constructor/state/metrics-risk-core.js';

// Поиск риск-таблиц в поддереве (4 риск-подвида kind — как в боевом дискриминаторе).
const RISK_KINDS = new Set(['regularRisk', 'operationalRisk', 'taxRisk', 'otherRisk']);
function findRiskTables(node) {
  const out = [];
  const walk = (n) => {
    if (!n) return;
    if (n.type === 'table' && RISK_KINDS.has(n.kind)) out.push(n);
    for (const c of n.children || []) walk(c);
  };
  walk(node);
  return out;
}

const risk = () => ({ id: 'r', type: 'table', kind: 'regularRisk', children: [] });

test('shouldHaveMetricsTable: false без рисков', () => {
  const node5x = { number: '5.1', children: [{ type: 'item', number: '5.1.1', children: [] }] };
  assert.equal(shouldHaveMetricsTable(node5x, findRiskTables), false);
});

test('shouldHaveMetricsTable: true при риске на глубоком уровне 5.X.Y', () => {
  const node5x = {
    number: '5.1',
    children: [{ type: 'item', number: '5.1.1', children: [risk()] }],
  };
  assert.equal(shouldHaveMetricsTable(node5x, findRiskTables), true);
});

test('shouldHaveMetricsTable: false при риске НЕПОСРЕДСТВЕННО на 5.X', () => {
  // Риск прямой ребёнок 5.X (не под item-веткой) — per-section сводную НЕ создаёт.
  const node5x = { number: '5.1', children: [risk()] };
  assert.equal(shouldHaveMetricsTable(node5x, findRiskTables), false);
});

test('shouldHaveMetricsTable: false для не-5.X узла', () => {
  const deep = { number: '5.1.1', children: [{ type: 'item', number: '5.1.1.1', children: [risk()] }] };
  assert.equal(shouldHaveMetricsTable(deep, findRiskTables), false);
  assert.equal(shouldHaveMetricsTable(null, findRiskTables), false);
});

test('shouldHaveMainMetrics: true при любом риске в §5 (включая прямой на 5.X)', () => {
  const section5 = { number: '5', children: [{ number: '5.1', type: 'item', children: [risk()] }] };
  assert.equal(shouldHaveMainMetrics(section5, findRiskTables), true);
});

test('shouldHaveMainMetrics: false без рисков', () => {
  const section5 = { number: '5', children: [{ number: '5.1', type: 'item', children: [] }] };
  assert.equal(shouldHaveMainMetrics(section5, findRiskTables), false);
  assert.equal(shouldHaveMainMetrics(null, findRiskTables), false);
});

test('предикат согласован: per-section ⟹ main (глубокий риск держит обе)', () => {
  const node5x = { number: '5.1', type: 'item', children: [{ type: 'item', number: '5.1.1', children: [risk()] }] };
  const section5 = { number: '5', children: [node5x] };
  assert.equal(shouldHaveMetricsTable(node5x, findRiskTables), true);
  assert.equal(shouldHaveMainMetrics(section5, findRiskTables), true);
});
