/**
 * Тесты чистого построителя живых уведомлений «acts»
 * (notifications-source-acts.js → buildActsNotificationItems).
 *
 * Покрывают: пропуск готовых/заблокированных актов, severity (error при
 * фактуре, иначе warning), формирование текста «Требуется: …», onClick.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildActsNotificationItems,
  actItemSignature,
  reconcileActsItemsState,
  registerActsSource,
} from '../../static/js/portal/acts-manager/notifications-source-acts.js';

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

// ── actItemSignature ─────────────────────────────────────────────────────────

test('actItemSignature: стабильна для одинаковых severity+body, меняется при изменении', () => {
  const a = { severity: 'warning', body: 'Работа не закончена' };
  const b = { severity: 'warning', body: 'Работа не закончена' };
  const c = { severity: 'warning', body: 'Требуется: дата составления' };
  const d = { severity: 'error', body: 'Работа не закончена' };
  assert.equal(actItemSignature(a), actItemSignature(b));
  assert.notEqual(actItemSignature(a), actItemSignature(c));
  assert.notEqual(actItemSignature(a), actItemSignature(d));
});

// ── reconcileActsItemsState ──────────────────────────────────────────────────

test('reconcile: error всегда виден, непрочитан, состояние не применяется', () => {
  const items = [{ id: 'acts:1', severity: 'error', body: 'Проверить: X' }];
  // даже если в сторе error помечен «прочитанным» — игнорируем (вечно горит)
  const store = { 'acts:1': { sig: actItemSignature(items[0]), read: true, dismissed: true } };
  const { visible } = reconcileActsItemsState(items, store);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].is_read, false);
});

test('reconcile: warning без стора → виден, непрочитан, заводит запись стора', () => {
  const items = [{ id: 'acts:2', severity: 'warning', body: 'Работа не закончена' }];
  const { visible, store } = reconcileActsItemsState(items, {});
  assert.equal(visible.length, 1);
  assert.equal(visible[0].is_read, false);
  assert.equal(store['acts:2'].read, false);
  assert.equal(store['acts:2'].dismissed, false);
  assert.equal(store['acts:2'].sig, actItemSignature(items[0]));
});

test('reconcile: warning с read=true (сигнатура совпадает) → виден приглушённым', () => {
  const items = [{ id: 'acts:3', severity: 'warning', body: 'Работа не закончена' }];
  const store = { 'acts:3': { sig: actItemSignature(items[0]), read: true, dismissed: false } };
  const { visible } = reconcileActsItemsState(items, store);
  assert.equal(visible.length, 1);
  assert.equal(visible[0].is_read, true);
});

test('reconcile: warning с dismissed=true → НЕ виден, но запись стора сохраняется', () => {
  const items = [{ id: 'acts:4', severity: 'warning', body: 'Работа не закончена' }];
  const store = { 'acts:4': { sig: actItemSignature(items[0]), read: false, dismissed: true } };
  const { visible, store: next } = reconcileActsItemsState(items, store);
  assert.equal(visible.length, 0);
  assert.equal(next['acts:4'].dismissed, true);
});

test('reconcile: изменение замечания (другая сигнатура) сбрасывает состояние', () => {
  const items = [{ id: 'acts:5', severity: 'warning', body: 'Новое замечание' }];
  // в сторе была старая сигнатура с dismissed=true
  const store = { 'acts:5': { sig: 'warning|Старое замечание', read: true, dismissed: true } };
  const { visible, store: next } = reconcileActsItemsState(items, store);
  assert.equal(visible.length, 1);          // снова виден (состояние сброшено)
  assert.equal(visible[0].is_read, false);
  assert.equal(next['acts:5'].sig, actItemSignature(items[0]));
  assert.equal(next['acts:5'].dismissed, false);
});

test('reconcile: исправленный акт (нет в items) вычищается из стора', () => {
  const items = [{ id: 'acts:6', severity: 'warning', body: 'Работа не закончена' }];
  const store = {
    'acts:6': { sig: actItemSignature(items[0]), read: true, dismissed: false },
    'acts:99': { sig: 'warning|устаревшее', read: true, dismissed: true }, // акт исправлен
  };
  const { store: next } = reconcileActsItemsState(items, store);
  assert.ok('acts:6' in next);
  assert.ok(!('acts:99' in next)); // запись исчезнувшего акта удалена
});

// ── registerActsSource: регрессия на затирание состояния до загрузки сводки ──

test('registerActsSource НЕ затирает сохранённое состояние до прихода сводки', async () => {
  // Сид: акт 5 (warning) помечен прочитанным в localStorage.
  const seedAct = { id: 5, inspection_name: 'Акт', validation_status: 'warning' };
  const [seedItem] = buildActsNotificationItems([seedAct]);
  const stored = { [seedItem.id]: { sig: actItemSignature(seedItem), read: true, dismissed: false } };

  let ls = JSON.stringify(stored);
  const mockWindow = {
    localStorage: { getItem: () => ls, setItem: (_k, v) => { ls = v; } },
  };
  let resolveFetch;
  const fetchPromise = new Promise((res) => { resolveFetch = res; });
  const mockDoc = { hidden: false, addEventListener() {}, removeEventListener() {} };

  const prev = { window: globalThis.window, document: globalThis.document, fetch: globalThis.fetch };
  globalThis.window = mockWindow;
  globalThis.document = mockDoc;
  globalThis.fetch = () => fetchPromise;

  let teardown;
  try {
    // Фейковый центр: registerSource синхронно зовёт collect (как настоящий).
    let collectFn = null;
    const center = {
      registerSource: (_k, h) => { collectFn = h.collect; h.collect(); },
      unregisterSource() {},
      refresh: () => { if (collectFn) collectFn(); },
    };

    teardown = registerActsSource(center, {});

    // ДО загрузки сводки синхронный collect НЕ должен стереть localStorage.
    assert.deepEqual(JSON.parse(ls), stored, 'состояние не должно стираться до загрузки');

    // Приходит сводка с тем же актом 5 (warning) → прочитанность сохраняется.
    resolveFetch({ ok: true, json: async () => [seedAct] });
    await fetchPromise;
    await new Promise((r) => setTimeout(r, 0));

    const act5 = collectFn().find((i) => i.id === seedItem.id);
    assert.ok(act5, 'акт 5 присутствует в выдаче после загрузки');
    assert.equal(act5.is_read, true, 'прочитанность пережила перезагрузку');
    assert.equal(JSON.parse(ls)[seedItem.id].read, true);
  } finally {
    if (teardown) teardown();
    globalThis.window = prev.window;
    globalThis.document = prev.document;
    globalThis.fetch = prev.fetch;
  }
});
