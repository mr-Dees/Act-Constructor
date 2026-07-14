/**
 * Единый конвейер приёма картинок (paste/drop/upload) + bulk-вставка
 * (находки аудита #28/#29).
 *
 * #28 — Ctrl+V больше НЕ берёт только последнюю картинку буфера и не читает
 * своим инлайн-FileReader'ом: все image-элементы буфера собираются в File[],
 * прогоняются через filterAcceptedImageFiles и insertImageFilesInOrder — ТОТ
 * ЖЕ путь, что drop/upload.
 *
 * #29 — insertImageFilesInOrder вставляет пачку РАЗОМ (один splice, один
 * renderContentItems, один updateBlock) вместо O(N²) перерисовки на каждый
 * файл. Единая точка гейта — _insertContentItemsBulk — сохраняет лимит #4 и
 * read-only-guard #1.
 *
 * Реальные модули конструктора импортируются под node:test через
 * _browser-stub (см. конвенцию в violation-additional-content-limit.test.mjs).
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppConfig } from '../../static/js/shared/app-config.js';
import { Notifications } from '../../static/js/shared/notifications.js';
import { PreviewManager } from '../../static/js/constructor/preview/preview.js';
import '../../static/js/constructor/violation/violation-init.js';
import { ViolationManager } from '../../static/js/constructor/violation/violation-core.js';
import { CONTENT_TYPE_IMAGE } from '../../static/js/constructor/violation/violation-content-item.js';
import {
    getImageLimits,
    resetImageLimitsForTests,
} from '../../static/js/constructor/violation/violation-image-validator.js';

// Шпионы: собираем вызовы вместо реальных side-эффектов (тосты/превью).
let warnings = [];
let successes = [];
let errors = [];
let previewCalls = [];
Notifications.warning = (msg) => warnings.push(msg);
Notifications.success = (msg) => successes.push(msg);
Notifications.error = (msg) => errors.push(msg);
PreviewManager.updateBlock = (type, id) => previewCalls.push({ type, id });

/** Мини-стаб FileReader — детерминированный data-URL на файл. */
class FakeFileReader {
    readAsDataURL(file) {
        Promise.resolve().then(() => {
            if (this.onload) this.onload({ target: { result: `data:image/png;base64,${file.name}` } });
        });
    }
}

function reset(maxItemsPerViolation = 50) {
    warnings = [];
    successes = [];
    errors = [];
    previewCalls = [];
    AppConfig.readOnlyMode.isReadOnly = false;
    resetImageLimitsForTests();
    getImageLimits().maxItemsPerViolation = maxItemsPerViolation;
    globalThis.FileReader = FakeFileReader;
    document.activeElement = null;
}

/**
 * Ставит фокус внутри зоны: под focus-моделью (#19) целевая зона paste
 * берётся из document.activeElement.closest('.additional-content-wrapper').
 */
function focusZone(container) {
    document.activeElement = {
        closest: (sel) => (sel === '.additional-content-wrapper' ? container : null),
    };
}

function makeViolation(items = []) {
    return { id: 'v1', additionalContent: { enabled: true, items } };
}

/** Стаб контейнера с рабочим querySelector('.additional-content-items'). */
function makeContainer(violationId = 'v1') {
    const itemsContainer = { innerHTML: '', appendChild() {}, dataset: { violationId } };
    return {
        querySelector: (sel) => (sel === '.additional-content-items' ? itemsContainer : null),
    };
}

/** Файл-стаб картинки с рабочим slice() (для magic-sniff #26). PNG → ресайз пропускается. */
function imgFile(name, size = 100) {
    return {
        name,
        type: 'image/png',
        size,
        slice: () => new Blob([new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])]),
    };
}

/**
 * Синтетическое событие вставки: image-элементы + опциональный text/plain.
 * getAsFile у картинок возвращает File-стаб, у текста — null (как в браузере).
 */
function makeClipboardEvent(files, { text = null } = {}) {
    const items = files.map((f) => ({ type: f.type, getAsFile: () => f }));
    if (text !== null) {
        items.push({ type: 'text/plain', getAsFile: () => null });
    }
    return {
        target: { tagName: 'DIV' },
        clipboardData: { items, getData: () => text ?? '' },
        preventDefault() {},
    };
}

