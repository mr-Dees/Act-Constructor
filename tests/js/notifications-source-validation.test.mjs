/**
 * Источник «validation» колокольчика конструктора (#8):
 * collectValidationItems читает validation_issues последнего сохранения
 * из window.AppState и нормализует в элементы уведомлений.
 */
import './_browser-stub.mjs';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { collectValidationItems } from '../../static/js/constructor/header/notifications-source-validation.js';

beforeEach(() => {
  window.AppState = {};
});

test('нет замечаний → пустой список', () => {
  window.AppState.validationIssues = [];
  assert.deepEqual(collectValidationItems(), []);
});

test('отсутствующий AppState/issues → пустой список (без throw)', () => {
  window.AppState = {};
  assert.deepEqual(collectValidationItems(), []);
});

test('замечания нормализуются в элементы с severity и текстом', () => {
  window.AppState.validationIssues = [
    { code: 'table_no_header', severity: 'error', ref: 't1', message: 'Таблица без заголовка' },
    { code: 'table_no_data', severity: 'warning', ref: 't2', message: 'Таблица без данных' },
  ];
  const items = collectValidationItems();
  assert.equal(items.length, 2);
  assert.equal(items[0].severity, 'error');
  assert.equal(items[0].title, 'Структура акта');
  assert.match(items[0].body, /без заголовка/);
  assert.equal(items[1].severity, 'warning');
  // id уникален в пределах снимка.
  assert.notEqual(items[0].id, items[1].id);
});

test('неизвестная severity трактуется как warning', () => {
  window.AppState.validationIssues = [{ code: 'x', message: 'm' }];
  assert.equal(collectValidationItems()[0].severity, 'warning');
});
