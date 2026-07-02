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

test('#5 setAllVisible(false) оставляет первую ВИДИМУЮ-ПО-УМОЛЧАНИЮ, а не служебную hidden:true', () => {
  const cols = [{ key: 'a', width: 100, hidden: true }, { key: 'b', width: 100 }, { key: 'c', width: 100 }];
  const s = new TableViewState({ storageKey: 'ck:test:view:allvis', columns: cols, storage: fakeStorage() });
  s.setAllVisible(false);
  assert.deepEqual(s.getVisibleKeys(), ['b']); // 'a' — hidden:true, оставляем первую default-visible
});

test('#11 сериализация: {v:2, hidden[], known[], widths}', () => {
  const st = fakeStorage();
  const s = make(st);
  s.setVisible('b', false);
  s.setWidth('a', 150);
  const stored = JSON.parse(st.getItem('ck:test:view:v1'));
  assert.equal(stored.v, 2);
  assert.deepEqual(stored.hidden, ['b']);        // хранятся СКРЫТЫЕ, не видимые
  assert.deepEqual(stored.known, ['a', 'b', 'c']); // снимок всех ключей на момент сохранения
  assert.deepEqual(stored.widths, { a: 150 });
});

test('#11 новая default-visible колонка (добавлена в конфиг после сохранения) — видима', () => {
  const st = fakeStorage();
  const s1 = make(st);
  s1.setVisible('b', false); // пользователь скрыл b
  // Позже в конфиг добавилась новая default-visible колонка 'd'
  const colsV2 = [{ key: 'a', width: 100 }, { key: 'b', width: 100 }, { key: 'c', width: 100 }, { key: 'd', width: 100 }];
  const s2 = new TableViewState({ storageKey: 'ck:test:view:v1', columns: colsV2, storage: st });
  assert.deepEqual(s2.getVisibleKeys(), ['a', 'c', 'd']); // b осталась скрытой, d — новая и видимая
});

test('#11 новая hidden:true колонка (добавлена в конфиг после сохранения) — скрыта', () => {
  const st = fakeStorage();
  const s1 = make(st);
  s1.setVisible('b', false);
  // Позже добавилась служебная колонка 'svc' с hidden:true
  const colsV2 = [{ key: 'a', width: 100 }, { key: 'b', width: 100 }, { key: 'c', width: 100 }, { key: 'svc', width: 100, hidden: true }];
  const s2 = new TableViewState({ storageKey: 'ck:test:view:v1', columns: colsV2, storage: st });
  assert.deepEqual(s2.getVisibleKeys(), ['a', 'c']); // svc не был в снимке и hidden:true → скрыт
});

test('#11 включённая вручную hidden:true колонка остаётся видимой после перезагрузки', () => {
  const cols = [{ key: 'a', width: 100 }, { key: 'b', width: 100, hidden: true }, { key: 'c', width: 100 }];
  const st = fakeStorage();
  const s1 = new TableViewState({ storageKey: 'ck:test:view:togglehid', columns: cols, storage: st });
  s1.setVisible('b', true);
  const s2 = new TableViewState({ storageKey: 'ck:test:view:togglehid', columns: cols, storage: st });
  assert.deepEqual(s2.getVisibleKeys(), ['a', 'b', 'c']); // b была в снимке и не в hidden → видима
});

test('#11 старое состояние v1 игнорируется → дефолт (обратная совместимость не нужна)', () => {
  const st = fakeStorage();
  st.setItem('ck:test:view:v1', JSON.stringify({ v: 1, visible: ['a'], widths: { a: 999 } }));
  const s = make(st);
  assert.deepEqual(s.getVisibleKeys(), ['a', 'b', 'c']); // v1 не читается → все видимы по дефолту
  assert.equal(s.getWidth('a'), 100);                    // ширина из v1 не подхватилась
});
