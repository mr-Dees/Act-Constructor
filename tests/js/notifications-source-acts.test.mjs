/**
 * Тесты чистого построителя живых уведомлений «acts»
 * (notifications-source-acts.js → buildActsNotificationItems).
 *
 * Покрывают: пропуск готовых/заблокированных актов, severity (error при
 * фактуре, иначе warning), формирование текста «Требуется: …», onClick.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildActsNotificationItems } from '../../static/js/portal/acts-manager/notifications-source-acts.js';

test('не массив → пустой результат', () => {
  assert.deepEqual(buildActsNotificationItems(null), []);
  assert.deepEqual(buildActsNotificationItems(undefined), []);
  assert.deepEqual(buildActsNotificationItems('x'), []);
});

test('акты без требований и заблокированные пропускаются', () => {
  const acts = [
    { id: 1, inspection_name: 'Готовый' },
    { id: 2, inspection_name: 'Заблок', is_locked: true, needs_invoice_check: true },
  ];
  assert.deepEqual(buildActsNotificationItems(acts), []);
});

test('фактура → severity error и текст про фактуру', () => {
  const items = buildActsNotificationItems([
    { id: 5, inspection_name: 'Акт А', needs_invoice_check: true },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'acts:5');
  assert.equal(items[0].title, 'Акт А');
  assert.equal(items[0].severity, 'error');
  assert.equal(items[0].body, 'Требуется: проверка фактуры');
});

test('только метаданные → severity warning и перечисление требований', () => {
  const items = buildActsNotificationItems([
    {
      id: 7,
      inspection_name: 'Акт Б',
      needs_created_date: true,
      needs_directive_number: true,
      needs_service_note: true,
    },
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].severity, 'warning');
  assert.equal(
    items[0].body,
    'Требуется: дата составления, номера поручений, служебная записка',
  );
});

test('фактура + метаданные → фактура первой, severity error', () => {
  const items = buildActsNotificationItems([
    { id: 8, inspection_name: 'Акт В', needs_invoice_check: true, needs_service_note: true },
  ]);
  assert.equal(items[0].severity, 'error');
  assert.equal(items[0].body, 'Требуется: проверка фактуры, служебная записка');
});

test('title по умолчанию, если нет inspection_name', () => {
  const items = buildActsNotificationItems([{ id: 9, needs_invoice_check: true }]);
  assert.equal(items[0].title, 'Акт 9');
});

test('onOpen задаёт onClick, вызывающий onOpen с id акта', () => {
  let opened = null;
  const items = buildActsNotificationItems(
    [{ id: 11, inspection_name: 'Акт Г', needs_invoice_check: true }],
    { onOpen: (id) => { opened = id; } },
  );
  assert.equal(typeof items[0].onClick, 'function');
  items[0].onClick();
  assert.equal(opened, 11);
});

test('без onOpen onClick отсутствует', () => {
  const items = buildActsNotificationItems([{ id: 12, needs_service_note: true }]);
  assert.equal(items[0].onClick, undefined);
});

test('акт со структурной ошибкой → «Проверить: …» (только error), severity error (#8)', () => {
  const acts = [{
    id: 7, inspection_name: 'Проверка КМ-07',
    validation_status: 'error',
    validation_issues: [
      { code: 'table_no_header', severity: 'error', message: 'Таблица «X» без строки заголовка' },
      { code: 'table_no_data', severity: 'warning', message: 'Таблица «Y» без данных' },
    ],
  }];
  const items = buildActsNotificationItems(acts);
  assert.equal(items.length, 1);
  assert.match(items[0].body, /Проверить:/);
  assert.match(items[0].body, /без строки заголовка/);
  // warning-замечания на лендинг не выносим — только полным списком внутри акта
  assert.ok(!/без данных/.test(items[0].body));
  assert.equal(items[0].severity, 'error');
});

test('акт со статусом warning → агрегат «Работа не закончена», severity warning (#8)', () => {
  const acts = [{
    id: 13, inspection_name: 'Черновик',
    validation_status: 'warning',
    validation_issues: [
      { code: 'table_no_data', severity: 'warning', message: 'Таблица «Y» без данных' },
    ],
  }];
  const items = buildActsNotificationItems(acts);
  assert.equal(items.length, 1);
  assert.match(items[0].body, /Работа не закончена/);
  // конкретику пустых таблиц на лендинг не выносим
  assert.ok(!/без данных/.test(items[0].body));
  assert.equal(items[0].severity, 'warning');
});

test('акт со статусом ok без иных требований → пропускается', () => {
  const acts = [{ id: 8, inspection_name: 'Пусто', validation_status: 'ok', validation_issues: [] }];
  assert.deepEqual(buildActsNotificationItems(acts), []);
});

test('фактура + структурная ошибка → severity error, обе строки в body', () => {
  const acts = [{
    id: 9, inspection_name: 'Критичный', needs_invoice_check: true,
    validation_status: 'error',
    validation_issues: [{ code: 'empty_structure', severity: 'error', message: 'Структура акта пуста' }],
  }];
  const items = buildActsNotificationItems(acts);
  assert.equal(items[0].severity, 'error');
  assert.match(items[0].body, /проверка фактуры/);
  assert.match(items[0].body, /Структура акта пуста/);
});
