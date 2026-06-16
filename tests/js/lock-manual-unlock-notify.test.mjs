/**
 * Тесты уведомления при ошибке ручного снятия лока (H-SILENT).
 *
 * Гарантия: если manualUnlock не смог снять блокировку (сетевая ошибка или
 * не-2xx ответ), пользователь видит Notifications.error, а не только
 * console.error — иначе он не узнает, что акт остался заблокированным.
 */
import './_browser-stub.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { LockManager } from '../../static/js/constructor/lock-manager.js';
import { Notifications } from '../../static/js/shared/notifications.js';
import { AuthManager } from '../../static/js/shared/auth.js';
import { AppConfig } from '../../static/js/shared/app-config.js';

const originalError = Notifications.error;
const originalGetCurrentUser = AuthManager.getCurrentUser;

let errors;

beforeEach(() => {
  errors = [];
  Notifications.error = (msg) => errors.push(msg);
  AuthManager.getCurrentUser = () => 'user1';
  // Обходим вычисление base URL через window.location (нет в стабах).
  AppConfig.api._baseUrlCache = 'http://test';

  LockManager._actId = 7;
  LockManager._isExiting = false;
  LockManager._manualUnlockTriggered = false;
});

afterEach(() => {
  Notifications.error = originalError;
  AuthManager.getCurrentUser = originalGetCurrentUser;
  delete globalThis.fetch;
  LockManager._actId = null;
  LockManager._manualUnlockTriggered = false;
});

test('сетевая ошибка unlock → пользователь видит уведомление', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };

  await LockManager.manualUnlock();

  assert.equal(errors.length, 1, 'показано ровно одно уведомление');
  assert.match(errors[0], /Не удалось снять блокировку акта/);
});

test('не-2xx ответ unlock → пользователь видит уведомление', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 500 });

  await LockManager.manualUnlock();

  assert.equal(errors.length, 1, 'показано ровно одно уведомление');
  assert.match(errors[0], /Не удалось снять блокировку акта/);
});

test('успешный unlock → уведомления об ошибке нет', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200 });

  await LockManager.manualUnlock();

  assert.equal(errors.length, 0);
});
