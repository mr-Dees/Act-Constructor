import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractMplBreakdown, mergeTbBreakdowns } from '../../static/js/portal/ck-fin-res/fr-breakdown-logic.js';

// ── extractMplBreakdown ─────────────────────────────────────────────────────

test('extractMplBreakdown: берёт только строки с MPL > 0, кладёт MPL в metric_amount_rubles', () => {
  const rows = [
    { neg_finder_tb_id: '7', metric_amount_rubles: '300000.00', mpl_amount_rubles: '120000.00' },
    { neg_finder_tb_id: '8', metric_amount_rubles: '150000.00', mpl_amount_rubles: '0' },
  ];
  assert.deepEqual(extractMplBreakdown(rows), [
    { neg_finder_tb_id: '7', metric_amount_rubles: '120000.00' },
  ]);
});

test('extractMplBreakdown: пусто/undefined → []', () => {
  assert.deepEqual(extractMplBreakdown([]), []);
  assert.deepEqual(extractMplBreakdown(undefined), []);
});

test('extractMplBreakdown: отсутствующее поле mpl_amount_rubles трактуется как 0 (не падает)', () => {
  assert.deepEqual(extractMplBreakdown([{ neg_finder_tb_id: '1', metric_amount_rubles: '10.00' }]), []);
});

// ── mergeTbBreakdowns ────────────────────────────────────────────────────────

test('mergeTbBreakdowns: union по ТБ, недостающие значения нулевые', () => {
  const main = [{ neg_finder_tb_id: '7', metric_amount_rubles: '300000.00', metric_element_counts: 2 }];
  const mpl = [
    { neg_finder_tb_id: '7', metric_amount_rubles: '120000.00' },
    { neg_finder_tb_id: '1', metric_amount_rubles: '5000.00' },
  ];
  assert.deepEqual(mergeTbBreakdowns(main, mpl), [
    { neg_finder_tb_id: '7', metric_amount_rubles: '300000.00', metric_element_counts: 2, mpl_amount_rubles: '120000.00' },
    { neg_finder_tb_id: '1', metric_amount_rubles: '0.00', metric_element_counts: 0, mpl_amount_rubles: '5000.00' },
  ]);
});

test('mergeTbBreakdowns: пустой MPL — у всех mpl 0.00', () => {
  const main = [{ neg_finder_tb_id: '7', metric_amount_rubles: '300000.00', metric_element_counts: 2 }];
  assert.deepEqual(mergeTbBreakdowns(main, []), [
    { neg_finder_tb_id: '7', metric_amount_rubles: '300000.00', metric_element_counts: 2, mpl_amount_rubles: '0.00' },
  ]);
});

test('mergeTbBreakdowns: пустой main — строки только-MPL с суммой 0.00', () => {
  const mpl = [{ neg_finder_tb_id: '3', metric_amount_rubles: '900.00' }];
  assert.deepEqual(mergeTbBreakdowns([], mpl), [
    { neg_finder_tb_id: '3', metric_amount_rubles: '0.00', metric_element_counts: 0, mpl_amount_rubles: '900.00' },
  ]);
});

test('mergeTbBreakdowns: пустые/undefined входы → []', () => {
  assert.deepEqual(mergeTbBreakdowns([], []), []);
  assert.deepEqual(mergeTbBreakdowns(undefined, undefined), []);
});
