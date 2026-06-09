/**
 * Тесты поддержки целых весов colWidths в структурных операциях с колонками.
 *
 * Проверяют чистые мутаторы colWidths на объекте таблицы (без DOM): вставка,
 * удаление, разделение колонки должны держать table.colWidths целыми (что
 * требует pydantic colWidths: list[int]), а НЕ сбрасывать в равные дроби и НЕ
 * писать в tableUISizes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyInsertColumnWidth,
  applyRemoveColumnWidth,
} from '../../static/js/constructor/table/col-widths.js';
import { makeTable, makeGrid } from './_setup.mjs';

const allInts = (arr) => arr.every((n) => Number.isInteger(n));

// Контракт: grid передаётся уже в пост-структурном состоянии (вызывающий код
// сначала splice'ит ячейки grid, затем зовёт мутатор весов). Для вставки grid
// уже расширен, для удаления — уже сжат.

test('applyInsertColumnWidth для colWidths:[50,50] даёт целые длиной 3', () => {
  // grid уже расширен до 3 колонок (имитируем пост-insert), исходных весов 2.
  const table = makeTable({ grid: makeGrid(2, 3), colWidths: [50, 50] });
  applyInsertColumnWidth(table, 1);
  assert.equal(table.colWidths.length, 3);
  assert.ok(allInts(table.colWidths), JSON.stringify(table.colWidths));
});

test('applyInsertColumnWidth сохраняет существующие веса', () => {
  const table = makeTable({ grid: makeGrid(2, 3), colWidths: [80, 120] });
  applyInsertColumnWidth(table, 0);
  assert.equal(table.colWidths.length, 3);
  assert.ok(allInts(table.colWidths));
  // Старые веса 80 и 120 на местах после вставленного в начало.
  assert.equal(table.colWidths[1], 80);
  assert.equal(table.colWidths[2], 120);
});

test('applyRemoveColumnWidth убирает вес по индексу и держит целые', () => {
  // grid уже сжат до 2 колонок (имитируем пост-delete), исходных весов было 3.
  const table = makeTable({ grid: makeGrid(2, 2), colWidths: [10, 20, 30] });
  applyRemoveColumnWidth(table, 1);
  assert.deepEqual(table.colWidths, [10, 30]);
  assert.ok(allInts(table.colWidths));
});

test('applyInsertColumnWidth без colWidths инициализирует равными целыми по числу колонок', () => {
  // grid 2x3 (пост-insert) → база 2 колонки; нет colWidths → создаём целые.
  const table = makeTable({ grid: makeGrid(2, 3), colWidths: undefined });
  applyInsertColumnWidth(table, 0);
  assert.ok(Array.isArray(table.colWidths));
  assert.equal(table.colWidths.length, 3);
  assert.ok(allInts(table.colWidths));
  assert.ok(table.colWidths.every((w) => w >= 1));
});
