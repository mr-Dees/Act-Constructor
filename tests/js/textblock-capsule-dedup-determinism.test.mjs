/**
 * CORE-2: детерминированная починка дубль-id капсул. Прежний _freshMarkerId
 * (Date.now()+Math.random()) на каждом прогоне давал бы РАЗНЫЙ id → каждое
 * сохранение писало иной content («вечно грязный» акт), а живой DOM расходился
 * с сохранённым до ре-рендера. Дериватив _derivedDuplicateId детерминирован:
 * тот же вход → побайтно тот же выход; повторный прогон ничего не меняет.
 *
 * Реального DOM-парсера (<template>) в node нет — тестируем ядро логики
 * _repairCapsulesInRoot на фейковых капсулах/root и pure-функцию
 * _derivedDuplicateId напрямую (тот же приём, что в
 * textblock-capsule-observer-editing.test.mjs).
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextBlockManager } from '../../static/js/constructor/textblock/textblock-core.js';
import '../../static/js/constructor/textblock/textblock-editor.js';
import '../../static/js/constructor/textblock/textblock-capsule-integrity.js';

globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };

/** Фейк-родитель: _areAdjacentSplit сравнивает parentNode по ссылке. */
function fakeParent() {
  return { replaceChild() {}, removeChild() {} };
}

/** Фейк-капсула-ссылка: ровно те поля, что читает/пишет _repairCapsulesInRoot. */
function fakeLink(id, url, text, parent) {
  const classes = new Set(['text-link']);
  const attrs = { 'data-link-id': id, 'data-link-url': url, contenteditable: 'false' };
  return {
    nodeType: 1,
    classList: { contains: (c) => classes.has(c) },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = v; },
    removeAttribute: (k) => { delete attrs[k]; },
    textContent: text,
    parentNode: parent,
    nextSibling: null,
  };
}

// fakeRoot без firstChild → _cleanCapGuards (обходит editor.firstChild) — no-op.
const fakeRoot = (capsules) => ({ querySelectorAll: () => capsules });
const makeMgr = () => Object.create(TextBlockManager.prototype);

test('CORE-2: дубль-id чинится ДЕТЕРМИНИРОВАННО — два прогона дают идентичный результат', () => {
  const mgr = makeMgr();
  // Два независимых дубля (разные parent → не расщеплённый клон, а новый id).
  const build = () => [
    fakeLink('L1', 'http://a', 'A', fakeParent()),
    fakeLink('L1', 'http://b', 'B', fakeParent()),
  ];
  const run = () => {
    const caps = build();
    mgr._repairCapsulesInRoot(fakeRoot(caps));
    return caps.map((c) => c.getAttribute('data-link-id'));
  };
  const first = run();
  const second = run();
  assert.deepEqual(first, second);       // тот же вход → тот же выход (не timestamp)
  assert.equal(first[0], 'L1');          // оригинал не тронут
  assert.equal(first[1], 'L1_d1');       // дубль — детерминированный суффикс
  assert.notEqual(first[0], first[1]);   // дубль устранён
});

test('CORE-2: три одинаковых id → детерминированные разные суффиксы', () => {
  const mgr = makeMgr();
  const caps = [
    fakeLink('L1', 'http://a', 'A', fakeParent()),
    fakeLink('L1', 'http://b', 'B', fakeParent()),
    fakeLink('L1', 'http://c', 'C', fakeParent()),
  ];
  mgr._repairCapsulesInRoot(fakeRoot(caps));
  const ids = caps.map((c) => c.getAttribute('data-link-id'));
  assert.deepEqual(ids, ['L1', 'L1_d1', 'L1_d2']);
  assert.equal(new Set(ids).size, 3); // все уникальны
});

test('CORE-2: повторный прогон над починенными капсулами не меняет id (changed=false)', () => {
  const mgr = makeMgr();
  const caps = [
    fakeLink('L1', 'http://a', 'A', fakeParent()),
    fakeLink('L1', 'http://b', 'B', fakeParent()),
  ];
  const changed1 = mgr._repairCapsulesInRoot(fakeRoot(caps));
  assert.equal(changed1, true); // первый прогон чинил дубль
  const after1 = caps.map((c) => c.getAttribute('data-link-id'));
  const changed2 = mgr._repairCapsulesInRoot(fakeRoot(caps));
  assert.equal(changed2, false); // второй — нечего чинить (идемпотентность)
  const after2 = caps.map((c) => c.getAttribute('data-link-id'));
  assert.deepEqual(after2, after1);
});

test('CORE-2: _derivedDuplicateId обходит коллизию с существующим id, детерминирован', () => {
  const mgr = makeMgr();
  const seen = new Map([['L1', {}], ['L1_d1', {}]]); // L1_d1 уже занят
  assert.equal(mgr._derivedDuplicateId('L1', seen), 'L1_d2'); // следующий свободный
  assert.equal(mgr._derivedDuplicateId('L1', seen), 'L1_d2'); // тот же вход → тот же выход
});

test('CORE-2: разные исходные id → разные производные', () => {
  const mgr = makeMgr();
  const seen = new Map([['A', {}], ['B', {}]]);
  assert.notEqual(mgr._derivedDuplicateId('A', seen), mgr._derivedDuplicateId('B', seen));
});

test('CORE-2: здоровая одиночная капсула → changed=false (write-back не триггерится)', () => {
  const mgr = makeMgr();
  const caps = [fakeLink('L1', 'http://a', 'A', fakeParent())];
  const changed = mgr._repairCapsulesInRoot(fakeRoot(caps));
  assert.equal(changed, false); // косметика (снятие contenteditable) — не «починка»
  assert.equal(caps[0].getAttribute('data-link-id'), 'L1');
  assert.equal(caps[0].getAttribute('contenteditable'), null); // снят, но changed=false
});

test('CORE-2: пустой url → капсула развёрнута в текст (changed=true)', () => {
  const mgr = makeMgr();
  const caps = [fakeLink('L1', '', 'слово', fakeParent())];
  const changed = mgr._repairCapsulesInRoot(fakeRoot(caps));
  assert.equal(changed, true); // структурная починка
});
