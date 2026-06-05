/**
 * Тесты контракта клиентской защиты целостности grid (T6b.6).
 *
 * TableCellsOperations после каждой структурной операции прогоняет table.grid
 * через validateGrid и откатывает повреждённую сетку. Сами операции (P4,
 * table-merge-core.js) корректны by-construction, поэтому в штатном потоке
 * страховка не срабатывает. Здесь фиксируем именно этот контракт:
 *   1) выход merge/unmerge/auto-unmerge ВСЕГДА проходит validateGrid;
 *   2) намеренно повреждённая сетка validateGrid НЕ проходит — то есть гард
 *      реально поймал бы будущую регрессию до ухода на сервер (422).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCell } from './_setup.mjs';
import { validateGrid } from '../../static/js/constructor/table/grid-merges.js';
import {
  mergeRange,
  unmergeAt,
  autoUnmergeRow,
} from '../../static/js/constructor/table/table-merge-core.js';

/**
 * Простая 3×3 сетка одиночных ячеек.
 */
function grid3x3() {
  return [0, 1, 2].map((r) =>
    [0, 1, 2].map((c) => makeCell({ content: `${r}${c}`, originRow: r, originCol: c })),
  );
}

test('защита: выход mergeRange проходит validateGrid', () => {
  const merged = mergeRange(grid3x3(), 0, 0, 1, 1); // 2×2 объединение
  const res = validateGrid(merged);
  assert.equal(res.valid, true, JSON.stringify(res.errors));
});

test('защита: merge → unmerge возвращает валидную сетку', () => {
  const merged = mergeRange(grid3x3(), 0, 0, 0, 2); // 1×3 шапка
  const unmerged = unmergeAt(merged, 0, 0);
  assert.equal(validateGrid(unmerged).valid, true);
});

test('защита: autoUnmergeRow даёт валидную сетку перед удалением строки', () => {
  const merged = mergeRange(grid3x3(), 0, 0, 2, 0); // вертикальное 3×1
  const cleared = autoUnmergeRow(merged, 1);
  assert.equal(validateGrid(cleared).valid, true);
});

test('защита: повреждённая сетка (рваная строка) ловится гардом', () => {
  // Имитация будущей регрессии структурной операции: одна строка короче.
  const broken = grid3x3();
  broken[1].pop();
  const res = validateGrid(broken);
  assert.equal(res.valid, false);
  assert.ok(res.errors.length > 0);
});

test('защита: повреждённая сетка (объединение за границей) ловится гардом', () => {
  const broken = grid3x3();
  broken[0][0].colSpan = 9; // выходит за 3 колонки
  const res = validateGrid(broken);
  assert.equal(res.valid, false);
});
