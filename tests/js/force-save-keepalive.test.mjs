/**
 * Тесты keepalive у аварийного форс-сохранения (PERSIST-6).
 *
 * При эскалации из beforeunload обычный fetch отменяется закрытием вкладки.
 * forceSaveToDb помечает запрос keepalive:true, чтобы он пережил unload, — но
 * ТОЛЬКО если тело влезает в лимит keepalive (~64KB). Тело крупнее (типичный
 * кейс переполнения LS) уходит обычным fetch как best-effort.
 */
import './_browser-stub.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { APIClient } from '../../static/js/shared/api.js';
import { StorageManager } from '../../static/js/constructor/storage-manager.js';
import { AuthManager } from '../../static/js/shared/auth.js';

const realFetch = APIClient._fetchWithTimeout;
const realExport = StorageManager.exportActData;
const realSetBase = StorageManager.setBaseUpdatedAt;
const realSynced = StorageManager.markAsSyncedWithDB;
const realGetUser = AuthManager.getCurrentUser;

let lastOpts;

beforeEach(() => {
  APIClient._saveInFlight = false;
  APIClient._saveInFlightPromise = null;
  lastOpts = null;

  AuthManager.getCurrentUser = () => 'u42';
  StorageManager.setBaseUpdatedAt = () => {};
  StorageManager.markAsSyncedWithDB = () => {};
  APIClient._fetchWithTimeout = async (_url, opts) => {
    lastOpts = opts;
    return { ok: true, json: async () => ({ updated_at: '2026-07-06T00:00:00Z' }) };
  };
  globalThis.location = { origin: 'http://test', pathname: '/' };
});

afterEach(() => {
  APIClient._fetchWithTimeout = realFetch;
  StorageManager.exportActData = realExport;
  StorageManager.setBaseUpdatedAt = realSetBase;
  StorageManager.markAsSyncedWithDB = realSynced;
  AuthManager.getCurrentUser = realGetUser;
  APIClient._saveInFlight = false;
  APIClient._saveInFlightPromise = null;
  delete globalThis.location;
});

test('PERSIST-6: keepalive:true + маленькое тело → fetch с keepalive', async () => {
  StorageManager.exportActData = () => ({ small: 'x' });

  await APIClient.forceSaveToDb(7, { keepalive: true });

  assert.equal(lastOpts.keepalive, true, 'маленькое тело помечено keepalive');
});

test('PERSIST-6: keepalive:true + большое тело (>64KB) → обычный fetch (best-effort)', async () => {
  // Тело заведомо больше лимита keepalive.
  StorageManager.exportActData = () => ({ big: 'x'.repeat(70 * 1024) });

  await APIClient.forceSaveToDb(7, { keepalive: true });

  assert.notEqual(lastOpts.keepalive, true, 'крупное тело уходит без keepalive');
});

test('PERSIST-6: keepalive:false (обычная эскалация) → keepalive не проставляется', async () => {
  StorageManager.exportActData = () => ({ small: 'x' });

  await APIClient.forceSaveToDb(7, { keepalive: false });

  assert.notEqual(lastOpts.keepalive, true, 'без запроса keepalive — обычный fetch');
});

test('PERSIST-6: без опций forceSaveToDb работает как раньше (keepalive не проставляется)', async () => {
  StorageManager.exportActData = () => ({ small: 'x' });

  await APIClient.forceSaveToDb(7);

  assert.notEqual(lastOpts.keepalive, true);
});
