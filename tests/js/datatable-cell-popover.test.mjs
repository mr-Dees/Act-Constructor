import './_browser-stub.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTruncated } from '../../static/js/shared/datatable/cell-popover.js';

test('isTruncated: scrollWidth > clientWidth', () => {
  assert.equal(isTruncated({ scrollWidth: 300, clientWidth: 120 }), true);
  assert.equal(isTruncated({ scrollWidth: 100, clientWidth: 120 }), false);
  assert.equal(isTruncated(null), false);
});
