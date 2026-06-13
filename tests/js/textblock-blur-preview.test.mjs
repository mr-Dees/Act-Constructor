/**
 * textblock-3: handleEditorBlur должен сразу точечно обновлять превью
 * (PreviewManager.updateBlock('textblock', id)) — без этого input-debounce
 * (500мс) мог не успеть, и превью оставалось с устаревшим текстом до
 * следующего ввода. Висящий save-таймер при этом сбрасывается.
 */
import './_browser-stub.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TextBlockManager } from '../../static/js/constructor/textblock/textblock-core.js';
import '../../static/js/constructor/textblock/textblock-editor.js';
import { PreviewManager } from '../../static/js/constructor/preview/preview.js';

let updateBlockCalls = [];
beforeEach(() => {
  updateBlockCalls = [];
  PreviewManager.updateBlock = (kind, id) => updateBlockCalls.push({ kind, id });
});

function makeManager() {
  const mgr = Object.create(TextBlockManager.prototype);
  mgr.globalToolbar = { contains: () => false };
  mgr.hideToolbar = () => {};
  mgr.clearActiveEditor = () => {};
  return mgr;
}

test('blur точечно обновляет превью текстблока с актуальным content', () => {
  const mgr = makeManager();
  const textBlock = { id: 'tb1', content: 'старое' };
  const editor = { innerHTML: '<p>новое</p>', dataset: { textBlockId: 'tb1' } };

  mgr.handleEditorBlur(editor, textBlock);

  assert.equal(textBlock.content, '<p>новое</p>', 'content не зафиксирован при blur');
  assert.deepEqual(updateBlockCalls, [{ kind: 'textblock', id: 'tb1' }]);
});

test('blur сбрасывает висящий save-таймер input-debounce', () => {
  const mgr = makeManager();
  const textBlock = { id: 'tb2', content: '' };
  let cleared = false;
  const timer = setTimeout(() => {}, 100000);
  const editor = {
    innerHTML: '<p>x</p>',
    dataset: { textBlockId: 'tb2' },
    saveTimeout: timer,
  };
  // Подменяем clearTimeout, чтобы зафиксировать сброс именно этого таймера.
  const origClear = globalThis.clearTimeout;
  globalThis.clearTimeout = (t) => { if (t === timer) cleared = true; origClear(t); };

  try {
    mgr.handleEditorBlur(editor, textBlock);
  } finally {
    globalThis.clearTimeout = origClear;
  }

  assert.equal(cleared, true, 'save-таймер не сброшен при blur');
  assert.equal(editor.saveTimeout, null);
  assert.equal(updateBlockCalls.length, 1);
});
