/**
 * §5 new coverage: B-5/Е2 — applyActsAllowlist применяет серверный allowlist
 * (/acts/limits секция sanitizer) к профилю 'acts', а офлайн/пустой ввод
 * оставляет фолбэк. Экспортируемый ACTS_CSS_PROPERTIES (страж паритета) при
 * этом не мутируется.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyActsAllowlist,
  SAFE_HTML_PROFILES,
  ACTS_CSS_PROPERTIES,
} from '../../static/js/shared/sanitize.js';

test('applyActsAllowlist: серверный allowlist перезаписывает профиль acts', () => {
  applyActsAllowlist({
    allowed_tags: ['p', 'b'],
    allowed_css_properties: ['font-size'],
    allowed_data_attrs: ['data-link-url'],
  });
  assert.deepEqual(SAFE_HTML_PROFILES.acts.ALLOWED_TAGS, ['p', 'b']);
  assert.deepEqual(SAFE_HTML_PROFILES.acts.__cssAllowlist, ['font-size']);
  // data-атрибуты дополняются базовыми href/title/class/style (паритет с бэком).
  assert.deepEqual(
    SAFE_HTML_PROFILES.acts.ALLOWED_ATTR,
    ['href', 'title', 'class', 'style', 'data-link-url'],
  );
});

test('applyActsAllowlist: null/{}/пустые массивы → no-op (офлайн-фолбэк сохранён)', () => {
  applyActsAllowlist({ allowed_tags: ['p'] });
  const before = [...SAFE_HTML_PROFILES.acts.ALLOWED_TAGS];
  applyActsAllowlist(null);
  applyActsAllowlist({});
  applyActsAllowlist({ allowed_tags: [] });
  assert.deepEqual(SAFE_HTML_PROFILES.acts.ALLOWED_TAGS, before);
});

test('экспортируемый фолбэк ACTS_CSS_PROPERTIES не мутируется (страж паритета)', () => {
  const snapshot = [...ACTS_CSS_PROPERTIES];
  applyActsAllowlist({ allowed_css_properties: ['color'] });
  assert.deepEqual(ACTS_CSS_PROPERTIES, snapshot,
    'мутация активного профиля не должна затрагивать экспортируемый фолбэк');
});
