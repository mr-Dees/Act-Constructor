/**
 * Перф-гейт точечного обновления блоков превью (FINDING 13).
 *
 * Замечания таблиц зависят ИСКЛЮЧИТЕЛЬНО от AppState.tables, поэтому правки
 * текстблоков/нарушений не должны пересчитывать рамки таблиц. Проверяем, что
 * флаш updateBlock дёргает _applyTableOutlines ТОЛЬКО когда в пачке есть правка
 * таблицы; пачка из одних не-табличных блоков рамки не трогает.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PreviewManager } from '../../static/js/constructor/preview/preview.js';

/**
 * Делает requestAnimationFrame синхронным, перехватывает побочные эффекты
 * флаша (_patchBlock/_applyTableOutlines/_emitContentChanged) и собирает,
 * вызвался ли _applyTableOutlines. Восстанавливает всё после прогона.
 *
 * @param {Array<[string,string]>} edits Пары [kind, id] для updateBlock.
 * @returns {{outlinesCalled: boolean}}
 */
function runFlush(edits) {
    const origRaf = globalThis.requestAnimationFrame;
    const origQS = document.querySelector;
    const origDispatch = document.dispatchEvent;
    const origCustomEvent = globalThis.CustomEvent;
    const origPatch = PreviewManager._patchBlock;
    const origOutlines = PreviewManager._applyTableOutlines;
    const origEmit = PreviewManager._emitContentChanged;

    let outlinesCalled = false;
    globalThis.requestAnimationFrame = (cb) => { cb(); return 0; };
    document.querySelector = () => ({}); // .preview-sheet найден
    document.dispatchEvent = () => true;
    globalThis.CustomEvent = function () {};
    PreviewManager._patchBlock = () => true; // патч «успешен», DOM не трогаем
    PreviewManager._applyTableOutlines = () => { outlinesCalled = true; };
    PreviewManager._emitContentChanged = () => {};

    try {
        PreviewManager._pendingBlocks.clear();
        PreviewManager._blockRafPending = false;
        for (const [kind, id] of edits) PreviewManager.updateBlock(kind, id);
    } finally {
        globalThis.requestAnimationFrame = origRaf;
        document.querySelector = origQS;
        document.dispatchEvent = origDispatch;
        globalThis.CustomEvent = origCustomEvent;
        PreviewManager._patchBlock = origPatch;
        PreviewManager._applyTableOutlines = origOutlines;
        PreviewManager._emitContentChanged = origEmit;
    }
    return { outlinesCalled };
}

test('пачка из одних не-табличных правок не пересчитывает рамки таблиц', () => {
    const { outlinesCalled } = runFlush([['textblock', 'tb1'], ['violation', 'v1']]);
    assert.equal(outlinesCalled, false);
});

test('пачка с правкой таблицы пересчитывает рамки таблиц', () => {
    const { outlinesCalled } = runFlush([['table', 't1']]);
    assert.equal(outlinesCalled, true);
});

test('смешанная пачка (есть таблица) пересчитывает рамки', () => {
    const { outlinesCalled } = runFlush([['textblock', 'tb1'], ['table', 't1']]);
    assert.equal(outlinesCalled, true);
});
