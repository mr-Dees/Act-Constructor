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
    for (const m of ['open', 'close', '_accept', '_textChanged', '_rangeText', '_serializeWithBreaks', '_setMode', '_request']) {
        assert.equal(typeof CorrectorPopover[m], 'function', 'нет метода ' + m);
    }
});

// Фейковые DOM-узлы для проверки чистой сериализации без реального DOM.
const el = (tag, children) => ({ nodeType: 1, tagName: tag, childNodes: children || [] });
const txt = (t) => ({ nodeType: 3, textContent: t });

test('_serializeWithBreaks: границы блочных элементов дают перевод строки', () => {
    // Две Enter-строки в редакторе = два нативных <div>.
    const root = el('DIV', [el('DIV', [txt('a')]), el('DIV', [txt('b')])]);
    assert.equal(CorrectorPopover._serializeWithBreaks(root), 'a\nb\n');
});

test('_serializeWithBreaks: <br> даёт перевод строки, инлайн-узлы — нет', () => {
    const root = el('DIV', [txt('a'), el('BR'), txt('b')]);
    assert.equal(CorrectorPopover._serializeWithBreaks(root), 'a\nb');
    const inline = el('DIV', [txt('до '), el('SPAN', [txt('ссылка')]), txt(' после')]);
    assert.equal(CorrectorPopover._serializeWithBreaks(inline), 'до ссылка после');
});

test('_textChanged: выделение через две Enter-строки без правок — не изменение', () => {
    // Пункт 3: исходный (Selection.toString) = 'a\nb'; текущий,
    // реконструированный через границы блоков, = 'a\nb\n' → хвост \n отбрасывается.
    const root = el('DIV', [el('DIV', [txt('a')]), el('DIV', [txt('b')])]);
    const current = CorrectorPopover._serializeWithBreaks(root);
    assert.equal(CorrectorPopover._textChanged('a\nb', current), false);
});

test('_textChanged: убранный перенос между строками — реальная правка', () => {
    // Пользователь склеил две строки в одну — детекция не должна ослабнуть.
    const root = el('DIV', [el('DIV', [txt('ab')])]);
    const current = CorrectorPopover._serializeWithBreaks(root);
    assert.equal(CorrectorPopover._textChanged('a\nb', current), true);
});

test('_setMode: повтор клика по тому же режиму после ошибки повторяет запрос', () => {
    // Пункт 7: после провала _request флаг _lastError=true, и повторный клик
    // по уже активной кнопке должен снова дёрнуть _request.
    const calls = [];
    const orig = CorrectorPopover._request;
    CorrectorPopover._request = function () { calls.push(this._mode); };
    try {
        CorrectorPopover._els = null; // _syncModeButtons ранний выход
        CorrectorPopover._mode = null;
        CorrectorPopover._hasRequested = false;
        CorrectorPopover._lastError = false;

        CorrectorPopover._setMode('fix');           // первый запуск
        assert.equal(calls.length, 1);

        CorrectorPopover._hasRequested = true;       // имитируем «запрос был»
        CorrectorPopover._lastError = false;
        CorrectorPopover._setMode('fix');            // успех → повтор не нужен
        assert.equal(calls.length, 1);

        CorrectorPopover._lastError = true;          // имитируем ошибку
        CorrectorPopover._setMode('fix');            // тот же режим → повтор
        assert.equal(calls.length, 2);
    } finally {
        CorrectorPopover._request = orig;
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
