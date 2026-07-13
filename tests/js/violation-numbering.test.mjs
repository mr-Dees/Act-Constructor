/**
 * Тесты чистой функции нумерации доп.контента нарушения
 * (violation-numbering.js).
 *
 * Фиксируют решение пользователя (Q1): рендерим ВСЁ, включая пустое —
 * нумеруются ВСЕ кейсы (в т.ч. пустые), счётчик сбрасывается на любом
 * НЕ-кейсе (image/freeText). Это то же правило, что и в эталоне формы
 * calculateCaseNumbers (violation-rendering.js:105-120), но без DOM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeAdditionalContentNumbers } from '../../static/js/constructor/violation/violation-numbering.js';

test('пустой массив → пустой результат', () => {
    assert.deepEqual(computeAdditionalContentNumbers([]), []);
});

test('undefined на входе → пустой результат (ранний guard)', () => {
    assert.deepEqual(computeAdditionalContentNumbers(undefined), []);
});

test('два кейса подряд нумеруются 1, 2', () => {
    const items = [
        { id: 'c1', type: 'case', content: 'первый' },
        { id: 'c2', type: 'case', content: 'второй' },
    ];
    const result = computeAdditionalContentNumbers(items);
    assert.deepEqual(result.map((r) => r.number), [1, 2]);
});

test('пустой кейс тоже нумеруется', () => {
    const items = [
        { id: 'c1', type: 'case', content: '' },
        { id: 'c2', type: 'case', content: 'второй' },
    ];
    const result = computeAdditionalContentNumbers(items);
    assert.deepEqual(result.map((r) => r.number), [1, 2]);
});

test('image сбрасывает нумерацию кейсов', () => {
    const items = [
        { id: 'c1', type: 'case', content: 'первый' },
        { id: 'img1', type: 'image', url: 'data:image/png;base64,AAAA' },
        { id: 'c2', type: 'case', content: 'второй' },
    ];
    const result = computeAdditionalContentNumbers(items);
    assert.deepEqual(result.map((r) => r.number), [1, null, 1]);
});

test('freeText перед кейсом даёт null у freeText и 1 у кейса', () => {
    const items = [
        { id: 'ft1', type: 'freeText', content: 'заметка' },
        { id: 'c1', type: 'case', content: 'первый' },
    ];
    const result = computeAdditionalContentNumbers(items);
    assert.deepEqual(result.map((r) => r.number), [null, 1]);
});

test('freeText между кейсами сбрасывает нумерацию', () => {
    const items = [
        { id: 'c1', type: 'case', content: 'первый' },
        { id: 'ft1', type: 'freeText', content: 'заметка' },
        { id: 'c2', type: 'case', content: 'второй' },
    ];
    const result = computeAdditionalContentNumbers(items);
    assert.deepEqual(result.map((r) => r.number), [1, null, 1]);
});

test('visible === true для всех элементов, id/kind проброшены', () => {
    const items = [
        { id: 'c1', type: 'case', content: 'первый' },
        { id: 'img1', type: 'image', url: 'data:image/png;base64,AAAA' },
        { id: 'ft1', type: 'freeText', content: 'заметка' },
    ];
    const result = computeAdditionalContentNumbers(items);

    assert.equal(result.length, 3);
    result.forEach((r) => assert.equal(r.visible, true));

    assert.equal(result[0].id, 'c1');
    assert.equal(result[0].kind, 'case');
    assert.equal(result[1].id, 'img1');
    assert.equal(result[1].kind, 'image');
    assert.equal(result[2].id, 'ft1');
    assert.equal(result[2].kind, 'freeText');
});
