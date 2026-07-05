/**
 * Тесты «эпохи грязности» при сохранении в БД (PERSIST-4).
 *
 * Раньше saveActContent выключал dirty-трекинг на ВЕСЬ асинхронный PUT, и
 * символы, напечатанные во время запроса (на прокси PUT легко >500мс), не
 * помечали акт грязным → markAsSyncedWithDB молча их хоронил. Теперь:
 *  - трекинг выключается только вокруг синхронной сериализации exportActData;
 *  - saveActContent запоминает эпоху грязности перед PUT и после ответа
 *    сравнивает: если выросла (была правка во время сохранения) — НЕ помечает
 *    акт синхронизированным и НЕ удаляет снимок (правки дошлёт следующий цикл);
 *  - пока трекинг выключен, эпоха заморожена (flush внутри exportActData не
 *    поднимает её сам → нет вечно-грязного акта).
 */
import './_browser-stub.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { StorageManager } from '../../static/js/constructor/storage-manager.js';
import { APIClient } from '../../static/js/shared/api.js';
import { AuthManager } from '../../static/js/shared/auth.js';
import { Notifications } from '../../static/js/shared/notifications.js';

const realFetch = APIClient._fetchWithTimeout;
const realExport = StorageManager.exportActData;
const realRemove = StorageManager.removeSnapshot;
const realGetUser = AuthManager.getCurrentUser;
const realSuccess = Notifications.success;
const realWarning = Notifications.warning;
const realError = Notifications.error;

let removeCalls;

beforeEach(() => {
  StorageManager._trackingDepth = 0;
  StorageManager._dirtyEpoch = 0;
  StorageManager._setState('unsaved');
  APIClient._saveInFlight = false;
  APIClient._saveInFlightPromise = null;

  removeCalls = 0;
  StorageManager.removeSnapshot = () => { removeCalls++; };
  // Сериализацию изолируем — тест про логику эпохи, не про exportData.
  StorageManager.exportActData = () => ({ tree: {}, tables: {}, textBlocks: {}, violations: {}, invoiceNodeIds: [] });
  AuthManager.getCurrentUser = () => 'u42';
  Notifications.success = () => {};
  Notifications.warning = () => {};
  Notifications.error = () => {};

  // Success-ветка saveActContent диспатчит CustomEvent — стабы для node.
  globalThis.CustomEvent = globalThis.CustomEvent || class { constructor(type, opts) { this.type = type; this.detail = opts?.detail; } };
  globalThis.document.dispatchEvent = () => {};
  // AppConfig.api.getUrl читает window.location.{origin,pathname}.
  globalThis.location = { origin: 'http://test', pathname: '/' };
});

afterEach(() => {
  StorageManager.destroy();
  StorageManager._trackingDepth = 0;
  StorageManager._setState('saved');
  APIClient._fetchWithTimeout = realFetch;
  StorageManager.exportActData = realExport;
  StorageManager.removeSnapshot = realRemove;
  AuthManager.getCurrentUser = realGetUser;
  Notifications.success = realSuccess;
  Notifications.warning = realWarning;
  Notifications.error = realError;
  delete globalThis.location;
});

/** Фейковый успешный ответ PUT /content. */
function okResponse() {
  return {
    ok: true,
    json: async () => ({ updated_at: '2026-07-06T00:00:00Z', validation_status: 'ok', validation_issues: [] }),
  };
}

test('PERSIST-4: правка во время PUT — акт остаётся dirty, снимок не удалён', async () => {
  // Мок сети: во время await PUT пользователь печатает → markAsUnsaved
  // (трекинг уже включён обратно после exportActData) → эпоха растёт.
  APIClient._fetchWithTimeout = async () => {
    StorageManager.markAsUnsaved();
    return okResponse();
  };

  await APIClient.saveActContent(7, { saveType: 'manual' });

  assert.notEqual(StorageManager._state, 'saved',
    'эпоха выросла за время PUT → акт НЕ помечен синхронизированным');
  assert.equal(removeCalls, 0,
    'снимок-черновик не удалён — правки дошлёт следующий цикл сохранения');
});

test('PERSIST-4: без правок во время PUT — акт синхронизирован, снимок удалён', async () => {
  APIClient._fetchWithTimeout = async () => okResponse();

  await APIClient.saveActContent(7, { saveType: 'manual' });

  assert.equal(StorageManager._state, 'saved',
    'эпоха не изменилась → акт синхронизирован с БД');
  assert.equal(removeCalls, 1, 'снимок-черновик удалён после успешного PUT');
});

test('PERSIST-4: пока трекинг выключен, эпоха заморожена (exportActData не поднимает её сам)', () => {
  const e0 = StorageManager.getDirtyEpoch();

  StorageManager.disableTracking();
  // Имитируем мутации из flush активного редактора во время сериализации.
  StorageManager.markAsUnsaved();
  StorageManager.markAsUnsaved();
  assert.equal(StorageManager.getDirtyEpoch(), e0, 'при выключенном трекинге эпоха не растёт');

  StorageManager.enableTracking();
  StorageManager.markAsUnsaved();
  assert.equal(StorageManager.getDirtyEpoch(), e0 + 1, 'после включения трекинга мутация двигает эпоху');
});

test('PERSIST-4: флаг in-flight снят после сохранения (сериализация _saveInFlight не сломана)', async () => {
  APIClient._fetchWithTimeout = async () => okResponse();

  await APIClient.saveActContent(7, { saveType: 'periodic' });

  assert.equal(APIClient._saveInFlight, false, 'in-flight гард снят');
  assert.equal(APIClient._saveInFlightPromise, null, 'промис завершения сброшен');
});
