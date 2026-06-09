/**
 * Тесты чистого ядра контентной валидации таблиц (validation-table-core.js).
 *
 * Ядро не зависит от DOM/AppState — работает с dense-сеткой (`grid`) напрямую.
 * Здесь фиксируются два ранее некорректных сценария:
 *   - E5: многострочная шапка (две и более строк заголовка подряд) — все они
 *     считаются шапкой, а не данными; таблица без строк данных под шапкой
 *     должна помечаться как «без данных».
 *   - E6: таблица без единой строки заголовка должна давать явную ошибку, а не
 *     молча проходить валидацию.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCell } from './_setup.mjs';
import {
  countHeaderRows,
  hasEmptyHeaders,
  hasDataRows,
  validateTableContent,
} from '../../static/js/constructor/validation/validation-table-core.js';

/**
 * Строит строку из ячеек с заданными content/isHeader.
 * @param {Array<{content?:string, isHeader?:boolean}>} cells
 */
function row(cells) {
  return cells.map((opts) => makeCell(opts));
}

// ──────────────────────────────────────────────────────────────────────────
// countHeaderRows — подсчёт последовательных строк-заголовков сверху
// ──────────────────────────────────────────────────────────────────────────

test('countHeaderRows: одна строка-заголовок → 1', () => {
  const grid = [
    row([{ content: 'A', isHeader: true }, { content: 'B', isHeader: true }]),
    row([{ content: '1' }, { content: '2' }]),
  ];
  assert.equal(countHeaderRows(grid), 1);
});

test('countHeaderRows: двухстрочная шапка → 2 (вторая строка заголовка не считается данными)', () => {
  const grid = [
    row([{ content: 'A', isHeader: true }, { content: 'B', isHeader: true }]),
    row([{ content: 'a', isHeader: true }, { content: 'b', isHeader: true }]),
    row([{ content: '1' }, { content: '2' }]),
  ];
  assert.equal(countHeaderRows(grid), 2);
});

test('countHeaderRows: нет строк-заголовков → 0', () => {
  const grid = [
    row([{ content: '1' }, { content: '2' }]),
    row([{ content: '3' }, { content: '4' }]),
  ];
  assert.equal(countHeaderRows(grid), 0);
});

test('countHeaderRows: останавливается на первой НЕ-заголовочной строке (header после данных не считается)', () => {
  const grid = [
    row([{ content: 'A', isHeader: true }]),
    row([{ content: '1' }]),
    row([{ content: 'X', isHeader: true }]), // заголовок ниже данных — не часть шапки
  ];
  assert.equal(countHeaderRows(grid), 1);
});

test('countHeaderRows: грид без isHeader-строки → 0 (предикат блокировки экспорта E6)', () => {
  // Регрессия на гейт «заголовок обязателен»: грид целиком из строк данных, ни
  // одной isHeader-ячейки. countHeaderRows===0 — точка, на которой validateHeaders
  // блокирует экспорт и формирует toast со списком таблиц без шапки.
  const grid = [
    row([{ content: 'значение' }, { content: '42' }]),
    row([{ content: 'ещё' }, { content: '7' }]),
  ];
  assert.equal(countHeaderRows(grid), 0);
});

// ──────────────────────────────────────────────────────────────────────────
// hasDataRows — есть ли заполненные строки данных под шапкой (E5)
// ──────────────────────────────────────────────────────────────────────────

test('hasDataRows: двухстрочная шапка без данных → false (E5)', () => {
  // Раньше вторая строка шапки считалась данными → таблица ложно «с данными».
  const grid = [
    row([{ content: 'A', isHeader: true }, { content: 'B', isHeader: true }]),
    row([{ content: 'a', isHeader: true }, { content: 'b', isHeader: true }]),
  ];
  assert.equal(hasDataRows(grid), false);
});

