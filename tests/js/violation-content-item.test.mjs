/**
 * Тесты фабрики элементов дополнительного контента нарушения
 * (violation-content-item.js).
 *
 * Закрывают находки аудита:
 * - violation-2: строки-типы item.type ('case'/'image'/'freeText') сведены
 *   к одному источнику — константам модуля; значения зафиксированы тестом,
 *   потому что они сериализуются в содержимое акта и зеркалят
 *   Literal["case", "image", "freeText"] в ViolationContentItemSchema.
 * - violation-3: фабрика создаёт только релевантные типу поля — у кейса/текста
 *   нет url/caption/filename/width, у картинки нет content.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    CONTENT_TYPE_CASE,
    CONTENT_TYPE_FREE_TEXT,
    CONTENT_TYPE_IMAGE,
    createContentItem,
} from '../../static/js/constructor/violation/violation-content-item.js';

test('значения констант типов совпадают с сериализуемыми строками бэка', () => {
    // Менять синхронно с ViolationContentItemSchema.type
    // (app/domains/acts/schemas/act_content.py) — значения лежат в данных актов.
    assert.equal(CONTENT_TYPE_CASE, 'case');
    assert.equal(CONTENT_TYPE_IMAGE, 'image');
    assert.equal(CONTENT_TYPE_FREE_TEXT, 'freeText');
});

test('кейс: только id/type/content/order, без полей картинки', () => {
    const item = createContentItem(CONTENT_TYPE_CASE, 3, { content: 'текст кейса' });

    assert.deepEqual(Object.keys(item).sort(), ['content', 'id', 'order', 'type']);
    assert.equal(item.type, 'case');
    assert.equal(item.content, 'текст кейса');
    assert.equal(item.order, 3);
    assert.match(item.id, /^case_/);
});

test('свободный текст: только id/type/content/order', () => {
    const item = createContentItem(CONTENT_TYPE_FREE_TEXT, 0);

    assert.deepEqual(Object.keys(item).sort(), ['content', 'id', 'order', 'type']);
    assert.equal(item.type, 'freeText');
    assert.equal(item.content, '');
    assert.match(item.id, /^freeText_/);
});

test('картинка: id/type/url/caption/filename/width/order, без content', () => {
    const item = createContentItem(CONTENT_TYPE_IMAGE, 1, {
        url: 'data:image/png;base64,AAAA',
        filename: 'screen.png',
    });

    assert.deepEqual(
        Object.keys(item).sort(),
        ['caption', 'filename', 'id', 'order', 'type', 'url', 'width'],
    );
    assert.equal(item.type, 'image');
    assert.equal(item.url, 'data:image/png;base64,AAAA');
    assert.equal(item.filename, 'screen.png');
    assert.equal(item.caption, '');
    assert.equal(item.width, 0);
});

test('картинка: width прокидывается из extraData', () => {
    const item = createContentItem(CONTENT_TYPE_IMAGE, 0, { width: 50 });
    assert.equal(item.width, 50);
});

test('id уникальны между вызовами', () => {
    const a = createContentItem(CONTENT_TYPE_CASE, 0);
    const b = createContentItem(CONTENT_TYPE_CASE, 0);
    assert.notEqual(a.id, b.id);
});
