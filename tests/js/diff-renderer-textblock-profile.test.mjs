/**
 * Task E: _renderDiffTextBlock (diff-renderer.js) должен рендерить FULL-
 * содержимое текстблока (added/removed/fallback) профилем 'acts' —
 * зеркалом того, что реально допускает превью (renderActContent) и
 * бэк-санитайзер (html_sanitizer.py) — а не дефолтным blocklist-профилем
 * SafeHTML.set(el, html), который пропускает теги вне acts-allowlist
 * (например легаси <img>).
 *
 * Word-diff-ветка (modified + wordDiff) — сознательное исключение: она
 * рендерит <ins>/<del> поверх уже pre-stripped plain text, а <ins> вне
 * acts-allowlist (ACTS_TAGS_FALLBACK в sanitize.js) — переключение на
 * renderActContent срезало бы подсветку вставок.
 *
 * DOMPurify в node без DOM не поднимается (см. sanitize-profiles.test.mjs) —
 * фейк ниже фиксирует КОНТРАКТ конфига (тот же приём, что и
 * sanitize-render-act-content.test.mjs): различаем allowlist-профиль acts
 * (несёт ALLOWED_TAGS) от дефолтного blocklist-конфига (несёт FORBID_TAGS,
 * ALLOWED_TAGS отсутствует).
 */
import './_browser-stub.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { DiffRenderer } from '../../static/js/portal/acts-manager/diff-renderer.js';
import { SAFE_HTML_PROFILES } from '../../static/js/shared/sanitize.js';

const capturedConfigs = [];

/**
 * Фейк DOMPurify.sanitize для node: различает allowlist (ALLOWED_TAGS) и
 * blocklist (FORBID_TAGS) конфиги, вырезая теги соответственно. Атрибуты не
 * фильтрует — их проверка вне зоны этого теста (см. sanitize-acts-allowlist).
 */
function fakeSanitize(html, cfg) {
  capturedConfigs.push(cfg);
  return String(html).replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (match, tag) => {
    const t = tag.toLowerCase();
    if (cfg && Array.isArray(cfg.ALLOWED_TAGS)) {
      return cfg.ALLOWED_TAGS.includes(t) ? match : '';
    }
    if (cfg && Array.isArray(cfg.FORBID_TAGS)) {
      return cfg.FORBID_TAGS.includes(t) ? '' : match;
    }
    return match;
  });
}

globalThis.window.DOMPurify = { sanitize: fakeSanitize };

beforeEach(() => {
  capturedConfigs.length = 0;
});

/**
 * Стаб-элемент с реальной связкой textContent → innerHTML (базовое
 * HTML-экранирование), т.к. _renderDiffTextBlock._escapeHtml полагается на
 * браузерный приём (div.textContent = str; читать div.innerHTML) — у общего
 * _browser-stub.mjs это независимые поля, и без связки escaped-текст всегда
 * стал бы пустой строкой в word-diff ветке.
 */
function makeEscapeAwareDiv() {
  let html = '';
  const el = {
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    removeChild() {},
    remove() {},
    setAttribute() {},
    querySelector: () => null,
    querySelectorAll: () => [],
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return html; },
    set(v) { html = String(v); },
  });
  Object.defineProperty(el, 'textContent', {
    get() { return html; },
    set(v) {
      html = String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    },
  });
  return el;
}

/**
 * Рендерит текстблок-diff и возвращает innerHTML корневого div —
 * appendChild контейнера-заглушки no-op, поэтому перехватываем
 * document.createElement и забираем ПЕРВЫЙ созданный div (корневой; в
 * word-diff-ветке _escapeHtml создаёт дополнительные div ПОСЛЕ него).
 */
function renderTextBlockDiff(tbDiff) {
  const origCreate = document.createElement;
  let captured = null;
  document.createElement = (tag) => {
    const el = tag === 'div' ? makeEscapeAwareDiv() : origCreate(tag);
    if (tag === 'div' && captured === null) captured = el;
    return el;
  };
  try {
    DiffRenderer._renderDiffTextBlock({ appendChild() {} }, tbDiff);
  } finally {
    document.createElement = origCreate;
  }
  return captured;
}

test('added-ветка: профиль acts, disallowed <img> вырезан (как в превью)', () => {
  const div = renderTextBlockDiff({ status: 'added', newContent: '<img src="x.png">Добавленный текст' });
  assert.equal(capturedConfigs.length, 1);
  assert.equal(capturedConfigs[0], SAFE_HTML_PROFILES.acts, 'added-ветка должна звать renderActContent (профиль acts)');
  assert.ok(!div.innerHTML.includes('<img'), 'img не вырезан профилем acts');
  assert.ok(div.innerHTML.includes('Добавленный текст'));
});

test('removed-ветка: профиль acts, disallowed <img> вырезан (как в превью)', () => {
  const div = renderTextBlockDiff({ status: 'removed', oldContent: '<img src="x.png">Удалённый текст' });
  assert.equal(capturedConfigs.length, 1);
  assert.equal(capturedConfigs[0], SAFE_HTML_PROFILES.acts, 'removed-ветка должна звать renderActContent (профиль acts)');
  assert.ok(!div.innerHTML.includes('<img'), 'img не вырезан профилем acts');
  assert.ok(div.innerHTML.includes('Удалённый текст'));
});

test('fallback/unchanged-ветка: профиль acts, disallowed <img> вырезан (как в превью)', () => {
  const div = renderTextBlockDiff({ status: 'unchanged', content: '<img src="x.png">Неизменённый текст' });
  assert.equal(capturedConfigs.length, 1);
  assert.equal(capturedConfigs[0], SAFE_HTML_PROFILES.acts, 'fallback-ветка должна звать renderActContent (профиль acts)');
  assert.ok(!div.innerHTML.includes('<img'), 'img не вырезан профилем acts');
  assert.ok(div.innerHTML.includes('Неизменённый текст'));
});

test('word-diff-ветка: НЕ профиль acts — <ins>/<del> подсветка сохраняется', () => {
  const div = renderTextBlockDiff({
    status: 'modified',
    wordDiff: [
      { type: 'unchanged', text: 'общий' },
      { type: 'insert', text: 'новое' },
      { type: 'delete', text: 'старое' },
    ],
  });
  assert.equal(capturedConfigs.length, 1);
  assert.notEqual(capturedConfigs[0], SAFE_HTML_PROFILES.acts, 'word-diff должен остаться на дефолтном (не acts) профиле');
  assert.ok(Array.isArray(capturedConfigs[0].FORBID_TAGS), 'word-diff должен использовать дефолтный blocklist-конфиг (FORBID_TAGS)');
  assert.ok(!capturedConfigs[0].ALLOWED_TAGS, 'word-diff НЕ должен нести allowlist acts-конфига (ALLOWED_TAGS)');
  assert.ok(div.innerHTML.includes('<ins>новое</ins>'), 'insert-подсветка вырезана');
  assert.ok(div.innerHTML.includes('<del>старое</del>'), 'delete-подсветка вырезана');
});
