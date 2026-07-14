/**
 * Рендер расширенного диффа нарушения (#8, вариант А): список описаний и
 * доп.контент.
 *
 * Ключевой инвариант тех-долга (см. diff-renderer-textblock-profile.test.mjs):
 * НОВЫЕ word-diff-ветки (пункт descriptionList, кейс/свободный текст) должны
 * оборачивать вставки/удаления в <ins>/<del> через _escapeHtml — на ДЕФОЛТНОМ
 * профиле SafeHTML.set, а не acts-allowlist (тот срезал бы <ins>/<del>).
 *
 * DOM в node поднять нельзя, поэтому: (1) юнит-тест чистой сборки html
 * _wordDiffToHtml с escape-aware createElement; (2) smoke-тест полного
 * _renderDiffViolation на стандартных стабах (без исключений).
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DiffRenderer } from '../../static/js/portal/acts-manager/diff-renderer.js';

/** Escape-aware элемент: textContent → innerHTML с базовым HTML-экранированием. */
function makeEscapeAwareEl() {
    let html = '';
    const el = {
        style: {}, dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        addEventListener() {}, appendChild() {}, setAttribute() {},
    };
    Object.defineProperty(el, 'innerHTML', { get() { return html; }, set(v) { html = String(v); } });
    Object.defineProperty(el, 'textContent', {
        get() { return html; },
        set(v) { html = String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
    });
    return el;
}

test('_wordDiffToHtml: вставки/удаления обёрнуты <ins>/<del>, payload экранирован', () => {
    const orig = document.createElement;
    document.createElement = () => makeEscapeAwareEl();
    try {
        const html = DiffRenderer._wordDiffToHtml([
            { type: 'equal', text: 'общий' },
            { type: 'insert', text: 'новое' },
            { type: 'delete', text: '<b>старое</b>' },
        ]);
        assert.ok(html.includes('<ins>новое</ins>'), 'insert должен быть в <ins>');
        assert.ok(html.includes('<del>&lt;b&gt;старое&lt;/b&gt;</del>'), 'delete-payload экранирован внутри <del>');
        assert.ok(!html.includes('<b>'), 'сырой HTML из payload не должен просачиваться');
    } finally {
        document.createElement = orig;
    }
});

test('_renderDiffViolation: полный дифф (списки + кейс + картинка) рендерится без исключений', () => {
    const violDiff = {
        status: 'modified',
        fieldDiffs: {
            reasons: { old: 'старое', new: 'новое', changed: true },
            descriptionList: {
                kind: 'list', changed: true, enabled: true, oldEnabled: true,
                items: [
                    { status: 'modified', old: 'a', new: 'b', wordDiff: [{ type: 'delete', text: 'a' }, { type: 'insert', text: 'b' }] },
                    { status: 'added', new: 'c' },
                    { status: 'removed', old: 'd' },
                    { status: 'unchanged', old: 'e', new: 'e' },
                ],
            },
            additionalContent: {
                kind: 'additional', changed: true, enabled: true, oldEnabled: true,
                entries: [
                    { status: 'modified', reordered: false, oldItem: { id: 'c1', type: 'case', content: 'x' }, newItem: { id: 'c1', type: 'case', content: 'y' }, wordDiff: [{ type: 'delete', text: 'x' }, { type: 'insert', text: 'y' }] },
                    { status: 'added', newItem: { id: 'f1', type: 'freeText', content: 'новый текст' } },
                    { status: 'modified', reordered: false, oldItem: { id: 'i1', type: 'image', url: 'a', caption: 'старая', filename: 'p.png', width: 0 }, newItem: { id: 'i1', type: 'image', url: 'b', caption: 'новая', filename: 'p.png', width: 50 }, fields: { url: { old: 'a', new: 'b' }, caption: { old: 'старая', new: 'новая' }, width: { old: 0, new: 50 } } },
                    { status: 'removed', oldItem: { id: 'i2', type: 'image', url: '', caption: '', filename: 'q.png', width: 0 } },
                ],
            },
        },
        oldData: { additionalContent: { enabled: true, items: [{ id: 'c1', type: 'case' }, { id: 'i1', type: 'image' }, { id: 'i2', type: 'image' }] } },
        newData: { additionalContent: { enabled: true, items: [{ id: 'c1', type: 'case' }, { id: 'f1', type: 'freeText' }, { id: 'i1', type: 'image' }] }, reasons: { enabled: true, content: 'новое' } },
    };

    assert.doesNotThrow(() => {
        DiffRenderer._renderDiffViolation({ appendChild() {} }, violDiff);
    });
});
