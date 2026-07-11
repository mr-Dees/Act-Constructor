/**
 * «Вся капсула как юнит»: чистый предикат _rangeIsWholeCapsule (+ его хелперы
 * _capsuleAncestor / _boundaryNodeAfter / _boundaryNodeBefore) на ФЕЙКОВЫХ
 * node-деревьях. Тот же приём, что textblock-capsule-dedup-determinism.test.mjs:
 * реального DOM-Range в node нет, поэтому строим минимальные узлы с полями,
 * которые читает предикат (nodeType/data/childNodes/siblings/parentElement/
 * classList). DOM/selection/keyboard/undo-поведение (Shift+←/→, execCommand
 * delete, .node-selected, _deleteCapsuleWhole) — за Playwright.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextBlockManager } from '../../static/js/constructor/textblock/textblock-core.js';
import '../../static/js/constructor/textblock/textblock-editor.js';
import '../../static/js/constructor/textblock/textblock-capsule-integrity.js';

globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };

const GUARD = '﻿';
const makeMgr = () => Object.create(TextBlockManager.prototype);

/** Фейк текстового узла (в т.ч. guard при data===U+FEFF). */
function textNode(data) {
  return { nodeType: 3, data, parentElement: null, nextSibling: null, previousSibling: null };
}
const guardNode = () => textNode(GUARD);

/** Фейк-капсула (ссылка/сноска); editing → добавляет класс editing-mode. */
function capsule({ footnote = false, editing = false } = {}) {
  const classes = new Set([footnote ? 'text-footnote' : 'text-link']);
  if (editing) classes.add('editing-mode');
  return {
    nodeType: 1,
    classList: { contains: (c) => classes.has(c) },
    childNodes: [],
    parentElement: null, nextSibling: null, previousSibling: null,
  };
}

/** Капсула с текстовым телом (для клип-кейса «граница внутри тела»). */
function capsuleWithBody(text, opts) {
  const cap = capsule(opts);
  const body = textNode(text);
  body.parentElement = cap;
  cap.childNodes = [body];
  cap._body = body;
  return cap;
}

/** Обычный inline-элемент (не капсула). */
function plainEl(text = 'x') {
  const t = textNode(text);
  const el = {
    nodeType: 1, classList: { contains: () => false },
    childNodes: [t], parentElement: null, nextSibling: null, previousSibling: null,
  };
  t.parentElement = el;
  return el;
}

/** Редактор-контейнер: держит children и разводит siblings/parentElement.
 *  contains(n) → true для любого узла, кроме самого редактора (как реальный DOM
 *  для потомков; _capsuleAncestor останавливается на el===editor раньше). */
function makeEditor(children) {
  const editor = {
    nodeType: 1, classList: { contains: () => false }, childNodes: children,
  };
  editor.contains = (n) => n != null && n !== editor;
  children.forEach((c, i) => {
    c.parentElement = editor;
    c.previousSibling = children[i - 1] || null;
    c.nextSibling = children[i + 1] || null;
  });
  return editor;
}

const range = (sc, so, ec, eo) => ({
  collapsed: false, startContainer: sc, startOffset: so, endContainer: ec, endOffset: eo,
});

// --------------------------- _rangeIsWholeCapsule ---------------------------

test('whole-bracket с ведущим и хвостовым guard → возвращает капсулу', () => {
  const mgr = makeMgr();
  const g1 = guardNode(), cap = capsule(), g2 = guardNode();
  const ed = makeEditor([g1, cap, g2]);
  assert.equal(mgr._rangeIsWholeCapsule(range(ed, 0, ed, 3), ed), cap);
});

test('whole-bracket без guard (граница ровно по краям капсулы) → возвращает капсулу', () => {
  const mgr = makeMgr();
  const a = plainEl('a'), cap = capsule({ footnote: true }), b = plainEl('b');
  const ed = makeEditor([a, cap, b]);
  assert.equal(mgr._rangeIsWholeCapsule(range(ed, 1, ed, 2), ed), cap);
});

test('guard включён только с одной стороны → всё равно возвращает капсулу', () => {
  const mgr = makeMgr();
  const g1 = guardNode(), cap = capsule(), b = plainEl('b');
  const ed = makeEditor([g1, cap, b]);
  // start в редакторе с 0 (включает g1), end на 2 (после капсулы, без хвост.guard)
  assert.equal(mgr._rangeIsWholeCapsule(range(ed, 0, ed, 2), ed), cap);
});

test('старт ВНУТРИ ведущего guard-узла (offset 0) → капсула (текст-контейнер путь)', () => {
  const mgr = makeMgr();
  const g1 = guardNode(), cap = capsule(), g2 = guardNode();
  const ed = makeEditor([g1, cap, g2]);
  assert.equal(mgr._rangeIsWholeCapsule(range(g1, 0, ed, 3), ed), cap);
});

