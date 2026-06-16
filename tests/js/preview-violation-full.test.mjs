/**
 * Превью нарушений = полнота DOCX (H4/M.3/M.5).
 *
 * Тестируем чистые части рендерера: collectViolationLines (полные тексты,
 * полный descriptionList, нумерация кейсов со сбросом — семантика
 * docx/builders/violation.py) и imagePresentationStyle (маппинг
 * item.width / preview_max_height_percent → CSS, Б-1.4/Б-1.6).
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    collectViolationLines,
    imagePresentationStyle,
    PreviewViolationRenderer,
} from '../../static/js/constructor/preview/preview-violation-renderer.js';

/**
 * Рендерит нарушение с одним image-элементом и возвращает применённый
 * inline-стиль картинки. Перехватывает document.createElement, чтобы достать
 * созданный <img> (appendChild в стабе — no-op).
 *
 * @param {Object} imageItem Элемент additionalContent типа image.
 * @returns {{width: (string|undefined), maxHeight: (string|undefined)}}
 */
function renderImageStyle(imageItem) {
    const origCreate = document.createElement;
    let imgStyle = null;
    document.createElement = (tag) => {
        const el = origCreate(tag);
        if (tag === 'img') imgStyle = el.style;
        return el;
    };
    try {
        PreviewViolationRenderer.create({
            violated: '—',
            established: '—',
            descriptionList: { enabled: false, items: [] },
            additionalContent: { enabled: true, items: [imageItem] },
            reasons: { enabled: false, content: '' },
            consequences: { enabled: false, content: '' },
            responsible: { enabled: false, content: '' },
            recommendations: { enabled: false, content: '' },
        });
    } finally {
        document.createElement = origCreate;
    }
    return imgStyle || {};
}

const LONG = 'Очень длинный текст нарушения, который раньше обрезался превью до пары десятков символов. '.repeat(20);

function makeViolation(overrides = {}) {
    return Object.assign({
        id: 'v1',
        nodeId: 'n1',
        violated: 'Нарушено-текст',
        established: 'Установлено-текст',
        descriptionList: { enabled: false, items: [] },
        additionalContent: { enabled: false, items: [] },
        reasons: { enabled: false, content: '' },
        consequences: { enabled: false, content: '' },
        responsible: { enabled: false, content: '' },
        recommendations: { enabled: false, content: '' },
    }, overrides);
}

test('violated/established выводятся полностью, без обрезки', () => {
    const lines = collectViolationLines(makeViolation({ violated: LONG, established: LONG }));
    const violated = lines.find(l => l.label === 'Нарушено');
    const established = lines.find(l => l.label === 'Установлено');
    assert.equal(violated.text, LONG);
    assert.equal(established.text, LONG);
});

test('descriptionList — полный список пунктов, а не «N метрик»', () => {
    const items = ['Метрика один', 'Метрика два', 'Метрика три'];
    const lines = collectViolationLines(makeViolation({
        descriptionList: { enabled: true, items: [...items, '   '] },
    }));
    const list = lines.find(l => l.type === 'list');
    assert.ok(list, 'нет list-строки');
    assert.deepEqual(list.items, items); // пустые отфильтрованы, остальные полностью
    assert.ok(!lines.some(l => l.type === 'line' && /метрик/.test(l.text || '')));
});

test('выключенный descriptionList не выводится', () => {
    const lines = collectViolationLines(makeViolation({
        descriptionList: { enabled: false, items: ['скрытая'] },
    }));
    assert.ok(!lines.some(l => l.type === 'list'));
});

test('кейсы и свободный текст — полные, без обрезки (M.5)', () => {
    const lines = collectViolationLines(makeViolation({
        additionalContent: {
            enabled: true,
            items: [
                { id: 'c1', type: 'case', content: LONG },
                { id: 'f1', type: 'freeText', content: LONG },
            ],
        },
    }));
    assert.equal(lines.find(l => l.label === 'Кейс 1').text, LONG);
    assert.equal(lines.find(l => l.label === 'Текст 1').text, LONG);
});

