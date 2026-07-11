import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterRows, sortRows, sortRowsMulti, paginate, specMatches, compareBy,
} from '../../static/js/shared/datatable/datatable-logic.js';

// Канон фильтра — СЫРЬЁ. filterMap = dict[colKey → FilterSpec].
const columns = [
  { key: 'tb', type: 'dictionary' },   // сырое — id (число/строка)
  { key: 'sum', type: 'number' },      // сырое — число
  { key: 'name', type: 'text' },
  { key: 'dt', type: 'date' },
];
const rows = [
  { id: 1, tb: 1, sum: 1234.5, name: 'Альфа', dt: '2025-02-01' },
  { id: 2, tb: 2, sum: 98000, name: 'Бета', dt: '2025-05-10' },
];

test('specMatches contains — по сырому тексту', () => {
  assert.equal(specMatches('Альфа', { op: 'contains', value: 'льф' }), true);
  assert.equal(specMatches('Альфа', { op: 'contains', value: 'бет' }), false);
  assert.equal(specMatches('x', { op: 'contains', value: '' }), true); // пустой — не режет
});

test('specMatches eq — точное равенство', () => {
  assert.equal(specMatches(true, { op: 'eq', value: 'true' }), true);
  assert.equal(specMatches(false, { op: 'eq', value: 'true' }), false);
  assert.equal(specMatches('a', { op: 'eq', value: '' }), true); // пустой — не режет
});

test('specMatches in — членство по сырому id; пустой массив → совпадений нет', () => {
  assert.equal(specMatches(1, { op: 'in', values: ['1', '14'] }), true);
  assert.equal(specMatches(2, { op: 'in', values: ['1', '14'] }), false);
  assert.equal(specMatches(1, { op: 'in', values: [] }), false); // in:[] → ничего не совпадает
});

test('specMatches: массив скаляров — in совпадает, если хотя бы один элемент входит в values', () => {
  assert.equal(specMatches(['7', '8'], { op: 'in', values: ['1', '8'] }), true); // пересечение есть
  assert.equal(specMatches(['7', '9'], { op: 'in', values: ['1', '8'] }), false); // пересечения нет
  assert.equal(specMatches([], { op: 'in', values: ['1', '8'] }), false); // пустой массив — нечему совпасть
});

test('specMatches: массив скаляров — eq/contains совпадают по хотя бы одному элементу', () => {
  assert.equal(specMatches(['1', '2'], { op: 'eq', value: '2' }), true);
  assert.equal(specMatches(['1', '2'], { op: 'eq', value: '3' }), false);
  assert.equal(specMatches(['Альфа', 'Бета'], { op: 'contains', value: 'льф' }), true);
  assert.equal(specMatches(['Гамма', 'Дельта'], { op: 'contains', value: 'льф' }), false);
});

test('specMatches range date — включительно от/до', () => {
  const s = { op: 'range', cast: 'date', from: '2025-03-01', to: '2025-06-01' };
  assert.equal(specMatches('2025-05-10', s), true);
  assert.equal(specMatches('2025-02-01', s), false);
  assert.equal(specMatches('2025-06-01', { op: 'range', cast: 'date', to: '2025-06-01' }), true);
});

test('specMatches range date — сравнение по календарному ДНЮ: timestamp-значение и date-only границы не теряют граничные строки', () => {
  // Раньше Date.parse смешивал зоны: 'YYYY-MM-DD' — UTC, 'YYYY-MM-DDTHH:MM' — местное,
  // и строки ровно на границе выпадали. Теперь всё приводится к местной полуночи дня.
  const s = { op: 'range', cast: 'date', from: '2025-06-01', to: '2025-06-01' };
  assert.equal(specMatches('2025-06-01T00:30:00', s), true);  // раннее утро граничного дня
  assert.equal(specMatches('2025-06-01T23:30:00', s), true);  // поздний вечер: «по» включает день целиком
  assert.equal(specMatches('2025-05-31T23:59:00', s), false);
  assert.equal(specMatches('2025-06-02T00:10:00', s), false);
});

test('specMatches range numeric — только нижняя граница', () => {
  const s = { op: 'range', cast: 'numeric', from: '1000' };
  assert.equal(specMatches(1234.5, s), true);
  assert.equal(specMatches(500, s), false);
});