test('hasDataRows: двухстрочная шапка + строка данных → true', () => {
  const grid = [
    row([{ content: 'A', isHeader: true }, { content: 'B', isHeader: true }]),
    row([{ content: 'a', isHeader: true }, { content: 'b', isHeader: true }]),
    row([{ content: '1' }, { content: '2' }]),
  ];
  assert.equal(hasDataRows(grid), true);
});

test('hasDataRows: одна шапка, пустые строки данных → false', () => {
  const grid = [
    row([{ content: 'A', isHeader: true }]),
    row([{ content: '' }]),
    row([{ content: '   ' }]),
  ];
  assert.equal(hasDataRows(grid), false);
});

// ──────────────────────────────────────────────────────────────────────────
// hasEmptyHeaders — пустые ячейки во всех строках шапки
// ──────────────────────────────────────────────────────────────────────────

test('hasEmptyHeaders: пустая ячейка во второй строке шапки ловится', () => {
  const grid = [
    row([{ content: 'A', isHeader: true }, { content: 'B', isHeader: true }]),
    row([{ content: 'a', isHeader: true }, { content: '', isHeader: true }]),
    row([{ content: '1' }, { content: '2' }]),
  ];
  assert.equal(hasEmptyHeaders(grid), true);
});

test('hasEmptyHeaders: все ячейки шапки заполнены → false', () => {
  const grid = [
    row([{ content: 'A', isHeader: true }, { content: 'B', isHeader: true }]),
    row([{ content: '1' }, { content: '2' }]),
  ];
  assert.equal(hasEmptyHeaders(grid), false);
});

test('hasEmptyHeaders: поглощённые (isSpanned) ячейки шапки игнорируются', () => {
  const grid = [
    [
      makeCell({ content: 'Код', isHeader: true, rowSpan: 2 }),
      makeCell({ content: 'Кол-во', isHeader: true, colSpan: 2 }),
      makeCell({ content: '', isHeader: true, isSpanned: true, spanOrigin: { row: 0, col: 1 } }),
    ],
    [
      makeCell({ content: '', isHeader: true, isSpanned: true, spanOrigin: { row: 0, col: 0 } }),
      makeCell({ content: 'ФЛ', isHeader: true }),
      makeCell({ content: 'ЮЛ', isHeader: true }),
    ],
    row([{ content: '1' }, { content: '2' }, { content: '3' }]),
  ];
  assert.equal(hasEmptyHeaders(grid), false);
});

// ──────────────────────────────────────────────────────────────────────────
// validateTableContent — агрегат флагов (E5/E6 + пустые заголовки)
// ──────────────────────────────────────────────────────────────────────────

test('validateTableContent: таблица без шапки → noHeader=true (E6)', () => {
  const grid = [
    row([{ content: '1' }, { content: '2' }]),
    row([{ content: '3' }, { content: '4' }]),
  ];
  const res = validateTableContent(grid);
  assert.equal(res.noHeader, true);
});

test('validateTableContent: двухстрочная шапка без данных → noData=true, noHeader=false (E5)', () => {
  const grid = [
    row([{ content: 'A', isHeader: true }, { content: 'B', isHeader: true }]),
    row([{ content: 'a', isHeader: true }, { content: 'b', isHeader: true }]),
  ];
  const res = validateTableContent(grid);
  assert.equal(res.noHeader, false);
  assert.equal(res.noData, true);
});

test('validateTableContent: корректная таблица (шапка + данные) → все флаги false', () => {
  const grid = [
    row([{ content: 'A', isHeader: true }, { content: 'B', isHeader: true }]),
    row([{ content: '1' }, { content: '2' }]),
  ];
  const res = validateTableContent(grid);
  assert.deepEqual(res, { noHeader: false, emptyHeaders: false, noData: false });
});

test('validateTableContent: пустая/невалидная сетка → все флаги false (нечего проверять)', () => {
  assert.deepEqual(validateTableContent([]), { noHeader: false, emptyHeaders: false, noData: false });
  assert.deepEqual(validateTableContent(null), { noHeader: false, emptyHeaders: false, noData: false });
});
