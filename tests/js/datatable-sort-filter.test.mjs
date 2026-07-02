import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataTable } from '../../static/js/shared/datatable/data-table.js';

function makeTable() {
  const columns = [
    { key: 'id', label: 'ID', type: 'id' },
    { key: 'name', label: 'Имя', type: 'text' },
  ];
  const view = { getVisibleKeys: () => ['id', 'name'], isVisible: () => true, getWidth: () => 100 };
  const ds = { mode: 'client', total: 0, getAllRows: () => [] };
  return new DataTable({
    mountEl: document.createElement('div'),
    columns, viewState: view, dataSource: ds, dicts: {}, pageSize: 50,
  });
}

test('одиночная сортировка по клику: норм → возр → убыв → норм', () => {
  const dt = makeTable();
  assert.deepEqual(dt._sort, []); // исходно — без сортировки
  dt.setSort('name');
  assert.deepEqual(dt._sort, [{ key: 'name', dir: 'asc' }]);
  dt.setSort('name');
  assert.deepEqual(dt._sort, [{ key: 'name', dir: 'desc' }]);
  dt.setSort('name'); // третий клик — возврат к исходному порядку
  assert.deepEqual(dt._sort, []);
});

test('клик по второй колонке НАКАПЛИВАЕТ её в наборе (без модификаторов)', () => {
  const dt = makeTable();
  dt.setSort('name'); // [name asc]
  dt.setSort('id');   // + id → [name asc, id asc]
  assert.deepEqual(dt._sort, [{ key: 'name', dir: 'asc' }, { key: 'id', dir: 'asc' }]);
});

test('смена направления ведущей колонки сохраняет накопленный набор и порядок', () => {
  const dt = makeTable();
  dt.setSort('name'); // [name asc]
  dt.setSort('id');   // [name asc, id asc]
  dt.setSort('name'); // name asc → desc, id и порядок сохраняются
  assert.deepEqual(dt._sort, [{ key: 'name', dir: 'desc' }, { key: 'id', dir: 'asc' }]);
});

test('колонка проходит цикл возр → убыв → убрать; остальные держат порядок', () => {
  const dt = makeTable();
  dt.setSort('name'); // [name asc]
  dt.setSort('id');   // [name asc, id asc]
  dt.setSort('id');   // id asc → desc
  assert.deepEqual(dt._sort, [{ key: 'name', dir: 'asc' }, { key: 'id', dir: 'desc' }]);
  dt.setSort('id');   // id desc → убрать из набора
  assert.deepEqual(dt._sort, [{ key: 'name', dir: 'asc' }]);
});

test('сброс фильтров обнуляет и сортировку', () => {
  const dt = makeTable();
  dt.setFilter('name', 'abc');
  dt.setSort('id');
  dt.setSort('name'); // накопленный набор [id, name]
  dt.clearFilters();
  assert.deepEqual(dt._filters, {});
  assert.deepEqual(dt._sort, []);
});

// Перехватываем setAttribute на создаваемой th, чтобы проверить aria-sort
// (на реальном DOM это th[aria-sort="…"]; визуальная подсветка идёт через
// класс .dt-th--sorted, а aria-sort — только на ведущей колонке набора).
function buildHeaderThAttrs(dt, col) {
  const attrs = {};
  const origCreate = document.createElement;
  document.createElement = (tag) => {
    const el = origCreate(tag);
    if (tag === 'th') el.setAttribute = (k, v) => { attrs[k] = v; };
    return el;
  };
  try { dt._buildHeaderCell(col); } finally { document.createElement = origCreate; }
  return attrs;
}

test('_buildHeaderCell: aria-sort только на ведущей колонке набора сортировки', () => {
  const dt = makeTable();
  dt._sort = [{ key: 'name', dir: 'desc' }, { key: 'id', dir: 'asc' }];
  // ведущая (приоритет 1) — aria-sort соответствует направлению
  assert.equal(buildHeaderThAttrs(dt, { key: 'name', label: 'Имя' })['aria-sort'], 'descending');
  // вторичная колонка набора — без aria-sort (по ARIA-спеке атрибут на одной колонке)
  assert.equal(buildHeaderThAttrs(dt, { key: 'id', label: 'ID' })['aria-sort'], undefined);
  // колонка вне набора — без aria-sort
  assert.equal(buildHeaderThAttrs(dt, { key: 'other', label: 'Другое' })['aria-sort'], undefined);
});

test('setFilter строит contains-спек и сохраняет текст UI', () => {
  const dt = makeTable();
  dt.setFilter('name', 'абв');
  assert.deepEqual(dt._filters.name, { op: 'contains', value: 'абв' });
  assert.equal(dt._filterText.name, 'абв');
  dt.setFilter('name', ''); // пусто → фильтр снимается
  assert.equal(dt._filters.name, undefined);
});

test('_specFromText: словарь → in через filterResolve, число → contains нормализованный', () => {
  const dt = makeTable();
  const dictCol = { key: 'tb', type: 'dictionary', filterResolve: (q) => (q === 'вв' ? ['1', '2'] : []) };
  assert.deepEqual(dt._specFromText(dictCol, 'вв'), { op: 'in', values: ['1', '2'] });
  const numCol = { key: 'sum', type: 'number' };
  assert.deepEqual(dt._specFromText(numCol, '1 234,50'), { op: 'contains', value: '1234.50' });
  assert.equal(dt._specFromText(numCol, '   '), null);
});

test('_specFromRange: даты от/до → range cast date', () => {
  const dt = makeTable();
  assert.deepEqual(dt._specFromRange('2025-01-01', '2025-06-30'),
    { op: 'range', cast: 'date', from: '2025-01-01', to: '2025-06-30' });
  assert.deepEqual(dt._specFromRange('2025-01-01', ''),
    { op: 'range', cast: 'date', from: '2025-01-01', to: null });
  assert.equal(dt._specFromRange('', ''), null);
});

test('#6: _pruneHiddenFilters снимает фильтры невидимых колонок', () => {
  const dt = makeTable();
  dt._filters = { id: { op: 'contains', value: '1' }, name: { op: 'contains', value: 'a' } };
  dt._filterText = { id: '1', name: 'a' };
  dt._pruneHiddenFilters(['name']); // видима только name
  assert.deepEqual(Object.keys(dt._filters), ['name']);
  assert.deepEqual(Object.keys(dt._filterText), ['name']);
});

test('#8: _pageWindow окно вокруг текущей страницы, текущая всегда внутри', () => {
  const dt = makeTable();
  assert.deepEqual(dt._pageWindow(1, 16), [1, 2, 3, 4, 5]);
  assert.deepEqual(dt._pageWindow(12, 16), [10, 11, 12, 13, 14]);
  assert.deepEqual(dt._pageWindow(16, 16), [12, 13, 14, 15, 16]);
  assert.deepEqual(dt._pageWindow(2, 3), [1, 2, 3]); // мало страниц — всё окно
  assert.ok(dt._pageWindow(12, 16).includes(12));
});
