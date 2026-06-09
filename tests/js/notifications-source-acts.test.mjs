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
