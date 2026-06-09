/**
 * Property-тесты round-trip над ЖИВЫМИ mergeRange/unmergeAt (table-merge-core.js).
 *
 * Golden-тесты (table-merge-golden.test.mjs) фиксируют конкретные входы; эти
 * property-тесты ловят будущие регрессии в самом ядре на случайных сетках и
 * прямоугольниках. Два инварианта:
 *   - round-trip: unmergeAt(mergeRange(...)) разъединяет весь прямоугольник
 *     (colSpan/rowSpan===1, isSpanned===false) и сохраняет content ведущей ячейки;
 *   - форма: после mergeRange поглощённые ячейки несут РОВНО
 *     {isSpanned:true, spanOrigin:{row,col}} (2 поля — именно сохраняемый формат),
 *     а ведущая — colSpan/rowSpan по размеру прямоугольника.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  mergeRange,
  unmergeAt,
} from '../../static/js/constructor/table/table-merge-core.js';

/**
 * Случайная прямоугольная сетка rows×cols (rows,cols∈[1..6]) с буквенным
 * content и случайным признаком isHeader, и случайный прямоугольник внутри
 * (r1≤r2, c1≤c2). Прямоугольник кодируется парами (start, extra) и масштабируется
 * по фактическим размерам сетки.
 */
const arbGridAndRect = fc
  .record({
    rows: fc.integer({ min: 1, max: 6 }),
    cols: fc.integer({ min: 1, max: 6 }),
    rStartFrac: fc.nat({ max: 1000 }),
    rExtraFrac: fc.nat({ max: 1000 }),
    cStartFrac: fc.nat({ max: 1000 }),
    cExtraFrac: fc.nat({ max: 1000 }),
    isHeader: fc.boolean(),
  })
  .map(({ rows, cols, rStartFrac, rExtraFrac, cStartFrac, cExtraFrac, isHeader }) => {
    const r1 = rStartFrac % rows;
    const r2 = r1 + (rExtraFrac % (rows - r1));
    const c1 = cStartFrac % cols;
    const c2 = c1 + (cExtraFrac % (cols - c1));

    let code = 65;
    const grid = [];
    for (let r = 0; r < rows; r++) {
      const row = [];
      for (let c = 0; c < cols; c++) {
        row.push({
          content: String.fromCharCode(65 + ((code++) % 26)),
          isHeader,
          colSpan: 1,
          rowSpan: 1,
          originRow: r,
          originCol: c,
        });
      }
      grid.push(row);
    }
    return { grid, r1, c1, r2, c2 };
  });

test('property: форма после mergeRange — origin span + поглощённые ровно {isSpanned,spanOrigin}', () => {
  fc.assert(
    fc.property(arbGridAndRect, ({ grid, r1, c1, r2, c2 }) => {
      const originContent = grid[r1][c1].content;
      const merged = mergeRange(grid, r1, c1, r2, c2);

      // Ведущая ячейка несёт правильные span'ы и сохраняет своё содержимое в начале.
      assert.equal(merged[r1][c1].colSpan, c2 - c1 + 1);
      assert.equal(merged[r1][c1].rowSpan, r2 - r1 + 1);
      assert.ok(
        merged[r1][c1].content.startsWith(originContent),
        `origin content «${merged[r1][c1].content}» не начинается с «${originContent}»`,
      );

      // Поглощённые ячейки прямоугольника — РОВНО 2 поля.
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          if (r === r1 && c === c1) continue;
          const cell = merged[r][c];
          assert.deepEqual(
            cell,
            { isSpanned: true, spanOrigin: { row: r1, col: c1 } },
            `поглощённая (${r},${c}) не в сохраняемом формате: ${JSON.stringify(cell)}`,
          );
        }
      }
    }),
    { numRuns: 300 },
  );
});

test('property: round-trip merge→unmerge разъединяет весь прямоугольник и хранит content origin', () => {
  fc.assert(
    fc.property(arbGridAndRect, ({ grid, r1, c1, r2, c2 }) => {
      const merged = mergeRange(grid, r1, c1, r2, c2);
      const mergedOriginContent = merged[r1][c1].content;
      const restored = unmergeAt(merged, r1, c1);

      // Все ячейки прямоугольника снова синглтоны без span-меток.
      for (let r = r1; r <= r2; r++) {
        for (let c = c1; c <= c2; c++) {
          const cell = restored[r][c];
          assert.equal(cell.colSpan, 1, `colSpan≠1 в (${r},${c})`);
          assert.equal(cell.rowSpan, 1, `rowSpan≠1 в (${r},${c})`);
          assert.ok(!cell.isSpanned, `isSpanned остался в (${r},${c})`);
        }
      }

      // Ведущая сохраняет своё (склеенное при merge) содержимое.
      assert.equal(restored[r1][c1].content, mergedOriginContent);
    }),
    { numRuns: 300 },
  );
});
