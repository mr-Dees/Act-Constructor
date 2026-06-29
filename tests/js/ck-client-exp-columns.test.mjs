import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CkClientExpConfig } from '../../static/js/portal/ck-client-exp/ck-client-exp-config.js';

test('колонки выводятся из fields + extra впереди', () => {
  const keys = CkClientExpConfig.columns.map(c => c.key);
  assert.deepEqual(keys.slice(0, 4), ['id', 'created_at', 'metric_name', 'act_sub_number']);
  for (const k of ['metric_code', 'km_id', 'metric_amount_rubles', 'metric_unic_clients', 'num_sz']) {
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
