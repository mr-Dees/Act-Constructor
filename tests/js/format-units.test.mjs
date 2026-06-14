/**
 * shared/format-units.js — единый хелпер размеров (заменил 3 копии).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatMb, formatFileSize } from '../../static/js/shared/format-units.js';

test('formatMb: одна десятичная, хвостовой .0 убирается', () => {
  assert.equal(formatMb(1.5 * 1024 * 1024), '1.5');
  assert.equal(formatMb(2 * 1024 * 1024), '2');
  assert.equal(formatMb(10 * 1024 * 1024), '10');
  assert.equal(formatMb(0), '0');
});

test('formatFileSize: Б/КБ/МБ с единицей (контракт чата сохранён)', () => {
  assert.equal(formatFileSize(512), '512 Б');
  assert.equal(formatFileSize(1536), '1.5 КБ');
  assert.equal(formatFileSize(1.5 * 1024 * 1024), '1.5 МБ');
  assert.equal(formatFileSize(2 * 1024 * 1024), '2.0 МБ');
  assert.equal(formatFileSize(1023), '1023 Б');
});
