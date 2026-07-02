/**
 * #12: Home ставит каретку в начало ТЕКУЩЕЙ визуальной строки, а не всего
 * блока. _currentLineFirstNode уважает строку каретки (строки разделены <br>),
 * иначе Home на строке-N телепортировал бы к капсуле строки 1.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextBlockManager } from '../../static/js/constructor/textblock/textblock-core.js';
import '../../static/js/constructor/textblock/textblock-editor.js';

globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };

/** Линкует массив узлов как siblings одного editor-родителя. */
function makeEditor(nodes) {
  const editor = { childNodes: nodes };
  nodes.forEach((n, i) => {
    n.parentNode = editor;
    n.previousSibling = nodes[i - 1] || null;
    n.nextSibling = nodes[i + 1] || null;
  });
  return editor;
}

const capsule = () => ({ nodeType: 1, nodeName: 'SPAN', classList: { contains: (c) => c === 'text-link' } });
const text = (data) => ({ nodeType: 3, nodeName: '#text', data });
const br = () => ({ nodeType: 1, nodeName: 'BR' });

test('#12: Home на строке 3 (капсула в начале) возвращает капсулу строки 3, не строки 1', () => {
  const mgr = Object.create(TextBlockManager.prototype);
  const capA = capsule();      // строка 1 начинается капсулой
  const l1 = text('строка1');
  const b1 = br();
  const l2 = text('строка2');
  const b2 = br();
  const capC = capsule();      // строка 3 начинается капсулой
  const l3 = text('строка3');
  const editor = makeEditor([capA, l1, b1, l2, b2, capC, l3]);

  // Каретка внутри текста строки 3.
  const range = { startContainer: l3, startOffset: 2 };
  const first = mgr._currentLineFirstNode(range, editor);
  assert.equal(first, capC);   // капсула строки 3, НЕ capA
});

test('#12: Home на строке 1 (капсула в начале) возвращает капсулу строки 1', () => {
  const mgr = Object.create(TextBlockManager.prototype);
  const capA = capsule();
  const l1 = text('строка1');
  const b1 = br();
  const l2 = text('строка2');
  const editor = makeEditor([capA, l1, b1, l2]);

  const range = { startContainer: l1, startOffset: 1 };
  assert.equal(mgr._currentLineFirstNode(range, editor), capA);
});

test('#12: строка начинается текстом → первый узел не капсула (Home не перехватывается)', () => {
  const mgr = Object.create(TextBlockManager.prototype);
  const l1 = text('обычная');
  const b1 = br();
  const l2 = text('вторая');
  const editor = makeEditor([l1, b1, l2]);

  const range = { startContainer: l2, startOffset: 3 };
  const first = mgr._currentLineFirstNode(range, editor);
  assert.equal(mgr._isCapsule(first), false);
});
