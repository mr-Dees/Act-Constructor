/**
 * Тесты пунктуация-осведомлённого дифа корректора.
 *
 * Ключевое отличие от портального `_wordDiff`: знаки препинания — отдельные токены,
 * поэтому добавленная запятая показывается как вставка знака, а не правка слова.
 */
import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    tokenize, diffTokens, renderInline, renderBefore, renderAfter,
} from '../../static/js/constructor/text-actions/corrector-diff.js';

test('tokenize: слова / пунктуация / пробелы — раздельные токены', () => {
    assert.deepEqual(
        tokenize('привет, как дела?'),
        ['привет', ',', ' ', 'как', ' ', 'дела', '?'],
    );
});

test('добавленная запятая — вставка знака, а не правка целого слова', () => {
    const ops = diffTokens('привет как дела?', 'привет, как дела?');
    assert.equal(renderInline(ops), 'привет<ins>,</ins> как дела?');
});

test('опечатка внутри слова — слово целиком (пословно, как и раньше)', () => {
    const ops = diffTokens('гарушении', 'нарушении');
    assert.equal(renderInline(ops), '<del>гарушении</del><ins>нарушении</ins>');
});

test('renderBefore: только удаления, без вставок', () => {
    const ops = diffTokens('привет как дела?', 'привет, как дела?');
    assert.equal(renderBefore(ops), 'привет как дела?');
});

test('renderAfter: только вставки, без удалений', () => {
    const ops = diffTokens('привет как дела?', 'привет, как дела?');
    assert.equal(renderAfter(ops), 'привет<ins>,</ins> как дела?');
});

test('пробелы и переносы сохраняются точь-в-точь', () => {
    const ops = diffTokens('строка\nдва', 'строка\nдва');
    assert.equal(renderInline(ops), 'строка\nдва');
});

test('html-спецсимволы экранируются', () => {
    const ops = diffTokens('a < b', 'a < b');
    assert.equal(renderInline(ops), 'a &lt; b');
});
