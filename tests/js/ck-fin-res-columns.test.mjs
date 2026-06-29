import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CkFinResConfig } from '../../static/js/portal/ck-fin-res/ck-fin-res-config.js';

test('колонки выводятся из fields + extra впереди', () => {
  const keys = CkFinResConfig.columns.map(c => c.key);
  assert.deepEqual(keys.slice(0, 4), ['id', 'created_at', 'metric_name', 'act_sub_number']);
  for (const k of ['metric_code', 'km_id', 'metric_amount_rubles', 'deviation_description', 'num_sz']) {
    assert.ok(keys.includes(k), `нет колонки ${k}`);
  }
});

test('metric_code → «Код метрики», metric_name → «Метрика»', () => {
  const cols = CkFinResConfig.columns;
  assert.equal(cols.find(c => c.key === 'metric_code').label, 'Код метрики');
  assert.equal(cols.find(c => c.key === 'metric_name').label, 'Метрика');
});

test('сумма: align right + формат с разделителями тысяч', () => {
  const sum = CkFinResConfig.columns.find(c => c.key === 'metric_amount_rubles');
  assert.equal(sum.align, 'right');
  assert.equal(typeof sum.format, 'function');
  assert.match(sum.format(1234567.89), /1.234.567/);
});

test('ТБ форматируется через terbanks; длинные тексты — longText', () => {
  const cols = CkFinResConfig.columns;
  const tb = cols.find(c => c.key === 'neg_finder_tb_id');
  assert.equal(tb.label, 'ТБ');
  assert.equal(tb.format(1, { terbanks: [{ tb_id: 1, short_name: 'ВВБ' }] }), 'ВВБ');
  assert.equal(cols.find(c => c.key === 'deviation_description').longText, true);
});