/** Ставит paste-обработчик и возвращает захваченный колбэк. */
function capturePasteHandler(vm) {
    let handler = null;
    const orig = document.addEventListener;
    document.addEventListener = (type, cb) => {
        if (type === 'paste') handler = cb;
    };
    vm.setupPasteHandler();
    document.addEventListener = orig;
    return handler;
}

// --- #28: Ctrl+V собирает ВСЕ картинки и гонит их через общий конвейер ---

test('#28 Ctrl+V с несколькими картинками: ВСЕ идут в единый конвейер, не только последняя', async () => {
    reset();
    const vm = new ViolationManager();
    const violation = makeViolation();
    const container = makeContainer();
    focusZone(container);
    vm.activeViolations.set('v1', violation);

    // Спай конвейера: захватываем, что реально передали (после filterAcceptedImageFiles).
    // Единая точка входа из paste — promptQualityThenInsertImages (диалог Q3 → ресайз).
    let captured = null;
    vm.promptQualityThenInsertImages = (v, c, idx, files) => {
        captured = { v, c, idx, files };
    };

    const handler = capturePasteHandler(vm);
    await handler(makeClipboardEvent([imgFile('a.png'), imgFile('b.png'), imgFile('c.png')]));

    assert.ok(captured, 'конвейер promptQualityThenInsertImages вызван');
    assert.equal(captured.files.length, 3, 'переданы ВСЕ три картинки, не только последняя');
    assert.deepEqual(captured.files.map((f) => f.name), ['a.png', 'b.png', 'c.png'], 'порядок сохранён');
    assert.equal(captured.idx, 0, 'insertIndex = конец зоны (пустая зона → 0)');
    assert.equal(captured.c, container, 'целевой контейнер = зона по фокусу');
    assert.equal(captured.v, violation);
});

test('#1 read-only: Ctrl+V не запускает конвейер вставки', async () => {
    reset();
    AppConfig.readOnlyMode.isReadOnly = true;
    const vm = new ViolationManager();
    const violation = makeViolation();
    const container = makeContainer();
    focusZone(container);
    vm.activeViolations.set('v1', violation);

    let called = false;
    vm.promptQualityThenInsertImages = () => {
        called = true;
    };

    const handler = capturePasteHandler(vm);
    await handler(makeClipboardEvent([imgFile('a.png'), imgFile('b.png')]));

    assert.equal(called, false, 'в режиме просмотра конвейер не вызывается');
});

test('#29 Ctrl+V текста: ровно один updateBlock (нет двойного апдейта превью)', async () => {
    reset();
    const vm = new ViolationManager();
    const violation = makeViolation();
    const container = makeContainer();
    focusZone(container);
    vm.activeViolations.set('v1', violation);

    const handler = capturePasteHandler(vm);
    await handler(makeClipboardEvent([], { text: 'просто текст' }));

    assert.equal(violation.additionalContent.items.length, 1, 'текст добавлен');
    assert.equal(previewCalls.length, 1, 'превью обновлено ровно один раз (нет двойного updateBlock)');
    assert.deepEqual(successes, ['Текст добавлен из буфера обмена']);
});

// --- #29: bulk-вставка insertImageFilesInOrder — один render, один updateBlock ---

test('#29 insertImageFilesInOrder: пачка → один renderContentItems и один updateBlock', async () => {
    reset(50);
    const vm = new ViolationManager();
    const violation = makeViolation();
    const container = makeContainer();

    let renderCalls = 0;
    vm.renderContentItems = () => {
        renderCalls += 1;
    };

    await vm.insertImageFilesInOrder(violation, container, 0, [imgFile('a.png'), imgFile('b.png'), imgFile('c.png')]);

    assert.equal(violation.additionalContent.items.length, 3, 'все три вставлены');
    assert.deepEqual(
        violation.additionalContent.items.map((i) => i.filename),
        ['a.png', 'b.png', 'c.png'],
        'порядок пачки сохранён',
    );
    assert.ok(violation.additionalContent.items.every((i) => i.type === CONTENT_TYPE_IMAGE));
    assert.equal(renderCalls, 1, 'ровно один render на всю пачку (не O(N))');
    assert.equal(previewCalls.length, 1, 'ровно один updateBlock на всю пачку');
    assert.deepEqual(successes, ['Добавлено изображений: 3']);
    assert.equal(warnings.length, 0);
});

