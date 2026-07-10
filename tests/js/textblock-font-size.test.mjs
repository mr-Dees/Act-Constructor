/**
 * B-24/B-2: applyFontSize без execCommand/font[size=7].
 *  - С выделением: оборачивает в span[style=font-size] через
 *    range.extractContents()+insertNode (сохраняя вложенную разметку).
 *  - На каретке (collapsed): материализует размер в content span'ом с ZWSP-якорем,
 *    а НЕ в editor.style (флагман data-loss B-2 — стиль контейнера в innerHTML
 *    не попадает и терялся при reload/preview/export).
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextBlockManager } from '../../static/js/constructor/textblock/textblock-core.js';
import '../../static/js/constructor/textblock/textblock-toolbar.js';

/** Минимальная заглушка span/элемента, читаемая applyFontSize. */
function makeSpanStub() {
  return {
    style: {},
    _children: [],
    firstChild: null,
    classList: { contains: () => false },
    appendChild(node) {
      this._children.push(node);
      if (!this.firstChild) this.firstChild = node;
      return node;
    },
    querySelectorAll: () => [],
    getAttribute: () => null,
    setAttribute() {},
    removeAttribute() {},
  };
}

function installDom(createdSpans) {
  globalThis.window = globalThis;
  globalThis.document = {
    createElement: () => {
      const s = makeSpanStub();
      createdSpans.push(s);
      return s;
    },
    createRange: () => ({
      selectNodeContents() {},
      setStart() {},
      collapse() {},
    }),
    createTextNode: (t) => ({ nodeType: 3, textContent: t }),
  };
}

function makeEditor() {
  return {
    dataset: { textBlockId: 'tb1' },
    innerHTML: '<p>x</p>',
    style: {},
    focus() {},
    // finalizeEdit (единый сток) опрашивает капсулы и число сносок.
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

function makeManager(editor) {
  const mgr = Object.create(TextBlockManager.prototype);
  mgr.activeEditor = editor;
  mgr.fontSizes = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
  mgr.saved = [];
  mgr.saveContent = (id, content) => mgr.saved.push({ id, content });
  // _toggleEmptyClass живёт в textblock-editor.js (тут не импортирован) — стаб.
  mgr._toggleEmptyClass = () => {};
  mgr.updateToolbarState = () => {};
  return mgr;
}

test('B-24: выделение оборачивается в span[style=font-size] без execCommand', () => {
  const editor = makeEditor();
  const mgr = makeManager(editor);
  const createdSpans = [];
  installDom(createdSpans);

  let extracted = false;
  let inserted = null;
  const fragment = { _kind: 'fragment' };
  const range = {
    extractContents() { extracted = true; return fragment; },
    insertNode(node) { inserted = node; },
  };
  globalThis.getSelection = () => ({
    isCollapsed: false,
    rangeCount: 1,
    getRangeAt: () => range,
    removeAllRanges() {},
    addRange() {},
  });

  mgr.applyFontSize(20);

  assert.equal(extracted, true, 'range.extractContents должен быть вызван (B-24, без font7)');
  assert.ok(inserted, 'обёрнутый span должен быть вставлен через insertNode');
  assert.equal(inserted.style.fontSize, '20px');
  assert.equal(editor.style.fontSize, undefined, 'editor.style НЕ трогаем при выделении');
  assert.equal(mgr.saved.length, 1);
});

test('B-2: размер на каретке материализуется span+ZWSP в content, НЕ в editor.style', () => {
  const editor = makeEditor();
  const mgr = makeManager(editor);
  const createdSpans = [];
  installDom(createdSpans);

  let inserted = null;
  const range = { insertNode(node) { inserted = node; } };
  globalThis.getSelection = () => ({
    isCollapsed: true,
    rangeCount: 1,
    getRangeAt: () => range,
    removeAllRanges() {},
    addRange() {},
  });

  mgr.applyFontSize(28);

  assert.ok(inserted, 'span с размером должен быть вставлен в каретку');
  assert.equal(inserted.style.fontSize, '28px');
  // Флагман B-2: editor.style.fontSize НЕ выставляется.
  assert.equal(editor.style.fontSize, undefined);
  // ZWSP-якорь добавлен внутрь span (будущий ввод унаследует размер).
  assert.equal(inserted._children.length, 1);
  assert.equal(inserted._children[0].textContent, '​');
  assert.equal(mgr.saved.length, 1);
});

test('размер клампится по границам шрифта (выходит за max → не применяется буквально)', () => {
  const editor = makeEditor();
  const mgr = makeManager(editor);
  const createdSpans = [];
  installDom(createdSpans);

  let inserted = null;
  const range = { insertNode(node) { inserted = node; } };
  globalThis.getSelection = () => ({
    isCollapsed: true,
    rangeCount: 1,
    getRangeAt: () => range,
    removeAllRanges() {},
    addRange() {},
  });

  mgr.applyFontSize(999);

  assert.ok(inserted);
  // 999 зажат к максимуму палитры/границ (≤ 72).
  assert.ok(parseInt(inserted.style.fontSize) <= 72);
});
