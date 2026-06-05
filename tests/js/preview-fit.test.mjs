/**
 * Тесты чистого расчёта масштаба fit-to-width (computeFitScale).
 *
 * computeFitScale возвращает долю ширины панели к натуральной ширине листа,
 * капится на 1 (лист не увеличивается крупнее натурального) и безопасен к
 * нулю/отрицательным/NaN/Infinity-значениям (вернёт 1, а не ломает рендер).
 * Логика чистая, без DOM — модуль под node:test импортируется безопасно
 * благодаря window-guard'у.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFitScale } from '../../static/js/constructor/preview/preview-fit.js';

test('узкая панель: масштаб = доля ширины', () => {
  assert.equal(computeFitScale(400, 800), 0.5);
});

test('широкая панель капится на 100%', () => {
  assert.equal(computeFitScale(1600, 800), 1);
});

test('точное совпадение ширины даёт 100%', () => {
  assert.equal(computeFitScale(800, 800), 1);
});

test('нулевая натуральная ширина → 1 (защита)', () => {
  assert.equal(computeFitScale(400, 0), 1);
});

test('отрицательная натуральная ширина → 1 (защита)', () => {
  assert.equal(computeFitScale(400, -5), 1);
});

test('NaN ширины панели → 1 (защита)', () => {
  assert.equal(computeFitScale(NaN, 800), 1);
});

test('Infinity ширины панели → 1 (защита)', () => {
  assert.equal(computeFitScale(Infinity, 800), 1);
});

test('нулевая ширина панели → 1 (защита)', () => {
  assert.equal(computeFitScale(0, 800), 1);
});
