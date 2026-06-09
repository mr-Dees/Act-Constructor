import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';

test('node:test работает', () => {
  assert.equal(1 + 1, 2);
});

test('fast-check property работает', () => {
  fc.assert(fc.property(fc.integer(), (n) => n + 0 === n));
});
