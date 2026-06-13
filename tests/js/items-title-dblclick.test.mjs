/**
 * render-5: редактирование заголовков пункта и таблицы запускается нативным
 * событием dblclick, а не ручным 300мс таймером по click. Одиночный клик
 * больше не должен ни планировать таймер, ни запускать редактирование.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ItemsRenderer } from '../../static/js/constructor/items/items-renderer.js';
import { ItemsTitleEditing } from '../../static/js/constructor/items/items-title-editing.js';

/** Элемент с честным dispatch: вызывает зарегистрированные слушатели по типу. */
function makeEl() {
  const handlers = {};
  return {
    style: {},
    addEventListener(type, fn) { (handlers[type] ||= []).push(fn); },
    dispatch(type) { (handlers[type] || []).forEach(fn => fn()); },
    _handlers: handlers,
  };
}

test('заголовок пункта: dblclick запускает редактирование, click — нет', () => {
  const el = makeEl();
  const node = { id: 'n1', label: 'Пункт' };

  let started = 0;
  const orig = ItemsTitleEditing.startEditingItemTitle;
  ItemsTitleEditing.startEditingItemTitle = () => { started++; };
  try {
    ItemsRenderer._setupTitleEditing(el, node);

    assert.ok(el._handlers.dblclick, 'dblclick-слушатель не навешан');
    assert.ok(!el._handlers.click, 'остался устаревший click-слушатель');

    el.dispatch('click');
    assert.equal(started, 0, 'одиночный клик запустил редактирование');

    el.dispatch('dblclick');
    assert.equal(started, 1, 'dblclick не запустил редактирование');
  } finally {
    ItemsTitleEditing.startEditingItemTitle = orig;
  }

  assert.equal(el.style.cursor, 'pointer');
});

test('заголовок таблицы: dblclick запускает редактирование, click — нет', () => {
  const el = makeEl();
  const node = { id: 't1', customLabel: 'Таблица 1' };

  let started = 0;
  const orig = ItemsTitleEditing.startEditingTableTitle;
  ItemsTitleEditing.startEditingTableTitle = () => { started++; };
  try {
    ItemsRenderer._setupTableTitleEditing(el, node);

    assert.ok(el._handlers.dblclick);
    assert.ok(!el._handlers.click);

    el.dispatch('click');
    assert.equal(started, 0);

    el.dispatch('dblclick');
    assert.equal(started, 1);
  } finally {
    ItemsTitleEditing.startEditingTableTitle = orig;
  }
});
