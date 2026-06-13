/**
 * textblock-5: inheritFromNeighbors должен брать INLINE-стили соседнего span
 * (prevNode.style.*), а не computed-стили. Computed резолвит дефолты/наследие
 * (fontWeight '400', textDecoration 'none solid rgb(...)') и навязал бы их
 * маркеру как inline, раздувая разметку.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextBlockManager } from '../../static/js/constructor/textblock/textblock-core.js';
import '../../static/js/constructor/textblock/textblock-formatting.js';

/** span-сосед: inline-стили заданы в style, length>0; computed «врёт» дефолтами. */
function makeSpan(inlineStyle) {
  const style = { ...inlineStyle, length: Object.keys(inlineStyle).length };
  return {
    nodeType: 1,
    tagName: 'SPAN',
    style,
    previousSibling: null,
  };
}

/** Целевой маркер (ссылка/сноска): пустые inline-стили. */
function makeMarker() {
  return { style: {}, previousSibling: null };
}

test('наследуются только реально заданные inline-стили соседа', () => {
  // computed вернул бы все эти поля заполненными — фиксируем, что метод их НЕ читает.
  globalThis.window = globalThis;
  globalThis.getComputedStyle = () => {
    throw new Error('inheritFromNeighbors не должен звать getComputedStyle');
  };

  const prev = makeSpan({ fontSize: '18px', fontWeight: '700' });
  const marker = makeMarker();
  marker.previousSibling = prev;

  const mgr = Object.create(TextBlockManager.prototype);
  mgr.activeEditor = {};

  mgr.inheritFromNeighbors(marker);

  assert.equal(marker.style.fontSize, '18px');
  assert.equal(marker.style.fontWeight, '700');
  // fontStyle/textDecoration у соседа не заданы inline — не должны появиться.
  assert.equal(marker.style.fontStyle, undefined);
  assert.equal(marker.style.textDecoration, undefined);
});

test('уже заданный inline-стиль маркера не перезаписывается соседом', () => {
  globalThis.window = globalThis;
  const prev = makeSpan({ fontSize: '12px' });
  const marker = makeMarker();
  marker.style.fontSize = '20px'; // маркер уже несёт свой размер
  marker.previousSibling = prev;

  const mgr = Object.create(TextBlockManager.prototype);
  mgr.activeEditor = {};

  mgr.inheritFromNeighbors(marker);

  assert.equal(marker.style.fontSize, '20px', 'размер маркера перезаписан соседом');
});

test('сосед без inline-стилей (style.length===0) пропускается', () => {
  globalThis.window = globalThis;
  const prev = makeSpan({});
  const marker = makeMarker();
  marker.previousSibling = prev;

  const mgr = Object.create(TextBlockManager.prototype);
  mgr.activeEditor = {};

  mgr.inheritFromNeighbors(marker);

  assert.deepEqual(marker.style, {}, 'наследование от пустого span');
});
