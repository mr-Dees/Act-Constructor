/**
 * Тесты чистого предиката восстановления черновика (H3).
 *
 * shouldOfferRestore решает судьбу снимка localStorage при загрузке акта:
 * 'restore' — предложить восстановление (акт не менялся с момента снимка),
 * 'discard' — молча удалить (устарел/повреждён), 'none' — снимка нет.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldOfferRestore } from '../../static/js/constructor/state/draft-restore.js';

/** Валидный снимок с данными и базовой меткой. */
function makeSnapshot(overrides = {}) {
  return {
    actId: 7,
    savedAt: '2026-06-11T12:00:00.000Z',
    baseUpdatedAt: '2026-06-11T10:00:00.123456',
    version: 2,
    data: { tree: { id: 'root', children: [] }, tables: {}, textBlocks: {}, violations: {} },
    ...overrides,
  };
}

test('нет снимка → none', () => {
  assert.equal(shouldOfferRestore(null, '2026-06-11T10:00:00.123456'), 'none');
  assert.equal(shouldOfferRestore(undefined, '2026-06-11T10:00:00.123456'), 'none');
});

test('метки совпадают посимвольно → restore', () => {
  const snap = makeSnapshot();
  assert.equal(shouldOfferRestore(snap, '2026-06-11T10:00:00.123456'), 'restore');
});

test('метки не совпадают (акт менялся) → discard', () => {
  const snap = makeSnapshot();
  assert.equal(shouldOfferRestore(snap, '2026-06-11T11:30:00.000000'), 'discard');
});

test('один момент времени в разной записи → restore (эпоха-фоллбэк)', () => {
  const snap = makeSnapshot({ baseUpdatedAt: '2026-06-11T10:00:00' });
  assert.equal(shouldOfferRestore(snap, '2026-06-11T10:00:00.000'), 'restore');
});

test('снимок без baseUpdatedAt → discard (нельзя проверить, менялся ли акт)', () => {
  const snap = makeSnapshot({ baseUpdatedAt: null });
  assert.equal(shouldOfferRestore(snap, '2026-06-11T10:00:00.123456'), 'discard');
});

test('нет серверного updated_at → discard', () => {
  const snap = makeSnapshot();
  assert.equal(shouldOfferRestore(snap, null), 'discard');
  assert.equal(shouldOfferRestore(snap, undefined), 'discard');
});

test('повреждённый снимок (нет data) → discard', () => {
  assert.equal(
    shouldOfferRestore(makeSnapshot({ data: null }), '2026-06-11T10:00:00.123456'),
    'discard'
  );
  assert.equal(
    shouldOfferRestore(makeSnapshot({ data: 'мусор' }), '2026-06-11T10:00:00.123456'),
    'discard'
  );
});

test('повреждённый снимок (data без дерева) → discard', () => {
  const snap = makeSnapshot({ data: { tables: {} } });
  assert.equal(shouldOfferRestore(snap, '2026-06-11T10:00:00.123456'), 'discard');
});

test('нечитаемые метки времени → discard, а не ложный restore', () => {
  const snap = makeSnapshot({ baseUpdatedAt: 'не-дата' });
  assert.equal(shouldOfferRestore(snap, 'тоже-не-дата'), 'discard');
});

test('#10 (Variant Б): несогласованный, но свежий снимок → restore (не discard)', () => {
  // Сирота-запись словаря (textBlock ссылается на nodeId, которого нет в дереве)
  // + висячая ссылка узла. Раньше молча выбрасывалось (потеря правок); теперь
  // восстанавливается, а sanitizeActContent на пути загрузки чинит неразрушающе.
  const snap = makeSnapshot({
    data: {
      tree: { id: 'root', children: [{ id: 'n1', textBlockId: 'tbX' }] },
      tables: {},
      textBlocks: { tbOrphan: { nodeId: 'nMissing', content: 'сирота' } },
      violations: {},
    },
  });
  assert.equal(shouldOfferRestore(snap, '2026-06-11T10:00:00.123456'), 'restore');
});
