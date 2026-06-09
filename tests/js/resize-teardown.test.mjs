/**
 * Тесты идемпотентной разборки слушателей ресайза колонок (B6).
 *
 * Гарантия: teardown выполняет переданную функцию РОВНО один раз, сколько бы
 * раз его ни вызвали. Это защищает от двойной финализации весов, когда ресайз
 * прерывается потерей фокуса (blur), а затем приходит запоздалый mouseup.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeIdempotentTeardown } from '../../static/js/constructor/table/resize-teardown.js';

test('makeIdempotentTeardown вызывает функцию один раз при единичном вызове', () => {
  let calls = 0;
  const teardown = makeIdempotentTeardown(() => { calls += 1; });
  teardown();
  assert.equal(calls, 1);
});

test('makeIdempotentTeardown не вызывает функцию повторно (blur + mouseup)', () => {
  let calls = 0;
  const teardown = makeIdempotentTeardown(() => { calls += 1; });
  teardown(); // имитируем blur-прерывание
  teardown(); // имитируем запоздалый mouseup
  teardown(); // и любой последующий повтор
  assert.equal(calls, 1);
});

test('makeIdempotentTeardown изолирует независимые экземпляры', () => {
  let a = 0;
  let b = 0;
  const teardownA = makeIdempotentTeardown(() => { a += 1; });
  const teardownB = makeIdempotentTeardown(() => { b += 1; });
  teardownA();
  teardownA();
  teardownB();
  assert.equal(a, 1);
  assert.equal(b, 1);
});
