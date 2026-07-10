/**
 * CORE-1: редактор текстблока раньше звал SafeHTML.set(el, html) БЕЗ профиля
 * (дефолтный blocklist DEFAULT_CONFIG) — редактируемая поверхность расходилась
 * с allowlist'ом 'acts', которым рендерится превью и который зеркалит бэк
 * (html_sanitizer.py): легаси-контент вроде <img src=внешний-трекер> в
 * редакторе отрисовывался бы, хотя ни превью, ни бэк-санитайзер его не
 * пропустят. renderActContent (sanitize.js) — единая точка входа профилем
 * 'acts' для обоих потребителей.
 *
 * DOMPurify в node без DOM не поднимается (см. sanitize-profiles.test.mjs) —
 * поведение реального DOMPurify здесь не проверяется (это зона Playwright
 * спек 15/16). Фейк ниже фиксирует КОНТРАКТ: какой конфиг долетает до
 * sanitize и что этот конфиг не пропускает <img> (тега нет в ALLOWED_TAGS
 * профиля 'acts').
 */
import './_browser-stub.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TextBlockManager } from '../../static/js/constructor/textblock/textblock-core.js';
import '../../static/js/constructor/textblock/textblock-editor.js';
import { PreviewTextBlockRenderer } from '../../static/js/constructor/preview/preview-textblock-renderer.js';
import { renderActContent, SAFE_HTML_PROFILES } from '../../static/js/shared/sanitize.js';

const capturedConfigs = [];

/**
 * Упрощённый фейк DOMPurify.sanitize для node (нет реального DOM): вырезает
 * теги, которых нет в cfg.ALLOWED_TAGS, сохраняя их текстовое содержимое —
 * этого достаточно, чтобы отличить allowlist-профиль 'acts' (без img) от
 * дефолтного blocklist-конфига (пропустил бы img). Атрибуты не фильтрует —
 * их allowlist уже покрыт sanitize-acts-allowlist.test.mjs.
 */
function fakeSanitize(html, cfg) {
  capturedConfigs.push(cfg);
  return String(html).replace(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi, (match, tag) => (
    cfg && Array.isArray(cfg.ALLOWED_TAGS) && cfg.ALLOWED_TAGS.includes(tag.toLowerCase())
      ? match
      : ''
  ));
}

globalThis.window.DOMPurify = { sanitize: fakeSanitize };

beforeEach(() => {
  capturedConfigs.length = 0;
});

/** Редактор с минимальными стабами того, что TB-8 не проверяет (капсулы/размер). */
function makeManager() {
  const mgr = Object.create(TextBlockManager.prototype);
  mgr.installCapsuleObserver = () => {};
  mgr.applyBaseFontSize = () => {};
  // Стаб, а не импорт textblock-capsule-integrity.js: активирует ВТОРУЮ точку
  // renderActContent в createEditor (:52) тем же способом, что и textblock-blur-preview.test.mjs.
  mgr.validateAndRepairCapsules = (html) => html;
  return mgr;
}

test('renderActContent зовёт sanitize профилем acts (та же ссылка, что SAFE_HTML_PROFILES.acts)', () => {
  const el = { innerHTML: '' };
  renderActContent(el, '<img src="http://evil.example/pixel.gif">Текст');

  assert.equal(capturedConfigs.length, 1);
  assert.equal(capturedConfigs[0], SAFE_HTML_PROFILES.acts);
  assert.ok(!el.innerHTML.includes('<img'), 'img не вырезан профилем acts');
  assert.ok(el.innerHTML.includes('Текст'), 'легитимный текст срезан вместе с img');
});

test('CORE-1: createEditor рендерит content профилем acts на ОБЕИХ точках SafeHTML.set', () => {
  const mgr = makeManager();
  const textBlock = { id: 'tb-parity', content: '<img src="http://evil.example/pixel.gif">Текст с <b>жирным</b>' };

  const editor = mgr.createEditor(textBlock);

  assert.ok(capturedConfigs.length >= 2, `ожидались 2 вызова sanitize в createEditor, получено ${capturedConfigs.length}`);
  capturedConfigs.forEach((cfg) => assert.equal(cfg, SAFE_HTML_PROFILES.acts));
  assert.ok(!editor.innerHTML.includes('<img'), 'редактор не вырезал img через acts-профиль');
  assert.ok(editor.innerHTML.includes('Текст'));
});

test('CORE-1: превью текстблока рендерит content профилем acts', () => {
  const textBlock = { id: 'tb-parity-preview', content: '<img src="http://evil.example/pixel.gif">Текст' };

  const content = PreviewTextBlockRenderer._createContent(textBlock);

  assert.equal(capturedConfigs.length, 1);
  assert.equal(capturedConfigs[0], SAFE_HTML_PROFILES.acts);
  assert.ok(!content.innerHTML.includes('<img'));
  assert.ok(content.innerHTML.includes('Текст'));
});

test('CORE-1 страж паритета: редактор и превью зовут sanitize ОДНИМ И ТЕМ ЖЕ конфигом', () => {
  const html = '<img src="http://evil.example/pixel.gif">Текст';

  makeManager().createEditor({ id: 'tb-a', content: html });
  const fromEditor = capturedConfigs.slice();

  capturedConfigs.length = 0;
  PreviewTextBlockRenderer._createContent({ id: 'tb-b', content: html });
  const fromPreview = capturedConfigs.slice();

  assert.ok(fromEditor.length > 0 && fromPreview.length > 0, 'обе точки должны были вызвать sanitize');
  [...fromEditor, ...fromPreview].forEach((cfg) => {
    assert.equal(cfg, SAFE_HTML_PROFILES.acts, 'редактор и превью должны использовать один и тот же профиль acts');
  });
});

test('CORE-1 самопроверка: профиль acts (которым теперь рендерится редактор) не режет капсулы/якорь размера', () => {
  // fakeSanitize выше фильтрует только ТЕГИ (по ALLOWED_TAGS), не атрибуты —
  // не годится, чтобы честно проверить сохранность data-атрибутов/CSS. Здесь
  // проверяем впрямую состав профиля, которым реально пользуется createEditor
  // (см. предыдущий тест: capturedConfigs === SAFE_HTML_PROFILES.acts).
  const acts = SAFE_HTML_PROFILES.acts;
  assert.ok(acts.ALLOWED_TAGS.includes('span'), 'span (капсулы, якорь размера U+200B) вне allowlist');
  assert.ok(acts.ALLOWED_ATTR.includes('class'), 'class (text-link/text-footnote) вне allowlist');
  assert.ok(acts.ALLOWED_ATTR.includes('data-link-url'), 'data-link-url вне allowlist');
  assert.ok(acts.ALLOWED_ATTR.includes('data-footnote-text'), 'data-footnote-text вне allowlist');
  assert.ok(acts.__cssAllowlist.includes('font-size'), 'font-size (якорь размера на span) вне CSS-allowlist');

  const html = '<span class="text-link" data-link-id="L1" data-link-url="https://a.ru">ссылка</span>'
    + `<span style="font-size:20px">${String.fromCharCode(0x200B)}</span>текст`;
  makeManager().createEditor({ id: 'tb-capsule', content: html });
  assert.ok(capturedConfigs.length > 0);
  assert.ok(capturedConfigs.every((cfg) => cfg === acts), 'реальный капсульный контент рендерится не профилем acts');
});
