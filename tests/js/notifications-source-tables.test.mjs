/**
 * Тесты чистой фабрики кеша замечаний по таблицам (makeWarningsCache).
 *
 * Кеш считает замечания (ValidationTable.collectContentWarnings) один раз за
 * обновление предпросмотра и переиспользует результат и для рамок таблиц
 * (_applyTableOutlines), и для колокольчика (collectTableItems), и между
 * poll-тиками — до явной инвалидации при правке контента.
 *
 * Покрывают находки #16.1 (один расчёт за тик) и #16.2 (между «poll-подобными»
 * get без инвалидации повторного обхода дерева нет).
 *
 * Фабрика импортируется из node-safe модуля `notifications-warnings-cache.js`
 * (в `notifications-source-tables.js` она инстанцируется поверх ValidationTable,
 * тянущей DOM — под node:test тот модуль не загружается). См. репо-конвенцию
 * «чистая логика → отдельный модуль без DOM» (resize-teardown.js, *-core.js).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWarningsCache } from '../../static/js/constructor/header/notifications-warnings-cache.js';

test('два get() подряд → collectFn вызван ровно один раз (один расчёт за тик)', () => {
  let calls = 0;
  const cache = makeWarningsCache(() => { calls += 1; return [{ tableId: 1 }]; });

  const first = cache.get();
  const second = cache.get();

  assert.equal(calls, 1);
  // тот же закешированный результат
  assert.deepEqual(first, [{ tableId: 1 }]);
  assert.strictEqual(first, second);
});

test('после invalidate() следующий get() пересчитывает (2-й вызов collectFn)', () => {
  let calls = 0;
  const cache = makeWarningsCache(() => { calls += 1; return [{ tableId: calls }]; });

  cache.get();
  cache.get();
  assert.equal(calls, 1);

  cache.invalidate();

  const afterInvalidate = cache.get();
  assert.equal(calls, 2);
  assert.deepEqual(afterInvalidate, [{ tableId: 2 }]);
});

test('серия get() без инвалидации (poll-подобные тики) дерево не обходит', () => {
  let calls = 0;
  const cache = makeWarningsCache(() => { calls += 1; return []; });

  for (let i = 0; i < 5; i += 1) cache.get();

  assert.equal(calls, 1);
});

test('пустой результат [] кешируется как валидное значение, без повторного расчёта', () => {
  let calls = 0;
  const cache = makeWarningsCache(() => { calls += 1; return []; });

  const first = cache.get();
  const second = cache.get();

  assert.equal(calls, 1);
  assert.deepEqual(first, []);
  assert.strictEqual(first, second);
});

test('исключение в collectFn → get() отдаёт [] и не пробрасывает ошибку', () => {
  let calls = 0;
  const cache = makeWarningsCache(() => { calls += 1; throw new Error('boom'); });

  const result = cache.get();
  assert.deepEqual(result, []);
  assert.equal(calls, 1);
});

test('invalidate() сбрасывает кеш, накопивший []-фолбэк после ошибки', () => {
  let calls = 0;
  const cache = makeWarningsCache(() => {
    calls += 1;
    if (calls === 1) throw new Error('boom');
    return [{ tableId: 9 }];
  });

  assert.deepEqual(cache.get(), []);
  cache.invalidate();
  assert.deepEqual(cache.get(), [{ tableId: 9 }]);
  assert.equal(calls, 2);
});
