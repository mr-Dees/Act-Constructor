import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DataSource } from '../../static/js/shared/datatable/data-source.js';

test('всё получено (items>=total) → client-mode', async () => {
  const ds = new DataSource({
    workingSetCap: 1000, pageSize: 50,
    fetchPage: async () => ({ items: [{ id: 1 }, { id: 2 }], total: 2 }),
  });
  await ds.init();
  assert.equal(ds.mode, 'client');
  assert.equal(ds.total, 2);
  assert.deepEqual(ds.getAllRows().map(r => r.id), [1, 2]);
});

test('получено меньше total → server-mode', async () => {
  let lastArgs = null;
  const ds = new DataSource({
    workingSetCap: 1000, pageSize: 50,
    fetchPage: async (a) => {
      lastArgs = a;
      return a.offset === 0 && a.limit === 1000
        ? { items: new Array(1000).fill(0).map((_, i) => ({ id: i })), total: 5000 }
        : { items: [{ id: 999 }], total: 5000 };
    },
  });
  await ds.init();
  assert.equal(ds.mode, 'server');
  const page = await ds.fetchServerPage({ filters: { name: 'x' }, sortBy: 'id', sortDir: 'asc', page: 3 });
  assert.equal(page.total, 5000);
  assert.equal(lastArgs.offset, 100); // (3-1)*50
  assert.equal(lastArgs.limit, 50);
  assert.deepEqual(lastArgs.filters, { name: 'x' });
});
