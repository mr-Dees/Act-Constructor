import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGrid, makeTable } from './_setup.mjs';

test('makeGrid строит сетку нужного размера', () => {
  const grid = makeGrid(2, 3);
  assert.ok(grid.length === 2 && grid[0].length === 3);
});

test('makeTable задаёт три ширины колонок по умолчанию', () => {
  assert.equal(makeTable().colWidths.length, 3);
});
