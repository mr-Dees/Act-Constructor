/**
 * Тесты чистого форматтера detail-поля ответов FastAPI (api-errors.js).
 *
 * FastAPI на 422 (валидация тела запроса) возвращает `detail` как массив
 * объектов `{loc, msg, type, ...}`. Без форматирования в UI прилетало
 * "[object Object]". Форматтер сворачивает массив в человекочитаемую строку,
 * показывая `msg` каждого пункта (у pydantic-валидаторов msg уже на русском).
 * Это load-bearing для T6b.5: серверная 422-структурная валидация таблицы
 * должна доходить до пользователя текстом «где и что не так».
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatValidationDetail } from '../../static/js/shared/api-errors.js';

test('formatValidationDetail: массив 422 → msg каждого пункта через "; "', () => {
  const detail = [
    { loc: ['body', 'tables', 't1', 'grid'], msg: 'Value error, Строки таблицы имеют разную длину', type: 'value_error' },
    { loc: ['body', 'tables', 't2', 'colWidths'], msg: 'Value error, Ширины колонок должны быть положительными', type: 'value_error' },
  ];
  const out = formatValidationDetail(detail);
  assert.equal(
    out,
    'Value error, Строки таблицы имеют разную длину; Value error, Ширины колонок должны быть положительными',
  );
});

test('formatValidationDetail: строковый detail возвращается как есть', () => {
  assert.equal(formatValidationDetail('Акт не найден'), 'Акт не найден');
});

test('formatValidationDetail: пункт без msg сериализуется в JSON (не теряется)', () => {
  const out = formatValidationDetail([{ loc: ['body'], type: 'missing' }]);
  assert.ok(out.includes('missing'));
});

test('formatValidationDetail: null/undefined → null (вызывающая сторона подставит fallback)', () => {
  assert.equal(formatValidationDetail(null), null);
  assert.equal(formatValidationDetail(undefined), null);
});

test('formatValidationDetail: одиночный объект 422 → его msg', () => {
  const out = formatValidationDetail([{ loc: ['body'], msg: 'Объединение ячейки (0,0) выходит за границы таблицы' }]);
  assert.equal(out, 'Объединение ячейки (0,0) выходит за границы таблицы');
});
