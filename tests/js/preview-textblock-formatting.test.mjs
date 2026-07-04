/**
 * B-1: превью текстблока применяет КОНТЕЙНЕРОМ только размер и выравнивание
 * (fontSize/textAlign). Начертание (жирный/курсив/подчёркивание) — единственным
 * источником истины выступает inline-HTML в content; полей formatting.b/i/u нет.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PreviewTextBlockRenderer } from '../../static/js/constructor/preview/preview-textblock-renderer.js';

function apply(formatting) {
    const el = { style: {} };
    PreviewTextBlockRenderer._applyFormatting(el, formatting);
    return el.style;
}

test('formatting применяет только размер и выравнивание (начертание — в content, B-1)', () => {
    const style = apply({
        fontSize: 16, alignment: 'center', bold: true, italic: true, underline: true,
    });
    assert.equal(style.fontSize, '16px');
    assert.equal(style.textAlign, 'center');
    // B-1: bold/italic/underline из formatting НЕ применяются — единственный
    // источник начертания — inline-HTML в content (теги <b>/<i>/<u>).
    assert.equal(style.fontWeight, undefined);
    assert.equal(style.fontStyle, undefined);
    assert.equal(style.textDecoration, undefined);
});

test('выключенные b/i/u не задают стилей', () => {
    const style = apply({ fontSize: 14, alignment: 'left', bold: false, italic: false, underline: false });
    assert.equal(style.fontWeight, undefined);
    assert.equal(style.fontStyle, undefined);
    assert.equal(style.textDecoration, undefined);
});

test('отсутствующий formatting не ломает рендер', () => {
    assert.deepEqual(apply(null), {});
    assert.deepEqual(apply(undefined), {});
});
