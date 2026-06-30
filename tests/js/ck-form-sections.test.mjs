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

test('CkForm._flattenFields и _findFieldConfig учитывают секции', () => {
  CkForm.init({ fields: SECTIONED, dictionaries: {}, containerEl: document.createElement('div') });
  assert.deepEqual(CkForm._flattenFields().map(f => f.key), ['a', 'b', 'c', 'd']);
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
