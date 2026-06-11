/**
 * M.6: превью текстблока применяет ВСЕ поля formatting контейнером
 * (fontSize/textAlign + bold/italic/underline) — паритет с DOCX-рендером
 * заданного юзером formatting (docx/formatter.py:_render_textblock).
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

test('полный formatting применяется контейнером', () => {
    const style = apply({
        fontSize: 16, alignment: 'center', bold: true, italic: true, underline: true,
    });
    assert.equal(style.fontSize, '16px');
    assert.equal(style.textAlign, 'center');
    assert.equal(style.fontWeight, 'bold');
    assert.equal(style.fontStyle, 'italic');
    assert.equal(style.textDecoration, 'underline');
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
