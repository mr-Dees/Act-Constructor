/**
 * Тесты детерминированного чтения пачки файлов (violation-file-reading.js).
 *
 * Закрывает находку аудита violation-4: множественная вставка картинок через
 * FileReader.onload не гарантировала порядок (колбэки завершаются вразнобой).
 * readFilesInOrder обязан вернуть результаты строго в порядке выбора файлов,
 * независимо от порядка завершения чтения.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFilesInOrder } from '../../static/js/constructor/violation/violation-file-reading.js';

/** Возвращает «чтение», завершающееся с заданной задержкой на файл. */
function makeDelayedReader(delaysByName, failNames = new Set()) {
    return (file) => new Promise((resolve, reject) => {
        setTimeout(() => {
            if (failNames.has(file.name)) {
                reject(new Error(`boom: ${file.name}`));
            } else {
                resolve(`url-${file.name}`);
            }
        }, delaysByName[file.name] ?? 0);
    });
}

test('результаты в порядке выбора файлов, даже если чтение завершается вразнобой', async () => {
    const files = [{ name: 'a.png' }, { name: 'b.png' }, { name: 'c.png' }];
    // a читается дольше всех, c — посередине: колбэки придут в порядке b, c, a.
    const readFile = makeDelayedReader({ 'a.png': 30, 'b.png': 0, 'c.png': 10 });

    const results = await readFilesInOrder(files, readFile);

    assert.deepEqual(results.map(r => r.file.name), ['a.png', 'b.png', 'c.png']);
    assert.deepEqual(results.map(r => r.url), ['url-a.png', 'url-b.png', 'url-c.png']);
    assert.ok(results.every(r => r.ok));
});

test('ошибка чтения одного файла не ломает порядок и помечается ok=false', async () => {
    const files = [{ name: 'a.png' }, { name: 'broken.png' }, { name: 'c.png' }];
    const readFile = makeDelayedReader(
        { 'a.png': 20, 'broken.png': 0, 'c.png': 5 },
        new Set(['broken.png']),
    );

    const results = await readFilesInOrder(files, readFile);

    assert.deepEqual(results.map(r => r.file.name), ['a.png', 'broken.png', 'c.png']);
    assert.deepEqual(results.map(r => r.ok), [true, false, true]);
    assert.match(String(results[1].error), /broken\.png/);
    assert.equal(results[1].url, undefined);
});

test('пустой список файлов → пустой результат', async () => {
    const results = await readFilesInOrder([], () => {
        throw new Error('не должен вызываться');
    });
    assert.deepEqual(results, []);
});
