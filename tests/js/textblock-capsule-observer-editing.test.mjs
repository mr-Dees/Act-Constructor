/**
 * #1: MutationObserver-починка целостности капсул НЕ должна откатывать
 * contenteditable='true', выставленный намеренно для inline-правки (двойной
 * клик, класс 'editing-mode'). Иначе focus попадал в уже не редактируемый span
 * и правка текста ссылки/сноски молча не работала.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextBlockManager } from '../../static/js/constructor/textblock/textblock-core.js';
import '../../static/js/constructor/textblock/textblock-editor.js';
import '../../static/js/constructor/textblock/textblock-capsule-integrity.js';

globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };

function fakeCapsule({ editing }) {
  const classes = new Set(['text-link']);
  if (editing) classes.add('editing-mode');
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
  mgr.normalizeMarkers = () => {};
  return mgr;
}

function makeEditor() {
  return { __healing: false, __capsuleObserver: { takeRecords: () => {} } };
}

test('#1: капсула в editing-mode не откатывается на contenteditable=false', () => {
  const mgr = makeMgr();
  const cap = fakeCapsule({ editing: true });
  mgr._onCapsuleMutations([{ type: 'attributes', target: cap }], makeEditor());
  assert.equal(cap.getAttribute('contenteditable'), 'true'); // НЕ сброшен
});

test('#1-регресс: капсула вне editing-mode с contenteditable!=false чинится на false', () => {
  const mgr = makeMgr();
  const cap = fakeCapsule({ editing: false });
  mgr._onCapsuleMutations([{ type: 'attributes', target: cap }], makeEditor());
  assert.equal(cap.getAttribute('contenteditable'), 'false'); // починен
});
