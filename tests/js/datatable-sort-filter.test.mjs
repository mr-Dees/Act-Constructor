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

test('переключение на другую колонку всегда начинает с возрастания', () => {
  const dt = makeTable();
  dt.setSort('name');
  dt.setSort('name'); // desc
  dt.setSort('id'); // другая колонка → одиночная asc (сбрасывает остальные)
  assert.deepEqual(dt._sort, [{ key: 'id', dir: 'asc' }]);
});

test('мультисортировка: Shift-добавление вторичной колонки, цикл asc → desc → убрать', () => {
  const dt = makeTable();
  dt.setSort('name'); // [name asc]
  dt.setSort('id', true); // append → [name asc, id asc]
  assert.deepEqual(dt._sort, [{ key: 'name', dir: 'asc' }, { key: 'id', dir: 'asc' }]);
  dt.setSort('id', true); // id asc → desc
  assert.deepEqual(dt._sort, [{ key: 'name', dir: 'asc' }, { key: 'id', dir: 'desc' }]);
  dt.setSort('id', true); // id desc → убрать из набора (остальные сохраняют порядок)
  assert.deepEqual(dt._sort, [{ key: 'name', dir: 'asc' }]);
});

test('обычный клик при мультисортировке сбрасывает набор к одной колонке', () => {
  const dt = makeTable();
  dt.setSort('name');
  dt.setSort('id', true); // [name, id]
  dt.setSort('name'); // обычный клик → одиночная сортировка по name (asc)
  assert.deepEqual(dt._sort, [{ key: 'name', dir: 'asc' }]);
});

test('сброс фильтров обнуляет и сортировку', () => {
  const dt = makeTable();
  dt.setFilter('name', 'abc');
  dt.setSort('id');
  dt.setSort('name', true); // мультисортировка активна
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
