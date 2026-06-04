/**
 * Тесты чистых помощников весов колонок (colWidths).
 *
 * colWidths — единственный источник ширины колонок: положительные ЦЕЛЫЕ
 * относительные веса (DOCX-билдер нормирует их по сумме). Эти помощники
 * поддерживают структурные операции (вставка/удаление/разделение колонки) и
 * пересчёт в проценты для colgroup в редакторе — всё без DOM, чтобы тестировать
 * чистую логику и гарантировать, что pydantic (colWidths: list[int]) не получит
 * дробей и не отдаст 422.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {
  insertColumnWeight,
  removeColumnWeight,
  splitColumnWeight,
  colWidthsToPercents,
  pixelWidthsToWeights,
} from '../../static/js/constructor/table/col-widths.js';

const isInt = (n) => Number.isInteger(n);
const allInts = (arr) => arr.every(isInt);

test('insertColumnWeight вставляет целый вес на позицию и сохраняет существующие', () => {
  const result = insertColumnWeight([50, 50], 1);
  assert.equal(result.length, 3);
  assert.ok(allInts(result), `ожидались целые: ${JSON.stringify(result)}`);
  // Существующие веса сохранены на своих местах (вставка в середину).
  assert.equal(result[0], 50);
  assert.equal(result[2], 50);
  // Вставленный вес — округлённое среднее (50), не дробь.
  assert.equal(result[1], 50);
});

test('insertColumnWeight на пустом массиве вставляет 100', () => {
  assert.deepEqual(insertColumnWeight([], 0), [100]);
});

test('insertColumnWeight округляет среднее до целого (минимум 1)', () => {
  // Среднее (10+11)/2 = 10.5 → round = 11 (банковское округление не используется).
  const result = insertColumnWeight([10, 11], 2);
  assert.ok(allInts(result));
  assert.equal(result[2], 11);
  assert.equal(result.length, 3);
});

test('insertColumnWeight не вставляет вес меньше 1', () => {
  // Среднее очень маленьких весов всё равно не должно дать 0.
  const result = insertColumnWeight([1], 1);
  assert.ok(result.every((w) => w >= 1));
  assert.ok(allInts(result));
});

test('removeColumnWeight убирает указанный индекс, сохраняя остальные', () => {
  const result = removeColumnWeight([10, 20, 30], 1);
  assert.deepEqual(result, [10, 30]);
});

test('removeColumnWeight не мутирует исходный массив', () => {
  const src = [10, 20, 30];
  removeColumnWeight(src, 0);
  assert.deepEqual(src, [10, 20, 30]);
});

test('insertColumnWeight не мутирует исходный массив', () => {
  const src = [50, 50];
  insertColumnWeight(src, 1);
  assert.deepEqual(src, [50, 50]);
});

test('splitColumnWeight делит вес на два целых, в сумме равных исходному', () => {
  const result = splitColumnWeight([100, 40], 0);
  assert.equal(result.length, 3);
  assert.ok(allInts(result));
  // На месте index — два веса в сумме = исходному 100.
  assert.equal(result[0] + result[1], 100);
  // floor(100/2)=50 и 100-50=50.
  assert.deepEqual([result[0], result[1]], [50, 50]);
  // Соседний вес не тронут.
  assert.equal(result[2], 40);
});

test('splitColumnWeight нечётного веса даёт два целых в сумме исходного', () => {
  const result = splitColumnWeight([7], 0);
  assert.ok(allInts(result));
  assert.equal(result[0] + result[1], 7);
  // floor(7/2)=3 и 7-3=4.
  assert.deepEqual(result, [3, 4]);
});

test('splitColumnWeight веса 1 даёт две колонки по >=1', () => {
  const result = splitColumnWeight([1], 0);
  assert.equal(result.length, 2);
  assert.ok(result.every((w) => w >= 1));
  assert.ok(allInts(result));
});

test('splitColumnWeight не мутирует исходный массив', () => {
  const src = [100, 40];
  splitColumnWeight(src, 0);
  assert.deepEqual(src, [100, 40]);
});

test('colWidthsToPercents возвращает проценты в сумме ~100', () => {
  const pcts = colWidthsToPercents([1, 1, 2]);
  const sum = pcts.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 100) < 1e-9, `сумма процентов ${sum}`);
  assert.equal(pcts[0], 25);
  assert.equal(pcts[1], 25);
  assert.equal(pcts[2], 50);
});

test('colWidthsToPercents на пустом или нулевой сумме делит поровну', () => {
  assert.deepEqual(colWidthsToPercents([]), []);
  const pcts = colWidthsToPercents([0, 0, 0]);
  const sum = pcts.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 100) < 1e-9);
  pcts.forEach((p) => assert.ok(Math.abs(p - 100 / 3) < 1e-9));
});

test('property: insert/remove/split сохраняют целые веса >=1', () => {
  const arbWeights = fc.array(fc.integer({ min: 1, max: 1000 }), {
    minLength: 1,
    maxLength: 12,
  });
  fc.assert(
    fc.property(arbWeights, fc.nat(), (weights, rawIdx) => {
      const idx = rawIdx % weights.length;

      const ins = insertColumnWeight(weights, idx);
      assert.ok(allInts(ins) && ins.every((w) => w >= 1));
      assert.equal(ins.length, weights.length + 1);

      const rem = removeColumnWeight(weights, idx);
      assert.ok(allInts(rem) && rem.every((w) => w >= 1));
      assert.equal(rem.length, weights.length - 1);

      const spl = splitColumnWeight(weights, idx);
      assert.ok(allInts(spl) && spl.every((w) => w >= 1));
      assert.equal(spl.length, weights.length + 1);
      // Сумма после split не меняется, КОГДА исходный вес делим (>=2).
      // Для веса 1 split даёт [1,1] (каждый >=1) — это сознательный пол, при
      // котором сумма растёт на 1; иначе одна из колонок была бы 0 (невалидно).
      if (weights[idx] >= 2) {
        assert.equal(
          spl.reduce((a, b) => a + b, 0),
          weights.reduce((a, b) => a + b, 0)
        );
      }
    })
  );
});

test('pixelWidthsToWeights переводит пиксели в целые веса с сохранением пропорций', () => {
  // Колонки 100px, 200px, 100px → пропорции 1:2:1.
  const weights = pixelWidthsToWeights([100, 200, 100]);
  assert.ok(weights.every((w) => Number.isInteger(w) && w >= 1), JSON.stringify(weights));
  assert.equal(weights.length, 3);
  // Пропорции сохранены: средняя колонка вдвое шире крайних.
  assert.equal(weights[1], weights[0] * 2);
  assert.equal(weights[0], weights[2]);
});

test('pixelWidthsToWeights округляет дробные пиксели до целых весов', () => {
  const weights = pixelWidthsToWeights([133.33, 66.67]);
  assert.ok(weights.every((w) => Number.isInteger(w) && w >= 1));
  assert.equal(weights.length, 2);
});

test('pixelWidthsToWeights клампит нулевую/отрицательную ширину к весу 1', () => {
  const weights = pixelWidthsToWeights([0, 100, -5]);
  assert.ok(weights.every((w) => Number.isInteger(w) && w >= 1));
  assert.equal(weights[0], 1);
  assert.equal(weights[2], 1);
});

test('property: pixelWidthsToWeights всегда даёт целые веса >=1', () => {
  const arbPixels = fc.array(fc.float({ min: 0, max: 2000, noNaN: true }), {
    minLength: 1,
    maxLength: 12,
  });
  fc.assert(
    fc.property(arbPixels, (pixels) => {
      const weights = pixelWidthsToWeights(pixels);
      assert.equal(weights.length, pixels.length);
      assert.ok(weights.every((w) => Number.isInteger(w) && w >= 1));
    })
  );
});

test('property: colWidthsToPercents всегда даёт сумму ~100 для положительных весов', () => {
  const arbWeights = fc.array(fc.integer({ min: 1, max: 1000 }), {
    minLength: 1,
    maxLength: 12,
  });
  fc.assert(
    fc.property(arbWeights, (weights) => {
      const pcts = colWidthsToPercents(weights);
      const sum = pcts.reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(sum - 100) < 1e-6, `сумма ${sum}`);
    })
  );
});
