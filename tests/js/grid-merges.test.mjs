/**
 * Тесты чистого ядра range-list объединений ячеек (grid-merges.js).
 *
 * Range-list (`{row,col,rowspan,colspan}`) — ВНУТРЕННЕЕ представление для
 * корректного merge/unmerge и единого обхода span'ов. Хранимый формат grid
 * НЕ меняется: ведущая ячейка несёт colSpan/rowSpan, поглощённая —
 * isSpanned:true + spanOrigin:{row,col} + originRow/originCol. Эти тесты
 * фиксируют, что round-trip dense grid → range-list → dense grid не меняет
 * хранимую форму (round-trip / идемпотентность) и что валидатор ловит
 * нарушения целостности.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import { makeCell } from './_setup.mjs';
import {
  gridToMerges,
  applyMergesToGrid,
  validateGrid,
  normalizeGrid,
  iterateVisibleCells,
} from '../../static/js/constructor/table/grid-merges.js';

/**
 * Строит metrics-подобную сетку 2-строчной шапки: «Код метрики» (rowSpan=2),
 * «Количество, ед.» (colSpan=2), «ФЛ»/«ЮЛ» под ней. Повторяет ровно тот dense
 * формат, который генерит state-content.js для таблицы метрик.
 */
function buildMetricsGrid() {
  return [
    [
      { content: 'Код метрики', isHeader: true, colSpan: 1, rowSpan: 2, originRow: 0, originCol: 0 },
      { content: 'Кол-во, ед.', isHeader: true, colSpan: 2, rowSpan: 1, originRow: 0, originCol: 1 },
      {
        content: '', isHeader: true, colSpan: 1, rowSpan: 1,
        isSpanned: true, spanOrigin: { row: 0, col: 1 }, originRow: 0, originCol: 2,
      },
      { content: 'Сумма, руб.', isHeader: true, colSpan: 1, rowSpan: 2, originRow: 0, originCol: 3 },
    ],
    [
      {
        content: '', isHeader: true, colSpan: 1, rowSpan: 1,
        isSpanned: true, spanOrigin: { row: 0, col: 0 }, originRow: 1, originCol: 0,
      },
      { content: 'ФЛ', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 1 },
      { content: 'ЮЛ', isHeader: true, colSpan: 1, rowSpan: 1, originRow: 1, originCol: 2 },
      {
        content: '', isHeader: true, colSpan: 1, rowSpan: 1,
        isSpanned: true, spanOrigin: { row: 0, col: 3 }, originRow: 1, originCol: 3,
      },
    ],
  ];
}

/**
 * Глубокая копия dense-сетки (структуры ячеек — простые объекты/массивы).
 */
function cloneGrid(grid) {
  return JSON.parse(JSON.stringify(grid));
}

/**
 * Возвращает grid с «голыми» ячейками: убирает все производные span-поля,
 * оставляя только content/isHeader/originRow/originCol. Используется, чтобы
 * проверить, что applyMergesToGrid восстанавливает ровно исходную форму.
 */
function stripSpans(grid) {
  return grid.map((row, r) =>
    row.map((cell, c) => ({
      content: cell.content || '',
      isHeader: cell.isHeader || false,
      colSpan: 1,
      rowSpan: 1,
      isSpanned: false,
      spanOrigin: null,
      originRow: r,
      originCol: c,
    })),
  );
}

// ──────────────────────────────────────────────────────────────────────────
// gridToMerges — извлечение range-list из dense-сетки
// ──────────────────────────────────────────────────────────────────────────

test('gridToMerges извлекает прямоугольники объединений из metrics-шапки', () => {
  const merges = gridToMerges(buildMetricsGrid());
  // Порядок: построчно слева направо по ведущим ячейкам.
  assert.deepEqual(merges, [
    { row: 0, col: 0, rowspan: 2, colspan: 1 }, // «Код метрики»
    { row: 0, col: 1, rowspan: 1, colspan: 2 }, // «Кол-во, ед.»
    { row: 0, col: 3, rowspan: 2, colspan: 1 }, // «Сумма, руб.»
  ]);
});

test('gridToMerges на сетке без объединений возвращает пустой список', () => {
  const grid = [
    [makeCell({ originRow: 0, originCol: 0 }), makeCell({ originRow: 0, originCol: 1 })],
    [makeCell({ originRow: 1, originCol: 0 }), makeCell({ originRow: 1, originCol: 1 })],
  ];
  assert.deepEqual(gridToMerges(grid), []);
});

