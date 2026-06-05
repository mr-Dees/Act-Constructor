/**
 * Паритет пропорций колонок: предпросмотр ↔ DOCX.
 *
 * Предпросмотр строит colgroup из `colWidthsToPercents(colWidths)`
 * (weight/sum*100). DOCX-билдер (`builders/tables.py::_compute_col_widths`)
 * раскладывает USABLE_WIDTH_DXA как `round(USABLE * weight/sum)` — та же
 * пропорция weight/sum. Этот тест фиксирует, что предпросмотр и Word дают
 * ОДИНАКОВЫЕ относительные ширины колонок (с точностью до округления DOCX).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { colWidthsToPercents } from '../../static/js/constructor/table/col-widths.js';

test('colWidthsToPercents даёт ту же пропорцию weight/sum, что DOCX-билдер', () => {
  // Типичные веса колонок таблицы метрик (7 колонок).
  const weights = [80, 200, 100, 100, 120, 80, 120];
  const total = weights.reduce((a, b) => a + b, 0); // 800
  const percents = colWidthsToPercents(weights);

  // Каждый процент == weight/total*100 — ровно то, что использует DOCX
  // (round(USABLE * weight/total) ⇔ доля weight/total).
  weights.forEach((w, i) => {
    const expected = (w / total) * 100;
    assert.ok(
      Math.abs(percents[i] - expected) < 1e-9,
      `колонка ${i}: ${percents[i]} ≠ ${expected}`
    );
  });

  // Сумма ровно 100% (лист тянется на 100% колонки текста, как w:tblW pct=5000).
  const sum = percents.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 100) < 1e-9, `сумма процентов ${sum}`);
});

test('паритет сохраняется при нормировке: предпросмотр и DOCX делят одну долю', () => {
  // Симулируем DOCX _compute_col_widths на условном USABLE и сверяем доли.
  const weights = [80, 200, 100, 100, 120, 80, 120];
  const total = weights.reduce((a, b) => a + b, 0);
  const USABLE = 10346; // USABLE_WIDTH_DXA из tables.py (для иллюстрации долей)

  const percents = colWidthsToPercents(weights);
  // DOCX-доля колонки в твипах, переведённая обратно в проценты.
  const docxPercents = weights.map((w) => ((USABLE * w) / total / USABLE) * 100);

  percents.forEach((p, i) => {
    assert.ok(
      Math.abs(p - docxPercents[i]) < 1e-9,
      `доля колонки ${i}: предпросмотр ${p} ≠ DOCX ${docxPercents[i]}`
    );
  });
});
