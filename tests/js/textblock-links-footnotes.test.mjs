/**
 * textblock-6/2: общий поток создания/редактирования ссылок и сносок
 * (_createOrEditInlineMarker) и поиск существующего маркера по началу
 * выделения (range.startContainer), а не по anchorNode.
 *
 * При обратном выделении (снизу вверх / справа налево) anchorNode — это
 * КОНЕЦ выделения; маркер в начале выделения через anchorNode не находился,
 * и редактирование создавало вложенный дубль вместо правки существующего.
 */
import './_browser-stub.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TextBlockManager } from '../../static/js/constructor/textblock/textblock-core.js';
import '../../static/js/constructor/textblock/textblock-links-footnotes.js';

/** Фейковый элемент-маркер (ссылка/сноска) с атрибутами и classList. */
function makeMarker(className, attrs = {}) {
  const store = { ...attrs };
  return {
    nodeType: 1,
    classList: { contains: (c) => c === className },
    getAttribute: (k) => (k in store ? store[k] : null),
    setAttribute: (k, v) => { store[k] = v; },
    parentElement: null,
    _attrs: store,
  };
}

/** Текстовый узел внутри родителя. */
function makeTextNode(parentElement) {
  return { nodeType: 3, parentElement };
}

/** Менеджер без конструктора DOM: прототип + фейковый активный редактор. */
function makeManager() {
  const mgr = Object.create(TextBlockManager.prototype);
  mgr.activeEditor = {
    dataset: { textBlockId: 'tb1' },
    innerHTML: '<p>контент</p>',
    // finalizeEdit (единый сток) опрашивает капсулы и число сносок.
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  mgr.saved = [];
  mgr.saveContent = (id, content) => mgr.saved.push({ id, content });
  // _toggleEmptyClass живёт в textblock-editor.js (тут не импортирован) — стаб.
  mgr._toggleEmptyClass = () => {};
  mgr.attachCalls = 0;
  mgr.attachLinkFootnoteHandlers = () => { mgr.attachCalls++; };
  return mgr;
}

let promptValue = null;
let alerts = [];
beforeEach(() => {
  promptValue = null;
  alerts = [];
  globalThis.prompt = () => promptValue;
  globalThis.alert = (msg) => alerts.push(msg);
});

/** Selection: anchorNode — конец выделения, range.startContainer — начало. */
function makeSelection({ anchorNode, startContainer }) {
  return {
    isCollapsed: false,
    anchorNode,
    rangeCount: 1,
    getRangeAt: () => ({
      startContainer,
      toString: () => 'текст',
    }),
    removeAllRanges() {},
    addRange() {},
  };
}

test('редактирование ссылки: маркер ищется по началу выделения (обратное выделение)', () => {
  const mgr = makeManager();
  const link = makeMarker('text-link', { 'data-link-url': 'http://old' });
  link.parentElement = mgr.activeEditor;
  const insideLink = makeTextNode(link);
  const afterLink = makeTextNode(mgr.activeEditor); // anchorNode вне ссылки

  globalThis.getSelection = () => makeSelection({ anchorNode: afterLink, startContainer: insideLink });
  promptValue = 'http://new';

  mgr.createOrEditLink();

  assert.equal(link._attrs['data-link-url'], 'http://new',
    'существующая ссылка не отредактирована — поиск шёл по anchorNode (конец выделения)');
  assert.equal(mgr.saved.length, 1);
  assert.equal(mgr.saved[0].id, 'tb1');
  assert.ok(mgr.attachCalls >= 1);
});

test('редактирование сноски: общий поток, маркер по началу выделения', () => {
  const mgr = makeManager();
  const footnote = makeMarker('text-footnote', { 'data-footnote-text': 'старая' });
  footnote.parentElement = mgr.activeEditor;
  const insideFootnote = makeTextNode(footnote);
  const outside = makeTextNode(mgr.activeEditor);

  globalThis.getSelection = () => makeSelection({ anchorNode: outside, startContainer: insideFootnote });
  promptValue = 'новая сноска';

  mgr.createOrEditFootnote();

  assert.equal(footnote._attrs['data-footnote-text'], 'новая сноска');
  assert.equal(mgr.saved.length, 1);
});

test('EXP-3: тело сноски триммится при правке (пробельная обёртка не сохраняется)', () => {
  const mgr = makeManager();
  const footnote = makeMarker('text-footnote', { 'data-footnote-text': 'старая' });
  footnote.parentElement = mgr.activeEditor;
  const insideFootnote = makeTextNode(footnote);

  globalThis.getSelection = () =>
    makeSelection({ anchorNode: insideFootnote, startContainer: insideFootnote });
  promptValue = '   с пробелами   ';

  mgr.createOrEditFootnote();

  // Обёрточные пробелы срезаны — критерий пустоты (bleach payload.strip(),
  // numberFootnotes .trim()) не разъезжается с телом сноски.
  assert.equal(footnote._attrs['data-footnote-text'], 'с пробелами');
});

test('EXP-3: URL ссылки не трогается else-веткой трима (валидатор сам нормализует)', () => {
  const mgr = makeManager();
  const link = makeMarker('text-link', { 'data-link-url': 'http://old' });
  link.parentElement = mgr.activeEditor;
  const insideLink = makeTextNode(link);

  globalThis.getSelection = () =>
    makeSelection({ anchorNode: insideLink, startContainer: insideLink });
  promptValue = 'https://example.com/path';

  mgr.createOrEditLink();

  assert.equal(link._attrs['data-link-url'], 'https://example.com/path');
});

test('пустой prompt по существующему маркеру — удаление через removeLinkOrFootnote', () => {
  const mgr = makeManager();
  const link = makeMarker('text-link', { 'data-link-url': 'http://old' });
  link.parentElement = mgr.activeEditor;
  const insideLink = makeTextNode(link);

  let removed = null;
  mgr.removeLinkOrFootnote = (el) => { removed = el; };
  globalThis.getSelection = () => makeSelection({ anchorNode: insideLink, startContainer: insideLink });
  promptValue = '   ';

  mgr.createOrEditLink();

  assert.equal(removed, link);
  assert.equal(mgr.saved.length, 0, 'saveContent не должен вызываться при удалении');
});

test('свёрнутое выделение — alert с текстом про выделение, без prompt', () => {
  const mgr = makeManager();
  globalThis.getSelection = () => ({ isCollapsed: true });

  mgr.createOrEditLink();
  mgr.createOrEditFootnote();

  assert.deepEqual(alerts, [
    'Выделите текст для создания гиперссылки',
    'Выделите текст для создания сноски',
  ]);
});
