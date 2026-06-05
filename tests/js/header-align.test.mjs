/**
 * Тесты выравнивания объединённых ячеек шапки (header-align.js).
 *
 * Зеркало серверной логики _fill_cell (tables.py) и centered-набора styles.py.
 * Проверяем:
 *  - объединённые риск-шапки (налоговый/операционный риск) → 'left';
 *  - centered-набор остаётся 'center', в т.ч. при «грязных» пробелах;
 *  - одиночная шапка (colSpan ≤ 1, undefined, 0) → 'center';
 *  - не-шапка → null.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mergedHeaderAlign,
  CENTERED_MERGED_HEADER_TEXTS,
} from '../../static/js/constructor/table/header-align.js';

test('объединённая шапка налогового риска → left', () => {
  assert.equal(mergedHeaderAlign('Выявлены налоговые риски', 6, true), 'left');
});

test('объединённая шапка операционного риска → left', () => {
  assert.equal(
    mergedHeaderAlign('Отклонения с признаками операционного риска (далее - ОР)', 5, true),
    'left',
  );
});

test('centered-набор остаётся по центру даже при colSpan>1', () => {
  assert.equal(
    mergedHeaderAlign('Количество клиентов / элементов, ед.', 2, true),
    'center',
  );
});

test('сопоставление с centered-набором нечувствительно к пробелам', () => {
  assert.equal(
    mergedHeaderAlign('Количество   клиентов / элементов, ед.', 2, true),
    'center',
  );
});

test('одиночная ячейка шапки (colSpan=1) → center', () => {
  assert.equal(mergedHeaderAlign('Процесс', 1, true), 'center');
});

test('colSpan 0/undefined трактуется как одиночная → center', () => {
  assert.equal(mergedHeaderAlign('X', 1, true), 'center');
  assert.equal(mergedHeaderAlign('X', 0, true), 'center');
  assert.equal(mergedHeaderAlign('X', undefined, true), 'center');
});

test('не-шапка → null (спец-выравнивание не применяется)', () => {
  assert.equal(mergedHeaderAlign('Выявлены налоговые риски', 6, false), null);
});

test('CENTERED_MERGED_HEADER_TEXTS содержит ровно одну формулировку-зеркало', () => {
  assert.equal(CENTERED_MERGED_HEADER_TEXTS.has('Количество клиентов / элементов, ед.'), true);
  assert.equal(CENTERED_MERGED_HEADER_TEXTS.size, 1);
});
