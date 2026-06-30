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

test('3-позиционная сортировка по клику: норм → возр → убыв → норм', () => {
  const dt = makeTable();
  assert.equal(dt._sortKey, null); // исходно — без сортировки
  dt.setSort('name');
  assert.equal(dt._sortKey, 'name');
  assert.equal(dt._sortDir, 'asc');
  dt.setSort('name');
  assert.equal(dt._sortKey, 'name');
  assert.equal(dt._sortDir, 'desc');
  dt.setSort('name'); // третий клик — возврат к исходному порядку
  assert.equal(dt._sortKey, null);
  assert.equal(dt._sortDir, 'asc');
});

test('переключение на другую колонку всегда начинает с возрастания', () => {
  const dt = makeTable();
  dt.setSort('name');
  dt.setSort('name'); // desc
  dt.setSort('id'); // другая колонка → asc
  assert.equal(dt._sortKey, 'id');
  assert.equal(dt._sortDir, 'asc');
});

test('сброс фильтров обнуляет и сортировку', () => {
  const dt = makeTable();
  dt.setFilter('name', 'abc');
  dt.setSort('id');
  assert.equal(dt._sortKey, 'id');
  dt.clearFilters();
  assert.deepEqual(dt._filters, {});
  assert.equal(dt._sortKey, null);
  assert.equal(dt._sortDir, 'asc');
});

// Перехватываем setAttribute на создаваемой th, чтобы проверить aria-sort
// (на реальном DOM это th[aria-sort="…"] → CSS-подсветка отсортированной колонки).
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

test('_buildHeaderCell помечает aria-sort только на активной колонке', () => {
  const dt = makeTable();
  dt._sortKey = 'name';
  dt._sortDir = 'desc';
  assert.equal(buildHeaderThAttrs(dt, { key: 'name', label: 'Имя' })['aria-sort'], 'descending');
  // другая (неотсортированная) колонка aria-sort не получает
  assert.equal(buildHeaderThAttrs(dt, { key: 'id', label: 'ID' })['aria-sort'], undefined);
});