test('gridToMerges распознаёт 1×3 объединение шапки', () => {
  const grid = stripSpans([
    [makeCell(), makeCell(), makeCell()],
  ]);
  grid[0][0].colSpan = 3;
  grid[0][1] = { isSpanned: true, spanOrigin: { row: 0, col: 0 } };
  grid[0][2] = { isSpanned: true, spanOrigin: { row: 0, col: 0 } };
  assert.deepEqual(gridToMerges(grid), [{ row: 0, col: 0, rowspan: 1, colspan: 3 }]);
});

// ──────────────────────────────────────────────────────────────────────────
// applyMergesToGrid — round-trip к ИСХОДНОМУ dense-формату
// ──────────────────────────────────────────────────────────────────────────

test('applyMergesToGrid(strip(grid), gridToMerges(grid)) воссоздаёт исходную metrics-сетку', () => {
  const original = buildMetricsGrid();
  const merges = gridToMerges(original);
  const rebuilt = applyMergesToGrid(stripSpans(original), merges);
  assert.deepEqual(rebuilt, original);
});

test('applyMergesToGrid сбрасывает не покрытые ячейки в синглтоны', () => {
  const grid = stripSpans([[makeCell(), makeCell()]]);
  // Намеренно «грязные» производные поля — должны быть сброшены.
  grid[0][1].colSpan = 5;
  grid[0][1].isSpanned = true;
  grid[0][1].spanOrigin = { row: 9, col: 9 };
  const result = applyMergesToGrid(grid, []);
  assert.equal(result[0][1].colSpan, 1);
  assert.equal(result[0][1].rowSpan, 1);
  // Хранимый формат синглтона — БЕЗ span-меток (эквивалент дефолтам pydantic).
  assert.ok(!result[0][1].isSpanned);
  assert.ok(result[0][1].spanOrigin == null);
});

// ──────────────────────────────────────────────────────────────────────────
// validateGrid — целостность
// ──────────────────────────────────────────────────────────────────────────

test('validateGrid: корректная metrics-сетка валидна', () => {
  const res = validateGrid(buildMetricsGrid());
  assert.equal(res.valid, true, JSON.stringify(res.errors));
  assert.deepEqual(res.errors, []);
});

test('validateGrid: рваные строки (разная длина) невалидны', () => {
  const grid = [
    [makeCell(), makeCell()],
    [makeCell()],
  ];
  const res = validateGrid(grid);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => /прямоуголь|длин/i.test(e)));
});

test('validateGrid: объединение за границами сетки невалидно', () => {
  const grid = stripSpans([[makeCell(), makeCell()]]);
  grid[0][0].colSpan = 5; // выходит за пределы (2 колонки)
  const res = validateGrid(grid);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => /границ/i.test(e)));
});

test('validateGrid: пересекающиеся объединения невалидны', () => {
  // Две ведущих ячейки, чьи прямоугольники накладываются.
  const grid = stripSpans([
    [makeCell(), makeCell()],
    [makeCell(), makeCell()],
  ]);
  grid[0][0].rowSpan = 2; // покрывает (0,0),(1,0)
  grid[1][0].rowSpan = 2; // тоже хочет (1,0),(2,0) — но (1,0) уже занят
  const res = validateGrid(grid);
  assert.equal(res.valid, false);
});

test('validateGrid: висячий isSpanned без покрывающего origin невалиден', () => {
  const grid = stripSpans([[makeCell(), makeCell()]]);
  grid[0][1].isSpanned = true;
  grid[0][1].spanOrigin = { row: 0, col: 0 };
  // (0,0) не объединён → spanOrigin указывает в никуда
  const res = validateGrid(grid);
  assert.equal(res.valid, false);
  assert.ok(res.errors.some((e) => /объединени|покрыва|вис/i.test(e)));
});

// ──────────────────────────────────────────────────────────────────────────
// normalizeGrid — починка производных полей + идемпотентность
// ──────────────────────────────────────────────────────────────────────────

test('normalizeGrid: чинит неверный spanOrigin поглощённой ячейки', () => {
  const grid = buildMetricsGrid();
  // Ломаем spanOrigin поглощённой ячейки (0,2) — должна указывать на (0,1).
  grid[0][2].spanOrigin = { row: 5, col: 5 };
  const fixed = normalizeGrid(grid);
  assert.deepEqual(fixed[0][2].spanOrigin, { row: 0, col: 1 });
  assert.equal(validateGrid(fixed).valid, true);
});

