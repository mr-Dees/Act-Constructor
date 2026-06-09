/**
 * Тесты чистого расчёта масштаба fit-to-width (computeFitScale).
 *
 * computeFitScale возвращает долю ширины панели к натуральной ширине листа:
 * по умолчанию лист ЗАПОЛНЯЕТ ширину панели (масштаб может быть >1 на широкой
 * панели). Опциональный maxScale ограничивает рост сверху. Безопасен к
 * нулю/отрицательным/NaN/Infinity-значениям (вернёт 1, а не ломает рендер).
 * Логика чистая, без DOM — модуль под node:test импортируется безопасно
 * благодаря window-guard'у.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFitScale } from '../../static/js/constructor/preview/preview-fit.js';

test('узкая панель: масштаб = доля ширины (<1)', () => {
  assert.equal(computeFitScale(400, 800), 0.5);
});

test('широкая панель заполняет ширину (масштаб >1)', () => {
  assert.equal(computeFitScale(1600, 800), 2);
});

test('точное совпадение ширины даёт 100%', () => {
  assert.equal(computeFitScale(800, 800), 1);
});

test('заполнение ширины без капа: 1000/500 = 2', () => {
  assert.equal(computeFitScale(1000, 500), 2);
});

test('maxScale ограничивает рост сверху: 1000/500 кап 1.4 = 1.4', () => {
  assert.equal(computeFitScale(1000, 500, 1.4), 1.4);
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
