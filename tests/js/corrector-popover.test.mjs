/**
 * Смоук панели-корректора: цепочка импортов резолвится под браузер-стабом,
 * объект экспортирован с ключевыми методами и в window. Отдельно проверяется
 * чистая логика гейта устаревшего текста (_textChanged) без DOM.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CorrectorPopover } from '../../static/js/constructor/text-actions/corrector-popover.js';

test('CorrectorPopover: ключевые методы существуют', () => {
    for (const m of ['open', 'close', '_accept', '_textChanged', '_rangeText']) {
        assert.equal(typeof CorrectorPopover[m], 'function', 'нет метода ' + m);
    }
});

test('CorrectorPopover: экспортирован в window', () => {
    assert.equal(typeof window.CorrectorPopover, 'object');
});

test('_textChanged: идентичный текст — без изменений', () => {
    assert.equal(CorrectorPopover._textChanged('Привет мир', 'Привет мир'), false);
});

test('_textChanged: хвостовой перевод строки не считается изменением', () => {
    assert.equal(CorrectorPopover._textChanged('строка\n', 'строка'), false);
    assert.equal(CorrectorPopover._textChanged('a\nb', 'a\nb'), false);
});

test('_textChanged: прогоны пробелов схлопываются (white-space:normal)', () => {
    assert.equal(CorrectorPopover._textChanged('слово  слово', 'слово слово'), false);
    assert.equal(CorrectorPopover._textChanged('слово слово', 'слово  слово'), false);
});

test('_textChanged: реальная правка слова — изменение', () => {
    assert.equal(CorrectorPopover._textChanged('Привет мир', 'Пока мир'), true);
});

test('_textChanged: недоступный диапазон (null) — считаем изменением', () => {
    assert.equal(CorrectorPopover._textChanged('текст', null), true);
});
