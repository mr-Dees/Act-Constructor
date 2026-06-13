/**
 * Тесты разделения APIClient.loadActContent на сетевую и применяющую фазы (§3.4).
 *
 * Диалог восстановления черновика (_maybeRestoreDraft) живёт в _applyActContent.
 * Чтобы он показывался ПОСЛЕ захвата лока, _autoLoadAct вызывает фазы по
 * отдельности: _fetchActContent → LockManager.init → _applyActContent. Фасад
 * loadActContent композирует обе фазы и сохраняет прежнее поведение для прочих
 * вызывающих (переключение акта, обновление метаданных), где лок уже захвачен.
 */
import './_browser-stub.mjs';
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { APIClient } from '../../static/js/shared/api.js';
import { AuthManager } from '../../static/js/shared/auth.js';
import { AppConfig } from '../../static/js/shared/app-config.js';

const originalFetchWithTimeout = APIClient._fetchWithTimeout;
const originalApply = APIClient._applyActContent;
const originalGetUser = AuthManager.getCurrentUser;
const originalGetUrl = AppConfig.api.getUrl;

beforeEach(() => {
  AuthManager.getCurrentUser = () => 'user42';
  // URL-резолвер в node:test без window.location — стабим, тестируем разбиение фаз.
  AppConfig.api.getUrl = (endpoint) => endpoint;
});

afterEach(() => {
  APIClient._fetchWithTimeout = originalFetchWithTimeout;
  APIClient._applyActContent = originalApply;
  AuthManager.getCurrentUser = originalGetUser;
  AppConfig.api.getUrl = originalGetUrl;
  AppConfig.readOnlyMode.isReadOnly = false;
  AppConfig.readOnlyMode.userRole = null;
});

test('_fetchActContent и _applyActContent существуют как методы', () => {
  assert.equal(typeof APIClient._fetchActContent, 'function');
  assert.equal(typeof APIClient._applyActContent, 'function');
});

test('_fetchActContent возвращает распарсенный content при 200', async () => {
  const payload = { metadata: { updated_at: 'X' }, tree: { children: [] } };
  APIClient._fetchWithTimeout = async () => ({
    ok: true,
    status: 200,
    json: async () => payload,
  });
  const content = await APIClient._fetchActContent(7);
  assert.deepEqual(content, payload);
});

test('_fetchActContent НЕ применяет content (не дёргает _applyActContent)', async () => {
  let applyCalled = false;
  APIClient._applyActContent = async () => { applyCalled = true; };
  APIClient._fetchWithTimeout = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ metadata: {}, tree: { children: [] } }),
  });
  await APIClient._fetchActContent(7);
  assert.equal(applyCalled, false, 'фаза fetch не должна применять контент');
});

test('_fetchActContent бросает ACCESS_DENIED на 403', async () => {
  APIClient._fetchWithTimeout = async () => ({ ok: false, status: 403 });
  await assert.rejects(
    () => APIClient._fetchActContent(7),
    (err) => err.code === 'ACCESS_DENIED'
  );
});

test('_fetchActContent бросает NOT_FOUND на 404', async () => {
  APIClient._fetchWithTimeout = async () => ({ ok: false, status: 404 });
  await assert.rejects(
    () => APIClient._fetchActContent(7),
    (err) => err.code === 'NOT_FOUND'
  );
});

test('_fetchActContent без авторизации бросает ошибку', async () => {
  AuthManager.getCurrentUser = () => null;
  await assert.rejects(() => APIClient._fetchActContent(7), /не авторизован/);
});

test('_applyUserPermission выставляет read-only при canEdit=false (до захвата лока)', () => {
  AppConfig.readOnlyMode.isReadOnly = false;
  AppConfig.readOnlyMode.userRole = null;
  APIClient._applyUserPermission({ userPermission: { canEdit: false, role: 'Участник' } });
  assert.equal(AppConfig.readOnlyMode.isReadOnly, true);
  assert.equal(AppConfig.readOnlyMode.userRole, 'Участник');
});

test('_applyUserPermission снимает read-only при canEdit=true', () => {
  AppConfig.readOnlyMode.isReadOnly = true;
  APIClient._applyUserPermission({ userPermission: { canEdit: true, role: 'Руководитель' } });
  assert.equal(AppConfig.readOnlyMode.isReadOnly, false);
  assert.equal(AppConfig.readOnlyMode.userRole, 'Руководитель');
});

test('_applyUserPermission без userPermission не падает и не меняет режим', () => {
  AppConfig.readOnlyMode.isReadOnly = false;
  APIClient._applyUserPermission({ metadata: {} });
  assert.equal(AppConfig.readOnlyMode.isReadOnly, false);
});

test('loadActContent (фасад) вызывает fetch, затем apply, в этом порядке', async () => {
  const order = [];
  const payload = { metadata: {}, tree: { children: [] } };
  APIClient._fetchWithTimeout = async () => {
    order.push('fetch');
    return { ok: true, status: 200, json: async () => payload };
  };
  APIClient._applyActContent = async (actId, content) => {
    order.push('apply');
    assert.equal(actId, 7);
    assert.deepEqual(content, payload);
  };
  await APIClient.loadActContent(7);
  assert.deepEqual(order, ['fetch', 'apply'], 'fetch строго до apply');
});
