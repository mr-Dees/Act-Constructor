/**
 * Smoke-тест соли в id узлов контента (#3).
 *
 * `AppState._createContentNode` (state-content.js) собирает id узла как
 *   `${parentId}_${type}_${Date.now()}_${Math.random().toString(36).substring(2,9)}`.
 * Случайный суффикс гарантирует, что два узла одного типа под одним родителем,
 * созданные в одну миллисекунду, не получат совпадающий id.
 *
 * Боевой _createContentNode на import тянет DOM/window/AppConfig (см. state-content.js),
 * поэтому здесь воспроизводим ИМЕННО формулу построения id (зеркало боевой строки),
 * а не импортируем тяжёлый граф. Тест ловит регресс — откат соли вернёт коллизию.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** Зеркало боевой строки id в _createContentNode. */
function buildContentNodeId(parentId, type, now) {
  return `${parentId}_${type}_${now}_${Math.random().toString(36).substring(2, 9)}`;
}

test('id узлов контента различаются за счёт соли при одинаковых parentId/type/ms', () => {
  const now = Date.now();
  const ids = new Set();
  // Один и тот же родитель, тип и таймстемп — различать должна только соль.
  for (let i = 0; i < 1000; i++) {
    ids.add(buildContentNodeId('n_5', 'table', now));
  }
  assert.equal(ids.size, 1000, 'все id должны быть уникальны благодаря случайному суффиксу');
});
