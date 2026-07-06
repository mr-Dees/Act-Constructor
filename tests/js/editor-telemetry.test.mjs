/**
 * Тесты батчера телеметрии здоровья редактора (§6.8).
 *
 * Проверяют: флаш при 50 событиях и по таймеру 30с (mock timers), агрегацию
 * счётчиков, приватность payload (только тип/акт/счётчик), no-op при выключенном
 * kill-switch и без actId (RO), keepalive-флаш на beforeunload.
 */
import './_browser-stub.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { EditorTelemetry } from '../../static/js/constructor/services/editor-telemetry.js';

let fetchCalls;

beforeEach(() => {
  EditorTelemetry._resetForTests();
  fetchCalls = [];
  globalThis.fetch = (url, opts) => {
    fetchCalls.push({ url, opts });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  };
  globalThis.location = { origin: 'http://test', pathname: '/' };
  globalThis.currentActId = 999002;
});

afterEach(() => {
  EditorTelemetry._resetForTests();
  delete globalThis.fetch;
  delete globalThis.location;
  delete globalThis.currentActId;
});

/** Тело последнего POST'а телеметрии, распарсенное из JSON. */
function lastBody() {
  const call = fetchCalls[fetchCalls.length - 1];
  return JSON.parse(call.opts.body);
}

test('§6.8: флаш ровно при 50 событиях, раньше — не шлёт', () => {
  for (let i = 0; i < 49; i++) EditorTelemetry.track('observer_heal');
  assert.equal(fetchCalls.length, 0, '49 событий — ещё не флашим');

  EditorTelemetry.track('observer_heal');
  assert.equal(fetchCalls.length, 1, '50-е событие триггерит флаш');

  const body = lastBody();
  assert.deepEqual(body.events, [
    { event_type: 'observer_heal', act_id: 999002, count: 50 },
  ], 'счётчики агрегируются в одну запись count=50');
});

test('§6.8: POST идёт на эндпоинт телеметрии', () => {
  for (let i = 0; i < 50; i++) EditorTelemetry.track('empty_paste');
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0].url, /\/api\/v1\/acts\/editor-telemetry$/);
  assert.equal(fetchCalls[0].opts.method, 'POST');
});

test('§6.8: флаш по таймеру каждые 30с (mock timers)', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });

  EditorTelemetry.track('capsule_repair'); // <50 — флаша по счётчику нет
  assert.equal(fetchCalls.length, 0);

  t.mock.timers.tick(30000);
  assert.equal(fetchCalls.length, 1, 'по тику 30с — флаш накопленного');
  assert.deepEqual(lastBody().events, [
    { event_type: 'capsule_repair', act_id: 999002, count: 1 },
  ]);
});

test('§6.8: агрегация по (тип, акт); payload без пользовательского контента', () => {
  EditorTelemetry.track('observer_heal');
  EditorTelemetry.track('observer_heal');
  EditorTelemetry.track('dup_id_fix');
  globalThis.currentActId = 555;
  EditorTelemetry.track('save_failure');

  EditorTelemetry.flush();
  assert.equal(fetchCalls.length, 1);

  const events = lastBody().events;
  // Три записи: observer_heal×2 (акт 999002), dup_id_fix×1 (акт 999002),
  // save_failure×1 (акт 555).
  assert.equal(events.length, 3);
  const heal = events.find(e => e.event_type === 'observer_heal');
  assert.deepEqual(heal, { event_type: 'observer_heal', act_id: 999002, count: 2 });
  assert.ok(events.find(e => e.event_type === 'dup_id_fix' && e.act_id === 999002));
  assert.ok(events.find(e => e.event_type === 'save_failure' && e.act_id === 555));

  // Приватность: у каждой записи ровно 3 поля — ни текста, ни username.
  for (const e of events) {
    assert.deepEqual(Object.keys(e).sort(), ['act_id', 'count', 'event_type']);
  }
});

test('§6.8: kill-switch — track при выключенном флаге ничего не шлёт', () => {
  EditorTelemetry.setEnabled(false);
  for (let i = 0; i < 100; i++) EditorTelemetry.track('observer_heal');
  assert.equal(fetchCalls.length, 0, 'выключенная телеметрия — ни одного запроса');
  assert.equal(EditorTelemetry._totalPending, 0, 'счётчик не копится');
});

test('§6.8: setEnabled(false) сбрасывает накопленное и гасит таймер', () => {
  EditorTelemetry.track('observer_heal');
  assert.equal(EditorTelemetry._totalPending, 1);
  assert.notEqual(EditorTelemetry._timer, null, 'таймер запущен на первом событии');

  EditorTelemetry.setEnabled(false);
  assert.equal(EditorTelemetry._totalPending, 0, 'накопленное сброшено');
  assert.equal(EditorTelemetry._timer, null, 'таймер погашен (без утечки)');
});

test('§6.8: setEnabled(true) после выключения — снова копит и флашит', () => {
  EditorTelemetry.setEnabled(false);
  EditorTelemetry.track('observer_heal');
  assert.equal(fetchCalls.length, 0);

  EditorTelemetry.setEnabled(true);
  for (let i = 0; i < 50; i++) EditorTelemetry.track('observer_heal');
  assert.equal(fetchCalls.length, 1, 'после re-enable флаш по 50 работает');
});

test('§6.8: track без actId — no-op (read-only акт не падает)', () => {
  delete globalThis.currentActId;
  EditorTelemetry.track('observer_heal');
  EditorTelemetry.track('save_failure');
  assert.equal(fetchCalls.length, 0);
  assert.equal(EditorTelemetry._totalPending, 0, 'без actId ничего не копим');
});

test('§6.8: неизвестный тип события — no-op', () => {
  EditorTelemetry.track('totally_unknown_event');
  assert.equal(EditorTelemetry._totalPending, 0);
  EditorTelemetry.flush();
  assert.equal(fetchCalls.length, 0);
});

test('§6.8: пустой флаш — no-op (без сетевого запроса)', () => {
  EditorTelemetry.flush();
  assert.equal(fetchCalls.length, 0);
});

test('§6.8: финальный флаш на beforeunload идёт с keepalive:true', () => {
  EditorTelemetry.track('observer_heal');
  assert.equal(fetchCalls.length, 0, 'до unload не флашили (1<50)');

  EditorTelemetry._flushOnUnload();
  assert.equal(fetchCalls.length, 1, 'unload флашит остаток');
  assert.equal(fetchCalls[0].opts.keepalive, true, 'запрос помечен keepalive');
});

test('§6.8: обычный флаш идёт без keepalive', () => {
  for (let i = 0; i < 50; i++) EditorTelemetry.track('observer_heal');
  assert.equal(fetchCalls.length, 1);
  assert.notEqual(fetchCalls[0].opts.keepalive, true, 'штатный флаш без keepalive');
});
