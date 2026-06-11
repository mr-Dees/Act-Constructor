/**
 * Маршрутизация точечного обновления блока превью (перф-волна, M.7):
 * чистая функция decideBlockPatch — patch / skip / full без DOM.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideBlockPatch, PATCHABLE_BLOCK_KINDS } from '../../static/js/constructor/preview/preview-block-routing.js';

test('table/violation: патч только при наличии элемента и данных', () => {
    for (const kind of ['table', 'violation']) {
        assert.equal(decideBlockPatch(kind, {hasElement: true, hasData: true}), 'patch', kind);
        assert.equal(decideBlockPatch(kind, {hasElement: false, hasData: true}), 'full', `${kind}: промах индекса`);
        assert.equal(decideBlockPatch(kind, {hasElement: true, hasData: false}), 'full', `${kind}: блок удалён из state`);
        assert.equal(decideBlockPatch(kind, {hasElement: false, hasData: false}), 'full', kind);
    }
});

test('textblock: непустой с элементом — patch', () => {
    assert.equal(
        decideBlockPatch('textblock', {hasElement: true, hasData: true, hasContent: true}),
        'patch'
    );
});

test('textblock: появление контента (элемента ещё нет) — full (нужна вставка)', () => {
    assert.equal(
        decideBlockPatch('textblock', {hasElement: false, hasData: true, hasContent: true}),
        'full'
    );
});

test('textblock: контент исчез (элемент есть) — full (нужно убрать блок)', () => {
    assert.equal(
        decideBlockPatch('textblock', {hasElement: true, hasData: true, hasContent: false}),
        'full'
    );
});

test('textblock: пустой и скрытый — skip (DOM не трогаем)', () => {
    assert.equal(
        decideBlockPatch('textblock', {hasElement: false, hasData: true, hasContent: false}),
        'skip'
    );
});

test('textblock без данных и неизвестный тип — full', () => {
    assert.equal(decideBlockPatch('textblock', {hasElement: true, hasData: false}), 'full');
    assert.equal(decideBlockPatch('chart', {hasElement: true, hasData: true}), 'full');
});

test('перечень патчабельных типов зафиксирован', () => {
    assert.deepEqual([...PATCHABLE_BLOCK_KINDS], ['table', 'textblock', 'violation']);
});
