/**
 * Клиентский даунскейл картинок перед вставкой (#25).
 *
 * Тестируется ЧИСТАЯ логика: выбор maxDim/quality по режиму, предикат
 * пережатия (JPEG — да; GIF/PNG/original — нет), пересчёт размеров с
 * сохранением аспекта, и skip-ветки downscaleImage (original/GIF/PNG →
 * оригинальные байты). Сам canvas-конвейер (createImageBitmap/toBlob) в node
 * без DOM не исполняется — это LIVE-проверка (см. task-13-report).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    RESIZE_PRESETS,
    resolveResizeMode,
    shouldDownscale,
    computeScaledSize,
    downscaleImage,
} from '../../static/js/constructor/violation/violation-image-resize.js';

// --- resolveResizeMode ---

test('resolveResizeMode: high → 1600/0.8, medium → 1200/0.7', () => {
    assert.deepEqual(resolveResizeMode('high'), { maxDim: 1600, quality: 0.8 });
    assert.deepEqual(resolveResizeMode('medium'), { maxDim: 1200, quality: 0.7 });
    // Пресеты доступны и как таблица.
    assert.equal(RESIZE_PRESETS.high.maxDim, 1600);
    assert.equal(RESIZE_PRESETS.medium.quality, 0.7);
});

test('resolveResizeMode: original / неизвестный режим → null', () => {
    assert.equal(resolveResizeMode('original'), null);
    assert.equal(resolveResizeMode('zzz'), null);
    assert.equal(resolveResizeMode(undefined), null);
});

// --- shouldDownscale (ветка пропуска GIF/PNG/original) ---

test('shouldDownscale: JPEG пережимается в high и medium', () => {
    assert.equal(shouldDownscale('image/jpeg', 'high'), true);
    assert.equal(shouldDownscale('image/jpeg', 'medium'), true);
});

test('shouldDownscale: режим original — никогда не пережимаем', () => {
    assert.equal(shouldDownscale('image/jpeg', 'original'), false);
    assert.equal(shouldDownscale('image/png', 'original'), false);
});

test('shouldDownscale: GIF и PNG в сжатии НЕ пережимаются (анимация/прозрачность)', () => {
    assert.equal(shouldDownscale('image/gif', 'high'), false);
    assert.equal(shouldDownscale('image/png', 'high'), false);
    assert.equal(shouldDownscale('image/png', 'medium'), false);
    assert.equal(shouldDownscale('image/gif', 'medium'), false);
});

// --- computeScaledSize (сохранение аспекта, без апскейла) ---

test('computeScaledSize: длинная сторона > maxDim → масштаб с сохранением аспекта', () => {
    assert.deepEqual(computeScaledSize(3200, 2400, 1600), { width: 1600, height: 1200 });
    assert.deepEqual(computeScaledSize(2400, 3200, 1600), { width: 1200, height: 1600 });
});

test('computeScaledSize: обе стороны ≤ maxDim → без апскейла', () => {
    assert.deepEqual(computeScaledSize(800, 600, 1600), { width: 800, height: 600 });
    assert.deepEqual(computeScaledSize(1600, 900, 1600), { width: 1600, height: 900 });
});

test('computeScaledSize: вырожденные размеры → возвращаются как есть', () => {
    assert.deepEqual(computeScaledSize(0, 0, 1600), { width: 0, height: 0 });
});

// --- downscaleImage: skip-ветки (без canvas) ---

test('downscaleImage: mode=original не трогает байты — читает оригинал', async () => {
    let readArg = null;
    const fakeReader = (f) => { readArg = f; return Promise.resolve('data:orig'); };
    const file = { type: 'image/jpeg', name: 'p.jpg' };

    const url = await downscaleImage(file, { mode: 'original', readAsDataUrl: fakeReader });

    assert.equal(url, 'data:orig');
    assert.equal(readArg, file, 'прочитан именно оригинальный файл, canvas не задействован');
});

test('downscaleImage: GIF в сжатии → оригинал (JPEG убил бы анимацию)', async () => {
    const file = { type: 'image/gif', name: 'a.gif' };
    const url = await downscaleImage(file, { mode: 'high', readAsDataUrl: () => Promise.resolve('data:gif') });
    assert.equal(url, 'data:gif');
});

test('downscaleImage: PNG в сжатии → оригинал (прозрачность сохраняется)', async () => {
    const file = { type: 'image/png', name: 'a.png' };
    const url = await downscaleImage(file, { mode: 'high', readAsDataUrl: () => Promise.resolve('data:png') });
    assert.equal(url, 'data:png');
});
