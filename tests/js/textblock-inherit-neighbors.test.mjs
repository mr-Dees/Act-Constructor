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
// _caretHomeSibling/_isZeroWidthNode/_isCapsule (TB-2) живут в textblock-editor.js,
// на том же TextBlockManager.prototype — импорт обязателен ДО вызова inheritFromNeighbors.
import '../../static/js/constructor/textblock/textblock-editor.js';
import '../../static/js/constructor/textblock/textblock-formatting.js';

globalThis.Node = { TEXT_NODE: 3, ELEMENT_NODE: 1 };

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

// TB-2: остановка обхода на первом значимом узле (не «издалека»).

test('TB-2: «Раз(24px)| два три» — реальный текст между span и маркером блокирует наследование', () => {
  globalThis.window = globalThis;
  const styledSpan = makeSpan({ fontSize: '24px' }); // "Раз"
  const betweenText = { nodeType: 3, data: ' два три' };
  const marker = makeMarker();

  betweenText.previousSibling = styledSpan;
  marker.previousSibling = betweenText;

  const mgr = Object.create(TextBlockManager.prototype);
  mgr.activeEditor = {};

  mgr.inheritFromNeighbors(marker);

  assert.equal(marker.style.fontSize, undefined, 'маркер унаследовал размер издалека через реальный текст');
});

test('TB-2: маркер вплотную к span 18px СКВОЗЬ caret-guard (U+FEFF) — наследует', () => {
  globalThis.window = globalThis;
  const styledSpan = makeSpan({ fontSize: '18px' });
  // U+FEFF (caret-guard) через код символа — не держать невидимку буквально в исходнике.
  const guard = { nodeType: 3, data: String.fromCharCode(0xFEFF) };
  const marker = makeMarker();

  guard.previousSibling = styledSpan;
  marker.previousSibling = guard;

  const mgr = Object.create(TextBlockManager.prototype);
  mgr.activeEditor = {};

  mgr.inheritFromNeighbors(marker);

  assert.equal(marker.style.fontSize, '18px', 'guard (zero-width) должен быть прозрачен для наследования');
});

test('TB-2: <br> перед маркером блокирует наследование (новая строка)', () => {
  globalThis.window = globalThis;
  const styledSpan = makeSpan({ fontSize: '20px' });
  const breakNode = { nodeType: 1, tagName: 'BR', classList: { contains: () => false } };
  const marker = makeMarker();

  breakNode.previousSibling = styledSpan;
  marker.previousSibling = breakNode;

  const mgr = Object.create(TextBlockManager.prototype);
  mgr.activeEditor = {};

  mgr.inheritFromNeighbors(marker);

  assert.equal(marker.style.fontSize, undefined, 'маркер унаследовал размер через <br>');
});

test('TB-2: соседняя капсула блокирует наследование (капсула — не донор формата)', () => {
  globalThis.window = globalThis;
  const styledSpan = makeSpan({ fontSize: '22px' });
  // Капсула физически тоже <span> (со своим inline-стилем) — не должна
  // трактоваться как обычный span-сосед для наследования.
  const otherCapsule = {
    nodeType: 1,
    tagName: 'SPAN',
    style: { fontSize: '30px', length: 1 },
    classList: { contains: (c) => c === 'text-link' },
  };
  const marker = makeMarker();

  otherCapsule.previousSibling = styledSpan;
  marker.previousSibling = otherCapsule;

  const mgr = Object.create(TextBlockManager.prototype);
  mgr.activeEditor = {};

  mgr.inheritFromNeighbors(marker);

  assert.equal(marker.style.fontSize, undefined, 'маркер унаследовал размер от соседней капсулы');
});
