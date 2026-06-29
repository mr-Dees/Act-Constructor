import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterRows, sortRows, paginate } from '../../static/js/shared/datatable/datatable-logic.js';

const columns = [
  { key: 'tb', type: 'dictionary', format: (v, d) => (d.tb || {})[v] || String(v) },
  { key: 'sum', type: 'number', format: v => Number(v).toLocaleString('ru-RU', { minimumFractionDigits: 2 }) },
  { key: 'name', type: 'text' },
];
const dicts = { tb: { 1: 'ВВБ', 2: 'ЦА' } };
const rows = [
  { id: 1, tb: 1, sum: 1234.5, name: 'Альфа' },
  { id: 2, tb: 2, sum: 98000, name: 'Бета' },
];

test('фильтр по отображаемому значению справочника', () => {
  assert.deepEqual(filterRows(rows, columns, { tb: 'ввб' }, dicts).map(r => r.id), [1]);
});

test('фильтр по форматированному числу', () => {
  assert.deepEqual(filterRows(rows, columns, { sum: '1 234' }, dicts).map(r => r.id), [1]);
});

test('несколько фильтров комбинируются по И', () => {
  assert.deepEqual(filterRows(rows, columns, { tb: 'ц', name: 'бет' }, dicts).map(r => r.id), [2]);
});

test('пустой фильтр не режет', () => {
  assert.equal(filterRows(rows, columns, { name: '' }, dicts).length, 2);
});

test('сортировка чисел по убыванию', () => {
  assert.deepEqual(sortRows(rows, columns[1], 'desc').map(r => r.id), [2, 1]);
});

test('сортировка текста по-русски', () => {
  assert.deepEqual(sortRows(rows, columns[2], 'asc').map(r => r.id), [1, 2]);
});

test('paginate отдаёт страницу и число страниц', () => {
  const r = paginate([1, 2, 3, 4, 5], 2, 2);
  assert.deepEqual(r.pageRows, [3, 4]);
  assert.equal(r.totalPages, 3);
});
