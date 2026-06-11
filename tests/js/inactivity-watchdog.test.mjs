/**
 * Тесты InactivityWatchdog (декомпозиция LockManager, §6 п.9).
 *
 * Гарантии:
 *  - start() подписывает 4 activity-события + visibilitychange на document;
 *  - stop() снимает ВСЕ подписки (контракт из 09-lock-listeners-leak.spec.ts)
 *    и идемпотентен;
 *  - проверка простоя: при превышении порога onIdle вызывается один раз
 *    с целым числом минут, таймер останавливается;
 *  - touch()/активность сбрасывают отсчёт простоя;
 *  - LockManager.destroy() делегирует watchdog.stop() — листенеры сняты.
 */
import './_browser-stub.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { InactivityWatchdog } from '../../static/js/constructor/inactivity-watchdog.js';
import { LockManager } from '../../static/js/constructor/lock-manager.js';

let added;
let removed;
let wd;

beforeEach(() => {
  added = [];
  removed = [];
  document.addEventListener = (type, fn, opts) => added.push({ type, fn, opts });
  document.removeEventListener = (type, fn) => removed.push({ type, fn });
  wd = null;
});

afterEach(() => {
  if (wd) wd.stop();
  document.addEventListener = () => {};
  document.removeEventListener = () => {};
});

function makeWatchdog(overrides = {}) {
  return new InactivityWatchdog({
    checkIntervalSeconds: 60,
    idleTimeoutMinutes: 5,
    onIdle: () => {},
    ...overrides,
  });
}

test('start() подписывает 4 activity-события и visibilitychange', () => {
  wd = makeWatchdog({ onVisibilityChange: () => {} });
  wd.start();

  const types = added.map((l) => l.type).sort();
  assert.deepEqual(types, ['keydown', 'mousedown', 'scroll', 'touchstart', 'visibilitychange']);
});

test('без onVisibilityChange подписки на visibilitychange нет', () => {
  wd = makeWatchdog();
  wd.start();

  assert.ok(!added.some((l) => l.type === 'visibilitychange'));
  assert.equal(added.length, 4);
});

test('stop() снимает все подписки и идемпотентен', () => {
  wd = makeWatchdog({ onVisibilityChange: () => {} });
  wd.start();
  wd.stop();

  const removedTypes = removed.map((l) => l.type).sort();
  assert.deepEqual(removedTypes, ['keydown', 'mousedown', 'scroll', 'touchstart', 'visibilitychange']);
  assert.equal(wd._checkInterval, null, 'idle-таймер остановлен');

  wd.stop();
  assert.equal(removed.length, 5, 'повторный stop не дублирует removeEventListener');
});

test('повторный start() не накапливает подписки', () => {
  wd = makeWatchdog({ onVisibilityChange: () => {} });
  wd.start();
  wd.start();

  // На каждый тип событий: добавлено 2, снято 1 → активна ровно одна подписка.
  for (const type of ['mousedown', 'keydown', 'scroll', 'touchstart', 'visibilitychange']) {
    const adds = added.filter((l) => l.type === type).length;
    const removes = removed.filter((l) => l.type === type).length;
    assert.equal(adds - removes, 1, `тип ${type}: ровно одна активная подписка`);
  }
});

test('активность через activity-handler сбрасывает отсчёт простоя', () => {
  wd = makeWatchdog();
  wd.start();
  wd._lastActivity = Date.now() - 10 * 60 * 1000;

  const handler = added.find((l) => l.type === 'mousedown').fn;
  handler();

  assert.ok(wd.getIdleMs() < 1000, 'getIdleMs близок к нулю после активности');
});

test('порог простоя превышен → onIdle один раз с целыми минутами, проверка остановлена', () => {
  const idleCalls = [];
  wd = makeWatchdog({ idleTimeoutMinutes: 5, onIdle: (m) => idleCalls.push(m) });
  wd.startIdleCheck();
  wd._lastActivity = Date.now() - 5.5 * 60 * 1000;

  wd._checkIdle();

  assert.deepEqual(idleCalls, [5], 'onIdle вызван с floor(минут простоя)');
  assert.equal(wd._checkInterval, null, 'таймер проверки остановлен после onIdle');
});

test('порог не превышен → onIdle не вызывается', () => {
  const idleCalls = [];
  wd = makeWatchdog({ idleTimeoutMinutes: 5, onIdle: (m) => idleCalls.push(m) });
  wd._lastActivity = Date.now() - 2 * 60 * 1000;

  wd._checkIdle();

  assert.equal(idleCalls.length, 0);
});

test('touch() сбрасывает отсчёт — onIdle не срабатывает', () => {
  const idleCalls = [];
  wd = makeWatchdog({ idleTimeoutMinutes: 5, onIdle: (m) => idleCalls.push(m) });
  wd._lastActivity = Date.now() - 10 * 60 * 1000;

  wd.touch();
  wd._checkIdle();

  assert.equal(idleCalls.length, 0);
});

test('visibilitychange пробрасывается в onVisibilityChange', () => {
  let calls = 0;
  wd = makeWatchdog({ onVisibilityChange: () => { calls++; } });
  wd.start();

  const handler = added.find((l) => l.type === 'visibilitychange').fn;
  handler();

  assert.equal(calls, 1);
});

test('LockManager.destroy() останавливает watchdog: все подписки сняты', () => {
  wd = makeWatchdog({ onVisibilityChange: () => {} });
  wd.start();
  const prevWatchdog = LockManager._watchdog;
  LockManager._watchdog = wd;

  try {
    LockManager.destroy();
  } finally {
    LockManager._watchdog = prevWatchdog;
  }

  const removedTypes = removed.map((l) => l.type).sort();
  assert.deepEqual(removedTypes, ['keydown', 'mousedown', 'scroll', 'touchstart', 'visibilitychange']);
});
