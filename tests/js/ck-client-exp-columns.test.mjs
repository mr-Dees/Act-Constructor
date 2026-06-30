import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CkClientExpConfig } from '../../static/js/portal/ck-client-exp/ck-client-exp-config.js';

test('логический порядок: id первым, «Код метрики» вплотную к «Метрике»', () => {
  const keys = CkClientExpConfig.columns.map(c => c.key);
  assert.equal(keys[0], 'id');
  const ci = keys.indexOf('metric_code');
  assert.equal(keys[ci + 1], 'metric_name'); // код метрики идёт сразу перед названием
  for (const k of ['km_id', 'metric_amount_rubles', 'metric_unic_clients', 'num_sz', 'created_at']) {
    assert.ok(keys.includes(k), `нет колонки ${k}`);
  }
});

test('metric_code → «Код метрики», metric_name → «Метрика»', () => {
  const cols = CkClientExpConfig.columns;
  assert.equal(cols.find(c => c.key === 'metric_code').label, 'Код метрики');
  assert.equal(cols.find(c => c.key === 'metric_name').label, 'Метрика');
});

test('сумма: align right + формат с разделителями тысяч', () => {
  const sum = CkClientExpConfig.columns.find(c => c.key === 'metric_amount_rubles');
  assert.equal(sum.align, 'right');
  assert.equal(typeof sum.format, 'function');
  assert.match(sum.format(1234567.89), /1.234.567/);
});

test('metric_unic_clients присутствует как колонка с align right', () => {
  const col = CkClientExpConfig.columns.find(c => c.key === 'metric_unic_clients');
  assert.ok(col, 'нет колонки metric_unic_clients');
  assert.equal(col.align, 'right');
});

test('ТБ форматируется через terbanks', () => {
  const tb = CkClientExpConfig.columns.find(c => c.key === 'neg_finder_tb_id');
  assert.equal(tb.label, 'ТБ');
  assert.equal(tb.format(1, { terbanks: [{ tb_id: 1, short_name: 'ВВБ' }] }), 'ВВБ');
});