test('contains_any: хотя бы одна фраза', () => {
  assert.equal(specMatches('Есть риск просрочки', { op: 'contains_any', values: ['штраф', 'риск'] }), true);
  assert.equal(specMatches('Всё хорошо', { op: 'contains_any', values: ['штраф', 'риск'] }), false);
});
test('contains_any: пустые значения не фильтруют', () => {
  assert.equal(specMatches('что угодно', { op: 'contains_any', values: [] }), true);
  assert.equal(specMatches('что угодно', { op: 'contains_any', values: ['', '  '] }), true);
});
test('contains_any: массивная семантика (filterValue)', () => {
  assert.equal(specMatches(['ЦА', 'ББ'], { op: 'contains_any', values: ['цa'] }), false); // латинская a
  assert.equal(specMatches(['ЦА', 'ББ'], { op: 'contains_any', values: ['ца'] }), true);
});

test('filterRows: словарь по сырому id (op in)', () => {
  assert.deepEqual(filterRows(rows, columns, { tb: { op: 'in', values: ['1'] } }).map(r => r.id), [1]);
});

test('filterRows: число по подстроке сырого значения', () => {
  assert.deepEqual(filterRows(rows, columns, { sum: { op: 'contains', value: '1234' } }).map(r => r.id), [1]);
});

test('filterRows: дата-диапазон', () => {
  const out = filterRows(rows, columns, { dt: { op: 'range', cast: 'date', from: '2025-04-01', to: '2025-12-31' } });
  assert.deepEqual(out.map(r => r.id), [2]);
});

test('filterRows: колонка с filterValue берёт сырое значение через аксессор, а не record[key]', () => {
  const colsWithAccessor = [
    // record.breakdown — массив ОБЪЕКТОВ; filterValue проецирует его в массив id.
    { key: 'breakdown', type: 'dictionary', filterValue: (r) => (r.breakdown || []).map(b => String(b.tb_id)) },
  ];
  const data = [
    { id: 1, breakdown: [{ tb_id: 7 }, { tb_id: 8 }] },
    { id: 2, breakdown: [{ tb_id: 9 }] },
  ];
  const out = filterRows(data, colsWithAccessor, { breakdown: { op: 'in', values: ['8'] } });
  assert.deepEqual(out.map(r => r.id), [1]);
});

test('filterRows: колонка БЕЗ filterValue — поведение не меняется (record[key] как раньше)', () => {
  assert.deepEqual(filterRows(rows, columns, { tb: { op: 'in', values: ['2'] } }).map(r => r.id), [2]);
});

test('filterRows: несколько фильтров комбинируются по И', () => {
  const out = filterRows(rows, columns, {
    tb: { op: 'in', values: ['2'] },
    name: { op: 'contains', value: 'бет' },
  });
  assert.deepEqual(out.map(r => r.id), [2]);
});

test('filterRows: пустой набор/пустые спеки не режут', () => {
  assert.equal(filterRows(rows, columns, { name: { op: 'contains', value: '' } }).length, 2);
  assert.equal(filterRows(rows, columns, {}).length, 2);
});

test('compareBy: id сортируется ЧИСЛЕННО (не 1,10,2)', () => {
  const data = [{ id: 2 }, { id: 10 }, { id: 1 }];
  const col = { key: 'id', type: 'id' };
  const out = data.slice().sort((a, b) => compareBy(a, b, col, 'asc')).map(r => r.id);
  assert.deepEqual(out, [1, 2, 10]);
});

test('compareBy: нечисловое содержимое числовой колонки — строковый фолбэк, а не no-op (NaN)', () => {
  // Синтетический групповой id вида «36|КМ-…» в колонке типа id: Number() даёт NaN,
  // раньше компаратор возвращал NaN и сортировка не делала ничего.
  const data = [{ id: '7|КМ-2' }, { id: '36|КМ-1' }, { id: '14|КМ-3' }];
  const col = { key: 'id', type: 'id' };
  const out = data.slice().sort((a, b) => compareBy(a, b, col, 'asc')).map(r => r.id);
  assert.deepEqual(out, ['14|КМ-3', '36|КМ-1', '7|КМ-2']); // localeCompare-порядок, стабильный
});

test('compareBy: дата — хронологически', () => {
  const col = { key: 'dt', type: 'date' };
  const out = rows.slice().sort((a, b) => compareBy(a, b, col, 'asc')).map(r => r.id);
  assert.deepEqual(out, [1, 2]); // 2025-02-01 < 2025-05-10
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
