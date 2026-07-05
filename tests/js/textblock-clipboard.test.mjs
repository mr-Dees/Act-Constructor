/**
 * Task 3: round-trip капсул через буфер обмена + гейт пустого paste
 * (CARET-2, CORE-4, CARET-6). Здесь — чистая логика, тестируемая без реального
 * DOM: опознание своего буфера по метке data-aw-clip, фабрика createFootnoteMarker
 * и маршрутизация handleEditorPaste (editing-mode → плейн; гейт пустоты; выбор
 * insertHTML vs insertText). DOM-heavy реконструкция/копирование покрыты e2e в
 * tests/playwright/specs/16-capsule-integrity.spec.ts.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextBlockManager } from '../../static/js/constructor/textblock/textblock-core.js';
import '../../static/js/constructor/textblock/textblock-links-footnotes.js';

// ── Опознание своего буфера ──────────────────────────────────────────────────

test('_isOwnClipboardHtml: без метки data-aw-clip → внешний (быстрый отказ без DOM-парса)', () => {
  const mgr = Object.create(TextBlockManager.prototype);
  // Substring-префильтр отсекает обычный внешний HTML без парсинга; точная
  // attribute-проверка (парс в inert <template>) требует реального DOM —
  // покрыта e2e в 16-capsule-integrity (детект + устойчивость к CF_HTML-обёртке).
  assert.equal(mgr._isOwnClipboardHtml('<p>внешний Word</p>'), false);
  assert.equal(mgr._isOwnClipboardHtml(''), false);
  assert.equal(mgr._isOwnClipboardHtml(null), false);
});

// ── Фабрика сноски (зеркало createLinkMarker) ────────────────────────────────

test('createFootnoteMarker: span.text-footnote с телом, свежим id, contenteditable=false', () => {
  // Записывающий фейк-элемент: браузерный стаб глотает setAttribute.
  const attrs = {};
  let text = '';
  const rec = {
    className: '',
    setAttribute(k, v) { attrs[k] = String(v); },
    getAttribute(k) { return k in attrs ? attrs[k] : null; },
    get textContent() { return text; },
    set textContent(v) { text = String(v); },
    contentEditable: undefined,
  };
  const origCreate = globalThis.document.createElement;
  globalThis.document.createElement = () => rec;
  try {
    const mgr = Object.create(TextBlockManager.prototype);
    const span = mgr.createFootnoteMarker('сн', 'тело сноски');
    assert.equal(span.className, 'text-footnote');
    assert.equal(attrs['data-footnote-text'], 'тело сноски');
    assert.match(attrs['data-footnote-id'], /^footnote_\d+_/);
    assert.equal(span.contentEditable, 'false');
    assert.equal(span.textContent, 'сн');
  } finally {
    globalThis.document.createElement = origCreate;
  }
});

// ── Маршрутизация handleEditorPaste (гейт пустоты, editing-mode, insertHTML) ──

/**
 * Прогоняет handleEditorPaste на стабах и возвращает журнал ключевых вызовов.
 * @param {{editing?:boolean, html?:string, plain?:string, fragChildren?:any[]}} cfg
 */
function runPaste(cfg = {}) {
  const { editing = false, html = '', plain = '', fragChildren = [] } = cfg;
  const calls = [];
  const mgr = Object.create(TextBlockManager.prototype);
  mgr._buildPasteFragment = () => ({ childNodes: fragChildren });
  mgr._expandRangeOutOfMarkers = () => calls.push('expand');
  mgr.applyFormattingToNewNodes = () => calls.push('applyFmt');
  mgr.finalizeEdit = () => calls.push('finalize');
  mgr.attachLinkFootnoteHandlers = () => calls.push('attach');
  const editor = {
    querySelector: (sel) => (sel === '.editing-mode' && editing ? {} : null),
    dataset: { textBlockId: 'tb1' },
  };
  const e = {
    preventDefault() { calls.push('prevent'); },
    clipboardData: { getData: (t) => (t === 'text/html' ? html : plain) },
  };
  const origExec = globalThis.document.execCommand;
  const origSel = globalThis.getSelection;
  globalThis.document.execCommand = (cmd, _b, val) => {
    calls.push(`exec:${cmd}:${val == null ? '' : val}`);
    return true;
  };
  globalThis.getSelection = () => ({
    rangeCount: 1,
    getRangeAt: () => ({}),
    removeAllRanges() {},
    addRange() {},
  });
  try {
    mgr.handleEditorPaste(e, editor, { id: 'tb1' });
  } finally {
    globalThis.document.execCommand = origExec;
    globalThis.getSelection = origSel;
  }
  return calls;
}

test('paste во время inline-правки капсулы → только insertText(plain), без insertHTML/finalize (CARET-1)', () => {
  const calls = runPaste({ editing: true, html: '<span data-footnote-text="t">X</span>', plain: 'ВСТАВКА' });
  assert.deepEqual(calls, ['prevent', 'exec:insertText:ВСТАВКА']);
});

test('paste в editing-mode с пустым plain → no-op (тело капсулы не трогаем)', () => {
  const calls = runPaste({ editing: true, html: '<b>x</b>', plain: '' });
  assert.deepEqual(calls, ['prevent']);
});

test('paste без HTML → insertText(plain) + finalize (прежний путь)', () => {
  const calls = runPaste({ html: '', plain: 'просто текст' });
  assert.deepEqual(calls, ['prevent', 'exec:insertText:просто текст', 'finalize']);
});

test('гейт пустоты (CARET-6): пустой фрагмент + непустой plain → insertText, без insertHTML', () => {
  const calls = runPaste({ html: '<img src=x>', plain: 'запасной', fragChildren: [] });
  assert.deepEqual(calls, ['prevent', 'exec:insertText:запасной', 'finalize']);
  assert.ok(!calls.some((c) => c.startsWith('exec:insertHTML')));
});

test('гейт пустоты (CARET-6): пустой фрагмент + пустой plain → no-op, выделение не тронуто', () => {
  const calls = runPaste({ html: '<img src=x>', plain: '', fragChildren: [] });
  assert.deepEqual(calls, ['prevent']); // ни insertText, ни insertHTML, ни finalize
});

test('непустой фрагмент → expand + insertHTML (undo) + applyFmt/finalize/attach', () => {
  const calls = runPaste({ html: '<p>текст</p>', plain: 'текст', fragChildren: [{}] });
  assert.ok(calls.includes('expand'), 'выделение расширяется за капсулы');
  assert.ok(calls.some((c) => c.startsWith('exec:insertHTML')), 'вставка через insertHTML');
  assert.ok(!calls.some((c) => c.startsWith('exec:insertText')), 'не должно быть insertText');
  assert.ok(calls.includes('finalize') && calls.includes('attach'));
});
