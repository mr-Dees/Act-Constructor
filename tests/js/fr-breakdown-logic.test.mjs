import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractNplBreakdown, mergeTbBreakdowns } from '../../static/js/portal/ck-fin-res/fr-breakdown-logic.js';

// ── extractNplBreakdown ─────────────────────────────────────────────────────

test('extractNplBreakdown: берёт только строки с NPL > 0, кладёт NPL в metric_amount_rubles', () => {
  const rows = [
    { neg_finder_tb_id: '7', metric_amount_rubles: '300000.00', npl_amount_rubles: '120000.00' },
    { neg_finder_tb_id: '8', metric_amount_rubles: '150000.00', npl_amount_rubles: '0' },
  ];
  assert.deepEqual(extractNplBreakdown(rows), [
    { neg_finder_tb_id: '7', metric_amount_rubles: '120000.00' },
  ]);
});

test('extractNplBreakdown: пусто/undefined → []', () => {
  assert.deepEqual(extractNplBreakdown([]), []);
  assert.deepEqual(extractNplBreakdown(undefined), []);
});

test('extractNplBreakdown: отсутствующее поле npl_amount_rubles трактуется как 0 (не падает)', () => {
  assert.deepEqual(extractNplBreakdown([{ neg_finder_tb_id: '1', metric_amount_rubles: '10.00' }]), []);
});

// ── mergeTbBreakdowns ────────────────────────────────────────────────────────

test('mergeTbBreakdowns: union по ТБ, недостающие значения нулевые', () => {
  const main = [{ neg_finder_tb_id: '7', metric_amount_rubles: '300000.00', metric_element_counts: 2 }];
  const npl = [
    { neg_finder_tb_id: '7', metric_amount_rubles: '120000.00' },
    { neg_finder_tb_id: '1', metric_amount_rubles: '5000.00' },
  ];
  assert.deepEqual(mergeTbBreakdowns(main, npl), [
    { neg_finder_tb_id: '7', metric_amount_rubles: '300000.00', metric_element_counts: 2, npl_amount_rubles: '120000.00' },
    { neg_finder_tb_id: '1', metric_amount_rubles: '0.00', metric_element_counts: 0, npl_amount_rubles: '5000.00' },
  ]);
});

test('mergeTbBreakdowns: пустой NPL — у всех npl 0.00', () => {
  const main = [{ neg_finder_tb_id: '7', metric_amount_rubles: '300000.00', metric_element_counts: 2 }];
  assert.deepEqual(mergeTbBreakdowns(main, []), [
    { neg_finder_tb_id: '7', metric_amount_rubles: '300000.00', metric_element_counts: 2, npl_amount_rubles: '0.00' },
  ]);
});

test('mergeTbBreakdowns: пустой main — строки только-NPL с суммой 0.00', () => {
  const npl = [{ neg_finder_tb_id: '3', metric_amount_rubles: '900.00' }];
  assert.deepEqual(mergeTbBreakdowns([], npl), [
    { neg_finder_tb_id: '3', metric_amount_rubles: '0.00', metric_element_counts: 0, npl_amount_rubles: '900.00' },
  ]);
});

test('mergeTbBreakdowns: пустые/undefined входы → []', () => {
  assert.deepEqual(mergeTbBreakdowns([], []), []);
  assert.deepEqual(mergeTbBreakdowns(undefined, undefined), []);
});
