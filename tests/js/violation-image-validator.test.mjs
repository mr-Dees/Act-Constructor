/**
 * Валидатор приёма картинок нарушений (H6).
 *
 * Все ветки отказа (MIME, размер файла, суммарный лимит акта, число
 * элементов) + ok-ветка + оценка байтов по data-URL. Лимиты передаются
 * явно — fetch /acts/limits в node-тестах не дёргается.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_IMAGE_LIMITS,
    estimateActImageBytes,
    estimateDataUrlBytes,
    validateImageFile,
} from '../../static/js/constructor/violation/violation-image-validator.js';

const LIMITS = {
    maxFileSize: 1000,
    maxTotalSizePerAct: 3000,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/gif'],
    maxItemsPerViolation: 3,
    previewMaxHeightPercent: 40,
};

function file(overrides = {}) {
    return Object.assign({ name: 'img.png', type: 'image/png', size: 500 }, overrides);
}

test('валидный файл проходит', () => {
    const res = validateImageFile(file(), { existingTotalBytes: 0, itemsCount: 0, limits: LIMITS });
    assert.equal(res.ok, true);
    assert.equal(res.reason, '');
});

test('SVG отклоняется (XSS-вектор, нет в whitelist)', () => {
    const res = validateImageFile(file({ type: 'image/svg+xml', name: 'evil.svg' }), { limits: LIMITS });
    assert.equal(res.ok, false);
    assert.match(res.reason, /Недопустимый тип/);
});

test('не-картинка (pdf) и пустой MIME отклоняются', () => {
    assert.equal(validateImageFile(file({ type: 'application/pdf' }), { limits: LIMITS }).ok, false);
    assert.equal(validateImageFile(file({ type: '' }), { limits: LIMITS }).ok, false);
});

test('файл больше лимита отклоняется с причиной про размер', () => {
    const res = validateImageFile(file({ size: 1001 }), { limits: LIMITS });
    assert.equal(res.ok, false);
    assert.match(res.reason, /слишком большой/);
});

test('файл ровно в лимит проходит', () => {
    assert.equal(validateImageFile(file({ size: 1000 }), { limits: LIMITS }).ok, true);
});

test('превышение суммарного лимита акта отклоняется', () => {
    const res = validateImageFile(file({ size: 600 }), {
        existingTotalBytes: 2500, itemsCount: 0, limits: LIMITS,
    });
    assert.equal(res.ok, false);
    assert.match(res.reason, /Суммарный размер/);
});

test('суммарный лимит впритык проходит', () => {
    const res = validateImageFile(file({ size: 500 }), {
        existingTotalBytes: 2500, itemsCount: 0, limits: LIMITS,
    });
    assert.equal(res.ok, true);
});

test('достигнут лимит элементов на нарушение → отказ', () => {
    const res = validateImageFile(file(), { itemsCount: 3, limits: LIMITS });
    assert.equal(res.ok, false);
    assert.match(res.reason, /лимит элементов/);
});

test('отсутствующий файл → отказ без исключения', () => {
    assert.equal(validateImageFile(null, { limits: LIMITS }).ok, false);
});

test('дефолтные лимиты зеркалят ACTS__IMAGES__* (10МБ/30МБ/50)', () => {
    assert.equal(DEFAULT_IMAGE_LIMITS.maxFileSize, 10 * 1024 * 1024);
    assert.equal(DEFAULT_IMAGE_LIMITS.maxTotalSizePerAct, 30 * 1024 * 1024);
    assert.equal(DEFAULT_IMAGE_LIMITS.maxItemsPerViolation, 50);
    assert.equal(DEFAULT_IMAGE_LIMITS.previewMaxHeightPercent, 40);
    assert.deepEqual(
        DEFAULT_IMAGE_LIMITS.allowedMimeTypes,
        ['image/jpeg', 'image/png', 'image/gif'],
    );
});

// --- Оценка байтов ---

test('estimateDataUrlBytes: 4 символа base64 ≈ 3 байта, префикс не считается', () => {
    const url = `data:image/png;base64,${'A'.repeat(4000)}`;
    assert.equal(estimateDataUrlBytes(url), 3000);
});

test('estimateDataUrlBytes: не-data строка → 0', () => {
    assert.equal(estimateDataUrlBytes('https://x/y.png'), 0);
    assert.equal(estimateDataUrlBytes(''), 0);
    assert.equal(estimateDataUrlBytes(null), 0);
});

test('estimateActImageBytes суммирует только image-элементы всех нарушений', () => {
    const url1k = `data:image/png;base64,${'A'.repeat(1000)}`;
    const violations = {
        v1: {
            additionalContent: {
                enabled: true,
                items: [
                    { type: 'image', url: url1k },
                    { type: 'case', content: 'не считается', url: '' },
                ],
            },
        },
        v2: { additionalContent: { enabled: false, items: [{ type: 'image', url: url1k }] } },
        v3: {},
    };
    assert.equal(estimateActImageBytes(violations), 1500);
});

test('estimateActImageBytes на пустом/отсутствующем словаре → 0', () => {
    assert.equal(estimateActImageBytes({}), 0);
    assert.equal(estimateActImageBytes(null), 0);
});
