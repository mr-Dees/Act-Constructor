/**
 * textblock-7: attachLinkFootnoteHandlers вызывается многократно (фокус
 * редактора, каждое создание/правка маркера), при этом click-capture
 * обработчик добавлялся анонимно и никогда не снимался — слушатели копились.
 * Фикс: все обработчики элемента навешиваются с signal одного per-element
 * AbortController; повторный attach сначала abort'ит предыдущий набор.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TextBlockManager } from '../../static/js/constructor/textblock/textblock-core.js';
import '../../static/js/constructor/textblock/textblock-links-footnotes.js';

/**
 * Фейковый DOM-элемент с честным учётом addEventListener/{signal}:
 * слушатель с AbortSignal снимается по abort() — как в браузере.
 */
function makeListenerTrackingElement(className) {
  const listeners = []; // {type, fn, options}
  return {
    classList: { contains: (c) => c === className },
    addEventListener(type, fn, options) {
      const rec = { type, fn, options };
      listeners.push(rec);
      const signal = options && options.signal;
      if (signal) {
        if (signal.aborted) {
          listeners.splice(listeners.indexOf(rec), 1);
          return;
        }
        signal.addEventListener('abort', () => {
          const i = listeners.indexOf(rec);
          if (i !== -1) listeners.splice(i, 1);
        }, { once: true });
      }
    },
    removeEventListener(type, fn) {
      const i = listeners.findIndex(l => l.type === type && l.fn === fn);
      if (i !== -1) listeners.splice(i, 1);
    },
    getAttribute: () => null,
    setAttribute() {},
    listeners,
  };
}

function makeManager(elements) {
  const mgr = Object.create(TextBlockManager.prototype);
  mgr.activeEditor = {
    dataset: { textBlockId: 'tb1' },
    querySelectorAll: (sel) => (sel === '.text-link'
      ? elements.filter(e => e.classList.contains('text-link'))
      : elements.filter(e => e.classList.contains('text-footnote'))),
  };
  return mgr;
}

test('повторные attachLinkFootnoteHandlers не копят обработчики (по одному на тип события)', () => {
  const link = makeListenerTrackingElement('text-link');
  const footnote = makeListenerTrackingElement('text-footnote');
  const mgr = makeManager([link, footnote]);

  mgr.attachLinkFootnoteHandlers();
  mgr.attachLinkFootnoteHandlers();
  mgr.attachLinkFootnoteHandlers();

  for (const el of [link, footnote]) {
    const byType = {};
    for (const l of el.listeners) byType[l.type] = (byType[l.type] || 0) + 1;
    assert.deepEqual(byType, {
      contextmenu: 1,
      dblclick: 1,
      mouseenter: 1,
      mouseleave: 1,
      click: 1,
    }, `обработчики накопились: ${JSON.stringify(byType)}`);
  }
});

test('click-обработчик навешивается в capture-фазе (защита от случайного редактирования)', () => {
  const link = makeListenerTrackingElement('text-link');
  const mgr = makeManager([link]);

  mgr.attachLinkFootnoteHandlers();

  const click = link.listeners.find(l => l.type === 'click');
  assert.ok(click, 'click-обработчик не навешан');
  assert.equal(click.options && click.options.capture, true);
});

test('attach после initial tooltip-обработчиков снимает их (нет дублей mouseenter)', () => {
  const link = makeListenerTrackingElement('text-link');
  const editor = {
    dataset: { textBlockId: 'tb1' },
    querySelectorAll: () => [link],
  };
  const mgr = Object.create(TextBlockManager.prototype);
  mgr.activeEditor = editor;

  // Начальный рендер: только tooltip-обработчики.
  mgr._attachInitialTooltipHandlers(editor);
  assert.equal(link.listeners.filter(l => l.type === 'mouseenter').length, 1);

  // Фокус редактора: полный набор; initial-обработчики обязаны сняться.
  mgr.attachLinkFootnoteHandlers();
  assert.equal(link.listeners.filter(l => l.type === 'mouseenter').length, 1,
    'mouseenter задвоился: initial tooltip-обработчик не снят');
});

// ── B-25: removeLinkOrFootnote тоже обязан абортить _lfAbort перед отсоединением ──

test('B-25: removeLinkOrFootnote абортит _lfAbort капсулы ДО replaceChild', () => {
  const link = makeListenerTrackingElement('text-link');
  link.textContent = 'ссылка';
  link.previousSibling = null;
  link.nextSibling = null;

  let abortedAtReplaceTime = null;
  const replaceCalls = [];
  const controllerRef = {};
  link.parentNode = {
    replaceChild(newNode, oldNode) {
      // Снимок в момент самого replaceChild — доказывает ПОРЯДОК (abort ДО
      // отсоединения от DOM), а не просто то, что abort случился где-то внутри.
      abortedAtReplaceTime = controllerRef.value && controllerRef.value.signal.aborted;
      replaceCalls.push({ newNode, oldNode });
    },
  };

  const mgr = makeManager([link]);
  mgr.attachLinkFootnoteHandlers();
  controllerRef.value = link._lfAbort;
  assert.ok(controllerRef.value, 'предусловие: attachLinkFootnoteHandlers навешивает _lfAbort');
  assert.ok(link.listeners.length > 0, 'предусловие: слушатели навешаны');

  let finalizeCalled = false;
  mgr.finalizeEdit = () => { finalizeCalled = true; };
  const origGetComputedStyle = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ fontSize: '16px' });
  try {
    mgr.removeLinkOrFootnote(link);
  } finally {
    globalThis.getComputedStyle = origGetComputedStyle;
  }

  assert.equal(abortedAtReplaceTime, true,
    'B-25: _lfAbort.abort() должен случиться ДО replaceChild, а не после');
  assert.equal(link.listeners.length, 0,
    'слушатели должны сняться (signal.aborted снимает их синхронно)');
  assert.equal(replaceCalls.length, 1, 'узел должен быть заменён ровно один раз');
  assert.equal(replaceCalls[0].oldNode, link);
  assert.ok(finalizeCalled, 'finalizeEdit всё равно вызывается после замены');
});
