import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterRows, sortRows, sortRowsMulti, paginate } from '../../static/js/shared/datatable/datatable-logic.js';

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

test('мультисортировка: вторичный ключ разрешает равенство по первичному', () => {
  const data = [
    { id: 1, grp: 1, name: 'Б' },
    { id: 2, grp: 1, name: 'А' },
    { id: 3, grp: 2, name: 'В' },
  ];
  const cols = { grp: { key: 'grp', type: 'number' }, name: { key: 'name', type: 'text' } };
  // grp по возрастанию; внутри grp=1 — name по возрастанию (А раньше Б) → 2,1; затем grp=2 → 3
  const out = sortRowsMulti(data, [
    { column: cols.grp, dir: 'asc' },
    { column: cols.name, dir: 'asc' },
  ]).map(r => r.id);
  assert.deepEqual(out, [2, 1, 3]);
});

test('sortRowsMulti без спецификаций — копия в исходном порядке', () => {
  const data = [{ id: 3 }, { id: 1 }];
  const out = sortRowsMulti(data, []);
  assert.deepEqual(out.map(r => r.id), [3, 1]);
  assert.notEqual(out, data);
});

test('paginate отдаёт страницу и число страниц', () => {
  const r = paginate([1, 2, 3, 4, 5], 2, 2);
  assert.deepEqual(r.pageRows, [3, 4]);
  assert.equal(r.totalPages, 3);
});
