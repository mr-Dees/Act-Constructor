/**
 * Тесты offline-обработки сбоя фонового сохранения в БД (§9 зона 3).
 *
 * Гарантии:
 *  - предупреждение о сбое показывается ОДИН раз (не спамит на каждый
 *    периодический тик), повторно — только после успешной синхронизации;
 *  - подписка на window 'online' регистрируется один раз и снимается
 *    при успехе (markAsSyncedWithDB) и в destroy;
 *  - обработчик 'online' немедленно повторяет save в БД при наличии
 *    несинхронизированных правок.
 */
import './_browser-stub.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { StorageManager } from '../../static/js/constructor/storage-manager.js';
import { APIClient } from '../../static/js/shared/api.js';
import { AppState } from '../../static/js/constructor/state/state-core.js';
import { Notifications } from '../../static/js/shared/notifications.js';

const originalWarning = Notifications.warning;
const originalSaveActContent = APIClient.saveActContent;

let warnings;
let listeners;
let saveCalls;

beforeEach(() => {
  warnings = [];
  listeners = { added: [], removed: [] };
  saveCalls = [];

  Notifications.warning = (msg) => warnings.push(msg);
  APIClient.saveActContent = async (...args) => {
    saveCalls.push(args);
  };
  globalThis.addEventListener = (type, handler) => listeners.added.push({ type, handler });
  globalThis.removeEventListener = (type, handler) => listeners.removed.push({ type, handler });

  StorageManager._setState('saved');
  StorageManager._resetDbSaveFailureState();
  globalThis.currentActId = 5;
  AppState._dragInProgress = false;
});

afterEach(() => {
  StorageManager.destroy();
  StorageManager._setState('saved');
  Notifications.warning = originalWarning;
  APIClient.saveActContent = originalSaveActContent;
  delete globalThis.addEventListener;
  delete globalThis.removeEventListener;
  globalThis.currentActId = null;
});

test('повторные сбои не дублируют предупреждение до успеха', () => {
  StorageManager._notifyDbSaveFailure();
  StorageManager._notifyDbSaveFailure();
  StorageManager._notifyDbSaveFailure();

  assert.equal(warnings.length, 1, 'предупреждение показано ровно один раз');
  assert.match(warnings[0], /Не удалось сохранить/);
});

test('подписка на online регистрируется один раз', () => {
  StorageManager._notifyDbSaveFailure();
  StorageManager._notifyDbSaveFailure();

  const onlineSubs = listeners.added.filter((l) => l.type === 'online');
  assert.equal(onlineSubs.length, 1);
});

test('после успешной синхронизации предупреждение возможно снова, подписка снята', () => {
  StorageManager._notifyDbSaveFailure();
  assert.equal(warnings.length, 1);

  StorageManager.markAsSyncedWithDB();
  const onlineUnsubs = listeners.removed.filter((l) => l.type === 'online');
  assert.equal(onlineUnsubs.length, 1, 'подписка на online снята при успехе');

  StorageManager._notifyDbSaveFailure();
  assert.equal(warnings.length, 2, 'после успеха новый сбой снова предупреждает');
});

test('обработчик online немедленно повторяет save при несинхронизированных правках', async () => {
  StorageManager._setState('local-only'); // есть несинхронизированные правки
  StorageManager._notifyDbSaveFailure();

  const onlineHandler = listeners.added.find((l) => l.type === 'online').handler;
  onlineHandler();
  await Promise.resolve(); // даём отработать async _retryDbSave

  assert.equal(saveCalls.length, 1);
  assert.deepEqual(saveCalls[0], [5, { saveType: 'periodic' }]);
});

test('обработчик online без несинхронизированных правок не дёргает save', async () => {
  StorageManager._setState('saved');
  StorageManager._notifyDbSaveFailure();

  const onlineHandler = listeners.added.find((l) => l.type === 'online').handler;
  onlineHandler();
  await Promise.resolve();

  assert.equal(saveCalls.length, 0);
});

test('destroy снимает подписку на online', () => {
  StorageManager._notifyDbSaveFailure();
  StorageManager.destroy();

  const onlineUnsubs = listeners.removed.filter((l) => l.type === 'online');
  assert.equal(onlineUnsubs.length, 1);
});