test('#4 insertImageFilesInOrder: пачка сверх лимита → вставлено до лимита, один warning, один render', async () => {
    reset(2);
    const vm = new ViolationManager();
    const violation = makeViolation([
        { id: 'x0', type: CONTENT_TYPE_IMAGE, order: 0, url: 'data:x', filename: 'x0.png' },
    ]);
    const container = makeContainer();

    let renderCalls = 0;
    vm.renderContentItems = () => {
        renderCalls += 1;
    };

    await vm.insertImageFilesInOrder(violation, container, 1, [imgFile('a.png'), imgFile('b.png'), imgFile('c.png')]);

    assert.equal(violation.additionalContent.items.length, 2, 'вставлено ровно до лимита');
    assert.equal(violation.additionalContent.items[1].filename, 'a.png', 'влезла первая из пачки');
    assert.equal(renderCalls, 1, 'один render даже при обрезке по лимиту');
    assert.equal(previewCalls.length, 1, 'один updateBlock');
    assert.equal(warnings.length, 1, 'один warning на всю пачку, не по разу на файл');
    assert.match(warnings[0], /лимит/i);
    assert.match(warnings[0], /2/, 'сообщение содержит число лимита');
    assert.deepEqual(successes, ['Изображение добавлено'], 'тост отражает РЕАЛЬНОЕ число (1)');
});

test('#1 insertImageFilesInOrder: read-only bulk-guard — ничего не вставлено, render не вызван', async () => {
    reset(50);
    AppConfig.readOnlyMode.isReadOnly = true;
    const vm = new ViolationManager();
    const violation = makeViolation();
    const container = makeContainer();

    let renderCalls = 0;
    vm.renderContentItems = () => {
        renderCalls += 1;
    };

    await vm.insertImageFilesInOrder(violation, container, 0, [imgFile('a.png'), imgFile('b.png')]);

    assert.equal(violation.additionalContent.items.length, 0, 'в режиме просмотра bulk ничего не вставляет');
    assert.equal(renderCalls, 0, 'render не вызывается');
    assert.equal(previewCalls.length, 0);
    assert.deepEqual(successes, [], 'нет ложного success-тоста');
});

test('#29 insertImageFilesInOrder: нечитаемый файл пропущен, остальные вставлены одним render', async () => {
    reset(50);
    // FileReader, падающий на broken.png.
    class FailingReader {
        readAsDataURL(file) {
            Promise.resolve().then(() => {
                if (file.name === 'broken.png') {
                    if (this.onerror) this.onerror(new Error('boom'));
                } else if (this.onload) {
                    this.onload({ target: { result: `data:image/png;base64,${file.name}` } });
                }
            });
        }
    }
    globalThis.FileReader = FailingReader;

    const vm = new ViolationManager();
    const violation = makeViolation();
    const container = makeContainer();

    let renderCalls = 0;
    vm.renderContentItems = () => {
        renderCalls += 1;
    };

    await vm.insertImageFilesInOrder(violation, container, 0, [
        imgFile('a.png'),
        imgFile('broken.png'),
        imgFile('c.png'),
    ]);

    assert.deepEqual(
        violation.additionalContent.items.map((i) => i.filename),
        ['a.png', 'c.png'],
        'битый файл пропущен, порядок остальных сохранён',
    );
    assert.equal(renderCalls, 1, 'один render на успешно прочитанные');
    assert.equal(previewCalls.length, 1);
    assert.equal(errors.length, 1, 'ошибка чтения показана один раз');
    assert.match(errors[0], /broken\.png/);
    assert.deepEqual(successes, ['Добавлено изображений: 2']);
});
