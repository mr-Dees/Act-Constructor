/**
 * Страж конфигурации SafeHTML-профилей (5.2.3 + M.19).
 *
 * Профиль 'acts' — allowlist, зеркальный бэк-whitelist
 * app/domains/acts/utils/html_sanitizer.py: проверяем состав тегов
 * (включая s/strike/del) и атрибутов (data-* ссылок/сносок), отсутствие
 * опасных тегов и on*-обработчиков. Поведенческая проверка самого DOMPurify
 * в node невозможна (нужен DOM) — она покрыта fallback-веткой (textContent)
 * и e2e. Здесь фиксируем контракт конфига.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SafeHTML, SAFE_HTML_PROFILES } from '../../static/js/shared/sanitize.js';

const acts = SAFE_HTML_PROFILES.acts;

test('acts-профиль существует и является allowlist (ALLOWED_TAGS/ALLOWED_ATTR)', () => {
    assert.ok(acts, 'профиль acts отсутствует');
    assert.ok(Array.isArray(acts.ALLOWED_TAGS), 'нет ALLOWED_TAGS');
    assert.ok(Array.isArray(acts.ALLOWED_ATTR), 'нет ALLOWED_ATTR');
    assert.equal(acts.FORBID_TAGS, undefined, 'allowlist не должен опираться на FORBID_TAGS');
});

test('acts: M.19-теги зачёркивания в whitelist', () => {
    for (const tag of ['s', 'strike', 'del']) {
        assert.ok(acts.ALLOWED_TAGS.includes(tag), `нет тега <${tag}>`);
    }
});

test('acts: состав тегов зеркалит бэк-whitelist html_sanitizer.py', () => {
    const backendTags = [
        'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'strike', 'del',
        'span', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div',
    ];
    assert.deepEqual([...acts.ALLOWED_TAGS].sort(), [...backendTags].sort());
});

test('acts: опасные теги не входят в whitelist', () => {
    for (const tag of ['script', 'iframe', 'svg', 'object', 'embed', 'form', 'style']) {
        assert.ok(!acts.ALLOWED_TAGS.includes(tag), `опасный тег <${tag}> в whitelist`);
    }
});

test('acts: data-атрибуты ссылок и сносок сохранены', () => {
    for (const attr of [
        'data-link-id', 'data-link-url', 'data-footnote-id', 'data-footnote-text',
        'href', 'title', 'class', 'style',
    ]) {
        assert.ok(acts.ALLOWED_ATTR.includes(attr), `нет атрибута ${attr}`);
    }
});

test('acts: ни одного on*-обработчика в ALLOWED_ATTR', () => {
    assert.ok(acts.ALLOWED_ATTR.every((a) => !/^on/i.test(a)));
});

test('fallback без DOMPurify: sanitize экранирует HTML (и для профиля acts)', () => {
    // В node-тестах window.DOMPurify отсутствует — рабочая ветка fallback.
    const out = SafeHTML.sanitize('<s>x</s><script>alert(1)</script>', 'acts');
    assert.ok(!out.includes('<script>'), 'сырой <script> прошёл в fallback');
    assert.ok(out.includes('&lt;script&gt;'), 'fallback не экранировал разметку');
});

test('escapeHtml экранирует все спецсимволы', () => {
    assert.equal(
        SafeHTML.escapeHtml(`<a href="x" onclick='y'>&`),
        '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;',
    );
});
