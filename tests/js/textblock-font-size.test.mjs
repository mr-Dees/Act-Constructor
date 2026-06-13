/**
 * textblock-1: applyFontSize должен преобразовывать в span ТОЛЬКО font[size="7"],
 * созданные текущим execCommand('fontSize','7'), а не все font[size=7] в блоке.
 * Пред-существующий font[size="7"] (юзер раньше явно выставил word-размер 7)
 * не относится к текущей операции и не должен затрагиваться.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextBlockManager } from '../../static/js/constructor/textblock/textblock-core.js';
import '../../static/js/constructor/textblock/textblock-toolbar.js';

/** font-тег с минимумом полей, которые читает applyFontSize. */
function makeFontTag(label) {
  return {
    label,
    innerHTML: label,
    style: {},
    parentNode: { replaceChild() {} },
    querySelectorAll: () => [],
  };
}

/**
 * Мок-редактор: список font[size="7"] настраивается; execCommand добавляет
 * НОВЫЙ font-тег (симуляция браузерного fontSize=7 на выделении).
 */
function makeEditor(initialFont7) {
  const font7 = [...initialFont7];
  const created = [];
  return {
    dataset: { textBlockId: 'tb1' },
    innerHTML: '<p>x</p>',
    style: {},
    focus() {},
    _font7: font7,
    _created: created,
    querySelectorAll(sel) {
      if (sel === 'font[size="7"]') return font7;
      if (sel === '.text-link, .text-footnote') return [];
      return [];
    },
    _execAddsFont7() {
      const tag = makeFontTag(`new${created.length}`);
      font7.push(tag);
      created.push(tag);
      return tag;
    },
  };
}

function makeManager(editor) {
  const mgr = Object.create(TextBlockManager.prototype);
  mgr.activeEditor = editor;
  mgr.fontSizes = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];
  mgr.saved = [];
  mgr.saveContent = (id, content) => mgr.saved.push({ id, content });
  // execCommand добавляет новый font-тег, имитируя браузер.
  mgr.execCommand = () => { editor._execAddsFont7(); };
  return mgr;
}

const SELECTION = {
  isCollapsed: false,
  rangeCount: 1,
  getRangeAt: () => ({ intersectsNode: () => false }),
  removeAllRanges() {},
  addRange() {},
};

test('пред-существующий font[size="7"] не преобразуется — затрагивается только новый', () => {
  const foreign = makeFontTag('foreign'); // чужой тег вне текущей операции
  const editor = makeEditor([foreign]);
  const mgr = makeManager(editor);

  globalThis.window = globalThis;
  globalThis.getSelection = () => SELECTION;
  globalThis.document = {
    createElement: () => ({ style: {}, innerHTML: '', querySelectorAll: () => [] }),
    createRange: () => ({ setStartBefore() {}, setEndAfter() {} }),
  };

  let foreignReplaced = false;
  foreign.parentNode = { replaceChild: () => { foreignReplaced = true; } };

  mgr.applyFontSize(18);

  assert.equal(foreignReplaced, false, 'чужой font[size="7"] ошибочно преобразован');
  assert.equal(editor._created.length, 1, 'execCommand должен был создать один новый тег');
  // Новый тег преобразован в span с нужным размером.
  assert.equal(editor._created[0].style.fontSize, undefined,
    'у исходного font-тега fontSize не ставится — он переносится в span');
});

test('новый font[size="7"] преобразуется в span с точным размером', () => {
  const editor = makeEditor([]);
  const mgr = makeManager(editor);

  const createdSpans = [];
  globalThis.window = globalThis;
  globalThis.getSelection = () => SELECTION;
  globalThis.document = {
    createElement: () => {
      const span = { style: {}, innerHTML: '', querySelectorAll: () => [] };
      createdSpans.push(span);
      return span;
    },
    createRange: () => ({ setStartBefore() {}, setEndAfter() {} }),
  };

  mgr.applyFontSize(20);

  assert.equal(createdSpans.length, 1, 'должен быть создан ровно один span');
  assert.equal(createdSpans[0].style.fontSize, '20px');
  assert.equal(mgr.saved.length, 1);
});
