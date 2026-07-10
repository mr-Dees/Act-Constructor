/**
 * Фронтовая сторона паритет-харнесса (идея 12 / §6.6): контракт
 * «редактор ↔ allowlist ↔ inline.py» на общих фикстурах
 * tests/fixtures/textblock_parity.json (бэк-сторона — pytest
 * test_textblock_parity.py, там же round-trip через bleach и рендер DOCX).
 *
 * DOMPurify в node без DOM не поднимается (стаб-окружение), поэтому здесь
 * пинятся ЧИСТЫЕ функции/конфиги профиля 'acts':
 *   - каждый тег/css/attr, который DOCX рендерит по фикстуре (allowlist_*),
 *     допущен фронт-allowlist'ом (ALLOWED_TAGS / ACTS_CSS_PROPERTIES /
 *     ALLOWED_ATTR) — иначе санитайзер срезал бы конструкцию ДО экспорта, и
 *     превью разошлось бы с DOCX;
 *   - filterCssDeclarations сохраняет каждое css-свойство на его носителе
 *     (font-size на span, text-align на блоке div/p).
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
    SAFE_HTML_PROFILES, ACTS_CSS_PROPERTIES, filterCssDeclarations,
} from '../../static/js/shared/sanitize.js';

const fixtures = JSON.parse(readFileSync(
    fileURLToPath(new URL('../fixtures/textblock_parity.json', import.meta.url)),
    'utf8',
)).fixtures;

const acts = SAFE_HTML_PROFILES.acts;

test('фикстур в наборе 8–12 (диапазон брифа)', () => {
    assert.ok(fixtures.length >= 8 && fixtures.length <= 12,
        `фикстур ${fixtures.length}, ожидалось 8–12`);
});

for (const f of fixtures) {
    test(`allowlist допускает конструкции фикстуры «${f.name}»`, () => {
        for (const t of f.allowlist_tags) {
            assert.ok(acts.ALLOWED_TAGS.includes(t), `тег <${t}> вне ALLOWED_TAGS`);
        }
        for (const c of f.allowlist_css) {
            assert.ok(ACTS_CSS_PROPERTIES.includes(c), `css ${c} вне ACTS_CSS_PROPERTIES`);
        }
        for (const a of f.allowlist_attrs) {
            assert.ok(acts.ALLOWED_ATTR.includes(a), `attr ${a} вне ALLOWED_ATTR`);
        }
    });

    test(`filterCssDeclarations сохраняет css фикстуры «${f.name}» на носителе`, () => {
        for (const c of f.allowlist_css) {
            // Носитель зеркалит контракт редактора: text-align живёт на блоке
            // (div/p), остальное (font-size) — на span. Блочный font-size DOCX
            // игнорирует, поэтому и на allowlist-стороне он к блокам не привязан.
            const carrier = c === 'text-align' ? 'div' : 'span';
            const value = c === 'text-align' ? 'center' : '20px';
            const kept = filterCssDeclarations(carrier, [[c, value]], ACTS_CSS_PROPERTIES);
            assert.ok(kept.some((s) => s.startsWith(`${c}:`)),
                `${c} срезано filterCssDeclarations на <${carrier}>`);
        }
    });
}
