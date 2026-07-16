/**
 * Проверка содержимого картинки по магическим байтам (#26).
 *
 * detectImageMagic — чистый матчинг сигнатур PNG/JPEG/GIF по первым байтам.
 * sniffImageMagic — async-обёртка (file.slice(0,12).arrayBuffer()) с фильтром
 * по списку разрешённых типов. Отклоняет мусор и переименованные не-картинки
 * (напр. PDF/EXE с расширением .png).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    detectImageMagic,
    sniffImageMagic,
} from '../../static/js/constructor/violation/violation-file-reading.js';

/** Файл-стаб с рабочим slice().arrayBuffer() поверх заданных байтов. */
function fileWith(bytes, type = 'image/png') {
    return { type, name: 'x', slice: () => new Blob([new Uint8Array(bytes)]) };
}

// --- detectImageMagic ---

test('detectImageMagic: распознаёт PNG / JPEG / GIF87a / GIF89a', () => {
    assert.equal(detectImageMagic([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]), 'image/png');
    assert.equal(detectImageMagic([0xFF, 0xD8, 0xFF, 0xE0]), 'image/jpeg');
    assert.equal(detectImageMagic([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]), 'image/gif'); // GIF89a
    assert.equal(detectImageMagic([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]), 'image/gif'); // GIF87a
});

test('detectImageMagic: мусор и пустой буфер → null', () => {
    assert.equal(detectImageMagic([0x00, 0x01, 0x02, 0x03]), null);
    assert.equal(detectImageMagic([0x25, 0x50, 0x44, 0x46]), null); // %PDF
    assert.equal(detectImageMagic([]), null);
});

test('detectImageMagic: принимает и Uint8Array, и обычный массив', () => {
    assert.equal(detectImageMagic(new Uint8Array([0xFF, 0xD8, 0xFF])), 'image/jpeg');
});

// --- sniffImageMagic ---

test('sniffImageMagic: валидные PNG/JPEG/GIF принимаются', async () => {
    assert.equal(await sniffImageMagic(fileWith([0x89, 0x50, 0x4E, 0x47, 0, 0, 0, 0])), true);
    assert.equal(await sniffImageMagic(fileWith([0xFF, 0xD8, 0xFF, 0, 0, 0, 0, 0], 'image/jpeg')), true);
    assert.equal(await sniffImageMagic(fileWith([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0], 'image/gif')), true);
});

test('sniffImageMagic: переименованный не-картиночный файл (PDF в .png) отклоняется', async () => {
    assert.equal(await sniffImageMagic(fileWith([0x25, 0x50, 0x44, 0x46, 0, 0, 0, 0])), false);
});

test('sniffImageMagic: случайный мусор отклоняется', async () => {
    assert.equal(await sniffImageMagic(fileWith([0xDE, 0xAD, 0xBE, 0xEF, 0, 0, 0, 0])), false);
});

test('sniffImageMagic: тип не в allowed-списке отклоняется даже при валидной сигнатуре', async () => {
    const gif = fileWith([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0], 'image/gif');
    assert.equal(await sniffImageMagic(gif, ['image/jpeg', 'image/png']), false);
});

test('sniffImageMagic: сбой чтения (нет slice) → false, без исключения', async () => {
    assert.equal(await sniffImageMagic({ type: 'image/png' }), false);
});