test('нумерация кейсов сбрасывается после не-кейса (паритет DOCX/MD/TXT)', () => {
    const lines = collectViolationLines(makeViolation({
        additionalContent: {
            enabled: true,
            items: [
                { id: 'c1', type: 'case', content: 'Первый' },
                { id: 'c2', type: 'case', content: 'Второй' },
                { id: 'i1', type: 'image', url: 'data:image/png;base64,AAAA', filename: 'x.png' },
                { id: 'c3', type: 'case', content: 'После картинки' },
            ],
        },
    }));
    const labels = lines.filter(l => /^Кейс/.test(l.label || '')).map(l => l.label);
    assert.deepEqual(labels, ['Кейс 1', 'Кейс 2', 'Кейс 1']);
});

test('пустой кейс пропускается и не двигает нумерацию', () => {
    const lines = collectViolationLines(makeViolation({
        additionalContent: {
            enabled: true,
            items: [
                { id: 'c1', type: 'case', content: '   ' },
                { id: 'c2', type: 'case', content: 'Единственный' },
            ],
        },
    }));
    const cases = lines.filter(l => /^Кейс/.test(l.label || ''));
    assert.equal(cases.length, 1);
    assert.equal(cases[0].label, 'Кейс 1');
});

test('image-элемент попадает в модель строк целиком', () => {
    const item = { id: 'i1', type: 'image', url: 'data:image/png;base64,AAAA', caption: 'Подпись', filename: 'x.png', width: 50 };
    const lines = collectViolationLines(makeViolation({
        additionalContent: { enabled: true, items: [item] },
    }));
    const image = lines.find(l => l.type === 'image');
    assert.equal(image.item, item);
});

test('опциональные поля выводятся полностью при enabled', () => {
    const lines = collectViolationLines(makeViolation({
        reasons: { enabled: true, content: LONG },
        recommendations: { enabled: false, content: 'скрытая' },
    }));
    assert.equal(lines.find(l => l.label === 'Причины').text, LONG);
    assert.ok(!lines.some(l => (l.text || '').includes('скрытая')));
});

// --- imagePresentationStyle (Б-1.4 / Б-1.6) ---

test('width=50 → width:50%, дефолтный лимит высоты 40% листа = 118.8mm', () => {
    const style = imagePresentationStyle({ width: 50 }, 40);
    assert.equal(style.width, '50%');
    assert.equal(style.maxHeight, '118.8mm');
});

test('width=0 (Авто) → width не задаётся', () => {
    const style = imagePresentationStyle({ width: 0 }, 40);
    assert.equal(style.width, '');
});

test('width отсутствует у старых актов → авто', () => {
    const style = imagePresentationStyle({}, 40);
    assert.equal(style.width, '');
});

test('кастомный preview_max_height_percent учитывается', () => {
    const style = imagePresentationStyle({ width: 25 }, 50);
    assert.equal(style.width, '25%');
    assert.equal(style.maxHeight, '148.5mm');
});

test('нулевой/отсутствующий процент высоты → дефолт 40', () => {
    assert.equal(imagePresentationStyle({}, 0).maxHeight, '118.8mm');
    assert.equal(imagePresentationStyle({}, undefined).maxHeight, '118.8mm');
});

// --- применённый стиль <img> (FINDING 6 / Б-1.6): явная ширина = как DOCX ---

test('явная ширина → задаётся только width, без потолка высоты (паритет DOCX)', () => {
    const style = renderImageStyle({ type: 'image', url: 'data:image/png;base64,AAAA', width: 50, filename: 'x.png' });
    assert.equal(style.width, '50%');
    assert.equal(style.maxHeight, undefined, 'explicit-width картинка не должна получать maxHeight');
});

test('авторазмер (width=0) → задаётся maxHeight, ширина не фиксируется', () => {
    const style = renderImageStyle({ type: 'image', url: 'data:image/png;base64,AAAA', width: 0, filename: 'x.png' });
    assert.equal(style.width, undefined, 'auto-size картинка не должна получать width');
    assert.equal(style.maxHeight, '118.8mm', 'auto-size картинка ограничивает высоту (защита скролла, Б-1.6)');
});

test('width отсутствует (старые акты) → авторазмер с maxHeight', () => {
    const style = renderImageStyle({ type: 'image', url: 'data:image/png;base64,AAAA', filename: 'x.png' });
    assert.equal(style.width, undefined);
    assert.equal(style.maxHeight, '118.8mm');
});
