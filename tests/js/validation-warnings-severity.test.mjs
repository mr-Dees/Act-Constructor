/**
 * Тесты чистой функции collectTableWarnings (validation-table-core.js).
 *
 * Функция агрегирует контентные/структурные замечания по всем таблицам без
 * DOM/AppState. Ключевое — критичность по типу:
 *   - 'error' (красный) — структурный дефект уровня сервера (hasStructuralDefect:
 *     не прямоугольная сетка / span за границей / рассинхрон colWidths);
 *     контентные проверки для такой таблицы пропускаются;
 *   - 'warning' (оранжевый) — неполнота: нет шапки (E6), пустые заголовки,
 *     нет данных (E5).
 * Важный инвариант: инертный устаревший spanOrigin (после legacy-операций с
 * колонками) НЕ считается структурным дефектом и не красит таблицу красным.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCell } from './_setup.mjs';
import { collectTableWarnings, hasStructuralDefect } from '../../static/js/constructor/validation/validation-table-core.js';

/**
 * Строит строку из ячеек с заданными content/isHeader.
 * @param {Array<{content?:string, isHeader?:boolean}>} cells
 */
function row(cells) {
  return cells.map((opts) => makeCell(opts));
}

/** Резолвер имени таблицы по id (для проверки проброса). */
function nameById(id) {
  return 'Имя ' + id;
}

// ──────────────────────────────────────────────────────────────────────────
// Пустой/тривиальный вход
// ──────────────────────────────────────────────────────────────────────────

test('collectTableWarnings: пустой словарь таблиц → []', () => {
  assert.deepEqual(collectTableWarnings({}, nameById), []);
});

test('collectTableWarnings: null/undefined → []', () => {
  assert.deepEqual(collectTableWarnings(null, nameById), []);
  assert.deepEqual(collectTableWarnings(undefined, nameById), []);
});

test('collectTableWarnings: таблица без grid пропускается → []', () => {
  const tables = { t1: {}, t2: { grid: [] } };
  assert.deepEqual(collectTableWarnings(tables, nameById), []);
});

// ──────────────────────────────────────────────────────────────────────────
// Корректная таблица — нет замечаний
// ──────────────────────────────────────────────────────────────────────────

test('collectTableWarnings: валидная шапка + данные → нет замечаний для таблицы', () => {
  const tables = {
    t1: {
      grid: [
        row([{ content: 'A', isHeader: true }, { content: 'B', isHeader: true }]),
        row([{ content: '1' }, { content: '2' }]),
      ],
    },
  };
  assert.deepEqual(collectTableWarnings(tables, nameById), []);
});

// ──────────────────────────────────────────────────────────────────────────
// Неполнота (severity: 'warning')
// ──────────────────────────────────────────────────────────────────────────

test('collectTableWarnings: нет строки заголовка → одно warning «нет строки заголовка»', () => {
  const tables = {
    t1: {
      grid: [
        row([{ content: '1' }, { content: '2' }]),
        row([{ content: '3' }, { content: '4' }]),
      ],
    },
  };
  const warnings = collectTableWarnings(tables, nameById);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].severity, 'warning');
  assert.equal(warnings[0].issue, 'нет строки заголовка');
});

test('collectTableWarnings: шапка есть, данных нет → warning «нет данных»', () => {
  const tables = {
    t1: {
      grid: [
        row([{ content: 'A', isHeader: true }, { content: 'B', isHeader: true }]),
      ],
    },
  };
  const warnings = collectTableWarnings(tables, nameById);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].severity, 'warning');
  assert.equal(warnings[0].issue, 'нет данных');
});

test('collectTableWarnings: пустая ячейка шапки → warning «не заполнены заголовки»', () => {
  const tables = {
    t1: {
      grid: [
        row([{ content: 'A', isHeader: true }, { content: '', isHeader: true }]),
        row([{ content: '1' }, { content: '2' }]),
      ],
    },
  };
  const warnings = collectTableWarnings(tables, nameById);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].severity, 'warning');
  assert.equal(warnings[0].issue, 'не заполнены заголовки');
});