test('частичный клип: конец ВНУТРИ тела капсулы → null', () => {
  const mgr = makeMgr();
  const a = plainEl('a'), cap = capsuleWithBody('ссылка');
  const ed = makeEditor([a, cap]);
  assert.equal(mgr._rangeIsWholeCapsule(range(ed, 0, cap._body, 2), ed), null);
});

test('капсула в editing-mode целиком в выделении → null (обычный текст, CARET-1)', () => {
  const mgr = makeMgr();
  const g1 = guardNode(), cap = capsule({ editing: true }), g2 = guardNode();
  const ed = makeEditor([g1, cap, g2]);
  assert.equal(mgr._rangeIsWholeCapsule(range(ed, 0, ed, 3), ed), null);
});

test('две капсулы в выделении → null (не один узел между границами)', () => {
  const mgr = makeMgr();
  const c1 = capsule(), c2 = capsule();
  const ed = makeEditor([c1, c2]);
  assert.equal(mgr._rangeIsWholeCapsule(range(ed, 0, ed, 2), ed), null);
});

test('единственный узел между границами — не капсула → null', () => {
  const mgr = makeMgr();
  const a = plainEl('a');
  const ed = makeEditor([a]);
  assert.equal(mgr._rangeIsWholeCapsule(range(ed, 0, ed, 1), ed), null);
});

test('схлопнутый диапазон → null', () => {
  const mgr = makeMgr();
  const cap = capsule();
  const ed = makeEditor([cap]);
  const r = { collapsed: true, startContainer: ed, startOffset: 0, endContainer: ed, endOffset: 0 };
  assert.equal(mgr._rangeIsWholeCapsule(r, ed), null);
});

test('капсула + соседний текст в выделении → null (лишний узел)', () => {
  const mgr = makeMgr();
  const cap = capsule(), b = plainEl('b');
  const ed = makeEditor([cap, b]);
  assert.equal(mgr._rangeIsWholeCapsule(range(ed, 0, ed, 2), ed), null);
});

// ----------------------------- _capsuleAncestor -----------------------------

test('_capsuleAncestor: текст внутри капсулы → капсула', () => {
  const mgr = makeMgr();
  const cap = capsuleWithBody('t');
  const ed = makeEditor([cap]);
  assert.equal(mgr._capsuleAncestor(cap._body, ed), cap);
});

test('_capsuleAncestor: текст внутри editing-капсулы → null', () => {
  const mgr = makeMgr();
  const cap = capsuleWithBody('t', { editing: true });
  const ed = makeEditor([cap]);
  assert.equal(mgr._capsuleAncestor(cap._body, ed), null);
});

test('_capsuleAncestor: сам редактор → null', () => {
  const mgr = makeMgr();
  const ed = makeEditor([plainEl('a')]);
  assert.equal(mgr._capsuleAncestor(ed, ed), null);
});

test('_capsuleAncestor: обычный текст без капсулы-предка → null', () => {
  const mgr = makeMgr();
  const a = plainEl('a');
  const ed = makeEditor([a]);
  assert.equal(mgr._capsuleAncestor(a.childNodes[0], ed), null);
});

test('_capsuleAncestor: текст в ВЛОЖЕННОМ элементе внутри капсулы → капсула (walk-up)', () => {
  // Ядро DRY-выноса: подъём по parentElement сквозь <b> внутри капсулы находит
  // капсулу (а не останавливается на первом родителе). Оба expand-хелпера
  // (toolbar/live-Range и capsule-integrity/StaticRange) опираются на это.
  const mgr = makeMgr();
  const cap = capsule();
  const b = plainEl('x');           // <b>x</b> внутри капсулы
  b.parentElement = cap;
  cap.childNodes = [b];
  const ed = makeEditor([cap]);
  assert.equal(mgr._capsuleAncestor(b.childNodes[0], ed), cap);
});

// ------------------------ _boundaryNodeAfter/Before -------------------------

test('_boundaryNodeAfter: элемент-контейнер → childNodes[offset]', () => {
  const mgr = makeMgr();
  const a = plainEl('a'), cap = capsule();
  const ed = makeEditor([a, cap]);
  assert.equal(mgr._boundaryNodeAfter(ed, 1), cap);
  assert.equal(mgr._boundaryNodeAfter(ed, 2), null); // за концом
});

test('_boundaryNodeBefore: элемент-контейнер → childNodes[offset-1]', () => {
  const mgr = makeMgr();
  const a = plainEl('a'), cap = capsule();
  const ed = makeEditor([a, cap]);
  assert.equal(mgr._boundaryNodeBefore(ed, 2), cap);
  assert.equal(mgr._boundaryNodeBefore(ed, 0), null); // до начала
});

test('_boundaryNodeAfter: текст-контейнер в конце → следующий сосед', () => {
  const mgr = makeMgr();
  const g = guardNode(), cap = capsule();
  makeEditor([g, cap]);
  assert.equal(mgr._boundaryNodeAfter(g, g.data.length), cap); // offset===len → nextSibling
  assert.equal(mgr._boundaryNodeAfter(g, 0), g);               // offset<len → сам текст
});
