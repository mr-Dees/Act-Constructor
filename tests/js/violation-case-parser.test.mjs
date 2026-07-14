/**
 * Тесты строгого парсера маркера «кейс» при вставке текста из буфера
 * (находка аудита #5).
 *
 * Раньше тип определялся через startsWith('кейс') + substring(4): любая строка,
 * начинающаяся с «кейс» (например «Кейсы банка…»), считалась кейсом и обрезалась
 * до «ы банка…». Теперь маркер строгий: «Кейс» + номер + разделитель
 * (`/^Кейс\s*\d+\s*[.:)\-–—]/i`); снимается РОВНО совпавший префикс.
 *
 * Реальный модуль импортируется под node:test через _browser-stub.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    CONTENT_TYPE_CASE,
    CONTENT_TYPE_FREE_TEXT,
} from '../../static/js/constructor/violation/violation-content-item.js';
// violation-init разруливает циклические импорты (core ↔ расширения прототипа):
// импортируем его ДО именованного экспорта из violation-paste.js.
import '../../static/js/constructor/violation/violation-init.js';
import { parseClipboardText } from '../../static/js/constructor/violation/violation-paste.js';

test('«Кейсы банка…» — НЕ кейс, текст не обрезается', () => {
    const input = 'Кейсы банка на рассмотрении';
    const res = parseClipboardText(input);
    assert.equal(res.type, CONTENT_TYPE_FREE_TEXT);
    assert.equal(res.content, input, 'текст сохранён целиком, не «ы банка…»');
});

test('«Кейс 3. текст» → кейс, снят ровно префикс «Кейс 3.»', () => {
    const res = parseClipboardText('Кейс 3. текст');
    assert.equal(res.type, CONTENT_TYPE_CASE);
    assert.equal(res.content, 'текст');
});

test('«Кейс12) x» → кейс без пробелов, разделитель — скобка', () => {
    const res = parseClipboardText('Кейс12) x');
    assert.equal(res.type, CONTENT_TYPE_CASE);
    assert.equal(res.content, 'x');
});

test('обычный текст → произвольный текст без изменений', () => {
    const input = 'просто описание нарушения';
    const res = parseClipboardText(input);
    assert.equal(res.type, CONTENT_TYPE_FREE_TEXT);
    assert.equal(res.content, input);
});

test('«кейс 1: описание» (нижний регистр) → кейс (флаг i)', () => {
    const res = parseClipboardText('кейс 1: описание');
    assert.equal(res.type, CONTENT_TYPE_CASE);
    assert.equal(res.content, 'описание');
});

test('«Кейс 5 – текст» (тире-варианты) → кейс', () => {
    const enDash = parseClipboardText('Кейс 5 – текст');
    assert.equal(enDash.type, CONTENT_TYPE_CASE);
    assert.equal(enDash.content, 'текст');

    const hyphen = parseClipboardText('Кейс 2 - abc');
    assert.equal(hyphen.type, CONTENT_TYPE_CASE);
    assert.equal(hyphen.content, 'abc');
});

test('«Кейс 7 текст» без разделителя → строгий парсер даёт произвольный текст', () => {
    const input = 'Кейс 7 текст';
    const res = parseClipboardText(input);
    assert.equal(res.type, CONTENT_TYPE_FREE_TEXT);
    assert.equal(res.content, input);
});