// ──────────────────────────────────────────────────────────────────────────
// Структурная поломка (severity: 'error') — контентные проверки пропускаются
// ──────────────────────────────────────────────────────────────────────────

test('collectTableWarnings: рваная сетка → error «нарушена структура» и без контентных warning', () => {
  const grid = [
    [makeCell({ content: 'A', isHeader: true })],
    [makeCell({ content: '1' }), makeCell({ content: '2' })],
  ];
  // Убеждаемся, что такая сетка действительно структурно дефектна.
  assert.equal(hasStructuralDefect(grid), true);

  const warnings = collectTableWarnings({ t1: { grid } }, nameById);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].severity, 'error');
  assert.equal(warnings[0].issue, 'нарушена структура таблицы');
});

test('collectTableWarnings: рассинхрон colWidths → error (сервер отклонит)', () => {
  const grid = [
    row([{ content: 'A', isHeader: true }, { content: 'B', isHeader: true }]),
    row([{ content: '1' }, { content: '2' }]),
  ];
  // 2 колонки, но 3 веса — сервер отвергнет такую таблицу.
  const warnings = collectTableWarnings({ t1: { grid, colWidths: [1, 1, 1] } }, nameById);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].severity, 'error');
});

test('collectTableWarnings: инертный устаревший spanOrigin НЕ красит красным (инвариант)', () => {
  // Сетка прямоугольна, span в границах, но у поглощённой ячейки spanOrigin
  // указывает «не туда» (как после legacy-операции с колонками). validateGrid
  // забраковал бы это, а сервер и рендер — нет. Значит: НЕ error.
  const grid = [
    [
      makeCell({ content: 'Шапка', isHeader: true, colSpan: 2 }),
      makeCell({ content: '', isHeader: true, isSpanned: true, spanOrigin: { row: 9, col: 9 } }),
    ],
    row([{ content: '1' }, { content: '2' }]),
  ];
  assert.equal(hasStructuralDefect(grid), false);

  const warnings = collectTableWarnings({ t1: { grid } }, nameById);
  // Никаких 'error'; таблица корректна по содержимому → замечаний нет.
  assert.equal(warnings.some((w) => w.severity === 'error'), false);
});

// ──────────────────────────────────────────────────────────────────────────
// Проброс tableId / tableName
// ──────────────────────────────────────────────────────────────────────────

test('collectTableWarnings: tableId и tableName пробрасываются', () => {
  const tables = {
    tbl42: {
      grid: [
        row([{ content: '1' }, { content: '2' }]),
      ],
    },
  };
  const warnings = collectTableWarnings(tables, nameById);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].tableId, 'tbl42');
  assert.equal(warnings[0].tableName, 'Имя tbl42');
});

// ──────────────────────────────────────────────────────────────────────────
// Несколько таблиц — плоский список с корректными записями по каждой
// ──────────────────────────────────────────────────────────────────────────

test('collectTableWarnings: несколько таблиц → плоский список с верными записями', () => {
  const tables = {
    ok: {
      grid: [
        row([{ content: 'A', isHeader: true }]),
        row([{ content: '1' }]),
      ],
    },
    noHeader: {
      grid: [
        row([{ content: '1' }]),
      ],
    },
    noData: {
      grid: [
        row([{ content: 'A', isHeader: true }]),
      ],
    },
    broken: {
      grid: [
        [makeCell({ content: 'A', isHeader: true })],
        [makeCell({ content: '1' }), makeCell({ content: '2' })],
      ],
    },
  };

  const warnings = collectTableWarnings(tables, nameById);
  // ok — без замечаний; остальные три — по одному.
  assert.equal(warnings.length, 3);

  const byId = new Map(warnings.map((w) => [w.tableId, w]));
  assert.equal(byId.get('noHeader').severity, 'warning');
  assert.equal(byId.get('noHeader').issue, 'нет строки заголовка');
  assert.equal(byId.get('noData').severity, 'warning');
  assert.equal(byId.get('noData').issue, 'нет данных');
  assert.equal(byId.get('broken').severity, 'error');
  assert.equal(byId.get('broken').issue, 'нарушена структура таблицы');
  assert.equal(byId.has('ok'), false);
});
