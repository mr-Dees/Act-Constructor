/**
 * CARET-8: во время IME-композиции MutationObserver-страховка капсул КОПИТ
 * mutation-records и НЕ обрабатывает (heal под активной композицией —
 * insertCompositionText мутирует узел-цель — сорвал бы ввод). По compositionend
 * накопленное прогоняется обычным pipeline.
 *
 * Реальный IME в node недоступен — имитируем прямым вызовом
 * _onCompositionStart / _flushComposition и синтетическими MutationRecord'ами
 * (тот же приём, что и в textblock-capsule-observer-editing.test.mjs).
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextBlockManager } from '../../static/js/constructor/textblock/textblock-core.js';
import '../../static/js/constructor/textblock/textblock-editor.js';
import '../../static/js/constructor/textblock/textblock-capsule-integrity.js';

globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };

/** Капсула со сброшенным на 'true' contenteditable — цель починки слоя 3. */
function fakeCapsule() {
  const classes = new Set(['text-link']);
  const attrs = { contenteditable: 'true' };
  return {
    nodeType: 1,
    classList: { contains: (c) => classes.has(c) },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    setAttribute: (k, v) => { attrs[k] = v; },
  };
}

function makeMgr() {
  const mgr = Object.create(TextBlockManager.prototype);
  let normalizeCalls = 0;
  mgr.normalizeMarkers = () => { normalizeCalls += 1; };
  mgr._normalizeCalls = () => normalizeCalls;
  return mgr;
}

function makeEditor() {
  return {
    __healing: false,
    __composing: false,
    __composingRecords: null,
    __capsuleObserver: { takeRecords: () => [] },
  };
}

const attrRecord = (cap) => ({ type: 'attributes', target: cap });

test('CARET-8: во время композиции observer молчит — contenteditable не чинится, records копятся', () => {
  const mgr = makeMgr();
  const editor = makeEditor();
  const cap = fakeCapsule();

  mgr._onCompositionStart(editor);
  assert.equal(editor.__composing, true);

  mgr._onCapsuleMutations([attrRecord(cap)], editor);

  assert.equal(cap.getAttribute('contenteditable'), 'true'); // НЕ починен (буфер)
  assert.equal(editor.__composingRecords.length, 1);         // record накоплен
});

test('CARET-8: по compositionend накопленное прогоняется — contenteditable починен, буфер очищен', () => {
  const mgr = makeMgr();
  const editor = makeEditor();
  const cap = fakeCapsule();

  mgr._onCompositionStart(editor);
  mgr._onCapsuleMutations([attrRecord(cap)], editor);
  assert.equal(cap.getAttribute('contenteditable'), 'true'); // ещё не тронут

  mgr._flushComposition(editor);

  assert.equal(editor.__composing, false);
  assert.equal(cap.getAttribute('contenteditable'), 'false'); // теперь починен
  assert.equal(editor.__composingRecords, null);              // буфер очищен
});

test('CARET-8: удаление guard во время композиции лечится нормализацией только по compositionend', () => {
  const mgr = makeMgr();
  const editor = makeEditor();
  const removedGuard = { nodeType: 3, data: mgr.CAP_GUARD_CHAR };
  const rec = { type: 'childList', removedNodes: [removedGuard], target: {} };

  mgr._onCompositionStart(editor);
  mgr._onCapsuleMutations([rec], editor);
  assert.equal(mgr._normalizeCalls(), 0); // heal не запускался во время композиции

  mgr._flushComposition(editor);
  assert.equal(mgr._normalizeCalls(), 1); // guard восстановлен по окончании
});

test('CARET-8: без композиции мутации обрабатываются немедленно (обычная печать не буферизуется)', () => {
  const mgr = makeMgr();
  const editor = makeEditor(); // __composing = false
  const cap = fakeCapsule();

  mgr._onCapsuleMutations([attrRecord(cap)], editor);

  assert.equal(cap.getAttribute('contenteditable'), 'false'); // починен сразу
  assert.equal(editor.__composingRecords, null);              // ничего не буферизовано
});

test('CARET-8: compositionstart поверх недослитого буфера — records продолжают копиться, слив по общему compositionend', () => {
  const mgr = makeMgr();
  const editor = makeEditor();
  const cap1 = fakeCapsule();
  const cap2 = fakeCapsule();

  mgr._onCompositionStart(editor);
  mgr._onCapsuleMutations([attrRecord(cap1)], editor);
  // Повторный старт (быстрая смена сегмента IME) — буфер сохраняется, не сбрасывается.
  mgr._onCompositionStart(editor);
  mgr._onCapsuleMutations([attrRecord(cap2)], editor);
  assert.equal(editor.__composingRecords.length, 2);

  mgr._flushComposition(editor);
  assert.equal(cap1.getAttribute('contenteditable'), 'false'); // оба починены
  assert.equal(cap2.getAttribute('contenteditable'), 'false');
});
