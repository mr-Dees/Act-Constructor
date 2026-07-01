import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TableViewState } from '../../static/js/shared/datatable/table-view-state.js';

function fakeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
  };
}

const columns = [{ key: 'a', width: 100 }, { key: 'b', width: 100 }, { key: 'c', width: 100 }];
const make = (storage = fakeStorage()) => new TableViewState({ storageKey: 'ck:test:view:v1', columns, storage });

test('по умолчанию видимы все', () => {
  assert.deepEqual(make().getVisibleKeys(), ['a', 'b', 'c']);
});

test('setVisible(false) скрывает; нельзя скрыть последнюю', () => {
  const s = make();
  s.setVisible('a', false);
  s.setVisible('b', false);
  assert.deepEqual(s.getVisibleKeys(), ['c']);
  s.setVisible('c', false); // игнор — последняя
  assert.deepEqual(s.getVisibleKeys(), ['c']);
});

test('setAllVisible(false) оставляет первую', () => {
  const s = make();
  s.setAllVisible(false);
  assert.deepEqual(s.getVisibleKeys(), ['a']);
});

test('ширина: setWidth/getWidth, fallback на column.width', () => {
  const s = make();
  assert.equal(s.getWidth('a'), 100);
  s.setWidth('a', 250);
  assert.equal(s.getWidth('a'), 250);
});

test('persist+restore через storage', () => {
  const st = fakeStorage();
  const s1 = make(st);
  s1.setVisible('b', false);
  s1.setWidth('a', 222);
  const s2 = make(st);
  assert.deepEqual(s2.getVisibleKeys(), ['a', 'c']);
  assert.equal(s2.getWidth('a'), 222);
});

test('битое состояние → дефолт', () => {
  const st = fakeStorage();
  st.setItem('ck:test:view:v1', '{not json');
  assert.deepEqual(make(st).getVisibleKeys(), ['a', 'b', 'c']);
});

test('resetToDefault сбрасывает видимость и ширины', () => {
  const s = make();
  s.setVisible('a', false);
  s.setWidth('b', 300);
  s.resetToDefault();
  assert.deepEqual(s.getVisibleKeys(), ['a', 'b', 'c']);
  assert.equal(s.getWidth('b'), 100);
});

test('колонка с hidden:true скрыта по умолчанию; включается вручную', () => {
  const cols = [{ key: 'a', width: 100 }, { key: 'b', width: 100, hidden: true }, { key: 'c', width: 100 }];
  const s = new TableViewState({ storageKey: 'ck:test:view:hid', columns: cols, storage: fakeStorage() });
  assert.deepEqual(s.getVisibleKeys(), ['a', 'c']); // b скрыта по умолчанию
  s.setVisible('b', true);
  assert.deepEqual(s.getVisibleKeys(), ['a', 'b', 'c']);
});

test('resetToDefault возвращает hidden-по-умолчанию, а не «всё видимо»', () => {
  const cols = [{ key: 'a', width: 100 }, { key: 'b', width: 100, hidden: true }];
  const s = new TableViewState({ storageKey: 'ck:test:view:hid2', columns: cols, storage: fakeStorage() });
  s.setVisible('b', true);
  assert.deepEqual(s.getVisibleKeys(), ['a', 'b']);
  s.resetToDefault();
  assert.deepEqual(s.getVisibleKeys(), ['a']); // b снова скрыта
});