test('normalizeGrid идемпотентен на уже нормализованной сетке', () => {
  const grid = buildMetricsGrid();
  const once = normalizeGrid(grid);
  const twice = normalizeGrid(once);
  assert.deepEqual(twice, once);
});

// ──────────────────────────────────────────────────────────────────────────
// iterateVisibleCells — единый обход видимых (не поглощённых) ячеек
// ──────────────────────────────────────────────────────────────────────────

test('iterateVisibleCells обходит только не-isSpanned ячейки с координатами', () => {
  const grid = buildMetricsGrid();
  const visited = [];
  iterateVisibleCells(grid, (cell, r, c) => visited.push([r, c]));
  // metrics: видимые ведущие — (0,0),(0,1),(0,3),(1,1),(1,2). Поглощённые скрыты.
  assert.deepEqual(visited, [
    [0, 0], [0, 1], [0, 3],
    [1, 1], [1, 2],
  ]);
});

// ──────────────────────────────────────────────────────────────────────────
// fast-check property-тесты
// ──────────────────────────────────────────────────────────────────────────

/**
 * Генератор НЕПЕРЕСЕКАЮЩИХСЯ прямоугольников: разбивает сетку rows×cols на
 * блоки фиксированными разрезами по строкам и колонкам, затем каждый блок —
 * это один прямоугольник объединения. Так гарантировано отсутствие наложений.
 */
const arbGridWithMerges = fc
  .record({
    rowCuts: fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 1, maxLength: 4 }),
    colCuts: fc.array(fc.integer({ min: 1, max: 3 }), { minLength: 1, maxLength: 4 }),
  })
  .map(({ rowCuts, colCuts }) => {
    const rows = rowCuts.reduce((a, b) => a + b, 0);
    const cols = colCuts.reduce((a, b) => a + b, 0);
    // Прямоугольники из произведения разрезов.
    const merges = [];
    let r0 = 0;
    for (const rs of rowCuts) {
      let c0 = 0;
      for (const cs of colCuts) {
        if (rs > 1 || cs > 1) {
          merges.push({ row: r0, col: c0, rowspan: rs, colspan: cs });
        }
        c0 += cs;
      }
      r0 += rs;
    }
    return { rows, cols, merges };
  });

test('property: gridToMerges восстанавливает ровно сгенерированные прямоугольники', () => {
  fc.assert(
    fc.property(arbGridWithMerges, ({ rows, cols, merges }) => {
      const base = stripSpans(
        Array.from({ length: rows }, () => Array.from({ length: cols }, () => makeCell())),
      );
      const grid = applyMergesToGrid(base, merges);
      const recovered = gridToMerges(grid);
      // Сортируем обе стороны для устойчивого сравнения.
      const norm = (m) => [...m].sort((a, b) => a.row - b.row || a.col - b.col);
      assert.deepEqual(norm(recovered), norm(merges));
    }),
    { numRuns: 300 },
  );
});

test('property: applyMergesToGrid∘gridToMerges идемпотентен', () => {
  fc.assert(
    fc.property(arbGridWithMerges, ({ rows, cols, merges }) => {
      const base = stripSpans(
        Array.from({ length: rows }, () => Array.from({ length: cols }, () => makeCell())),
      );
      const once = applyMergesToGrid(base, merges);
      const twice = applyMergesToGrid(once, gridToMerges(once));
      assert.deepEqual(twice, once);
    }),
    { numRuns: 300 },
  );
});

test('property: validateGrid проходит на корректно построенных сетках', () => {
  fc.assert(
    fc.property(arbGridWithMerges, ({ rows, cols, merges }) => {
      const base = stripSpans(
        Array.from({ length: rows }, () => Array.from({ length: cols }, () => makeCell())),
      );
      const grid = applyMergesToGrid(base, merges);
      const res = validateGrid(grid);
      assert.equal(res.valid, true, JSON.stringify(res.errors));
    }),
    { numRuns: 300 },
  );
});

test('property: normalizeGrid — no-op на уже нормализованной сетке', () => {
  fc.assert(
    fc.property(arbGridWithMerges, ({ rows, cols, merges }) => {
      const base = stripSpans(
        Array.from({ length: rows }, () => Array.from({ length: cols }, () => makeCell())),
      );
      const grid = applyMergesToGrid(base, merges);
      assert.deepEqual(normalizeGrid(grid), grid);
    }),
    { numRuns: 300 },
  );
});
