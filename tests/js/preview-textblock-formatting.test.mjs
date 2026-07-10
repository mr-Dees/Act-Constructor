/**
 * EXP-2: превью текстблока задаёт КОНТЕЙНЕРОМ только базовый размер шрифта из
 * /acts/limits (fontSizeDefault, дефолт 16px). Выравнивание и начертание живут
 * в inline-HTML content (per-line text-align — TB-1, теги <b>/<i>/<u> — B-1);
 * контейнерного объекта formatting больше нет (директива владельца).
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PreviewTextBlockRenderer } from '../../static/js/constructor/preview/preview-textblock-renderer.js';
import { getStructureLimits } from '../../static/js/constructor/violation/violation-image-validator.js';

test('_applyBaseFontSize ставит базовый размер из limits (дефолт 16px)', () => {
    const el = { style: {} };
    PreviewTextBlockRenderer._applyBaseFontSize(el);
    assert.equal(el.style.fontSize, `${getStructureLimits().fontSizeDefault}px`);
    // Единый источник с редактором и экспортом — дефолт 16px.
    assert.equal(el.style.fontSize, '16px');
});

test('выравнивание НЕ задаётся контейнером (per-line в content, дефолт — CSS)', () => {
    const el = { style: {} };
    PreviewTextBlockRenderer._applyBaseFontSize(el);
    assert.equal(el.style.textAlign, undefined);
});

test('начертание НЕ применяется контейнером (единственный источник — content)', () => {
    const el = { style: {} };
    PreviewTextBlockRenderer._applyBaseFontSize(el);
    assert.equal(el.style.fontWeight, undefined);
    assert.equal(el.style.fontStyle, undefined);
    assert.equal(el.style.textDecoration, undefined);
});
