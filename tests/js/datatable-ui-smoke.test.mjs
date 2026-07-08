import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachColumnResize } from '../../static/js/shared/datatable/column-resize.js';
import { ColumnVisibility } from '../../static/js/shared/datatable/column-visibility.js';
import { DataTable } from '../../static/js/shared/datatable/data-table.js';

test('UI-экспорты доступны и не падают на стаб-DOM', () => {
  const thead = document.createElement('thead');
  assert.doesNotThrow(() => attachColumnResize({
    theadEl: thead, columns: [{ key: 'a' }], viewState: { getWidth: () => 100, setWidth() {} },
  }));
  assert.equal(typeof ColumnVisibility.mount, 'function');
});

test('DataTable.render не падает в client-mode (стаб-DOM)', async () => {
  const columns = [
    { key: 'id', label: 'ID', type: 'id', align: 'left', width: 70 },
    { key: 'name', label: 'Имя', type: 'text', align: 'left', width: 160 },
  ];
  const view = {
    getVisibleKeys: () => ['id', 'name'],
    isVisible: () => true,
    getWidth: () => 100,
  };
  const ds = { mode: 'client', total: 2, getAllRows: () => [{ id: 1, name: 'A' }, { id: 2, name: 'B' }] };
  const dt = new DataTable({
    mountEl: document.createElement('div'), columns, viewState: view, dataSource: ds,
    dicts: {}, pageSize: 50, onRowSelect: () => {},
  });
  await assert.doesNotReject(async () => dt.render());
  assert.equal(dt.getVisibleColumns().length, 2);
});

test('_buildHeaderCell (заголовок-поле) строится без отдельной строки фильтров', () => {
  const view = { getWidth: () => 120 };
  const dt = new DataTable({
    mountEl: document.createElement('div'),
    columns: [{ key: 'code', label: 'Код метрики', type: 'text' }],
    viewState: view, dataSource: { mode: 'client', total: 0, getAllRows: () => [] },
    dicts: {}, pageSize: 50,
  });
  // На стаб-DOM проверяем, что построение ячейки-заголовка не бросает
  // (инпут поиска + каретка сортировки + крестик внутри одной th).
  assert.doesNotThrow(() => dt._buildHeaderCell({ key: 'code', label: 'Код метрики' }));
});

test('noSort-колонка не создаёт кнопку сортировки в заголовке', () => {
  const view = { getWidth: () => 120 };
  const dt = new DataTable({
    mountEl: document.createElement('div'),
    columns: [{ key: 'amt', label: 'Сумма', type: 'text' }],
    viewState: view, dataSource: { mode: 'client', total: 0, getAllRows: () => [] },
    dicts: {}, pageSize: 50,
  });
  // Стаб-DOM не хранит детей (appendChild — no-op) и querySelector всегда
  // возвращает null, поэтому дерево заголовка не обойти. Вместо этого ловим
  // сами createElement-вызовы: у элементов с className 'dt-th-sort' (кнопка
  // сортировки) он выставляется на тот же объект уже ПОСЛЕ создания, а ссылка
  // сохранена — читаем className постфактум.
  const origCreateElement = document.createElement;
  const created = [];
  document.createElement = (tag) => {
    const el = origCreateElement(tag);
    created.push(el);
    return el;
  };
  try {
    dt._buildHeaderCell({ key: 'amt', label: 'Сумма', noSort: true });
  } finally {
    document.createElement = origCreateElement;
  }
  assert.ok(!created.some(el => el.className === 'dt-th-sort'),
    'noSort-колонка не должна создавать кнопку сортировки (.dt-th-sort)');
});
