/**
 * Смоук панели-формализатора: цепочка импортов резолвится под браузер-стабом,
 * объект экспортирован с ключевыми методами и в window. DOM-heavy поток
 * (formalize → превью → применить) покрывается вручную/e2e в браузере.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FormalizerPopover } from '../../static/js/constructor/text-actions/formalizer-popover.js';

test('FormalizerPopover: экспортирован объект с ключевыми методами', () => {
  for (const m of ['open', 'close', '_build', '_run', '_renderPreview', '_accept']) {
    assert.equal(typeof FormalizerPopover[m], 'function', `метод ${m}`);
  }
});

test('FormalizerPopover: продублирован в window для inline-скриптов', () => {
  assert.equal(globalThis.window.FormalizerPopover, FormalizerPopover);
});
