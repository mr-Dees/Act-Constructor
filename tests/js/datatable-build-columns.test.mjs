import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildColumns, DEFAULT_WIDTHS } from '../../static/js/shared/datatable/build-columns.js';

const fields = [
  { key: 'metric_code', label: 'Метрика', type: 'dictionary' },
  { row: [
    { key: 'num_sz', label: '№ с/з', type: 'text' },
    { key: 'metric_amount_rubles', label: 'Сумма (руб.)', type: 'number' },
  ] },
  { key: 'deviation_description', label: 'Описание', type: 'textarea' },
];

test('разворачивает row-группы в плоский список', () => {
  const cols = buildColumns(fields);
  assert.deepEqual(cols.map(c => c.key),
    ['metric_code', 'num_sz', 'metric_amount_rubles', 'deviation_description']);
});

test('number → align right, textarea → longText', () => {
  const cols = buildColumns(fields);
  const sum = cols.find(c => c.key === 'metric_amount_rubles');
  assert.equal(sum.align, 'right');
  assert.equal(cols.find(c => c.key === 'deviation_description').longText, true);
});

test('extra-колонки идут впереди', () => {
  const cols = buildColumns(fields, { extra: [{ key: 'id', label: 'ID', type: 'id' }] });
  assert.equal(cols[0].key, 'id');
});

test('overrides перекрывают label/align/format', () => {
  const fmt = v => `#${v}`;
  const cols = buildColumns(fields, { overrides: { metric_code: { label: 'Код метрики', format: fmt } } });
  const c = cols.find(x => x.key === 'metric_code');
  assert.equal(c.label, 'Код метрики');
  assert.equal(c.format(7), '#7');
});

test('order переупорядочивает колонки', () => {
  const cols = buildColumns(fields, { order: ['deviation_description', 'metric_code'] });
  assert.equal(cols[0].key, 'deviation_description');
  assert.equal(cols[1].key, 'metric_code');
});

test('description поля пробрасывается в колонку (для tooltip)', () => {
  const cols = buildColumns([{ key: 'x', label: 'X', type: 'number', description: 'Полное описание X' }]);
  assert.equal(cols.find(c => c.key === 'x').description, 'Полное описание X');
});

test('ширина по типу из DEFAULT_WIDTHS, поле.width перекрывает', () => {
  const cols = buildColumns([
    { key: 'd', label: 'D', type: 'date' },
    { key: 'w', label: 'W', type: 'text', width: 333 },
  ]);
  assert.equal(cols[0].width, DEFAULT_WIDTHS.date);
  assert.equal(cols[1].width, 333);
});
