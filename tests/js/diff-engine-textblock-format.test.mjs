/**
 * Тесты диффа текстблоков по форматированию (#8 full, textblock): движок и
 * раньше помечал 'modified' при разном raw `content`, но если видимый текст
 * (_stripHtml) совпадал, word-diff был пустым (все слова equal) — подсветки
 * никакой, изменение выглядело «пустым». Теперь при modified со СОВПАДАЮЩИМ
 * stripHtml выставляется флаг `formattingOnly`, а рендер показывает бейдж
 * «Изменено форматирование».
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DiffEngine } from '../../static/js/portal/acts-manager/diff-engine.js';
import { DiffRenderer } from '../../static/js/portal/acts-manager/diff-renderer.js';

function diffOne(oldC, newC) {
    return DiffEngine._diffTextBlocks({ tb: { content: oldC } }, { tb: { content: newC } }).tb;
}

// --- движок -----------------------------------------------------------------

test('тот же текст, разный HTML → modified + formattingOnly=true', () => {
    const d = diffOne('<b>привет мир</b>', '<i>привет мир</i>');
    assert.equal(d.status, 'modified');
    assert.equal(d.formattingOnly, true);
    // Видимый текст совпал → word-diff без вставок/удалений.
    assert.ok(d.wordDiff.every(op => op.type === 'equal'));
});

test('реальная правка текста → modified + formattingOnly=false', () => {
    const d = diffOne('<b>привет мир</b>', '<b>привет свет</b>');
    assert.equal(d.status, 'modified');
    assert.equal(d.formattingOnly, false);
});

test('идентичный raw content → unchanged (без флага)', () => {
    const d = diffOne('<b>текст</b>', '<b>текст</b>');
    assert.equal(d.status, 'unchanged');
    assert.equal(d.formattingOnly, undefined);
});

test('added/removed не несут formattingOnly', () => {
    const added = DiffEngine._diffTextBlocks({}, { tb: { content: 'x' } }).tb;
    const removed = DiffEngine._diffTextBlocks({ tb: { content: 'x' } }, {}).tb;
    assert.equal(added.status, 'added');
    assert.equal(added.formattingOnly, undefined);
    assert.equal(removed.status, 'removed');
    assert.equal(removed.formattingOnly, undefined);
});

// --- рендер бейджа ----------------------------------------------------------

/** Собирает все созданные элементы при рендере текстблок-диффа. */
function renderCollecting(tbDiff) {
    const created = [];
    const orig = document.createElement;
    document.createElement = (tag) => {
        const el = orig(tag);
        created.push(el);
        return el;
    };
    try {
        DiffRenderer._renderDiffTextBlock({ appendChild() {} }, tbDiff);
    } finally {
        document.createElement = orig;
    }
    return created;
}

test('formattingOnly modified → создаётся бейдж «Изменено форматирование»', () => {
    const created = renderCollecting({
        status: 'modified',
        formattingOnly: true,
        wordDiff: [{ type: 'equal', text: 'привет мир' }],
    });
    const badge = created.find(el => el.className === 'diff-textblock-format-badge');
    assert.ok(badge, 'бейдж форматирования не создан');
    assert.equal(badge.textContent, 'Изменено форматирование');
});

test('обычная правка текста → бейджа форматирования нет', () => {
    const created = renderCollecting({
        status: 'modified',
        formattingOnly: false,
        wordDiff: [{ type: 'delete', text: 'мир' }, { type: 'insert', text: 'свет' }],
    });
    assert.ok(!created.some(el => el.className === 'diff-textblock-format-badge'));
});
