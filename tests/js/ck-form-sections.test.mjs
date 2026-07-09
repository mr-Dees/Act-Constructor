import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CkForm } from '../../static/js/shared/ck/ck-form.js';
import { flattenFields } from '../../static/js/shared/datatable/build-columns.js';

const SECTIONED = [
  { section: 'Идентификация', key: 'ident', fields: [
    { key: 'a', label: 'A', type: 'text', required: true },
    { row: [ { key: 'b', label: 'B', type: 'text' }, { key: 'c', label: 'C', type: 'date' } ] },
  ]},
  { section: 'Прочее', key: 'misc', fields: [
    { key: 'd', label: 'D', type: 'number' },
  ]},
];

test('flattenFields раскрывает секции и row-группы в плоский список ключей', () => {
  assert.deepEqual(flattenFields(SECTIONED).map(f => f.key), ['a', 'b', 'c', 'd']);
});

test('flattenFields совместим со старым плоским конфигом (без секций)', () => {
  const flat = [ { key: 'x' }, { row: [ { key: 'y' }, { key: 'z' } ] } ];
  assert.deepEqual(flattenFields(flat).map(f => f.key), ['x', 'y', 'z']);
});

test('#15: CkForm не держит собственный _flattenFields (делегирует в общий)', () => {
  // Приватный обход удалён — форма и колонки строятся из одного flattenFields
  // (build-columns.js), иначе поля формы и колонки таблицы могут разойтись.
  assert.equal(CkForm._flattenFields, undefined);
});

test('CkForm._findFieldConfig учитывает секции (через общий flattenFields)', () => {
  CkForm.init({ fields: SECTIONED, dictionaries: {}, containerEl: document.createElement('div') });
  assert.equal(CkForm._findFieldConfig('c').label, 'C');
  assert.equal(CkForm._findFieldConfig('zzz'), null);
});

test('CkForm.init с sectionStateKey читает свёрнутые секции из localStorage', () => {
  const origGet = globalThis.localStorage.getItem;
  globalThis.localStorage.getItem = (k) =>
    (k === 'test:sections' ? JSON.stringify(['misc']) : null);
  try {
    CkForm.init({
      fields: SECTIONED, dictionaries: {},
      containerEl: document.createElement('div'),
      sectionStateKey: 'test:sections',
    });
    assert.ok(CkForm._collapsed.has('misc'), 'секция misc восстановлена как свёрнутая');
    assert.ok(!CkForm._collapsed.has('ident'));
  } finally {
    globalThis.localStorage.getItem = origGet;
  }
});

test('collectData: nullable-число — пустое → null; обычное число — пустое → 0, заполненное → Number', () => {
  const FIELDS = [
    { key: 'opt_num', label: 'Опц. число', type: 'number', nullable: true },
    { key: 'req_num', label: 'Число', type: 'number' },
  ];
  CkForm.init({ fields: FIELDS, dictionaries: {}, containerEl: document.createElement('div') });
  // Стаб-DOM не индексирует элементы — подменяем getElementById на словарь инпутов.
  const els = {
    'ck-field-opt_num': { value: '' },
    'ck-field-req_num': { value: '' },
  };
  const origGet = document.getElementById;
  document.getElementById = (id) => els[id] || null;
  try {
    let data = CkForm.collectData();
    assert.equal(data.opt_num, null); // opt-in nullable: пусто → null, не 0
    assert.equal(data.req_num, 0);    // прежнее поведение прочих чисел сохранено
    els['ck-field-opt_num'].value = '42';
    data = CkForm.collectData();
    assert.equal(data.opt_num, 42);   // заполненное nullable — обычное число
  } finally {
    document.getElementById = origGet;
  }
});
